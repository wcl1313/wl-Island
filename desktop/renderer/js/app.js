/**
 * wl-Island renderer — application shell.
 *
 * Responsibilities kept deliberately small: own the state object, own the island
 * state machine, own the dock/banner/drop surface, and hand a `ctx` to whichever
 * panel is open. Panels never talk to the window directly.
 */
import { invoke, on, platform, pathForFile } from './bridge.js';
import { esc, fmtClock } from './dom.js';
import { icon } from './icons.js';

import aiPanel from './panels/ai.js';
import todoPanel from './panels/todo.js';
import btPanel from './panels/bt.js';
import mediaPanel from './panels/media.js';
import clockPanel from './panels/clock.js';
import filesPanel from './panels/files.js';
import settingsPanel from './panels/settings.js';
import notifyPanel from './panels/notify.js';
import healthPanel from './panels/health.js';
import statusPanel from './panels/status.js';

const PAD = 28; // must match #stage padding and window.js
const EXPANDED_W = 468;

/** Collapsed box, per content. The pill only takes the width it needs. */
const BOX = {
  idle: { w: 144, h: 38, r: 19 },
  media: { w: 268, h: 38, r: 19 },
  lyric: { w: 356, h: 38, r: 19 }
};

const DEFAULT_PANEL = 'media';

const PANELS = [
  mediaPanel, todoPanel, filesPanel, aiPanel, clockPanel, healthPanel,
  btPanel, statusPanel, notifyPanel, settingsPanel
];
const BY_ID = Object.fromEntries(PANELS.map((p) => [p.id, p]));

const S = {
  cfg: null,
  info: null,
  state: 'collapsed',
  panel: DEFAULT_PANEL,
  media: { active: false, playing: false, title: '', artist: '', app: '', position: 0, duration: 0, stamp: Date.now(), artwork: false, canControl: false },
  artUrl: '',
  bt: { devices: [], connected: 0 },
  health: {},
  clock: { alarms: [], countdown: null },
  stash: { items: [] },
  todo: [],
  notes: [],
  ai: { messages: [] }
};

const stage = document.getElementById('stage');
const island = document.getElementById('island');
const tint = document.getElementById('tint');
const grain = document.getElementById('grain');
const eyes = document.getElementById('eyes');
const pillMain = document.getElementById('pillMain');
const pillTitle = document.getElementById('pillTitle');
const pillSub = document.getElementById('pillSub');
const pillWave = document.getElementById('pillWave');
const pillClock = document.getElementById('pillClock');
const pillLyric = document.getElementById('pillLyric');
const lyEls = [document.getElementById('lyA'), document.getElementById('lyB')];
const banners = document.getElementById('banners');
const view = document.getElementById('view');
const dock = document.getElementById('dock');
const panelHd = document.getElementById('panelHd');
const hdText = panelHd.querySelector('.hd-text');
const hdChip = document.getElementById('hdChip');
const hdTitle = document.getElementById('hdTitle');
const hdSub = document.getElementById('hdSub');
const btnCollapse = document.getElementById('btnCollapse');
const dvCount = document.getElementById('dvCount');

let active = null;       // { update, destroy } from the open panel
let panelSubs = [];
let panelObserver = null;
let fitRaf = 0;
let sizeLockUntil = 0;   // suppress shrink during the expand animation
let morphToken = 0;      // invalidates stale timers after a newer state change
let fitRetry = null;     // one deferred re-fit when the box was still animating
let lastSize = { w: 0, h: 0 };
let autoCollapseTimer = null;
let hoverDepth = 0;      // island + banner stack both keep the island open
let hovering = false;
let clockTimer = null;
let lyricTimer = null;
let blinkTimer = null;
let swapTimer = null;
let swapIslandTimer = null;
let wanderTimer = null;
let lyricSlot = 0;       // which of lyEls is currently visible
let lyricText = '';      // last text painted into the pill
let lyricSticky = '';    // survives instrumental gaps so the pill never blanks
let lyricTrack = '';     // resets the sticky line when the track changes
let pillBox = '';        // which BOX the pill is currently using ('' = not painted yet)
let dragging = false;
let suppressClickUntil = 0;
let dockPill = null;

/* ------------------------------------------------------------------ helpers */
const subsForPanel = (evt, fn) => {
  const off = on(evt, fn);
  panelSubs.push(off);
  return off;
};

const ctx = {
  get S() { return S; },
  invoke,
  esc,
  platform,
  on: subsForPanel,
  open,
  close: () => setState('collapsed'),
  refreshHeader: paintHeader,
  fit: () => fitPanel(),
  pushNote,
  dropFiles
};

