'use strict';
/**
 * 久坐提醒 + 喝水提醒.
 *
 * Sitting detection uses powerMonitor idle time: if the user has been idle for
 * more than 90s we treat that as "they got up", which resets the sitting clock.
 * That is the difference between a reminder people keep and one they mute.
 */
const { EventEmitter } = require('events');
const { powerMonitor } = require('electron');

class HealthService extends EventEmitter {
  constructor({ cfg }) {
    super();
    this.cfg = cfg;
    this.timer = null;
    this.idleThreshold = 90;
  }

  start() {
    this.stop();
    this.timer = setInterval(() => this.tick(), 30000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  restart() { this.start(); }

  idleSeconds() {
    try { return powerMonitor.getSystemIdleTime(); } catch { return 0; }
  }

  status() {
    const sittingMinutes = Number(this.cfg.get('health.sittingMinutes', 45));
    const waterMinutes = Number(this.cfg.get('health.waterMinutes', 60));
    const now = Date.now();
    const lastStand = Number(this.cfg.get('health.lastStandAt', 0)) || now;
    const lastWater = Number(this.cfg.get('health.lastWaterAt', 0)) || now;
    return {
      sittingEnabled: this.cfg.get('health.sittingEnabled', true),
      waterEnabled: this.cfg.get('health.waterEnabled', true),
      sittingMinutes,
      waterMinutes,
      sittingElapsed: Math.max(0, Math.floor((now - lastStand) / 60000)),
      waterElapsed: Math.max(0, Math.floor((now - lastWater) / 60000)),
      idle: this.idleSeconds()
    };
  }

  tick() {
    const now = Date.now();
    const idle = this.idleSeconds();
    if (idle >= this.idleThreshold) {
      // 用户离开了座位 —— 视为已经休息过
      this.cfg.set('health.lastStandAt', now);
      return;
    }
    if (this.cfg.get('health.sittingEnabled', true)) {
      const limit = Number(this.cfg.get('health.sittingMinutes', 45)) * 60000;
      const last = Number(this.cfg.get('health.lastStandAt', 0)) || now;
      if (now - last >= limit) {
        this.cfg.set('health.lastStandAt', now);
        this.emit('remind', { kind: 'sitting', minutes: Math.round(limit / 60000) });
      }
    }
    if (this.cfg.get('health.waterEnabled', true)) {
      const limit = Number(this.cfg.get('health.waterMinutes', 60)) * 60000;
      const last = Number(this.cfg.get('health.lastWaterAt', 0)) || now;
      if (now - last >= limit) {
        this.cfg.set('health.lastWaterAt', now);
        this.emit('remind', { kind: 'water', minutes: Math.round(limit / 60000) });
      }
    }
  }

  /** User pressed "I stood up" / "I drank" or started a fresh session. */
  reset(kind) {
    const now = Date.now();
    if (kind === 'sitting' || kind === 'all') this.cfg.set('health.lastStandAt', now);
    if (kind === 'water' || kind === 'all') this.cfg.set('health.lastWaterAt', now);
    return this.status();
  }
}

module.exports = { HealthService };
