/**
 * Clock panel — live clock, alarms, countdown.
 * The alarm list is the source of truth in the main process; this panel is a
 * thin editor over it so an alarm set at 07:00 survives a renderer reload.
 */
import { icon } from '../icons.js';
import { fmtClock } from '../dom.js';

const DAYS = ['日', '一', '二', '三', '四', '五', '六'];

export default {
  id: 'clock',
  label: '时钟',
  icon: 'clock',
  height: 310,

  sub(S) {
    const on = (S.clock.alarms || []).filter((a) => a.enabled).length;
    return on ? `${on} 个闹钟启用` : '没有闹钟';
  },

  mount(view, ctx) {
    view.innerHTML = `
      <div class="big-clock">
        <div class="t" id="clkT">--:--</div>
        <div class="d" id="clkD"></div>
      </div>
      <div class="row" style="justify-content:space-between;padding:4px 0 6px">
        <span class="label">闹钟</span>
        <button class="pillbtn" data-variant="ghost" id="addAlarm">${icon('plus', 12)} 添加</button>
      </div>
      <div class="list" id="alarms"></div>
      <div class="alarm-form" id="alarmForm" style="display:none;margin-top:7px">
        <input type="time" id="alarmTime" value="07:30" />
        <input class="field grow" id="alarmLabel" placeholder="标签（可选）" />
        <button class="pillbtn" data-variant="accent" id="alarmSave">保存</button>
      </div>
      <div class="divider"></div>
      <div class="row" style="justify-content:space-between;padding-bottom:6px">
        <span class="label">计时器</span>
        <span class="tiny faint" id="timerState"></span>
      </div>
      <div class="timer-row">
        ${[5, 10, 25, 45].map((m) => `<button class="pillbtn" data-min="${m}">${m} 分钟</button>`).join('')}
        <button class="pillbtn" data-variant="danger" id="timerCancel" style="display:none">取消</button>
      </div>`;

    const t = view.querySelector('#clkT');
    const d = view.querySelector('#clkD');
    const alarms = view.querySelector('#alarms');
    const form = view.querySelector('#alarmForm');
    const timeInput = view.querySelector('#alarmTime');
    const labelInput = view.querySelector('#alarmLabel');
    const timerState = view.querySelector('#timerState');
    const cancelBtn = view.querySelector('#timerCancel');
    const is24 = ctx.S.cfg?.clock?.format24 !== false;

    function paintClock() {
      const now = new Date();
      t.textContent = fmtClock(now, is24);
      d.textContent = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · 星期${DAYS[now.getDay()]}`;
      const c = ctx.S.clock.countdown;
      if (c) {
        const left = Math.max(0, Math.round((c.endsAt - Date.now()) / 1000));
        timerState.textContent = `剩余 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        cancelBtn.style.display = '';
      } else {
        timerState.textContent = '未启动';
        cancelBtn.style.display = 'none';
      }
    }

    function renderAlarms() {
      const list = ctx.S.clock.alarms || [];
      if (!list.length) {
        alarms.innerHTML = `<div class="hint faint tiny" style="padding:6px 2px">还没有闹钟，点右上角添加一个。</div>`;
        return;
      }
      alarms.innerHTML = list.map((a) => `
        <div class="alarm" data-off="${a.enabled ? 0 : 1}">
          <div class="col grow">
            <div class="at">${ctx.esc(a.time)}</div>
            <div class="al">${ctx.esc(a.label || (a.days?.length ? a.days.map((x) => `周${DAYS[x]}`).join(' ') : '仅一次'))}</div>
          </div>
          <button class="switch" data-toggle="${a.id}" data-on="${a.enabled ? 1 : 0}" title="启用 / 停用"></button>
          <button class="ibtn" data-del="${a.id}" title="删除">${icon('trash', 14)}</button>
        </div>`).join('');
    }

    async function reload() {
      try {
        const st = await ctx.invoke('clock:state');
        ctx.S.clock = st;
        renderAlarms();
        ctx.refreshHeader();
      } catch {}
    }

    view.querySelector('#addAlarm').addEventListener('click', () => {
      form.style.display = form.style.display === 'none' ? 'flex' : 'none';
      if (form.style.display === 'flex') timeInput.focus();
    });

    view.querySelector('#alarmSave').addEventListener('click', async () => {
      const time = timeInput.value;
      if (!/^\d{2}:\d{2}$/.test(time)) return;
      try {
        const list = await ctx.invoke('clock:add', { time, label: labelInput.value.trim(), days: [] });
        ctx.S.clock.alarms = list;
        labelInput.value = '';
        form.style.display = 'none';
        renderAlarms();
        ctx.refreshHeader();
        ctx.pushNote({ title: '闹钟已添加', body: `每天 ${time} 提醒你`, level: 'success' });
      } catch (err) {
        ctx.pushNote({ title: '添加失败', body: err.message, level: 'warn' });
      }
    });

    alarms.addEventListener('click', async (e) => {
      const toggle = e.target.closest('[data-toggle]');
      const del = e.target.closest('[data-del]');
      try {
        if (toggle) {
          const id = toggle.dataset.toggle;
          const cur = (ctx.S.clock.alarms || []).find((a) => a.id === id);
          const list = await ctx.invoke('clock:update', { id, patch: { enabled: !cur?.enabled } });
          ctx.S.clock.alarms = list;
          renderAlarms();
          ctx.refreshHeader();
        }
        if (del) {
          const list = await ctx.invoke('clock:remove', { id: del.dataset.del });
          ctx.S.clock.alarms = list;
          renderAlarms();
          ctx.refreshHeader();
        }
      } catch {}
    });

    view.querySelectorAll('[data-min]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const c = await ctx.invoke('clock:timer:start', { minutes: Number(btn.dataset.min), label: '' });
          ctx.S.clock.countdown = c;
          paintClock();
          ctx.pushNote({ title: '计时开始', body: `${btn.dataset.min} 分钟后提醒你`, level: 'info' });
        } catch {}
      });
    });

    cancelBtn.addEventListener('click', async () => {
      await ctx.invoke('clock:timer:cancel').catch(() => {});
      ctx.S.clock.countdown = null;
      paintClock();
    });

    paintClock();
    renderAlarms();
    const tick = setInterval(paintClock, 1000);
    reload();

    return { update: () => { renderAlarms(); paintClock(); }, destroy: () => clearInterval(tick) };
  }
};
