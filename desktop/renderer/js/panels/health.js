/**
 * Health panel — 久坐 / 喝水.
 * Rings fill towards the next reminder; the sitting ring resets itself when the
 * system reports the user has been idle (i.e. they actually got up).
 */
import { icon } from '../icons.js';

const R = 16;
const C = 2 * Math.PI * R;

function ring(pct, color, label, value) {
  const dash = Math.max(0, Math.min(100, pct)) / 100 * C;
  return `
    <div class="ring">
      <svg viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="${R}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="3.4"/>
        <circle cx="20" cy="20" r="${R}" fill="none" stroke="${color}" stroke-width="3.4"
          stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C - dash).toFixed(1)}"
          style="transition:stroke-dashoffset .6s cubic-bezier(.22,1,.36,1)"/>
      </svg>
      <div class="val">${label}</div>
      <div class="cap">${value}</div>
    </div>`;
}

export default {
  id: 'health',
  label: '健康',
  icon: 'health',
  height: 376,

  sub(S) {
    const h = S.health || {};
    if (h.sittingEnabled === false && h.waterEnabled === false) return '提醒已关闭';
    return `久坐 ${h.sittingElapsed || 0} 分 · 喝水 ${h.waterElapsed || 0} 分`;
  },

  mount(view, ctx) {
    view.innerHTML = `
      <div class="rings" id="rings"></div>
      <div class="divider"></div>
      <div class="kv">
        <div class="col"><span style="font-size:11.5px">久坐提醒</span><span class="label">离开座位 90 秒自动重置</span></div>
        <button class="switch" id="sittingSw"></button>
      </div>
      <div class="kv">
        <div class="col"><span style="font-size:11.5px">喝水提醒</span><span class="label">按设定间隔提醒</span></div>
        <button class="switch" id="waterSw"></button>
      </div>
      <div class="divider"></div>
      <div class="kv">
        <span class="label">久坐间隔</span>
        <div class="row" style="gap:6px">
          <input class="slider" id="sitRange" type="range" min="20" max="120" step="5" style="width:96px"/>
          <span class="num tiny" id="sitVal" style="width:38px;text-align:right"></span>
        </div>
      </div>
      <div class="kv">
        <span class="label">喝水间隔</span>
        <div class="row" style="gap:6px">
          <input class="slider" id="watRange" type="range" min="20" max="180" step="10" style="width:96px"/>
          <span class="num tiny" id="watVal" style="width:38px;text-align:right"></span>
        </div>
      </div>
      <div class="row" style="gap:6px;padding-top:9px">
        <button class="pillbtn" id="stood" style="flex:1">${icon('stand', 13)} 已起身</button>
        <button class="pillbtn" id="drank" style="flex:1">${icon('drop', 13)} 喝过了</button>
      </div>`;

    const rings = view.querySelector('#rings');
    const sittingSw = view.querySelector('#sittingSw');
    const waterSw = view.querySelector('#waterSw');
    const sitRange = view.querySelector('#sitRange');
    const watRange = view.querySelector('#watRange');
    const sitVal = view.querySelector('#sitVal');
    const watVal = view.querySelector('#watVal');

    function render() {
      const h = ctx.S.health || {};
      const sitPct = h.sittingMinutes ? ((h.sittingElapsed || 0) / h.sittingMinutes) * 100 : 0;
      const watPct = h.waterMinutes ? ((h.waterElapsed || 0) / h.waterMinutes) * 100 : 0;
      rings.innerHTML = `
        ${ring(sitPct, sitPct > 90 ? '#ffd60a' : '#0a84ff', `${h.sittingElapsed || 0} 分`, `目标 ${h.sittingMinutes || 45} 分`)}
        ${ring(watPct, watPct > 90 ? '#ffd60a' : '#32d74b', `${h.waterElapsed || 0} 分`, `目标 ${h.waterMinutes || 60} 分`)}`;
      sittingSw.dataset.on = h.sittingEnabled ? '1' : '0';
      waterSw.dataset.on = h.waterEnabled ? '1' : '0';
      sitRange.value = h.sittingMinutes || 45;
      watRange.value = h.waterMinutes || 60;
      sitVal.textContent = `${h.sittingMinutes || 45} 分`;
      watVal.textContent = `${h.waterMinutes || 60} 分`;
    }

    async function reload() {
      try {
        ctx.S.health = await ctx.invoke('health:status');
        render();
        ctx.refreshHeader();
      } catch {}
    }

    const patch = async (partial) => {
      ctx.S.cfg = { ...ctx.S.cfg, health: { ...(ctx.S.cfg?.health || {}), ...partial } };
      await ctx.invoke('config:patch', { health: partial }).catch(() => {});
      reload();
    };

    sittingSw.addEventListener('click', () => patch({ sittingEnabled: !ctx.S.health.sittingEnabled }));
    waterSw.addEventListener('click', () => patch({ waterEnabled: !ctx.S.health.waterEnabled }));
    sitRange.addEventListener('change', () => patch({ sittingMinutes: Number(sitRange.value) }));
    watRange.addEventListener('change', () => patch({ waterMinutes: Number(watRange.value) }));
    sitRange.addEventListener('input', () => { sitVal.textContent = `${sitRange.value} 分`; });
    watRange.addEventListener('input', () => { watVal.textContent = `${watRange.value} 分`; });

    view.querySelector('#stood').addEventListener('click', async () => {
      ctx.S.health = await ctx.invoke('health:reset', { kind: 'sitting' }).catch(() => ctx.S.health);
      render();
      ctx.refreshHeader();
    });
    view.querySelector('#drank').addEventListener('click', async () => {
      ctx.S.health = await ctx.invoke('health:reset', { kind: 'water' }).catch(() => ctx.S.health);
      render();
      ctx.refreshHeader();
    });

    render();
    reload();
    const timer = setInterval(reload, 25000);
    return { update: render, destroy: () => clearInterval(timer) };
  }
};