/* --------------------------------------------------------------- the shell */
function measure() {
  const w = Math.round(stage.offsetWidth);
  const h = Math.round(stage.offsetHeight);
  // A 0×0 stage means the document is not laid out yet (or the window is
  // minimised); reporting it would clamp the window to its 120×60 floor.
  if (!w || !h) return;
  if (w === lastSize.w && h === lastSize.h) return;
  lastSize = { w, h };
  invoke('window:size', { w, h }).catch(() => {});
}

function observeSize() {
  let raf = 0;
  let retry = 0;
  const ro = new ResizeObserver(() => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (Date.now() < sizeLockUntil) {
        // The window is pre-sized for the morph. Whatever the content did in
        // the meantime still has to be picked up afterwards, or a banner that
        // appeared mid-animation leaves the window too short.
        clearTimeout(retry);
        retry = setTimeout(() => { measure(); fitPanel(); }, sizeLockUntil - Date.now() + 40);
        return;
      }
      measure();
    });
  });
  ro.observe(stage);
}

/** True while folding up would be rude: cursor still on us, or a field focused. */
function busy() {
  if (hovering) return true;
  if (dragging) return true;
  const el = document.activeElement;
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
  return false;
}

/** Long-countdown fallback for keyboard / programmatic expansion. */
function startAutoCollapse() {
  stopAutoCollapse();
  if (S.cfg?.general?.autoCollapse === false) return;
  const delay = Math.max(2, Number(S.cfg?.general?.autoCollapseDelay ?? 8)) * 1000;
  autoCollapseTimer = setTimeout(() => {
    if (busy()) { startAutoCollapse(); return; }
    setState('collapsed');
  }, delay);
}

/**
 * The cursor left — fold up almost immediately. This is the behaviour people
 * expect from a Dynamic Island, so it is the primary path; the countdown above
 * only exists for cases where no pointer is involved at all.
 */
function scheduleLeaveCollapse() {
  if (S.state !== 'expanded') return;
  if (S.cfg?.general?.collapseOnLeave === false) return;
  stopAutoCollapse();
  const wait = Math.max(0, Number(S.cfg?.general?.leaveDelay ?? 0.4)) * 1000;
  autoCollapseTimer = setTimeout(() => {
    if (busy()) { scheduleLeaveCollapse(); return; }
    setState('collapsed');
  }, wait);
}

function stopAutoCollapse() {
  if (autoCollapseTimer) clearTimeout(autoCollapseTimer);
  autoCollapseTimer = null;
}

async function setState(next) {
  if (S.state === next) return;
  S.state = next;
  const token = ++morphToken;

  if (next === 'expanded') {
    const h = BY_ID[S.panel]?.height || 360;
    // Pre-size the window BEFORE the CSS animation so nothing is clipped; the
    // extra transparent margin only lasts for the duration of the morph.
    await invoke('window:size', { w: EXPANDED_W + PAD * 2, h: h + PAD * 2 }).catch(() => {});
    // Another state change happened while the size round-trip was in flight —
    // let the newer one own the geometry.
    if (token !== morphToken) return;
    sizeLockUntil = Date.now() + 560;
    island.dataset.state = 'expanded';
    island.style.setProperty('--w', `${EXPANDED_W}px`);
    island.style.setProperty('--h', `${h}px`);
    island.style.setProperty('--r', '28px');
    paintEyes();
    startAutoCollapse();
    setTimeout(() => {
      if (token !== morphToken) return;
      fitPanel();
      measure();
      syncDockPill();
    }, 600);
  } else {
    const box = BOX[pillBox] || BOX.idle;
    island.dataset.state = 'collapsed';
    island.style.setProperty('--w', `${box.w}px`);
    island.style.setProperty('--h', `${box.h}px`);
    island.style.setProperty('--r', `${box.r}px`);
    stopAutoCollapse();
    setTimeout(() => {
      if (token !== morphToken) return;
      destroyPanel();
      sizeLockUntil = 0;
      measure();
    }, 460);
  }
  paintDock();
}

/** Per-panel heights: switching panels while expanded re-morphs the island. */
function applyPanelHeight() {
  const h = BY_ID[S.panel]?.height || 360;
  const token = ++morphToken;
  island.style.setProperty('--h', `${h}px`);
  invoke('window:size', { w: EXPANDED_W + PAD * 2, h: h + PAD * 2 }).catch(() => {});
  sizeLockUntil = Date.now() + 480;
  setTimeout(() => {
    if (token !== morphToken) return;
    fitPanel();
    measure();
    syncDockPill();
  }, 520);
}

/**
 * Natural height of the panel body.
 *
 * `view.scrollHeight` cannot be trusted here: `.view` is `flex: 1`, so it is
 * always stretched to the island and reports its own height back no matter how
 * little is inside. Summing the children gives the height the content actually
 * wants, which is the only way a panel can shrink again after showing something
 * tall (the loading state of a scan, a filtered list, a cleared todo).
 */
