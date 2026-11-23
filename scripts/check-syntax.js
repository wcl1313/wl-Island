'use strict';
/**
 * Zero-dependency syntax gate: `node --check` for CommonJS, and the ESM parser
 * for the renderer. Runs in CI and before packaging.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const cjs = ['desktop/main', 'desktop/preload', 'scripts'].flatMap((d) => walk(path.join(root, d)));
const esm = walk(path.join(root, 'desktop/renderer'));

let failed = 0;

for (const file of cjs) {
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (res.status !== 0) {
    failed += 1;
    console.error(`✗ ${path.relative(root, file)}\n${res.stderr}`);
  }
}

for (const file of esm) {
  const res = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    encoding: 'utf8',
    input: fs.readFileSync(file, 'utf8')
  });
  if (res.status !== 0) {
    failed += 1;
    console.error(`✗ ${path.relative(root, file)}\n${res.stderr}`);
  }
}

const total = cjs.length + esm.length;
if (failed) {
  console.error(`\n${failed} / ${total} files failed.`);
  process.exit(1);
}
console.log(`✓ ${total} JS files parsed (${cjs.length} cjs, ${esm.length} esm)`);
