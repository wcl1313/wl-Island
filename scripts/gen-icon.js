'use strict';
/**
 * Generates build/icon.png (1024×1024). electron-builder derives the .ico
 * (Windows) and .icns (macOS) from it, so the repo needs no binary art.
 *
 *   npm run icon
 */
const fs = require('fs');
const path = require('path');
const { drawIslet } = require('../desktop/main/util/png');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'build');
fs.mkdirSync(outDir, { recursive: true });

const sizes = [
  [1024, 'icon.png'],
  [512, 'icon-512.png'],
  [256, 'icon-256.png']
];

for (const [size, name] of sizes) {
  const png = drawIslet(size);
  fs.writeFileSync(path.join(outDir, name), png);
  console.log(`✓ build/${name} (${size}×${size}, ${(png.length / 1024).toFixed(1)} KB)`);
}
