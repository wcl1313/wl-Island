'use strict';
/**
 * Tray presence. The island is HUD-like, so the tray is the only place that
 * guarantees a discoverable "quit", "reset position" and theme switch.
 */
const { Tray, Menu, nativeImage, app } = require('electron');
const { drawIslet } = require('./util/png');

function trayImage() {
  const png = drawIslet(32, { monochrome: false, transparent: false });
  return nativeImage.createFromBuffer(png);
}

const THEME_LABEL = {
  midnight: '极夜',
  graphite: '石墨',
  ocean: '深海',
  ember: '余烬',
  violet: '极光',
  snow: '雪原'
};

function createTray({ cfg, win, onAction }) {
  let tray = null;
  try {
    tray = new Tray(trayImage());
  } catch (err) {
    console.warn('[tray] unavailable:', err.message);
    return null;
  }
  tray.setToolTip('wl-Island 灵动岛');

  const build = () => Menu.buildFromTemplate([
    { label: '展开灵动岛', click: () => { win.show(); onAction('expand'); } },
    { label: '隐藏', click: () => win.hide() },
    { type: 'separator' },
    {
      label: '主题',
      submenu: Object.entries(THEME_LABEL).map(([id, label]) => ({
        label,
        type: 'radio',
        checked: (cfg.get('appearance.theme') || 'midnight') === id,
        click: () => cfg.set('appearance.theme', id)
      }))
    },
    {
      label: '置顶显示',
      type: 'checkbox',
      checked: cfg.get('general.alwaysOnTop', true),
      click: (item) => {
        cfg.set('general.alwaysOnTop', item.checked);
        win.setAlwaysOnTop(item.checked);
        onAction('config');
      }
    },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: cfg.get('general.launchAtLogin', false),
      click: (item) => {
        cfg.set('general.launchAtLogin', item.checked);
        app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true });
        onAction('config');
      }
    },
    { type: 'separator' },
    { label: '设置…', click: () => { win.show(); onAction('settings'); } },
    { label: '重置位置', click: () => { cfg.set('general.anchor', null); win.applyPosition(); win.show(); } },
    { type: 'separator' },
    { label: `版本 ${app.getVersion()}`, enabled: false },
    { label: '退出 wl-Island', click: () => app.quit() }
  ]);

  tray.setContextMenu(build());
  // The radio state has to be rebuilt after a theme change from the menu.
  cfg.onChange((_data, keys) => {
    if (keys.includes('*') || keys.some((k) => k.startsWith('appearance.theme'))) tray.setContextMenu(build());
  });
  tray.on('click', () => win.toggle());
  return tray;
}

module.exports = { createTray };
