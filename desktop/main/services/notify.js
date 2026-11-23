'use strict';
/**
 * Notification bus.
 *
 * Three sources, one queue:
 *   1. internal  — alarms, reminders, media changes, AI answers
 *   2. local HTTP — POST http://127.0.0.1:7788/notify  (lets any script, build
 *      tool or CI job push into the island; documented in docs/API.md)
 *   3. renderer   — user pressed "test"
 */
const { EventEmitter } = require('events');
const http = require('http');
const crypto = require('crypto');
const { Notification } = require('electron');

class NotifyService {
  constructor({ cfg, onNotify }) {
    this.cfg = cfg;
    this.onNotify = onNotify;
    this.bus = new EventEmitter();
    this.recent = [];
    this.server = null;
  }

  push(payload = {}) {
    const note = {
      id: crypto.randomBytes(4).toString('hex'),
      title: String(payload.title || 'wl-Island').slice(0, 80),
      body: String(payload.body || '').slice(0, 400),
      icon: payload.icon || null,
      level: payload.level || 'info', // info | success | warn | alarm
      app: payload.app || null,
      actions: Array.isArray(payload.actions) ? payload.actions.slice(0, 3) : [],
      at: Date.now()
    };
    // de-dupe identical notifications arriving within 4s (alarm + http + system)
    const dup = this.recent.find((n) => n.title === note.title && n.body === note.body && note.at - n.at < 4000);
    if (dup) return dup;
    this.recent.push(note);
    if (this.recent.length > 40) this.recent.shift();

    this.onNotify?.(note);
    this.bus.emit('note', note);

    if (this.cfg.get('notify.mirrorToSystem', false) && Notification.isSupported()) {
      try {
        new Notification({ title: note.title, body: note.body, silent: !this.cfg.get('notify.sound', true) }).show();
      } catch { /* ignore */ }
    }
    return note;
  }

  history() { return this.recent.slice(-20).reverse(); }

  startServer() {
    this.stopServer();
    if (!this.cfg.get('notify.serverEnabled', true)) return;
    const port = Number(this.cfg.get('notify.port', 7788)) || 7788;
    this.server = http.createServer((req, res) => {
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-headers', 'content-type');
      if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, app: 'wl-island' }));
        return;
      }
      if (req.method !== 'POST' || !req.url.startsWith('/notify')) {
        res.writeHead(404).end();
        return;
      }
      let raw = '';
      req.on('data', (c) => {
        raw += c;
        if (raw.length > 64 * 1024) req.destroy();
      });
      req.on('end', () => {
        let payload = {};
        try { payload = JSON.parse(raw || '{}'); } catch { payload = { title: '通知', body: raw.slice(0, 200) }; }
        const note = this.push(payload);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id: note.id }));
      });
    });
    this.server.on('error', (err) => console.warn('[notify] server:', err.message));
    this.server.listen(port, '127.0.0.1');
  }

  stopServer() {
    if (this.server) {
      try { this.server.close(); } catch {}
      this.server = null;
    }
  }

  dispose() { this.stopServer(); }
}

module.exports = { NotifyService };
