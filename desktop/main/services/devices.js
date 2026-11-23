'use strict';
/**
 * USB / serial-port inventory.
 *
 * Both enumerations go through the resident PowerShell bridge, which costs one
 * WMI query each. The result is cached for a few seconds so flipping between
 * status tabs never queues up queries, and a failed bridge is reported as an
 * empty list rather than an exception (the panel then says "读取失败" instead
 * of breaking the whole status surface).
 */
class DeviceService {
  constructor({ adapter }) {
    this.adapter = adapter;
    this.cache = null;
    this.at = 0;
    this.pending = null;
  }

  async list() {
    if (this.cache && Date.now() - this.at < 5000) return this.cache;
    if (this.pending) return this.pending;

    this.pending = (async () => {
      const [usb, serial] = await Promise.all([
        this.adapter.usbDevices?.().catch(() => []) ?? [],
        this.adapter.serialPorts?.().catch(() => []) ?? []
      ]);
      const clean = (d) => ({
        name: String(d.name || d.id || '未知设备').trim(),
        id: String(d.id || ''),
        cls: String(d.cls || ''),
        status: String(d.status || 'OK'),
        ok: String(d.status || 'OK').toUpperCase() === 'OK'
      });
      // A headset publishes itself as USB parent + HID child; keep the first
      // (most specific) name and drop the duplicates.
      const seen = new Set();
      const unique = (list) => list.filter((d) => {
        const key = `${d.name}|${d.cls}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      this.cache = {
        usb: unique((usb || []).map(clean).filter((d) => d.name)).slice(0, 40),
        serial: (serial || []).map(clean).filter((d) => d.name || d.id),
        at: Date.now()
      };
      this.at = Date.now();
      return this.cache;
    })().finally(() => { this.pending = null; });

    return this.pending;
  }

  invalidate() {
    this.cache = null;
    this.at = 0;
  }
}

module.exports = { DeviceService };