function naturalViewHeight() {
  const cs = getComputedStyle(view);
  let total = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  for (const kid of view.children) {
    const k = getComputedStyle(kid);
    if (k.display === 'none' || k.position === 'absolute' || k.position === 'fixed') continue;
    total += kid.offsetHeight + (parseFloat(k.marginTop) || 0) + (parseFloat(k.marginBottom) || 0);
  }
  return total;
}

/**
 * Declared heights are the designed size, used for the first paint. After that
 * the island tracks its content in both directions. Measuring only happens once
 * the box has settled, because mid-morph the stretched height would be mistaken
 * for content and the island would ratchet upwards.
 */
function fitPanel() {
  if (S.state !== 'expanded' || !active) return;
  const hd = island.querySelector('.panel-hd');
  if (!hd) return;
  const target = parseInt(island.style.getPropertyValue('--h'), 10) || 0;
  if (target && Math.abs(island.getBoundingClientRect().height - target) > 1.5) {
    // The box is still morphing; measuring now would read the stretched height.
    // Try once more after it settles instead of dropping the update forever.
    clearTimeout(fitRetry);
    fitRetry = setTimeout(() => fitPanel(), 180);
    return;
  }
  const need = hd.offsetHeight + naturalViewHeight() + dock.offsetHeight;
  // The cap keeps the island on screen; it used to be a flat 600, which clipped
  // the settings panel as soon as the theme list grew. Derive it from the
  // display instead, so a 1080p screen can show the full pane and a 768p
  // laptop still gets a scrolling one rather than one that runs off-screen.
  const limit = Math.min(676, Math.max(360, (window.screen?.availHeight || 900) - 200));
  const next = Math.max(180, Math.min(Math.round(need) + 2, limit));
  const cur = parseInt(island.style.getPropertyValue('--h'), 10) || 0;
  if (Math.abs(next - cur) <= 1) return;
  island.style.setProperty('--h', `${next}px`);
  sizeLockUntil = Date.now() + 380;
  const token = morphToken;
  invoke('window:size', { w: EXPANDED_W + PAD * 2, h: next + PAD * 2 })
    .then(() => setTimeout(() => { if (token === morphToken) measure(); }, 400))
    .catch(() => {});
}

function open(id) {
  if (!BY_ID[id]) return;
  if (S.state === 'expanded' && S.panel === id) {
    setState('collapsed');
    return;
  }
  const samePanel = S.panel === id && active;
  const wasExpanded = S.state === 'expanded';
  // Dock order doubles as a direction: switching left slides the new panel in
  // from the left. It is a small thing, but it makes the dock feel like a
  // physical strip instead of a set of unrelated buttons.
  const from = PANELS.findIndex((p) => p.id === S.panel);
  const to = PANELS.findIndex((p) => p.id === id);
  const dir = to >= from ? 1 : -1;
  S.panel = id;
  if (!samePanel) mountPanel();
  paintHeader({ swap: wasExpanded, dir });
  paintDock();
  if (wasExpanded) {
    applyPanelHeight();
    playSwap(dir);
  }
  // Switching panels is activity: the idle countdown has to start over, or the
  // island folds up seconds after you pick something else from the dock.
  setState('expanded');
  if (wasExpanded) startAutoCollapse();
}

/** Slide + fade the new panel body in, from the side the dock suggests. */
function playSwap(dir) {
  if (!view) return;
  view.style.setProperty('--dirx', String(dir || 1));
  view.classList.remove('swap');
  void view.offsetWidth; // restart the animation even on a repeat click
  view.classList.add('swap');
  clearTimeout(swapTimer);
  swapTimer = setTimeout(() => view.classList.remove('swap'), 460);
  island.dataset.swap = '1';
  clearTimeout(swapIslandTimer);
  // Must outlive the chip animation (440 ms), or the fill is cut mid-flight.
  swapIslandTimer = setTimeout(() => { delete island.dataset.swap; }, 500);
}

function mountPanel() {
  destroyPanel();
  view.scrollTop = 0;
  try {
    active = BY_ID[S.panel].mount(view, ctx) || {};
  } catch (err) {
    console.error('[wl] panel mount failed', err);
    view.innerHTML = `<div class="empty">面板加载失败<br/><span class="faint">${esc(err.message)}</span></div>`;
    active = null;
  }
  // Panels redraw themselves (list refreshes, tab switches); keep the island
  // sized to whatever they render without every panel doing the maths.
  panelObserver = new MutationObserver(() => {
    if (fitRaf) return;
    fitRaf = requestAnimationFrame(() => {
      fitRaf = 0;
      fitPanel();
    });
  });
  panelObserver.observe(view, { childList: true, subtree: true, characterData: true });
}

