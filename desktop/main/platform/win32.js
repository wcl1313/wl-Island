'use strict';
/**
 * Windows adapter.
 *
 * Media  : SMTC (GlobalSystemMediaTransportControls) through the resident
 *          PowerShell bridge, with a global media-key fallback for players that
 *          never publish a session.
 * BT     : PnP device enumeration.
 * Battery: Win32_Battery.
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

/**
 * `spawn` is a kernel-level call: unlike `fs`, Electron's asar shim cannot
 * redirect it into the archive. electron-builder unpacks `*.ps1` next to the
 * asar, so point at that copy when we are running from a packaged app.
 */
function resolveScript() {
  const packed = path.join(__dirname, 'win32-bridge.ps1');
  if (!packed.includes(`app.asar${path.sep}`) && !packed.includes('app.asar/')) return packed;
  const unpacked = packed.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  return fs.existsSync(unpacked) ? unpacked : packed;
}

const SCRIPT = resolveScript();

class PsBridge {
  constructor() {
    this.proc = null;
    this.buf = Buffer.alloc(0);
    this.pending = new Map();
    this.seq = 0;
    this.deadUntil = 0;
    this.starting = null;
  }

  async _ensure() {
    if (this.proc) return;
    if (Date.now() < this.deadUntil) throw new Error('bridge cooling down');
    this.proc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

    this.buf = Buffer.alloc(0);
    this.proc.stdout.on('data', (chunk) => this._onData(chunk));
    this.proc.stderr.on('data', (d) => {
      const s = d.toString('utf8').trim();
      if (s) console.warn('[ps-bridge]', s.slice(0, 400));
    });
    this.proc.on('exit', (code) => {
      this.proc = null;
      this.deadUntil = Date.now() + 3000;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`bridge exited (${code})`));
      }
      this.pending.clear();
    });
    this.proc.on('error', () => { this.proc = null; });
  }

  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    let idx;
    while ((idx = this.buf.indexOf(0x0a)) !== -1) {
      const line = this.buf.subarray(0, idx).toString('utf8').trim();
      this.buf = this.buf.subarray(idx + 1);
      if (!line.startsWith('{')) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new Error(msg.error || 'bridge error'));
    }
    if (this.buf.length > 4 * 1024 * 1024) this.buf = Buffer.alloc(0);
  }

  async request(cmd, payload = {}, timeout = 5000) {
    await this._ensure();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout: ${cmd}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.proc.stdin.write(`${JSON.stringify({ id, cmd, ...payload })}\n`);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  dispose() {
    if (this.proc) {
      try { this.proc.stdin.end(); } catch {}
      try { this.proc.kill(); } catch {}
      this.proc = null;
    }
  }
}

module.exports = function createWin32Adapter({ cfg }) {
  const bridge = new PsBridge();
  let alive = false;

  (async () => {
    try { await bridge.request('ping', {}, 6000); alive = true; } catch { alive = false; }
  })();

  return {
    name: 'win32',
    bridge,
    get alive() { return alive; },

    async mediaStatus() {
      const s = await bridge.request('media.status', { target: cfg.get('media.preferApp') || undefined });
      return s;
    },
    async mediaSessions() {
      try {
        const list = await bridge.request('media.sessions');
        return Array.isArray(list) ? list : [];
      } catch { return []; }
    },
    async mediaArt() {
      return bridge.request('media.art', { target: cfg.get('media.preferApp') || undefined }, 8000);
    },
    /**
     * Players that never publish an SMTC session (网易云 3.x disables Chromium's
     * MediaSessionService, so it registers nothing). Returns the window-title
     * track plus the speaker peak level, which is the only honest answer to
     * "is sound coming out right now".
     */
    async mediaFallback() {
      try {
        return await bridge.request('media.fallback', {}, 4000);
      } catch {
        return { players: [], peak: 0 };
      }
    },
    async mediaControl(action, arg = {}) {
      return bridge.request('media.control', { action, ...arg }, 6000);
    },
    async bluetooth() {
      const list = await bridge.request('bt.list');
      return (list || []).map((d) => ({
        name: d.name,
        id: d.id,
        connected: !!d.connected,
        raw: d.status
      }));
    },
    async battery() {
      try {
        const info = await bridge.request('net.info');
        return typeof info.battery === 'number' ? { percent: info.battery } : null;
      } catch { return null; }
    },
    /** Is the left mouse button still down? Used to end a drag reliably. */
    async mouseLeft() {
      const r = await bridge.request('mouse.left', {}, 900);
      return !!(r && r.down);
    },
    async mute() {
      await bridge.request('act.mute', {}, 2500);
      return true;
    },
    async topProcesses() {
      try {
        const list = await bridge.request('proc.top', {}, 2500);
        return Array.isArray(list) ? list : [];
      } catch { return []; }
    },
    async usbDevices() {
      try {
        const list = await bridge.request('dev.usb', {}, 8000);
        return Array.isArray(list) ? list : [];
      } catch { return []; }
    },
    async serialPorts() {
      try {
        const list = await bridge.request('dev.com', {}, 8000);
        return Array.isArray(list) ? list : [];
      } catch { return []; }
    },
    /** Is the foreground window a real fullscreen app (not maximised)? */
    async foregroundFullscreen() {
      try {
        return await bridge.request('fg.fullscreen', {}, 2500) || { fullscreen: false };
      } catch {
        return { fullscreen: false };
      }
    },
    async storage() {
      return bridge.request('sys.storage', {}, 12000);
    },
    async cleanTemp(days) {
      return bridge.request('sys.cleanTemp', { days }, 60000);
    },
    async setHibernate(on) {
      return bridge.request('sys.hibernate', { on: !!on }, 20000);
    },
    dispose() { bridge.dispose(); }
  };
};
