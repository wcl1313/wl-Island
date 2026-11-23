'use strict';
/**
 * wl-Island — configuration store.
 *
 * One JSON file in userData, atomic writes, deep-merged against defaults so
 * upgrades never break an existing install.
 *
 * The important bit here is `patch()`: it reports the *actual* changed paths
 * instead of a blanket `['*']`. The main process restarts services per prefix,
 * so a blanket emit meant every slider drag restarted media polling, bluetooth
 * polling and the HTTP server — which is exactly the kind of churn that shows
 * up as flicker and dropped state.
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const THEMES = [
  'midnight', 'graphite', 'titanium', 'ocean', 'forest',
  'violet', 'rose', 'ember', 'snow', 'ivory',
  'moss', 'indigo', 'clay', 'steel'
];

const EYES = ['classic', 'cat', 'sparkle', 'ring', 'pixel', 'glasses', 'sleepy', 'heart'];

const DEFAULTS = {
  general: {
    /**
     * Placement anchor: the island's top-centre point in DIP screen coordinates.
     * `null` means "top centre of the primary work area". Everything — resizing,
     * scaling, expanding — is derived from this single point, so the island can
     * grow around a fixed anchor instead of being re-centred on every frame.
     */
    anchor: null,
    scale: 1,
    opacity: 1,
    alwaysOnTop: true,
    launchAtLogin: false,
    autoCollapse: true,
    autoCollapseDelay: 8,
    collapseOnLeave: true, // fold up as soon as the cursor leaves
    leaveDelay: 0.4, // seconds of grace before folding
    displayId: null,
    reduceMotion: false,
    /**
     * Hide the island while any app is genuinely fullscreen (video, game,
     * presentation). The watcher compares the foreground window rect against
     * its monitor, so a maximised window does not count.
     */
    hideOnFullscreen: true,
    onboardingDone: false
  },
  appearance: {
    theme: 'midnight', // see THEMES
    eyes: 'classic', // classic | cat | sparkle | ring | pixel
    blur: 34,
    tintOpacity: 0.68,
    highlight: true,
    noise: true,
    artworkTint: true,
    radius: 26
  },
  media: {
    enabled: true,
    pollInterval: 1600,
    showArtwork: true,
    lyrics: false,
    lyricOnPill: true, // show the current line in the collapsed pill
    neteaseApi: '',
    preferApp: '',
    showControlsInPill: true
  },
  ai: {
    provider: 'deepseek', // deepseek | openai | moonshot | zhipu | qwen | siliconflow | ollama | custom
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    balance: 'deepseek', // deepseek | openai | none
    maxTokens: 1200,
    temperature: 0.7,
    contextWindow: 64000,
    nickname: 'Island AI',
    systemPrompt: '你叫 Island AI，是嵌在 Windows 桌面灵动岛里的私人助手。回答准确、克制、直接，默认用中文；需要步骤时给出可执行的短清单，不要客套话。'
  },
  bluetooth: { enabled: true, pollInterval: 10000 },
  clock: { format24: true, alarms: [], lastTimerEnd: 0 },
  health: {
    sittingEnabled: true,
    sittingMinutes: 45,
    waterEnabled: true,
    waterMinutes: 60,
    lastWaterAt: 0,
    lastStandAt: 0
  },
  stash: { dir: '', maxDays: 7, maxFiles: 80 },
  notify: { serverEnabled: true, port: 7788, mirrorToSystem: false, sound: true },
  storage: { tempDays: 1, lastCleanAt: 0, lastFreed: 0 },
  usage: { promptTokens: 0, completionTokens: 0, requests: 0, month: '' }
};

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);

function merge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (isPlain(v) && isPlain(base ? base[k] : null)) out[k] = merge(base[k], v);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

/** dot-path get, e.g. get('media.pollInterval') */
function pick(obj, keyPath) {
  return keyPath.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

/**
 * Every leaf that differs, as dot paths. Arrays and scalars are reported as a
 * single path: replacing a list is one change, not N.
 */
function diffPaths(prev, next, prefix = '', out = []) {
  if (prev === next) return out;
  const bothPlain = isPlain(prev) && isPlain(next);
  if (!bothPlain) {
    if (prefix) out.push(prefix);
    return out;
  }
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const k of keys) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (!(k in prev) || !(k in next)) { out.push(p); continue; }
    diffPaths(prev[k], next[k], p, out);
  }
  return out;
}

class Config {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'wl-island.config.json');
    this.data = merge(DEFAULTS, this._read());
    this.listeners = new Set();
  }

  _read() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  _write() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
      return true;
    } catch (err) {
      console.error('[config] write failed:', err.message);
      return false;
    }
  }

  all() {
    return this.data;
  }

  get(keyPath, fallback) {
    const v = pick(this.data, keyPath);
    return v === undefined ? fallback : v;
  }

  patch(partial, { silent = false } = {}) {
    const prev = this.data;
    const next = merge(prev, partial);
    const keys = diffPaths(prev, next);
    if (!keys.length) return this.data; // nothing changed: no write, no event
    this.data = next;
    this._write();
    if (!silent) this._emit(keys);
    return this.data;
  }

  set(keyPath, value) {
    const keys = keyPath.split('.');
    let node = this.data;
    for (let i = 0; i < keys.length - 1; i += 1) {
      if (!isPlain(node[keys[i]])) node[keys[i]] = {};
      node = node[keys[i]];
    }
    node[keys[keys.length - 1]] = value;
    this._write();
    this._emit([keyPath]);
    return this.data;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(keys) {
    for (const fn of this.listeners) {
      try {
        fn(this.data, keys);
      } catch (err) {
        console.error('[config] listener error:', err.message);
      }
    }
  }
}

module.exports = { Config, DEFAULTS, THEMES, merge, diffPaths };