function destroyPanel() {
  if (panelObserver) {
    panelObserver.disconnect();
    panelObserver = null;
  }
  if (fitRaf) {
    cancelAnimationFrame(fitRaf);
    fitRaf = 0;
  }
  if (active?.destroy) {
    try { active.destroy(); } catch (err) { console.error(err); }
  }
  active = null;
  panelSubs.forEach((off) => { try { off(); } catch {} });
  panelSubs = [];
}

function paintHeader({ swap = false, dir = 1 } = {}) {
  const p = BY_ID[S.panel];
  if (!p) return;
  hdChip.innerHTML = icon(p.icon, 16);
  hdTitle.textContent = p.label;
  try {
    hdSub.textContent = typeof p.sub === 'function' ? p.sub(S) : (p.sub || '');
  } catch { hdSub.textContent = ''; }
  if (swap) {
    hdText.style.setProperty('--dirx', String(dir));
    hdText.classList.remove('swap');
    void hdText.offsetWidth;
    hdText.classList.add('swap');
    setTimeout(() => hdText.classList.remove('swap'), 560);
  }
}

function paintDock() {
  [...dock.querySelectorAll('button')].forEach((b) => {
    b.dataset.active = b.dataset.id === S.panel && S.state === 'expanded' ? '1' : '0';
  });
  const notifyBtn = dock.querySelector('[data-id="notify"]');
  if (notifyBtn) notifyBtn.dataset.badge = S.notes.length ? '1' : '0';
  const fileBtn = dock.querySelector('[data-id="files"]');
  if (fileBtn) fileBtn.dataset.badge = S.stash.items.length ? '1' : '0';
  const todoBtn = dock.querySelector('[data-id="todo"]');
  if (todoBtn) todoBtn.dataset.badge = S.todo.some((t) => !t.done) ? '1' : '0';
  syncDockPill();
}

/**
 * The highlight behind the active dock item is its own element, so it slides
 * from icon to icon instead of cross-fading between two backgrounds. Position
 * is measured from live rects (the dock is padded, and `offsetLeft` would be
 * relative to the padding box, off by exactly that padding).
 */
function syncDockPill() {
  if (!dockPill) return;
  const btn = dock.querySelector(`button[data-id="${S.panel}"]`);
  if (!btn || S.state !== 'expanded') {
    dockPill.style.opacity = '0';
    return;
  }
  const dr = dock.getBoundingClientRect();
  const br = btn.getBoundingClientRect();
  dockPill.style.width = `${br.width}px`;
  dockPill.style.height = `${br.height}px`;
  dockPill.style.transform = `translate3d(${Math.round(br.left - dr.left)}px, ${Math.round(br.top - dr.top)}px, 0)`;
  // Only fade in once the pill has a position, or it flashes at the left edge.
  if (!dockPill.dataset.ready) {
    dockPill.dataset.ready = '1';
    requestAnimationFrame(() => { dockPill.style.opacity = '1'; });
  } else {
    dockPill.style.opacity = '1';
  }
}

function buildDock() {
  dock.innerHTML = `<span class="dock-pill" aria-hidden="true"></span>${PANELS.map((p) => `
    <button data-id="${p.id}" data-label="${p.label}" title="${p.label}">
      ${icon(p.icon, 17)}
    </button>`).join('')}`;
  dockPill = dock.querySelector('.dock-pill');
  dock.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (btn) open(btn.dataset.id);
  });
}

/* ------------------------------------------------------------------- eyes */
function paintEyes() {
  const m = S.media;
  const base = m.active && m.playing ? 'live' : 'idle';
  eyes.dataset.mood = S.state === 'collapsed' && hovering ? 'curious' : base;
}

function setLook(dx, dy, { local = false } = {}) {
  // Pupils travel a hair under 3px inside a 12px eye: enough to read as a
  // glance, not enough to look like a cartoon eyeball rolling around.
  eyes.style.setProperty('--ex', `${(dx * (local ? 2.6 : 2.4)).toFixed(2)}px`);
  eyes.style.setProperty('--ey', `${(dy * (local ? 2 : 1.9)).toFixed(2)}px`);
}

function scheduleBlink() {
  clearTimeout(blinkTimer);
  const wait = 2600 + Math.random() * 5200;
  blinkTimer = setTimeout(() => {
    eyes.dataset.blink = '1';
    setTimeout(() => {
      eyes.dataset.blink = '0';
      // one blink in five comes back for a second one, like people do
      if (Math.random() < 0.2) {
        setTimeout(() => {
          eyes.dataset.blink = '1';
          setTimeout(() => { eyes.dataset.blink = '0'; }, 90);
        }, 160);
      }
      scheduleBlink();
    }, 120);
  }, wait);
}

