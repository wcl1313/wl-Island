'use strict';
/**
 * wl-Island — machine status.
 *
 * Everything here is cheap: `os` counters for CPU/memory, one `statfs` for the
 * disk, one bridge round-trip for the process list (cached for a second so a
 * panel refreshing every 2 s never queues up requests).
 *
 * Note on CPU: `os.loadavg()` is always [0,0,0] on Windows, so usage is derived
 * from the delta of `os.cpus()` ticks between two samples.
 */
const os = require('os');
const fs = require('fs');

const round1 = (n) => Math.round(n * 10) / 10;

class SysInfoService {
  constructor({ adapter }) {
    this.adapter = adapter;
    this.prev = null;
    this.cache = null;
    this.cacheAt = 0;
    this.procs = [];
    this.procsAt = 0;
  }

  _sample() {
    let idle = 0;
    let total = 0;
    for (const c of os.cpus()) {
      idle += c.times.idle;
      total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
    }
    return { idle, total };
  }

  cpu() {
    const now = this._sample();
    if (!this.prev) {
      this.prev = now;
      return 0;
    }
    const idle = now.idle - this.prev.idle;
    const total = now.total - this.prev.total;
    this.prev = now;
    if (total <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100)));
  }

  memory() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return { total, used, percent: Math.round((used / total) * 100) };
  }

  disk() {
    try {
      const st = fs.statfsSync('C:\\');
      const total = st.blocks * st.bsize;
      const free = st.bavail * st.bsize;
      const used = total - free;
      return { total, used, free, percent: total ? Math.round((used / total) * 100) : 0 };
    } catch {
      return null;
    }
  }

  net() {
    const ifs = os.networkInterfaces();
    for (const [name, list] of Object.entries(ifs)) {
      for (const a of list || []) {
        if (a.family === 'IPv4' && !a.internal) return { ip: a.address, iface: name };
      }
    }
    return { ip: '', iface: '' };
  }

  async _procs() {
    if (Date.now() - this.procsAt < 4000) return this.procs;
    try {
      const list = await this.adapter.topProcesses();
      this.procs = (list || []).map((p) => ({ name: String(p.name || ''), mem: Number(p.mem) || 0 }));
      this.procsAt = Date.now();
    } catch { /* keep the previous list */ }
    return this.procs;
  }

  async snapshot() {
    if (this.cache && Date.now() - this.cacheAt < 1100) return this.cache;
    const [battery, procs] = await Promise.all([
      this.adapter.battery?.().catch(() => null) ?? null,
      this._procs()
    ]);
    const m = this.memory();
    const d = this.disk();
    const n = this.net();
    this.cache = {
      cpu: this.cpu(),
      mem: { used: m.used, total: m.total, percent: m.percent },
      disk: d ? { used: d.used, total: d.total, free: d.free, percent: d.percent } : null,
      battery: battery && typeof battery.percent === 'number' ? { percent: battery.percent } : null,
      uptime: Math.round(os.uptime()),
      ip: n.ip,
      iface: n.iface,
      cores: os.cpus().length,
      host: os.hostname(),
      procs
    };
    this.cacheAt = Date.now();
    return this.cache;
  }

  /**
   * Storage report for the cleanup tab: C: occupancy, %TEMP% footprint and the
   * hibernation file. All three come from one bridge call because they are read
   * together and each is a WMI query otherwise.
   */
  async storage() {
    let remote = null;
    try {
      remote = await this.adapter.storage?.();
    } catch (err) {
      remote = { error: err.message };
    }
    if (remote && remote.disk) {
      const { total, free } = remote.disk;
      return {
        disk: {
          total,
          free,
          used: total - free,
          percent: total ? Math.round(((total - free) / total) * 100) : 0
        },
        temp: { bytes: Number(remote.tempBytes) || 0, count: Number(remote.tempCount) || 0, path: remote.tempPath || '' },
        hiberfil: { bytes: Number(remote.hiberfilBytes) || 0, on: !!remote.hibernateOn },
        local: false
      };
    }
    const d = this.disk();
    return {
      disk: d ? { total: d.total, free: d.free, used: d.used, percent: d.percent } : null,
      temp: { bytes: 0, count: 0, path: process.env.TEMP || '' },
      hiberfil: { bytes: 0, on: false },
      local: true,
      error: remote?.error
    };
  }

  async cleanTemp(days = 1) {
    const res = await this.adapter.cleanTemp?.(Math.max(0, Number(days) || 1));
    if (!res) throw new Error('当前环境不支持清理');
    this.cache = null;
    this.cacheAt = 0;
    return { removed: Number(res.removed) || 0, freed: Number(res.freed) || 0 };
  }

  async setHibernate(on) {
    const res = await this.adapter.setHibernate?.(!!on);
    if (!res) throw new Error('当前环境不支持修改休眠设置');
    if (!res.ok) {
      throw new Error(res.code === 5 || res.code === 1
        ? '需要管理员权限：请以管理员身份运行再试'
        : `powercfg 返回 ${res.code}`);
    }
    return { enabled: !!res.enabled };
  }
}

module.exports = { SysInfoService, round1 };
