'use strict';
/**
 * wl-Island — todo list.
 *
 * Deliberately its own JSON file rather than a config key: toggling a checkbox
 * must not look like a settings change, and the list is the one piece of data
 * people would be upset to lose. Atomic writes, newest first.
 */
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { app } = require('electron');

const MAX_ITEMS = 200;

class TodoService {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'todos.json');
    this.items = this._read();
  }

  _read() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((t) => t && typeof t.text === 'string')
        .map((t) => ({
          id: String(t.id || randomUUID()),
          text: t.text.slice(0, 300),
          done: !!t.done,
          flag: !!t.flag,
          createdAt: Number(t.createdAt) || Date.now(),
          doneAt: Number(t.doneAt) || 0
        }));
    } catch {
      return [];
    }
  }

  _write() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.items, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
      return true;
    } catch (err) {
      console.error('[todo] write failed:', err.message);
      return false;
    }
  }

  list() {
    return this.items;
  }

  add(text, { flag = false } = {}) {
    const body = String(text || '').trim().slice(0, 300);
    if (!body) throw new Error('内容为空');
    this.items.unshift({
      id: randomUUID(),
      text: body,
      done: false,
      flag: !!flag,
      createdAt: Date.now(),
      doneAt: 0
    });
    if (this.items.length > MAX_ITEMS) this.items.length = MAX_ITEMS;
    this._write();
    return this.items;
  }

  update(id, patch = {}) {
    const hit = this.items.find((t) => t.id === id);
    if (!hit) throw new Error('待办不存在');
    if (typeof patch.text === 'string') {
      const body = patch.text.trim().slice(0, 300);
      if (body) hit.text = body;
    }
    if (patch.done !== undefined) {
      hit.done = !!patch.done;
      hit.doneAt = hit.done ? Date.now() : 0;
    }
    if (patch.flag !== undefined) hit.flag = !!patch.flag;
    this._write();
    return this.items;
  }

  remove(id) {
    this.items = this.items.filter((t) => t.id !== id);
    this._write();
    return this.items;
  }

  clearDone() {
    this.items = this.items.filter((t) => !t.done);
    this._write();
    return this.items;
  }
}

module.exports = { TodoService };