function glance(dx, dy) {
  eyes.dataset.mood = 'alert';
  setLook(dx, dy);
  setTimeout(() => paintEyes(), 920);
}

/**
 * Idle saccades. A pupil that only tracks the pointer looks dead whenever the
 * pointer is still; a small involuntary glance every few seconds is what makes
 * the pair read as something alive rather than two painted circles.
 */
function scheduleWander() {
  clearTimeout(wanderTimer);
  wanderTimer = setTimeout(() => {
    if (S.state === 'collapsed' && !hovering && !dragging) {
      const dx = (Math.random() * 2 - 1) * 0.62;
      const dy = (Math.random() * 2 - 1) * 0.42 - 0.08;
      setLook(dx, dy);
    }
    scheduleWander();
  }, 2300 + Math.random() * 3800);
}

/* ----------------------------------------------------------------- the pill */
/** Playback position interpolated locally — same contract the media panel uses. */
function mediaPos(m) {
  const elapsed = m.playing ? (Date.now() - (m.stamp || Date.now())) / 1000 : 0;
  const raw = (m.position || 0) + elapsed;
  return m.duration > 0 ? Math.min(m.duration, Math.max(0, raw)) : Math.max(0, raw);
}

function currentLyric(m) {
  const lines = m.lyrics;
  if (!Array.isArray(lines) || !lines.length) return '';
  const pos = mediaPos(m);
  let text = '';
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].t <= pos) text = lines[i].text || '';
    else break;
  }
  return text.trim();
}

/**
 * The line to show in the pill. Instrumental gaps report an empty line; holding
 * the previous one keeps the pill from blanking and resizing every few seconds.
 */
function pillLyricLine() {
  const m = S.media;
  if (!m.active) {
    lyricTrack = '';
    lyricSticky = '';
    return '';
  }
  const key = `${m.title || ''}|${m.artist || ''}`;
  if (key !== lyricTrack) { lyricTrack = key; lyricSticky = ''; }
  const text = currentLyric(m);
  if (text) lyricSticky = text;
  // Before the first timed line (a short intro, or a paused track at 0:00)
  // currentLyric() returns nothing and the pill would fall back to the plain
  // title — which reads exactly like "lyrics are broken". Show the first line
  // until the real timeline catches up.
  if (!lyricSticky && Array.isArray(m.lyrics) && m.lyrics.length) {
    lyricSticky = m.lyrics[0].text || '';
  }
  return lyricSticky;
}

/** Two stacked lines: the new one rises from below, the old one leaves above. */
function setLyricLine(text) {
  if (text === lyricText) return;
  lyricText = text;
  const out = lyEls[lyricSlot];
  lyricSlot = 1 - lyricSlot;
  const inn = lyEls[lyricSlot];
  const body = inn.firstElementChild || inn;

  body.textContent = text;
  inn.classList.remove('on', 'up', 'slide');
  body.style.removeProperty('--shift');
  body.style.removeProperty('--drift');

  // A line that does not fit drifts sideways rather than being cut mid-word.
  const room = pillLyric.clientWidth - 4;
  const need = body.scrollWidth;
  if (room > 0 && need > room + 2) {
    const over = need - room;
    inn.classList.add('slide');
    body.style.setProperty('--shift', `-${over}px`);
    body.style.setProperty('--drift', `${Math.max(7, Math.round(over / 15))}s`);
  }

  void inn.offsetWidth; // restart the transition from the hidden position
  inn.classList.add('on');
  if (out) { out.classList.remove('on'); out.classList.add('up'); }
}

/** The pill only takes the width its content needs; the window follows. */
function syncPillWidth(box) {
  if (pillBox === box) return;
  pillBox = box;
  if (S.state !== 'collapsed') return; // setState() picks the right box anyway
  island.style.setProperty('--w', `${BOX[box].w}px`);
  // Resizing the native window mid-morph would cut the collapse animation in
  // half, so give it a moment and then let the ResizeObserver catch up.
  setTimeout(measure, 520);
}

function paintPill() {
  const m = S.media;
  const is24 = S.cfg?.clock?.format24 !== false;
  pillClock.textContent = fmtClock(new Date(), is24);

  const line = pillLyricLine();
  const showLyric = !!line && !!m.active && S.cfg?.media?.lyricOnPill !== false;
  island.dataset.lyric = showLyric ? '1' : '0';
  if (showLyric) setLyricLine(line);

  if (m.active) {
    island.dataset.idle = '0';
    pillTitle.textContent = m.title || '正在播放';
    pillSub.textContent = m.artist || m.app || '';
    pillWave.style.display = '';
    pillWave.dataset.playing = m.playing ? '1' : '0';
    pillClock.style.display = 'none';
  } else if (S.clock.countdown) {
    island.dataset.idle = '0';
    const c = S.clock.countdown;
    const left = Math.max(0, Math.round((c.endsAt - Date.now()) / 1000));
    pillTitle.textContent = '计时器';
    pillSub.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    pillWave.style.display = 'none';
    pillClock.style.display = '';
  } else {
    // Idle: no name, no subtitle — just the eyes and the clock.
    island.dataset.idle = '1';
    pillTitle.textContent = '';
    pillSub.textContent = '';
    pillWave.style.display = 'none';
    pillClock.style.display = '';
  }

  paintEyes();
  syncPillWidth(showLyric ? 'lyric' : m.active ? 'media' : 'idle');
}

