/**
 * Bluetooth panel — every device gets an icon drawn for its type.
 */
import { icon, deviceIcon } from '../icons.js';

const TYPE_LABEL = {
  headphones: '头戴耳机',
  earbuds: '真无线耳机',
  speaker: '音箱',
  keyboard: '键盘',
  mouse: '鼠标',
  gamepad: '游戏手柄',
  watch: '手表 / 手环',
  phone: '手机',
  laptop: '电脑',
  tv: '显示设备',
  unknown: '蓝牙设备'
};

export default {
  id: 'bt',
  label: '蓝牙',
  icon: 'bluetooth',
  height: 306,

  sub(S) {
    const n = S.bt.devices.length;
    if (!n) return '未发现已配对设备';
    return `${S.bt.connected} / ${n} 台已连接`;
  },

  mount(view, ctx) {
    view.innerHTML = `
      <div class="row" style="justify-content:space-between;padding:2px 0 8px">
        <span class="label" id="btCount">扫描中…</span>
        <button class="ibtn" id="btRefresh" title="重新扫描">${icon('refresh', 15)}</button>
      </div>
      <div class="list stagger" id="btList"></div>`;

    const list = view.querySelector('#btList');
    const count = view.querySelector('#btCount');

    function render(state) {
      const { devices, connected } = state.bt;
      count.textContent = devices.length ? `${connected} 台已连接 · 共 ${devices.length} 台` : '未发现已配对设备';
      if (!devices.length) {
        list.innerHTML = `<div class="empty">${icon('bluetooth', 24)}<div>没有找到蓝牙设备<br/><span class="faint">先在系统设置里配对一次</span></div></div>`;
        return;
      }
      list.innerHTML = devices.map((d, i) => `
        <div class="item" data-on="${d.connected ? 1 : 0}" style="--i:${i}">
          <div class="dic">${deviceIcon(d.type, 18)}</div>
          <div class="grow col">
            <div class="item-name truncate">${ctx.esc(d.name)}</div>
            <div class="item-sub">${TYPE_LABEL[d.type] || '蓝牙设备'}${d.connected ? ' · 已连接' : ' · 未连接'}</div>
          </div>
          <div class="${d.connected ? 'dot-on' : 'dot-off'}"></div>
        </div>`).join('');
    }

    render(ctx.S);
    const off = ctx.on('bt', (p) => {
      ctx.S.bt = p;
      render(ctx.S);
      ctx.refreshHeader();
    });

    view.querySelector('#btRefresh').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.style.transform = 'rotate(360deg)';
      btn.style.transition = 'transform .6s';
      try {
        const p = await ctx.invoke('bt:list');
        ctx.S.bt = p;
        render(ctx.S);
      } catch {}
      setTimeout(() => { btn.style.transform = ''; btn.style.transition = ''; }, 620);
    });

    return {
      update: () => render(ctx.S),
      destroy: off
    };
  }
};
