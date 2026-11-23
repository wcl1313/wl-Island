'use strict';
/**
 * wl-Island — the island window.
 *
 * Design contract (this is what keeps the island frameless *and* harmless):
 *   1. The window is ALWAYS exactly as large as the island + PAD on every side.
 *      A transparent window in Chromium still swallows clicks, so a big
 *      "invisible" window would create a dead zone over the user's desktop.
 *   2. One anchor rules geometry: the island's **top-centre point**, stored in
 *      DIP screen coordinates. Every resize, scale change and expansion derives
 *      the window rect from that point, so the island grows symmetrically
 *      around it. The previous build re-centred the window from its current
 *      bounds on every size tick *and* on every config change — two owners of
 *      the same value, fighting each other, which is what made dragging the
 *      position sliders flicker.
 *   3. hasShadow / thickFrame / roundedCorners are all off: on Windows DWM
 *      paints a shadow for the *window rect*, not for our rounded CSS shape, so
 *      enabling them draws a visible box around the island.
 *   4. Dragging is driven here, not by `-webkit-app-region: drag`, because a
 *      drag region swallows clicks and the pill has to stay clickable.
 */
const { BrowserWindow, screen } = require('electron');
const path = require('path');

const PAD = 28; // room for the CSS drop shadow; must match #stage padding

const COLLAPSED = { w: 144, h: 38 };
const DEFAULT_CSS = { w: COLLAPSED.w + PAD * 2, h: COLLAPSED.h + PAD * 2 };

class IslandWindow {
  constructor(cfg, { isDev = false, adapter = null } = {}) {
    this.cfg = cfg;
    this.isDev = isDev;
    this.adapter = adapter;
    this.win = null;
    this.css = { ...DEFAULT_CSS }; // last size reported by the renderer
    this.drag = null;
    this.cursorTimer = null;
    this.lastLook = '';
    this.crashTimer = null;
  }

  create() {
    const scale = this.cfg.get('general.scale', 1);
    const b = this.boundsFor(this.anchor(), DEFAULT_CSS, scale);

    this.win = new BrowserWindow({
      ...b,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      acceptFirstMouse: true,
      roundedCorners: false,
      thickFrame: false, // Windows: no resize border / DWM frame at all
      title: 'wl-Island',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
        spellcheck: false
      }
    });