/* ------------------------------------------------------------- appearance */
function applyTint() {
  const enabled = S.cfg?.appearance?.artworkTint !== false && !!S.artUrl && S.media.active;
  tint.style.setProperty('--art', S.artUrl ? `url("${S.artUrl}")` : 'none');
  tint.classList.toggle('on', enabled);
}

function applyConfig() {
  const a = S.cfg?.appearance || {};
  const g = S.cfg?.general || {};
  document.documentElement.dataset.theme = a.theme || 'midnight';
  island.dataset.eyes = a.eyes || 'classic';
  document.documentElement.style.setProperty('--blur', `${a.blur ?? 34}px`);
  document.documentElement.style.setProperty('--tint-blur', `${a.blur ?? 34}px`);
  document.documentElement.style.setProperty('--tint-op', String(a.tintOpacity ?? 0.68));
  document.body.dataset.reduceMotion = g.reduceMotion ? '1' : '0';
  grain.style.display = a.noise === false ? 'none' : '';
  applyTint();
  paintPill();
  paintHeader();
}

/* ---------------------------------------------------------------- banners */
function levelIcon(level) {
  if (level === 'success') return 'check';
  if (level === 'alarm') return 'clock';
  return 'notify';
}

function showBanner(note) {
  const el = document.createElement('div');
  el.className = 'banner';
  el.dataset.level = note.level || 'info';
  el.innerHTML = `
    <div class="b-ic">${icon(levelIcon(note.level), 16)}</div>
    <div class="b-body">
      <div class="b-title">${esc(note.title || '')}</div>
      <div class="b-text">${esc(note.body || '')}</div>
    </div>
    <div class="b-actions">
      ${(note.actions || []).map((a) => `<button class="b-btn" data-act="${esc(a.id)}">${esc(a.label)}</button>`).join('')}
    </div>`;

  let timer = null;
  const dismiss = () => {
    clearTimeout(timer);
    el.classList.add('out');
    setTimeout(() => { el.remove(); measure(); }, 260);
  };
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(dismiss, 6200);
  };
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', arm);
  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('.b-btn');
    if (btn) {
      e.stopPropagation();
      try { await invoke('notify:action', { action: btn.dataset.act, note }); } catch {}
      dismiss();
      return;
    }
    dismiss();
  });

  banners.prepend(el);
  while (banners.children.length > 3) banners.lastElementChild.remove();
  arm();
  measure();
}

function pushNote(note) {
  const full = { at: Date.now(), level: 'info', ...note };
  S.notes.unshift(full);
  if (S.notes.length > 30) S.notes.pop();
  paintDock();
  showBanner(full);
  if (S.state === 'expanded' && S.panel === 'notify') active?.update?.();
}

/* -------------------------------------------------------------------- drag
   Dragging is not `-webkit-app-region: drag`: a drag region swallows clicks and
   the pill has to stay clickable. Instead the main process follows the cursor
   on a timer, which is 1:1 and has no feedback loop (it never reads the window
   position it just wrote). */
function attachDrag(el, skipSelector) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (skipSelector && e.target.closest(skipSelector)) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;

    const finish = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (!moved) return;
      suppressClickUntil = Date.now() + 320;
      dragging = false;
      setTimeout(() => { island.dataset.dragging = '0'; }, 40);
      invoke('window:dragEnd').catch(() => {});
      // Placement is now explicit: never fold up right after a drop.
      startAutoCollapse();
    };

    const onMove = (ev) => {
      if (moved) return;
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 5) return;
      moved = true;
      dragging = true;
      island.dataset.dragging = '1';
      stopAutoCollapse();
      invoke('window:dragStart').catch(() => {});
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  });
}

/* -------------------------------------------------------------------- drop
   Files dropped anywhere on the island are copied into 中转站. The island
   expands on the first dragenter so there is a real target to aim at. */
let dropWatch = null;
let lastOver = 0;
let droppedOpen = false;

const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

function fileCount(dt) {
  try { return dt.items ? dt.items.length : (dt.files ? dt.files.length : 0); } catch { return 0; }
}

