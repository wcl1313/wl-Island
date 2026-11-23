'use strict';
/**
 * Media service — one state model over three very different backends.
 *
 * The hard part is not reading metadata, it is *controlling* every player:
 *   Windows : SMTC → fallback global media keys (covers players with no session)
 *   macOS   : MediaRemote via media-control → AppleScript → media key codes
 *   Linux   : MPRIS via playerctl (what 99% of Linux players speak)
 *
 * 网易云 3.x ships Chromium with MediaSessionService disabled and registers
 * nothing with SMTC, so its metadata comes from the window title. Cover art and
 * lyrics then have to be resolved out-of-band from NetEase's public endpoints
 * (see _resolveSong). Everything here is best-effort: a failed lookup only means
 * "no cover", never "no player".
 */
const { EventEmitter } = require('events');

const ART_CACHE_MAX = 12;
const NETEASE = 'https://music.163.com';
const EMPTY = {
  active: false, app: null, appId: null, title: null, artist: null, album: null,
  playing: false, position: 0, duration: 0, canSeek: false, canControl: false,
  artwork: null, lyrics: null, sessions: [], reachable: false
};

/** "SLOW MOTION (CASTLE. Remix)" and the API's spelling must compare equal. */
function normTitle(s) {
  return String(s || '').toLowerCase().replace(/[\s\-_./()（）\[\]【】·,，'"]/g, '');
}

async function nGet(url, ms = 6000) {
  const res = await fetch(url, {
    headers: {
      Referer: 'https://music.163.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36'
    },
    signal: AbortSignal.timeout(ms)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

async function nJson(url, ms = 6000) {
  return (await nGet(url, ms)).json();
}

class MediaService extends EventEmitter {
  constructor({ adapter, cfg }) {
    super();
    this.adapter = adapter;
    this.cfg = cfg;
    this.state = { ...EMPTY };
    this.timer = null;
    this.artCache = new Map();
    this.lyricCache = new Map();
    /** key -> { id, picUrl, duration } ; failures are not cached (retry next track) */
    this.songCache = new Map();
    /** de-duplicate the two lookups fired by the same track change */
    this.songPending = new Map();
    this.lastKey = '';
    this.busy = false;
    this.failures = 0;
    /** Last time the speakers were actually loud — see _fallback(). */
    this.lastSoundAt = 0;
    /** Local clock for title-only players: lyrics need a position to advance. */
    this.clock = { key: '', pos: 0, at: 0, playing: false };
  }

  start() {
    this.stop();
    if (!this.cfg.get('media.enabled', true)) return;
    const interval = Math.max(600, Number(this.cfg.get('media.pollInterval', 1600)));
    const tick = () => this.poll().catch(() => {});
    tick();
    this.timer = setInterval(tick, interval);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  restart() { this.start(); }

  async poll() {
    if (this.busy) return;
    this.busy = true;
    try {
      const s = await this.adapter.mediaStatus();
      let next = { ...EMPTY, ...s, reachable: true };

      // SMTC is authoritative when it has something, but plenty of players
      // never register a session at all (see _fallback). Fall through to the
      // window-title + speaker-peak path whenever SMTC is silent.
      const pin = String(this.cfg.get('media.preferApp') || '');
      const pinnedFallback = pin.startsWith('fallback:');
      if (pinnedFallback) {
        const fb = await this._fallback();
        next = fb ? { ...EMPTY, ...fb, reachable: true } : { ...EMPTY, reachable: true };
        if (!fb) this.lastSoundAt = 0;
      } else if (!next.active) {
        const fb = await this._fallback();
        if (fb) next = { ...next, ...fb, reachable: true };
        else this.lastSoundAt = 0;
      }

      const key = `${next.title || ''}|${next.artist || ''}`;
      const trackChanged = key !== this.lastKey;
      if (trackChanged && next.active) {
        this.lastKey = key;
        this.fetchArtwork(key, next).catch(() => {});
        if (this.cfg.get('media.lyrics')) this.fetchLyrics(next).catch(() => {});
      }
      if (!next.active) this.lastKey = '';

      // Per-track extras come from the caches. This also drops a stale cover /
      // lyric line the moment the song changes (a poll used to carry the
      // previous track's lyrics forward indefinitely).
      next.artwork = next.active ? (this.artCache.get(key) || null) : null;
      next.lyrics = next.active ? (this.lyricCache.get(key) || null) : null;
      next.stamp = Date.now();
      this._commit(next);
      this.failures = 0;
    } catch (err) {
      this.failures += 1;
      if (this.failures === 3) {
        this._commit({ ...this.state, reachable: false });
      }
    } finally {
      this.busy = false;
    }
  }

  /**
   * Resolve a title-only track against NetEase's public search/detail endpoints.
   * Returns `{ id, picUrl, duration }` or null. Both the cover and the lyric
   * lookup share this, so one search serves both.
   */
  async _resolveSong(title, artist) {
    const key = `${title || ''}|${artist || ''}`;
    if (this.songCache.has(key)) return this.songCache.get(key);
    if (this.songPending.has(key)) return this.songPending.get(key);

    const task = (async () => {
      try {
        const q = encodeURIComponent(`${title || ''} ${artist || ''}`.trim());
        const j = await nJson(`${NETEASE}/api/search/get?type=1&s=${q}&limit=5`);
        const songs = Array.isArray(j?.result?.songs) ? j.result.songs : [];
        const want = normTitle(title);
        const song = songs.find((x) => normTitle(x.name) === want)
          || songs.find((x) => {
            const n = normTitle(x.name);
            return n && want && (n.includes(want) || want.includes(n));
          });
        if (!song) return null;

        let picUrl = song.album?.picUrl || song.al?.picUrl || '';
        let duration = Math.round(Number(song.duration || 0) / 1000);
        if (!picUrl) {
          const d = await nJson(`${NETEASE}/api/song/detail?ids=%5B${song.id}%5D`);
          const full = d?.songs?.[0];
          picUrl = full?.album?.picUrl || full?.al?.picUrl || '';
          duration = Math.round(Number(full?.duration || song.duration || 0) / 1000) || duration;
        }
        const out = { id: song.id, picUrl, duration: duration > 0 ? duration : 0, name: song.name };
        this.songCache.set(key, out);
        while (this.songCache.size > 40) this.songCache.delete(this.songCache.keys().next().value);
        return out;
      } catch {
        return null;
      } finally {
        this.songPending.delete(key);
      }
    })();
    this.songPending.set(key, task);
    return task;
  }

  /**
   * Window-title fallback for players with no SMTC session.
   *
   * Peak (not session state) decides playback: Chromium keeps its audio stream
   * Active for minutes after a pause, so state alone would say "playing"
   * forever. A 2 s hold keeps a gap between tracks from flickering the icon.
   */
  async _fallback() {
    if (typeof this.adapter.mediaFallback !== 'function') return null;
    const fb = await this.adapter.mediaFallback();
    const list = Array.isArray(fb?.players) ? fb.players : [];
    if (!list.length) { this.lastSoundAt = 0; return null; }
    const p = list[0];
    const now = Date.now();
    const settled = now - (this.controlAt || 0) > 1400;
    // A machine without an endpoint meter cannot tell silence from "meter is
    // missing". Assume playback (the usual case) and follow the user's own
    // play/pause presses instead of forever showing a paused icon.
    const meterOk = fb.meter !== false;
    if (meterOk && settled && Number(fb.peak) > 0.004) this.lastSoundAt = now;
    const playing = !meterOk
      ? (this.intentPlaying === undefined ? true : !!this.intentPlaying)
      : (settled ? now - this.lastSoundAt < 2000 : !!this.intentPlaying);

    // Title-only players have no timeline. Keep a local clock so LRC lines can
    // advance, and use the real duration once the song has been resolved.
    const key = `${p.title || ''}|${p.artist || ''}`;
    const c = this.clock;
    if (c.key !== key) { c.key = key; c.pos = 0; c.at = now; c.playing = playing; }
    else {
      if (c.playing) c.pos += Math.max(0, (now - c.at) / 1000);
      c.at = now;
      c.playing = playing;
    }
    const song = this.songCache.get(key) || null;
    const duration = song?.duration || 0;
    const position = duration > 0 ? Math.min(c.pos, duration) : c.pos;

    return {
      active: true,
      app: p.app || '播放器',
      appId: `fallback:${p.process || p.app}`,
      title: p.title || '',
      artist: p.artist || '',
      album: '',
      playing,
      position,
      duration,
      canSeek: false,
      canControl: true,
      untimed: !duration
    };
  }

  _commit(next) {
    const a = this.state;
    const changed = ['active', 'title', 'artist', 'album', 'playing', 'duration', 'app', 'artwork', 'reachable']
      .some((k) => a[k] !== next[k]) || Math.abs((a.position || 0) - (next.position || 0)) > 1.2;
    this.state = next;
    if (changed) this.emit('state', this.publicState());
  }

  publicState() {
    const { artwork, ...rest } = this.state;
    return { ...rest, artwork: artwork ? true : false };
  }

  fullState() { return this.state; }

  /** Cover art: SMTC thumbnail first, then a NetEase lookup for title-only players. */
  async fetchArtwork(key, state = this.state) {
    if (!this.cfg.get('media.showArtwork', true)) return;
    if (!key || key === '|') return;
    if (this.artCache.has(key)) {
      const hit = this.artCache.get(key);
      if (hit) { this.state = { ...this.state, artwork: hit }; this.emit('state', this.publicState()); }
      return;
    }
    const online = String(state.appId || '').startsWith('fallback:');
    let url = null;
    if (!online) {
      try {
        const art = await this.adapter.mediaArt();
        if (art?.b64) url = `data:${art.mime};base64,${art.b64}`;
      } catch { /* no SMTC thumbnail */ }
    }
    if (!url) {
      const [title, artist] = key.split('|');
      const song = await this._resolveSong(title, artist);
      if (song?.picUrl) {
        try {
          const src = song.picUrl + (song.picUrl.includes('?') ? '&' : '?') + 'param=300y300';
          const res = await nGet(src, 7000);
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > 128 && buf.length < 2_000_000) {
            const mime = res.headers.get('content-type') || 'image/jpeg';
            url = `data:${mime};base64,${buf.toString('base64')}`;
          }
        } catch { /* offline or blocked: show the placeholder instead */ }
      }
    }
    this.artCache.set(key, url);              // null is cached too: no retry storm
    while (this.artCache.size > ART_CACHE_MAX) this.artCache.delete(this.artCache.keys().next().value);
    if (!url) return;
    this.state = { ...this.state, artwork: url };
    this.emit('state', this.publicState());
    this.emit('artwork', url);
  }

  /** Lyrics: local NetEaseCloudMusicApi when configured, otherwise the public endpoint. */
  async fetchLyrics(state) {
    const api = String(this.cfg.get('media.neteaseApi') || '').replace(/\/+$/, '');
    const key = `${state.title}|${state.artist}`;
    if (this.lyricCache.has(key)) {
      this.state = { ...this.state, lyrics: this.lyricCache.get(key) };
      this.emit('state', this.publicState());
      return;
    }
    let lrc = '';
    let songId = 0;
    if (api) {
      try {
        const q = encodeURIComponent(`${state.title} ${state.artist || ''}`.trim());
        const searchRes = await nJson(`${api}/search?keywords=${q}&limit=1`, 6000);
        const song = searchRes?.result?.songs?.[0];
        if (song) {
          songId = song.id;
          const lyricRes = await nJson(`${api}/lyric?id=${song.id}`, 6000);
          lrc = lyricRes?.lrc?.lyric || '';
        }
      } catch { /* local api is optional */ }
    }
    if (!lrc) {
      const song = songId ? { id: songId } : await this._resolveSong(state.title, state.artist);
      if (song?.id) {
        try {
          const j = await nJson(`${NETEASE}/api/song/lyric?id=${song.id}&lv=1&kv=1&tv=-1`, 6000);
          lrc = j?.lrc?.lyric || '';
        } catch { /* instrumental or offline */ }
      }
    }
    const lines = parseLrc(lrc);
    this.lyricCache.set(key, lines);
    while (this.lyricCache.size > 10) this.lyricCache.delete(this.lyricCache.keys().next().value);
    if (!lines.length) return;
    this.state = { ...this.state, lyrics: lines };
    this.emit('state', this.publicState());
  }

  async control(action, arg = {}) {
    const res = await this.adapter.mediaControl(action, arg);
    // Optimistic local update so the UI never feels laggy.
    if (action === 'toggle' || action === 'play' || action === 'pause') {
      const playing = action === 'toggle' ? !this.state.playing : action === 'play';
      this.state = { ...this.state, playing };
      this.emit('state', this.publicState());
      // A paused 网易云 still shows a decaying peak for a few hundred ms, which
      // would bounce the icon back to ▶ right after the user pressed pause.
      // Trust the user's intent for a moment and drop the stale sound stamp.
      this.controlAt = Date.now();
      this.lastSoundAt = 0;
      this.intentPlaying = playing;
    }
    if (action === 'seek') {
      this.state = { ...this.state, position: Number(arg.position) || 0, stamp: Date.now() };
      this.emit('state', this.publicState());
    }
    // Next / previous resets the local clock at the next poll (track key changes).
    setTimeout(() => this.poll().catch(() => {}), 420);
    return res;
  }

  async sessions() {
    let list = [];
    try { list = await this.adapter.mediaSessions(); } catch { list = []; }
    if (!Array.isArray(list)) list = [];
    // Surface title-only players in the same chip row, otherwise the panel
    // says "no switchable sessions" while 网易云 is clearly playing.
    if (typeof this.adapter.mediaFallback === 'function') {
      try {
        const fb = await this.adapter.mediaFallback();
        for (const p of (fb?.players || [])) {
          const id = `fallback:${p.process}`;
          if (list.some((s) => s.id === id || s.app === p.app)) continue;
          list.push({
            id,
            app: p.app,
            title: p.title,
            artist: p.artist,
            playing: this.state.appId === id && !!this.state.playing
          });
        }
      } catch { /* chips are cosmetic */ }
    }
    return list;
  }
}

/** "[01:23.45]text" → [{ t: 83.45, text }] */
const LRC_META = /^(作词|作曲|编曲|演唱|原唱|制作人|监制|混音|母带|和声|录音|出品|词|曲|Lyric|Lyrics|Composed|Composer|Arranged|Arrangement|Produced|Producer|Mixed|Mastered)\s*[:：]/i;
function parseLrc(lrc) {
  const out = [];
  const re = /^\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\](.*)$/;
  for (const raw of String(lrc).split(/\r?\n/)) {
    const m = raw.match(re);
    if (!m) continue;
    const t = Number(m[1]) * 60 + Number(m[2]) + Number(`0.${m[3] || 0}`);
    const text = (m[4] || '').trim();
    // NetEase LRC files open with credit lines (作词 : … / 作曲 : …). Showing
    // those as the "current lyric" for the first minute looks broken.
    if (!text || LRC_META.test(text)) continue;
    out.push({ t: Math.round(t * 100) / 100, text });
  }
  return out.sort((a, b) => a.t - b.t).slice(0, 400);
}

module.exports = { MediaService, parseLrc };
