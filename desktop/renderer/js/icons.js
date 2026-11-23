/**
 * wl-Island icon set — hand-drawn, 24×24, stroke based (1.6u) so every glyph keeps
 * the same optical weight at 14–28 px. No icon font, no sprite sheet, no deps:
 * one `currentColor` and it adapts to every state (idle / hover / active).
 */

const S = (body, opts = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${opts}>${body}</svg>`;

const F = (body) => `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  /* ---------------------------------------------------------- features */
  ai: S(`
    <path d="M11.4 3.6l1.55 4.15 4.15 1.55-4.15 1.55L11.4 15l-1.55-4.15L5.7 9.3l4.15-1.55z"/>
    <path d="M17.9 14.4l.85 2.05 2.05.85-2.05.85-.85 2.05-.85-2.05-2.05-.85 2.05-.85z"/>
    <circle cx="5.4" cy="16.2" r="1.5"/>`),

  bluetooth: S(`<path d="M7.2 7.4l9.6 9.2-4.8 3.9V3.5l4.8 3.9-9.6 9.2"/>`),

  media: S(`
    <path d="M9.2 17.4V5.6l9.2-2v11.8"/>
    <ellipse cx="6.6" cy="17.6" rx="2.6" ry="2.3"/>
    <ellipse cx="15.8" cy="15.4" rx="2.6" ry="2.3"/>`),

  clock: S(`
    <circle cx="12" cy="13.2" r="7.4"/>
    <path d="M12 9.4v3.9l2.6 1.7"/>
    <path d="M4.9 6.3L7.2 4M19.1 6.3L16.8 4"/>
    <path d="M7.2 7.6h.01M16.8 7.6h.01" stroke-width="2"/>`),

  files: S(`
    <path d="M3.4 13.4l2.3-8.1h12.6l2.3 8.1"/>
    <path d="M3.4 13.4v3.9a2.3 2.3 0 002.3 2.3h12.6a2.3 2.3 0 002.3-2.3v-3.9"/>
    <path d="M3.4 13.4h4.3l1.2 2.1h6.2l1.2-2.1h4.3"/>`),

  settings: S(`
    <path d="M3.6 7.2h8.2M17.4 7.2h3M3.6 12h3.8M13 12h7.4M3.6 16.8h9.6M18.2 16.8h2.2"/>
    <circle cx="14.6" cy="7.2" r="2.1"/>
    <circle cx="9.5" cy="12" r="2.1"/>
    <circle cx="15.4" cy="16.8" r="2.1"/>`),

  notify: S(`
    <path d="M6.4 10.2a5.6 5.6 0 0111.2 0c0 3.7 1.4 5.1 1.4 5.1H5s1.4-1.4 1.4-5.1z"/>
    <path d="M10.1 18.4a2 2 0 003.8 0"/>`),

  health: S(`
    <path d="M12 3.4s6.1 6.3 6.1 10.3A6.1 6.1 0 016 13.7C6 9.7 12 3.4 12 3.4z"/>
    <path d="M9.4 13.9a2.6 2.6 0 002.6 2.6"/>`),

  todo: S(`
    <rect x="4.4" y="3.4" width="15.2" height="17.2" rx="3"/>
    <path d="M8.4 9.2l1.5 1.5 2.6-2.7"/>
    <path d="M8.4 15.6h7.4"/>`),

  status: S(`
    <path d="M3.4 13.2h3.4l1.9-5.3 3 10.2 2.2-6.2 1.6 3.1h4.1"/>
    <path d="M4.2 6.4h4.6M4.2 20.2h6.2" opacity=".5"/>`),

  /* --------------------------------------------------------- transport */
  play: F(`<path d="M8.4 5.3a.9.9 0 011.36-.77l9.1 5.7a1.1 1.1 0 010 1.87l-9.1 5.7A.9.9 0 018.4 17V5.3z"/>`),
  pause: F(`
    <rect x="7" y="4.6" width="3.6" height="14.8" rx="1.5"/>
    <rect x="13.4" y="4.6" width="3.6" height="14.8" rx="1.5"/>`),
  next: F(`
    <path d="M6.4 5.6a.8.8 0 011.24-.67l8.5 6.5a.8.8 0 010 1.3l-8.5 6.5A.8.8 0 016.4 18.5V5.6z"/>
    <rect x="16.6" y="5" width="2.6" height="14.2" rx="1.2"/>`),
  prev: F(`
    <path d="M17.6 5.6a.8.8 0 00-1.24-.67l-8.5 6.5a.8.8 0 000 1.3l8.5 6.5a.8.8 0 001.24-.67V5.6z"/>
    <rect x="4.8" y="5" width="2.6" height="14.2" rx="1.2"/>`),
  volume: S(`
    <path d="M4.4 9.6h3l4-3.2v11.2l-4-3.2h-3z"/>
    <path d="M15.4 9.2a4 4 0 010 5.6M17.9 6.9a7.3 7.3 0 010 10.2"/>`),
  seek: S(`<path d="M12 4.6v14.8"/><path d="M4.6 12h14.8"/>`),

  /* ----------------------------------------------------------- utility */
  chevronDown: S(`<path d="M6.6 9.4l5.4 5.2 5.4-5.2"/>`),
  chevronRight: S(`<path d="M9.6 6.4l5.2 5.6-5.2 5.6"/>`),
  close: S(`<path d="M6.8 6.8l10.4 10.4M17.2 6.8L6.8 17.2"/>`),
  plus: S(`<path d="M12 5.4v13.2M5.4 12h13.2"/>`),
  trash: S(`
    <path d="M4.8 7.2h14.4M9.6 7.2V5.1a1.2 1.2 0 011.2-1.2h2.4a1.2 1.2 0 011.2 1.2v2.1"/>
    <path d="M6.6 7.2l.7 11.4a1.8 1.8 0 001.8 1.7h5.8a1.8 1.8 0 001.8-1.7l.7-11.4"/>
    <path d="M10.2 11v5.6M13.8 11v5.6"/>`),
  folder: S(`<path d="M3.6 8.1a2 2 0 012-2h3.1l1.9 2.1h7.8a2 2 0 012 2v7.5a2 2 0 01-2 2H5.6a2 2 0 01-2-2z"/>`),
  copy: S(`
    <rect x="8.6" y="8.6" width="11" height="11" rx="2.2"/>
    <path d="M15.4 8.6V6.4a2.2 2.2 0 00-2.2-2.2H6.6a2.2 2.2 0 00-2.2 2.2v6.6a2.2 2.2 0 002.2 2.2h2.2"/>`),
  check: S(`<path d="M5.2 12.6l4.4 4.4 9.2-9.6"/>`),
  refresh: S(`<path d="M20 11.4a8 8 0 10-2.6 6.3"/><path d="M20 5.4v6h-6"/>`),
  external: S(`
    <path d="M14.4 4.6h5v5"/><path d="M19.4 4.6l-7.8 7.8"/>
    <path d="M18.4 14.2v3.9a2 2 0 01-2 2H5.8a2 2 0 01-2-2V7.4a2 2 0 012-2h3.9"/>`),
  link: S(`
    <path d="M10.2 13.8a3.8 3.8 0 005.4 0l2.6-2.6a3.8 3.8 0 10-5.4-5.4l-1 1"/>
    <path d="M13.8 10.2a3.8 3.8 0 00-5.4 0l-2.6 2.6a3.8 3.8 0 105.4 5.4l1-1"/>`),
  clockSmall: S(`<circle cx="12" cy="12" r="8"/><path d="M12 7.6V12l3 1.9"/>`),
  drop: F(`<path d="M12 3.1s5.9 6.2 5.9 10.2A5.9 5.9 0 016.1 13.3C6.1 9.3 12 3.1 12 3.1z" opacity=".9"/>`),
  stand: S(`
    <circle cx="12" cy="4.9" r="2.2"/>
    <path d="M12 7.1v7.2"/>
    <path d="M8.4 9.6L12 8.2l3.6 1.4"/>
    <path d="M9.4 20.6l2.6-5.6 2.6 5.6"/>`),
  wave: S(`<path d="M4 12h1.6M8 8.4v7.2M12 5.6v12.8M16 8.9v6.2M20 11v2"/>`),
  coffee: S(`
    <path d="M5.6 8.4h10.2v5.8a4.6 4.6 0 01-4.6 4.6h-1a4.6 4.6 0 01-4.6-4.6z"/>
    <path d="M15.8 9.6h1.7a2.4 2.4 0 010 4.8h-1.7"/>
    <path d="M4.4 21.2h13"/>`),
  spark: F(`<path d="M12 3.6l1.7 4.5 4.5 1.7-4.5 1.7L12 16l-1.7-4.5L5.8 9.8l4.5-1.7z"/>`),
  star: S(`<path d="M12 4.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4-3.9-3.8 5.4-.8z"/>`),
  starFill: F(`<path d="M12 3.9l2.5 5.1 5.6.8-4.1 4 1 5.6-5-2.7-5 2.7 1-5.6-4.1-4 5.6-.8z"/>`),
  edit: S(`
    <path d="M15.6 4.6l3.8 3.8-9.6 9.6-4.6.8.8-4.6z"/>
    <path d="M13.4 6.8l3.8 3.8"/>`),
  grip: F(`
    <circle cx="9.4" cy="7" r="1.35"/><circle cx="14.6" cy="7" r="1.35"/>
    <circle cx="9.4" cy="12" r="1.35"/><circle cx="14.6" cy="12" r="1.35"/>
    <circle cx="9.4" cy="17" r="1.35"/><circle cx="14.6" cy="17" r="1.35"/>`),
  move: S(`
    <path d="M12 3.6v16.8M3.6 12h16.8"/>
    <path d="M9.6 6.2L12 3.6l2.4 2.6M9.6 17.8L12 20.4l2.4-2.6M6.2 9.6L3.6 12l2.6 2.4M17.8 9.6L20.4 12l-2.6 2.4"/>`),
  cpu: S(`
    <rect x="6.6" y="6.6" width="10.8" height="10.8" rx="2.4"/>
    <rect x="10" y="10" width="4" height="4" rx="1"/>
    <path d="M10 3.6v3M14 3.6v3M10 17.4v3M14 17.4v3M3.6 10h3M3.6 14h3M17.4 10h3M17.4 14h3"/>`),
  lock: S(`
    <rect x="5" y="10.4" width="14" height="10.2" rx="2.6"/>
    <path d="M8.4 10.4V7.8a3.6 3.6 0 017.2 0v2.6"/>
    <path d="M12 14.4v2.4"/>`),
  snip: S(`
    <path d="M6.6 3.4l11 15.2M17.4 3.4L6.4 18.6"/>
    <circle cx="5.4" cy="20" r="2.2"/><circle cx="18.6" cy="20" r="2.2"/>`),
  mute: S(`
    <path d="M4.4 9.6h3l4-3.2v11.2l-4-3.2h-3z"/>
    <path d="M15.4 9.4l4.2 5.2M19.6 9.4l-4.2 5.2"/>`),
  power: S(`<path d="M12 3.6v7.2"/><path d="M7.3 6.4a7.2 7.2 0 109.4 0"/>`),

  /* ------------------------------------------------------------ devices */
  headphones: S(`
    <path d="M4.6 14.6v-2a7.4 7.4 0 0114.8 0v2"/>
    <rect x="2.6" y="13.2" width="4.2" height="6.8" rx="2.1"/>
    <rect x="17.2" y="13.2" width="4.2" height="6.8" rx="2.1"/>`),
  earbuds: S(`
    <rect x="4.6" y="3.4" width="5.2" height="6.4" rx="2.6"/>
    <path d="M7.2 9.8v7.4"/>
    <rect x="14.2" y="3.4" width="5.2" height="6.4" rx="2.6"/>
    <path d="M16.8 9.8v7.4"/>`),
  speaker: S(`
    <rect x="5.8" y="2.8" width="12.4" height="18.4" rx="3.2"/>
    <circle cx="12" cy="8.6" r="2.1"/>
    <circle cx="12" cy="16" r="3.1"/>`),
  keyboard: S(`
    <rect x="2.4" y="7.2" width="19.2" height="10" rx="2.2"/>
    <path d="M6 10.6h.01M9.4 10.6h.01M12.8 10.6h.01M16.2 10.6h.01M7 14.4h10" stroke-width="2"/>`),
  mouse: S(`
    <rect x="6.8" y="3" width="10.4" height="18" rx="5.2"/>
    <path d="M12 3.4v6.4"/>`),
  gamepad: S(`
    <path d="M7.6 7.8h8.8a4.6 4.6 0 014.5 5.5l-.6 3.6a2.8 2.8 0 01-4.8 1.4l-1.3-1.5H9.8l-1.3 1.5a2.8 2.8 0 01-4.8-1.4l-.6-3.6a4.6 4.6 0 014.5-5.5z"/>
    <path d="M8 11.4v3.2M6.4 13h3.2"/>
    <circle cx="15.8" cy="12" r=".95"/><circle cx="18" cy="14" r=".95"/>`),
  watch: S(`
    <rect x="6.9" y="6.6" width="10.2" height="10.8" rx="3.2"/>
    <path d="M9.4 6.6l.5-3.2h4.2l.5 3.2M9.4 17.4l.5 3.2h4.2l.5-3.2"/>`),
  phone: S(`
    <rect x="7" y="2.6" width="10" height="18.8" rx="2.6"/>
    <path d="M10.6 5.4h2.8"/>`),
  laptop: S(`
    <rect x="4.2" y="5" width="15.6" height="10" rx="1.8"/>
    <path d="M2.2 18.6h19.6"/>`),
  tv: S(`
    <rect x="2.8" y="4.4" width="18.4" height="12" rx="2.2"/>
    <path d="M8.2 20h7.6"/>`),
  deviceUnknown: S(`
    <circle cx="12" cy="12" r="8.2"/>
    <path d="M9.4 9.6a2.7 2.7 0 114.3 2.2c-.9.7-1.7 1.2-1.7 2.6"/>
    <path d="M12 17.2h.01" stroke-width="2"/>`),

  /* ---------------------------------------------------------- 1.0 additions */
  usb: S(`
    <path d="M12 3.2v11.6"/>
    <path d="M12 3.2l-2.4 2.6M12 3.2l2.4 2.6"/>
    <path d="M9.6 8.6l4.8 2.2M14.4 8.6l-4.8 2.2"/>
    <rect x="10.1" y="14.4" width="3.8" height="6.2" rx="1.4"/>
    <path d="M12 6.6h.01" stroke-width="1.2"/>`),

  plug: S(`
    <path d="M9 3.4v4.2M15 3.4v4.2"/>
    <path d="M6.8 7.6h10.4v2.2a5.2 5.2 0 01-5.2 5.2 5.2 5.2 0 01-5.2-5.2z"/>
    <path d="M12 15v3.2a2.4 2.4 0 002.4 2.4h1.2"/>`),

  disk: S(`
    <ellipse cx="12" cy="6.4" rx="7.4" ry="2.9"/>
    <path d="M4.6 6.4v11.2c0 1.6 3.3 2.9 7.4 2.9s7.4-1.3 7.4-2.9V6.4"/>
    <path d="M4.6 12c0 1.6 3.3 2.9 7.4 2.9s7.4-1.3 7.4-2.9"/>`),

  broom: S(`
    <path d="M14.6 3.8l5.6 5.6"/>
    <path d="M13.2 5.2l5.6 5.6-2.6 2.6-5.6-5.6z"/>
    <path d="M10.6 7.8L4.2 14.2c-.9.9-.6 2.2.4 3.1l2.1 2.1c.9 1 2.2 1.3 3.1.4l6.4-6.4"/>
    <path d="M6.2 17.2l1.8-1.8M9.2 19.2l1.8-1.8"/>`),

  eye: S(`
    <path d="M2.8 12S6.4 5.8 12 5.8 21.2 12 21.2 12 17.6 18.2 12 18.2 2.8 12 2.8 12z"/>
    <circle cx="12" cy="12" r="2.9"/>`),

  eyeOff: S(`
    <path d="M3.4 9.2c1.9 2.4 5 4.6 8.6 4.6 1.5 0 2.8-.3 4-.8"/>
    <path d="M6.4 15.6l-1.6 2.2M12 17v2.6M17.6 15.6l1.6 2.2"/>
    <path d="M10.4 12.4a2 2 0 002.8-2.8"/>`),

  palette: S(`
    <path d="M12 20.4a8.4 8.4 0 110-16.8c4.6 0 8.4 3 8.4 6.6 0 2.3-1.9 3.6-3.9 3.6h-1.2c-1 0-1.8.8-1.8 1.8 0 .6.2 1 .5 1.5.3.5.5.9.5 1.5 0 1-.9 1.8-2.5 1.8z"/>
    <path d="M8 8.6h.01M12 7.2h.01M15.8 9.2h.01M6.9 12.2h.01" stroke-width="2.4"/>`),

  chip: S(`
    <rect x="6.6" y="6.6" width="10.8" height="10.8" rx="2.4"/>
    <path d="M9.6 3.6v3M14.4 3.6v3M9.6 17.4v3M14.4 17.4v3M3.6 9.6h3M3.6 14.4h3M17.4 9.6h3M17.4 14.4h3"/>`),

  bolt: F(`<path d="M13.2 2.4L5.4 13.2h5.2l-.8 8.4 7.8-10.8h-5.2z"/>`),

  wifi: S(`
    <path d="M3.4 8.8a13 13 0 0117.2 0"/>
    <path d="M6.4 12a8.6 8.6 0 0111.2 0"/>
    <path d="M9.4 15.2a4.2 4.2 0 015.2 0"/>
    <path d="M12 18.6h.01" stroke-width="2.4"/>`),

  globe: S(`
    <circle cx="12" cy="12" r="8.4"/>
    <path d="M3.6 12h16.8"/>
    <path d="M12 3.6c2.2 2.3 3.3 5.2 3.3 8.4s-1.1 6.1-3.3 8.4c-2.2-2.3-3.3-5.2-3.3-8.4S9.8 5.9 12 3.6z"/>`),

  send: F(`<path d="M3.6 11.2l16.4-7.6a.7.7 0 01.94.94L13.2 20.9a.7.7 0 01-1.3-.1l-1.5-5.3-5.3-1.5a.7.7 0 01-.1-1.3z"/>`),

  layers: S(`
    <path d="M12 3.4l8.4 4.2-8.4 4.2-8.4-4.2z"/>
    <path d="M3.6 12l8.4 4.2 8.4-4.2"/>
    <path d="M3.6 16.2l8.4 4.2 8.4-4.2"/>`)
};

export const DEVICE_ICON = {
  headphones: 'headphones',
  earbuds: 'earbuds',
  speaker: 'speaker',
  keyboard: 'keyboard',
  mouse: 'mouse',
  gamepad: 'gamepad',
  watch: 'watch',
  phone: 'phone',
  laptop: 'laptop',
  tv: 'tv',
  unknown: 'deviceUnknown'
};

/** Returns markup for an icon; `size` in CSS px, `cls` appended to the wrapper. */
export function icon(name, size = 20, cls = '') {
  const svg = ICONS[name] || ICONS.deviceUnknown;
  return `<span class="ic ${cls}" style="--ic:${size}px">${svg}</span>`;
}

export function deviceIcon(type, size = 22, cls = '') {
  return icon(DEVICE_ICON[type] || 'deviceUnknown', size, cls);
}