function enterDrop() {
  island.dataset.drop = '1';
  lastOver = Date.now();
  if (!dropWatch) {
    dropWatch = setInterval(() => {
      if (Date.now() - lastOver > 900) leaveDrop();
    }, 300);
  }
  if (S.state !== 'expanded' || S.panel !== 'files') {
    droppedOpen = true;
    open('files');
  }
}

function leaveDrop() {
  island.dataset.drop = '0';
  if (dropWatch) clearInterval(dropWatch);
  dropWatch = null;
  if (droppedOpen && S.state === 'expanded' && !busy()) {
    setTimeout(() => { if (!island.dataset.drop || island.dataset.drop === '0') setState('collapsed'); }, 260);
  }
  droppedOpen = false;
}

async function dropFiles(files) {
  const paths = [...files].map((f) => pathForFile(f)).filter(Boolean);
  if (!paths.length) return [];
  const res = await invoke('stash:add', { paths });
  S.stash.items = res.items || S.stash.items;
  paintDock();
  ctx.refreshHeader();
  if (S.state === 'expanded' && S.panel === 'files') active?.update?.();
  if (res.added) pushNote({ title: `已收下 ${res.added} 个文件`, body: '点开会打开中转站，可再拖出去用', level: 'success' });
  return res.items || [];
}

function wireDrop() {
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    enterDrop();
  });

  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    lastOver = Date.now();
    const n = fileCount(e.dataTransfer);
    dvCount.textContent = n > 1 ? `${n} 个项目，松手即收` : '复制一份，原文件不动';
  });

  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    // relatedTarget is null when the pointer really left the window
    if (!e.relatedTarget) leaveDrop();
    lastOver = Date.now();
  });

  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    island.dataset.drop = '0';
    if (dropWatch) clearInterval(dropWatch);
    dropWatch = null;
    droppedOpen = false;
    const files = [...(e.dataTransfer.files || [])];
    if (files.length) {
      try { await dropFiles(files); } catch (err) { pushNote({ title: '添加失败', body: err.message, level: 'warn' }); }
      startAutoCollapse();
    } else {
      leaveDrop();
    }
  });
}

/* ------------------------------------------------------------------ wiring */
function wire() {
  on('media', (m) => {
    S.media = m;
    if (!m.artwork) S.artUrl = '';
    applyTint();
    paintPill();
    if (S.state === 'expanded') active?.update?.();
    if (m.artwork && !S.artUrl) {
      invoke('media:art').then((url) => {
        if (url) { S.artUrl = url; applyTint(); if (S.state === 'expanded') active?.update?.(); }
      }).catch(() => {});
    }
  });

  on('media:art', ({ url }) => {
    S.artUrl = url || '';
    applyTint();
    if (S.state === 'expanded') active?.update?.();
  });

  on('bt', (p) => {
    S.bt = p;
    if (S.state === 'expanded') active?.update?.();
    paintHeader();
  });

  on('note', (note) => {
    S.notes.unshift(note);
    if (S.notes.length > 30) S.notes.pop();
    paintDock();
    if (S.state === 'expanded' && S.panel === 'notify') active?.update?.();
    showBanner(note);
    if (S.state === 'collapsed') {
      glance(0, -0.6);
      setTimeout(paintPill, 2600);
    }
  });

  on('config', ({ config }) => {
    S.cfg = config;
    applyConfig();
  });

  // The eyes follow the pointer even when it is nowhere near the island; the
  // main process quantises the vector so this only fires on real movement.
  on('cursor', ({ dx, dy }) => {
    if (S.state !== 'collapsed') return;
    setLook(dx, dy);
  });

  on('dragEnd', () => {
    island.dataset.dragging = '0';
    dragging = false;
  });

  on('ui:action', ({ action }) => {
    if (action === 'expand') open(S.panel || DEFAULT_PANEL);
    if (action === 'settings') open('settings');
  });

  on('ui:appearance', () => applyConfig());

  // click the pill to open the last panel
  island.addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil) return;
    if (S.state === 'collapsed' && !e.target.closest('.banner')) open(S.panel || DEFAULT_PANEL);
  });

  btnCollapse.addEventListener('click', (e) => {
    e.stopPropagation();
    setState('collapsed');
  });

  island.addEventListener('pointerdown', () => {
    if (S.state === 'expanded') startAutoCollapse();
  });

  // Scale / display changes move the dock, so the travelling highlight has to
  // be re-measured; doing it on the next frame avoids reading a stale layout.
  window.addEventListener('resize', () => requestAnimationFrame(syncDockPill));

  // Local pointer tracking is sharper than the 80 ms feed while the cursor is
  // actually over the island; both write the same variables.
  island.addEventListener('pointermove', (e) => {
    if (S.state !== 'collapsed') return;
    const r = island.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    setLook(Math.max(-1, Math.min(1, dx)), Math.max(-1, Math.min(1, dy)), { local: true });
  });

  // Hover is tracked on the island *and* the banner stack: banners are siblings
  // of the island, and moving onto one must not fold the island up.
  const onEnter = (e) => {
    hoverDepth += 1;
    hovering = true;
    stopAutoCollapse();
    // The eyes notice you: a touch wider, pupils recentre on the pointer.
    if (S.state === 'collapsed' && e.currentTarget === island) eyes.dataset.mood = 'curious';
  };
  const onLeave = (e) => {
    hoverDepth = Math.max(0, hoverDepth - 1);
    hovering = hoverDepth > 0;
    if (!hovering) {
      scheduleLeaveCollapse();
      if (S.state === 'collapsed' && e.currentTarget === island) paintEyes();
    }
  };
  [island, banners].forEach((el) => {
    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointerleave', onLeave);
  });

  island.addEventListener('keydown', () => startAutoCollapse());
  island.addEventListener('input', () => startAutoCollapse());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.state === 'expanded') setState('collapsed');
    if ((e.metaKey || e.ctrlKey) && e.key === ',') {
      e.preventDefault();
      open('settings');
    }
  });

  window.addEventListener('beforeunload', () => {
    stopAutoCollapse();
    clearTimeout(blinkTimer);
    clearTimeout(wanderTimer);
    clearTimeout(swapTimer);
    clearTimeout(swapIslandTimer);
    if (dropWatch) clearInterval(dropWatch);
  });
}

