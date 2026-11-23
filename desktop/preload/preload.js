'use strict';
/**
 * The only bridge between the sandboxed renderer and the system.
 * No node globals leak: `require` / `fs` / `process` stay in the main process.
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const listeners = new Map();

function on(event, cb) {
  const channel = `wl:${event}`;
  const handler = (_e, payload) => {
    try { cb(payload); } catch (err) { console.error('[wl] listener error', event, err); }
  };
  ipcRenderer.on(channel, handler);
  const off = () => ipcRenderer.removeListener(channel, handler);
  listeners.set(cb, off);
  return off;
}

contextBridge.exposeInMainWorld('wl', {
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  invoke: (channel, payload) => ipcRenderer.invoke(`wl:${channel}`, payload ?? {}),
  on,
  off: (cb) => {
    const fn = listeners.get(cb);
    if (fn) { fn(); listeners.delete(cb); }
  },
  /** Absolute path of a dropped File, so it can be handed to the main process. */
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  }
});
