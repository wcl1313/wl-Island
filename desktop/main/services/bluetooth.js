'use strict';
/**
 * Bluetooth service — polls the platform and classifies each device so the
 * renderer can draw a purpose-built icon (headphones / earbuds / speaker /
 * keyboard / mouse / pad / watch / phone …) instead of a generic glyph.
 */
const { EventEmitter } = require('events');

const RULES = [
  { type: 'earbuds', re: /airpods|buds|freebuds|earbud|入耳|豆|wf-1000|wh-1000xm5\s*buds/i },
  { type: 'headphones', re: /headphone|headset|耳机|头戴|wh-1000|qc35|qc45|momentum|beats\s*studio|soundcore/i },
  { type: 'speaker', re: /speaker|音箱|音响|homepod|soundlink|jbl|bose|sound\s*x|小爱|天猫精灵/i },
  { type: 'keyboard', re: /keyboard|键盘|k380|k580|mx\s*keys|keychron/i },
  { type: 'mouse', re: /mouse|鼠标|mx\s*master|magic\s*mouse|轨迹球/i },
  { type: 'gamepad', re: /controller|gamepad|手柄|xbox|dualsense|dualshock|joy-?con|8bitdo/i },
  { type: 'watch', re: /watch|手表|手环|band\s*\d|gt\s*\d|mi\s*band|amazfit/i },
  { type: 'phone', re: /iphone|phone|手机|pixel|mi\s*\d|redmi|huawei|华为|小米|oppo|vivo|oneplus/i },
  { type: 'laptop', re: /macbook|thinkpad|laptop|笔记本|电脑/i },
  { type: 'tv', re: /tv|电视|display|投影/i }
];

function classify(name = '') {
  for (const r of RULES) if (r.re.test(name)) return r.type;
  return 'unknown';
}

class BluetoothService extends EventEmitter {
  constructor({ adapter, cfg }) {
    super();
    this.adapter = adapter;
    this.cfg = cfg;
    this.devices = [];
    this.timer = null;
    this.signature = '';
  }

  start() {
    this.stop();
    if (!this.cfg.get('bluetooth.enabled', true)) return;
    const interval = Math.max(4000, Number(this.cfg.get('bluetooth.pollInterval', 10000)));
    const tick = () => this.poll().catch(() => {});
    tick();
    this.timer = setInterval(tick, interval);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  restart() { this.start(); }

  async poll() {
    let raw = [];
    try { raw = await this.adapter.bluetooth(); } catch { raw = []; }
    const devices = (raw || []).map((d) => ({
      id: d.id || d.name,
      name: (d.name || '').trim(),
      connected: !!d.connected,
      type: classify(d.name),
      battery: null
    })).filter((d) => d.name);

    // Connected first, then alphabetical — stable order avoids UI flicker.
    devices.sort((a, b) => (Number(b.connected) - Number(a.connected)) || a.name.localeCompare(b.name));

    const sig = devices.map((d) => `${d.id}:${d.connected}`).join('|');
    this.devices = devices;
    if (sig !== this.signature) {
      this.signature = sig;
      this.emit('changed', this.public());
    }
  }

  public() {
    return {
      devices: this.devices,
      connected: this.devices.filter((d) => d.connected).length
    };
  }
}

module.exports = { BluetoothService, classify };
