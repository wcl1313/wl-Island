'use strict';
/**
 * Platform adapter — Windows only.
 *
 * wl-Island ships for Windows 10+, so there is no runtime dispatch left: the
 * whole media/bluetooth/battery surface lives in one Win32 adapter. Keeping the
 * `createAdapter()` shape means the rest of the main process does not care.
 */
const createWin32 = require('./win32');

function createAdapter(ctx) {
  if (process.platform !== 'win32') {
    throw new Error('wl-Island 仅支持 Windows 10 及以上版本');
  }
  return createWin32(ctx);
}

module.exports = { createAdapter };
