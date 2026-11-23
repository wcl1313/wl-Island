'use strict';
/**
 * Fullscreen watcher.
 *
 * The island is always-on-top, which is exactly what you do *not* want while a
 * film, game or slide deck owns the screen. Two seconds is the sweet spot: fast
 * enough that the island is gone before the first frame, slow enough that the
 * bridge round-trip stays invisible (it is a `GetForegroundWindow` + rect
 * comparison, a few hundred microseconds on the PowerShell side).
 *
 * Hiding is done by the window itself so the island never paints "half hidden":
 * a collapsed pill fading out over a game looks like a bug.
 */
class FullscreenService {
  constructor({ cfg, adapter, win, interval = 2000 }) {
    this.cfg = cfg;
    this.adapter = adapter;
    this.win = win;
    this.interval = interval;
    this.timer = null;
    this.busy = false;
    this.fullscreen = false;
    this.autoHidden = false;
  }

  start() {
    if (this.timer || !this.adapter?.foregroundFullscreen) return;
    this.timer = setInterval(() => this.tick(), this.interval);
    setTimeout(() => this.tick(), 1200);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const res = await this.adapter.foregroundFullscreen();
      const isFull = !!res?.fullscreen;
      if (isFull === this.fullscreen) return;
      this.fullscreen = isFull;
      this.apply();
    } catch {
      /* a dead bridge must not leave the island hidden forever */
    } finally {
      this.busy = false;
    }
  }

  /** Re-evaluate after the setting itself changed. */
  apply() {
    const wants = this.cfg.get('general.hideOnFullscreen', true) !== false;
    if (this.fullscreen && wants) {
      if (this.win?.visible) {
        this.autoHidden = true;
        this.win.hide();
      }
    } else if (this.autoHidden) {
      this.autoHidden = false;
      this.win?.show();
    }
  }

  /** A manual show (tray / hotkey) wins until the next fullscreen transition. */
  showOverride() {
    this.autoHidden = false;
  }
}

module.exports = { FullscreenService };
