'use strict';
/**
 * Tiny dependency-free PNG writer (RGBA, no filtering) + the wl-Island glyph.
 *
 * Why: the app must ship an icon for three desktop targets and a tray bitmap at
 * runtime, and committing binary blobs to a fresh repo is worse than 150 lines
 * of deterministic drawing code. `npm run icon` writes build/icon.png (1024²)
 * which electron-builder converts to .ico / .icns.
 */
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function over(dst, i, r, g, b, a) {
  if (a <= 0) return;
  const da = dst[i + 3] / 255;
  const sa = a;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  dst[i] = Math.round((r * sa + dst[i] * da * (1 - sa)) / outA);
  dst[i + 1] = Math.round((g * sa + dst[i + 1] * da * (1 - sa)) / outA);
  dst[i + 2] = Math.round((b * sa + dst[i + 2] * da * (1 - sa)) / outA);
  dst[i + 3] = Math.round(outA * 255);
}

/**
 * Draws the wl-Island glyph: the dark squircle, and inside it the two eyes that
 * are the app's identity. Pure maths + a supersampling grid, so the repository
 * stays free of binary icon files.
 * @param {number} size
 * @param {{monochrome?: boolean, transparent?: boolean}} opts
 */
function drawIslet(size, opts = {}) {
  const buf = Buffer.alloc(size * size * 4, 0);
  const S = 3; // supersampling grid
  const c = size / 2;
  const half = size * 0.465;
  const radius = size * 0.235;

  // eye geometry, tuned against the collapsed pill proportions
  const eyeRx = size * 0.093;
  const eyeRy = size * 0.105;
  const eyeDx = size * 0.113;
  const eyeCy = size * 0.5;
  const pupilR = size * 0.041;
  const glintR = size * 0.016;

  const inEllipse = (px, py, cx, cy, rx, ry) => {
    const dx = (px - cx) / rx;
    const dy = (py - cy) / ry;
    return dx * dx + dy * dy <= 1;
  };

  const eyes = [
    { cx: c - eyeDx, cy: eyeCy },
    { cx: c + eyeDx, cy: eyeCy }
  ];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let covBody = 0;
      const covEye = [0, 0];
      const covPupil = [0, 0];
      const covGlint = [0, 0];
      for (let sy = 0; sy < S; sy += 1) {
        for (let sx = 0; sx < S; sx += 1) {
          const px = x + (sx + 0.5) / S;
          const py = y + (sy + 0.5) / S;
          if (sdRoundRect(px, py, c, c, half, half, radius) < 0) covBody += 1;
          for (let e = 0; e < 2; e += 1) {
            const eye = eyes[e];
            if (!inEllipse(px, py, eye.cx, eye.cy, eyeRx, eyeRy)) continue;
            covEye[e] += 1;
            if (Math.hypot(px - eye.cx, py - eye.cy) < pupilR) covPupil[e] += 1;
            if (Math.hypot(px - (eye.cx - pupilR * 0.34), py - (eye.cy - pupilR * 0.36)) < glintR) covGlint[e] += 1;
          }
        }
      }
      const n = S * S;
      const bodyA = covBody / n;
      const i = (y * size + x) * 4;
      if (opts.monochrome) {
        over(buf, i, 0, 0, 0, bodyA * (opts.transparent ? 0 : 0.92));
        for (let e = 0; e < 2; e += 1) over(buf, i, 0, 0, 0, (covEye[e] / n) * 0.92);
        continue;
      }
      if (!opts.transparent) {
        const t = y / size;
        const r = Math.round(30 - 22 * t);
        const g = Math.round(30 - 22 * t);
        const b = Math.round(36 - 26 * t);
        over(buf, i, r, g, b, bodyA);
      }
      // inner top highlight
      if (covBody > 0 && y < size * 0.5) {
        const gl = (1 - y / (size * 0.5)) * 0.12 * bodyA;
        over(buf, i, 255, 255, 255, gl);
      }
      for (let e = 0; e < 2; e += 1) {
        const eyeA = covEye[e] / n;
        if (eyeA > 0) over(buf, i, 246, 247, 250, eyeA);
        const pupilA = covPupil[e] / n;
        if (pupilA > 0) over(buf, i, 10, 11, 16, pupilA);
        const glintA = covGlint[e] / n;
        if (glintA > 0) over(buf, i, 255, 255, 255, glintA * 0.92);
      }
    }
  }
  return encodePNG(size, size, buf);
}

module.exports = { encodePNG, drawIslet, crc32 };
