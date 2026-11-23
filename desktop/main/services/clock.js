'use strict';
/**
 * Clock + alarms + countdown timer.
 * Alarms are stored in the config so they survive restarts; the scheduler ticks
 * every 10s and de-duplicates per (date, minute, alarm) so a suspend/resume or a
 * clock change cannot double-fire.
 */
const { EventEmitter } = require('events');
const crypto = require('crypto');

const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

class ClockService extends EventEmitter {
  constructor({ cfg }) {
    super();
    this.cfg = cfg;
    this.timer = null;
    this.fired = new Set();
    this.countdown = null;
    this._countdownHandle = null;
  }

  start() {
    this.stop();
    this.timer = setInterval(() => this.tick(), 10000);
    this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  alarms() {
    return this.cfg.get('clock.alarms', []) || [];
  }

  add({ time, days = [], label = '', enabled = true }) {
    if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('time 格式应为 HH:MM');
    const alarm = { id: crypto.randomBytes(4).toString('hex'), time, days, label, enabled };
    const alarms = [...this.alarms(), alarm];
    this.cfg.set('clock.alarms', alarms);
    return alarms;
  }

  update(id, patch) {
    const alarms = this.alarms().map((a) => (a.id === id ? { ...a, ...patch } : a));
    this.cfg.set('clock.alarms', alarms);
    return alarms;
  }

  remove(id) {
    const alarms = this.alarms().filter((a) => a.id !== id);
    this.cfg.set('clock.alarms', alarms);
    return alarms;
  }

  tick() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const stamp = `${now.toDateString()} ${hh}:${mm}`;
    for (const a of this.alarms()) {
      if (!a.enabled || a.time !== `${hh}:${mm}`) continue;
      if (Array.isArray(a.days) && a.days.length && !a.days.includes(now.getDay())) continue;
      const key = `${a.id}@${stamp}`;
      if (this.fired.has(key)) continue;
      this.fired.add(key);
      if (this.fired.size > 200) this.fired = new Set([...this.fired].slice(-100));
      this.emit('alarm', a);
      if (!a.days?.length) this.update(a.id, { enabled: false }); // 单次闹钟自动关闭
    }
    if (this.countdown && Date.now() >= this.countdown.endsAt) {
      const c = this.countdown;
      this.countdown = null;
      this.emit('timer-done', c);
    }
  }

  startTimer(minutes, label = '') {
    const total = Math.max(1, Number(minutes)) * 60;
    this.countdown = { id: crypto.randomBytes(4).toString('hex'), label, total, endsAt: Date.now() + total * 1000 };
    this.emit('timer-start', this.countdown);
    return this.countdown;
  }

  cancelTimer() {
    this.countdown = null;
    this.emit('timer-cancel');
  }

  state() {
    return {
      alarms: this.alarms(),
      countdown: this.countdown,
      days: DAY_NAMES
    };
  }
}

module.exports = { ClockService };