    this.win.setAlwaysOnTop(this.cfg.get('general.alwaysOnTop', true), 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.win.setMenuBarVisibility(false);
    this.win.setSkipTaskbar(true);

    // `?dev=1` exposes a state handle the harness drives; production loads the
    // plain file so no debug surface exists in a shipped build.
    this.win.loadFile(
      path.join(__dirname, '..', 'renderer', 'index.html'),
      this.isDev ? { query: { dev: '1' } } : undefined
    );

    this.win.once('ready-to-show', () => {
      this.win.showInactive();
      this.startCursorFeed();
      if (this.isDev) {
        console.log('[wl] ready-to-show', JSON.stringify(this.win.getBounds()));
      }
    });

    // CSS px are scaled through the zoom factor so that "size" means the same
    // thing to the layout, the window bounds and the ResizeObserver.
    this.win.webContents.on('did-finish-load', () => {
      this.crashCount = 0;
      try { this.win.webContents.setZoomFactor(this.cfg.get('general.scale', 1)); } catch {}
      this.send('wl:boot', { scale: this.cfg.get('general.scale', 1) });
    });

    this.win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error('[wl] renderer load failed', code, desc, url);
    });

    // A crashed renderer in an always-on-top window is invisible to the user,
    // so bring it back instead of leaving an empty desktop ornament. Recovery
    // is rate-limited: a renderer that dies during boot would otherwise reload
    // in a tight loop and pin a core forever.
    this.win.webContents.on('render-process-gone', (_e, details) => {
      console.error('[wl] render process gone:', details?.reason);
      const now = Date.now();
      if (now - (this.lastCrashAt || 0) < 60_000) this.crashCount = (this.crashCount || 1) + 1;
      else this.crashCount = 1;
      this.lastCrashAt = now;
      if (this.crashCount > 3) {
        console.error('[wl] renderer keeps dying, leaving it down');
        return;
      }
      clearTimeout(this.crashTimer);
      this.crashTimer = setTimeout(() => {
        if (this.win && !this.win.isDestroyed()) this.win.reload();
      }, 800 * this.crashCount);
    });

    // A wedged renderer looks identical to a hung island: no paint, no clicks.
    // Reloading is the only recovery Electron offers, so do it once per stall.
    this.win.webContents.on('unresponsive', () => {
      console.error('[wl] renderer unresponsive');
      if (this.win && !this.win.isDestroyed()) this.win.reload();
    });

    this.win.webContents.on('console-message', (...args) => {
      const first = args[0];
      if (first && typeof first === 'object' && 'message' in first) {
        if (this.isDev || first.level === 'error') console.log('[renderer]', first.level, first.message);
        return;
      }
      const [, level, message] = args;
      if (this.isDev || level >= 2) console.log('[renderer]', level, message);
    });

    this.win.on('closed', () => { this.win = null; this.stopCursorFeed(); });
    this.win.on('hide', () => this.stopCursorFeed());
    this.win.on('show', () => this.startCursorFeed());

    if (this.isDev) {
      try { require('./dev-harness')(this.win); } catch (err) { console.warn('[harness]', err.message); }
    }

    return this.win;
  }

  get display() {
    const id = this.cfg.get('general.displayId');
    if (id != null) {
      const d = screen.getAllDisplays().find((x) => x.id === id);
      if (d) return d;
    }
    return screen.getPrimaryDisplay();
  }

  get visible() {
    return !!this.win && !this.win.isDestroyed() && this.win.isVisible();
  }

  /** Top-centre of the island, in DIP. The single source of truth for placement. */
  anchor() {
    const saved = this.cfg.get('general.anchor');
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      return { x: saved.x, y: saved.y };
    }
    const wa = this.display.workArea;
    const scale = this.cfg.get('general.scale', 1);
    return { x: Math.round(wa.x + wa.width / 2), y: Math.round(wa.y + 8 * scale) };
  }

  /** Anchor derived from the live window rect (used while dragging). */
  liveAnchor() {
    if (!this.win || this.win.isDestroyed()) return this.anchor();
    const b = this.win.getBounds();
    const pad = Math.round(PAD * this.cfg.get('general.scale', 1));
    return { x: b.x + Math.round(b.width / 2), y: b.y + pad };
  }

  boundsFor(anchor, css, scale = this.cfg.get('general.scale', 1)) {
    const pad = Math.round(PAD * scale);
    const width = Math.max(120, Math.round(css.w * scale));
    const height = Math.max(60, Math.round(css.h * scale));
    const wa = this.display.workArea;

    let x = Math.round(anchor.x - width / 2);
    let y = Math.round(anchor.y - pad);

    // Keep a grabbable part on screen even if the display layout changed.
    const minVisible = 90;
    x = Math.min(Math.max(x, wa.x - width + minVisible), wa.x + wa.width - minVisible);
    y = Math.min(Math.max(y, wa.y - 12), wa.y + wa.height - 70);
    return { x, y, width, height };
  }

  applyAnchor(anchor, { persist = false } = {}) {
    if (!this.win || this.win.isDestroyed()) return;
    this.setBoundsStable(this.boundsFor(anchor, this.css));
    if (persist) this.cfg.set('general.anchor', { x: Math.round(anchor.x), y: Math.round(anchor.y) });
  }

  /** Re-apply placement from config (display hot-plug, preset buttons, reset). */
  applyPosition() {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.drag) return; // never fight an in-flight drag
    this.setBoundsStable(this.boundsFor(this.anchor(), this.css));
  }

  /**
   * The renderer reports the size of #stage, which already contains the 28 px
   * shadow padding. The window becomes exactly that, so a transparent window is
   * never larger than the visible island and never eats desktop clicks.
   */
  setContentSize(w, h) {
    if (!this.win || this.win.isDestroyed()) return;
    const bw = Math.max(120, Math.round(w));
    const bh = Math.max(60, Math.round(h));
    if (this.css.w === bw && this.css.h === bh) return;
    this.css = { w: bw, h: bh };
    // While dragging the anchor is authoritative and comes from the live rect;
    // recomputing from a stored anchor mid-drag would snap the island away.
    const anchor = this.drag ? this.liveAnchor() : this.anchor();
    this.setBoundsStable(this.boundsFor(anchor, this.css));
  }

  /**
   * setBounds with a no-op guard. The renderer reports the stage size on every
   * content change; writing identical bounds makes DWM re-composite the window
   * and shows up as a one-frame flicker of the glass.
   */
  setBoundsStable(rect) {
    if (!this.win || this.win.isDestroyed()) return;
    const cur = this.win.getBounds();
    if (cur.x === rect.x && cur.y === rect.y && cur.width === rect.width && cur.height === rect.height) return;
    this.win.setBounds(rect, false);
  }

  /* ------------------------------------------------------------------ drag */

  startDrag() {
    if (!this.win || this.win.isDestroyed() || this.drag) return;
    this.drag = {
      anchor0: this.liveAnchor(),
      cursor0: screen.getCursorScreenPoint(),
      startedAt: Date.now(),
      ticks: 0,
      askBridge: 0
    };
    let last = this.drag.cursor0;

    this.drag.timer = setInterval(() => {
      if (!this.drag) return;
      const p = screen.getCursorScreenPoint();
      if (p.x === last.x && p.y === last.y) {
        // No movement: still verify the button every ~6 ticks (≈100 ms), because
        // a pointerup that lands outside the moving window never reaches us.
        this.drag.askBridge += 1;
        if (this.drag.askBridge % 6 === 0) this._checkButton();
        return;
      }
      last = p;
      this.drag.ticks += 1;
      const a = {
        x: this.drag.anchor0.x + (p.x - this.drag.cursor0.x),
        y: this.drag.anchor0.y + (p.y - this.drag.cursor0.y)
      };
      this.setBoundsStable(this.boundsFor(a, this.css));
    }, 16);
  }

  _checkButton() {
    if (!this.adapter?.mouseLeft) return;
    this.adapter.mouseLeft().then((down) => {
      if (!down) this.endDrag();
    }).catch(() => {});
  }

  endDrag() {
    if (!this.drag) return;
    clearInterval(this.drag.timer);
    const ticks = this.drag.ticks;
    this.drag = null;
    if (this.win && !this.win.isDestroyed()) {
      const a = this.liveAnchor();
      this.cfg.set('general.anchor', { x: a.x, y: a.y });
      this.setBoundsStable(this.boundsFor(a, this.css));
    }
    this.send('wl:dragEnd', { moved: ticks > 2 });
  }

  /**
   * The eyes in the collapsed pill look at the cursor. Polling here is the only
   * way to know where the pointer is when it is outside a 164 px window; the
   * vector is quantised so we only send when it actually changes.
   */
  startCursorFeed() {
    if (this.cursorTimer) return;
    this.cursorTimer = setInterval(() => {
      if (!this.win || this.win.isDestroyed() || !this.win.isVisible() || this.drag) return;
      const b = this.win.getBounds();
      const p = screen.getCursorScreenPoint();
      const dx = Math.max(-1, Math.min(1, (p.x - (b.x + b.width / 2)) / 380));
      const dy = Math.max(-1, Math.min(1, (p.y - (b.y + b.height / 2)) / 300));
      const key = `${dx.toFixed(2)}|${dy.toFixed(2)}`;
      if (key === this.lastLook) return;
      this.lastLook = key;
      this.send('wl:cursor', { dx: Number(dx.toFixed(2)), dy: Number(dy.toFixed(2)) });
    }, 80);
  }

  stopCursorFeed() {
    if (this.cursorTimer) clearInterval(this.cursorTimer);
    this.cursorTimer = null;
  }

  /* --------------------------------------------------------------- window */

  setAlwaysOnTop(on) {
    if (this.win) this.win.setAlwaysOnTop(!!on, 'screen-saver');
  }

  /** Re-apply the user's scale factor without reloading the renderer. */
  applyScale() {
    if (!this.win || this.win.isDestroyed()) return;
    const scale = this.cfg.get('general.scale', 1);
    try { this.win.webContents.setZoomFactor(scale); } catch {}
    this.setBoundsStable(this.boundsFor(this.anchor(), this.css, scale));
  }

  setOpacity(v) {
    if (this.win) this.win.setOpacity(Math.min(1, Math.max(0.2, Number(v) || 1)));
  }

  show() {
    if (!this.win) return;
    this.applyPosition();
    this.win.showInactive();
  }

  hide() {
    if (this.win) this.win.hide();
  }

  toggle() {
    if (!this.win) return;
    if (this.win.isVisible()) this.hide();
    else this.show();
  }

  send(channel, payload) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  reload() {
    if (this.win && !this.win.isDestroyed()) this.win.reload();
  }

  dispose() {
    this.stopCursorFeed();
    clearTimeout(this.crashTimer);
    if (this.drag) clearInterval(this.drag.timer);
    this.drag = null;
  }
}

module.exports = { IslandWindow, PAD };