/* -------------------------------------------------------------------- boot */
async function boot() {
  buildDock();
  paintHeader();

  try {
    S.cfg = await invoke('config:get');
  } catch {
    S.cfg = { general: {}, appearance: {}, media: {}, ai: {}, notify: {}, clock: {}, health: {}, stash: {} };
  }
  applyConfig();

  invoke('media:state').then((m) => {
    S.media = m;
    if (m.artwork) {
      invoke('media:art').then((url) => { if (url) { S.artUrl = url; applyTint(); } }).catch(() => {});
    }
    paintPill();
  }).catch(() => {});

  invoke('bt:list').then((p) => { S.bt = p; }).catch(() => {});
  invoke('health:status').then((h) => { S.health = h; }).catch(() => {});
  invoke('clock:state').then((c) => { S.clock = c; }).catch(() => {});
  invoke('stash:list').then((i) => { S.stash.items = i; paintDock(); }).catch(() => {});
  invoke('notify:list').then((n) => { S.notes = n; paintDock(); }).catch(() => {});
  invoke('todo:list').then((t) => { S.todo = t; paintDock(); }).catch(() => {});

  wire();
  wireDrop();
  observeSize();
  measure();

  // Pill / panel header: hold and move to reposition the whole island.
  attachDrag(island.querySelector('.pill'));
  attachDrag(panelHd, '.ibtn,button,input,textarea,select,a');

  clockTimer = setInterval(paintPill, 1000);
  window.addEventListener('beforeunload', () => clearInterval(clockTimer));

  // Lyrics advance on their own clock — 220 ms is smooth without being busy, and
  // the work is a single string comparison unless the line actually changes.
  lyricTimer = setInterval(() => {
    if (S.state !== 'collapsed' || !S.media.active) return;
    if (island.dataset.lyric !== '1') return;
    const line = currentLyric(S.media);
    if (line) setLyricLine(line);
  }, 220);
  window.addEventListener('beforeunload', () => clearInterval(lyricTimer));

  scheduleBlink();
  scheduleWander();

  // First run: one hint, then never again.
  if (!S.cfg?.general?.onboardingDone) {
    setTimeout(() => {
      pushNote({ title: '拖动胶囊可以换位置', body: '按住岛直接拖，松手即落位。设置里还能选主题。', level: 'info' });
      invoke('config:patch', { general: { onboardingDone: true } }).catch(() => {});
    }, 1400);
  }
}

/* ---------------------------------------------------------------- dev handle
   Only present when the window was opened with `?dev=1` (see window.js).
   The screenshot harness pushes realistic state through the real paint path
   instead of faking DOM, so what it captures is what the code renders. */
if (location.search.includes('dev=1')) {
  window.__wl = {
    S,
    paintPill,
    setState,
    open,
    setMedia(patch) {
      S.media = { ...S.media, ...patch, stamp: Date.now() };
      paintPill();
      if (S.state === 'expanded') active?.update?.();
    },
    setTheme(id) {
      S.cfg = { ...S.cfg, appearance: { ...(S.cfg?.appearance || {}), theme: id } };
      applyConfig();
    },
    setTodo(items) {
      S.todo = items;
      paintDock();
      if (S.state === 'expanded' && S.panel === 'todo') active?.update?.();
    }
  };
}

boot();
