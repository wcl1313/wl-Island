'use strict';
/**
 * 文件中转站 — a drop shelf that lives inside the island.
 *
 * Files are *copied* into the stash (never moved): dropping a file into a HUD
 * should never change where the original lives. Dragging back out uses the
 * Chromium native drag start, so it works into Finder / Explorer / Nautilus and
 * into any app that accepts a file drop.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { app, shell, clipboard, nativeImage } = require('electron');

const EXT_ICON = [
  [/^(png|jpe?g|gif|webp|bmp|svg|avif|heic)$/i, 'image'],
  [/^(mp4|mov|mkv|avi|webm|m4v)$/i, 'video'],
  [/^(mp3|wav|flac|aac|ogg|m4a|ape)$/i, 'audio'],
  [/^(pdf)$/i, 'pdf'],
  [/^(zip|rar|7z|tar|gz|bz2|xz)$/i, 'archive'],
  [/^(docx?|pages)$/i, 'doc'],
  [/^(xlsx?|csv|numbers)$/i, 'sheet'],
  [/^(pptx?|key)$/i, 'slides'],
  [/^(js|ts|tsx|jsx|py|go|rs|java|c|cpp|h|cs|rb|php|swift|kt|sh|json|yml|yaml|toml|md|txt|log)$/i, 'code'],
  [/^(exe|msi|dmg|pkg|deb|rpm|appimage)$/i, 'app']
];

function kindOf(name) {
  const ext = (path.extname(name) || '').slice(1);
  for (const [re, kind] of EXT_ICON) if (re.test(ext)) return kind;
  return 'file';
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

class StashService {
  constructor({ cfg }) {
    this.cfg = cfg;
  }

  get dir() {
    return this.cfg.get('stash.dir') || path.join(app.getPath('userData'), 'stash');
  }

  async ensure() {
    await fsp.mkdir(this.dir, { recursive: true });
    return this.dir;
  }

  async list() {
    await this.ensure();
    const names = await fsp.readdir(this.dir).catch(() => []);
    const items = [];
    for (const file of names) {
      if (file.startsWith('.')) continue;
      const full = path.join(this.dir, file);
      let st;
      try { st = await fsp.stat(full); } catch { continue; }
      if (!st.isFile()) continue;
      const [id, ...rest] = file.split('__');
      const name = rest.join('__') || file;
      items.push({
        id,
        name,
        size: st.size,
        sizeText: humanSize(st.size),
        addedAt: st.birthtimeMs || st.mtimeMs,
        kind: kindOf(name),
        path: full
      });
    }
    items.sort((a, b) => b.addedAt - a.addedAt);
    return items;
  }

  async add(paths = []) {
    await this.ensure();
    const added = [];
    for (const src of paths) {
      try {
        const st = await fsp.stat(src);
        if (!st.isFile()) continue;
        const id = crypto.randomBytes(5).toString('hex');
        const base = path.basename(src);
        const dest = path.join(this.dir, `${id}__${base}`);
        await fsp.copyFile(src, dest);
        added.push({ id, name: base, size: st.size, sizeText: humanSize(st.size), kind: kindOf(base), path: dest });
      } catch (err) {
        console.warn('[stash] add failed', src, err.message);
      }
    }
    await this.enforceLimits();
    return { items: await this.list(), added: added.length };
  }

  async remove(id) {
    const items = await this.list();
    const hit = items.find((i) => i.id === id);
    if (!hit) return this.list();
    await fsp.unlink(hit.path).catch(() => {});
    return this.list();
  }

  async clear() {
    const items = await this.list();
    for (const i of items) await fsp.unlink(i.path).catch(() => {});
    return [];
  }

  async reveal(id) {
    const hit = (await this.list()).find((i) => i.id === id);
    if (hit) shell.showItemInFolder(hit.path);
  }

  async openFile(id) {
    const hit = (await this.list()).find((i) => i.id === id);
    if (!hit) return false;
    await shell.openPath(hit.path);
    return true;
  }

  async copyPath(id) {
    const hit = (await this.list()).find((i) => i.id === id);
    if (!hit) return false;
    clipboard.writeText(hit.path);
    return true;
  }

  async copyImage(id) {
    const hit = (await this.list()).find((i) => i.id === id);
    if (!hit || !/^image\//.test(`image/${path.extname(hit.name).slice(1)}`)) return false;
    const img = nativeImage.createFromPath(hit.path);
    if (img.isEmpty()) return false;
    clipboard.writeImage(img);
    return true;
  }

  async enforceLimits() {
    const maxDays = Number(this.cfg.get('stash.maxDays', 7)) || 0;
    const maxFiles = Number(this.cfg.get('stash.maxFiles', 80)) || 0;
    let items = await this.list();
    if (maxDays > 0) {
      const cutoff = Date.now() - maxDays * 86400000;
      for (const i of items.filter((x) => x.addedAt < cutoff)) {
        await fsp.unlink(i.path).catch(() => {});
      }
      items = await this.list();
    }
    if (maxFiles > 0 && items.length > maxFiles) {
      for (const i of items.slice(maxFiles)) await fsp.unlink(i.path).catch(() => {});
    }
  }
}

module.exports = { StashService, humanSize, kindOf };
