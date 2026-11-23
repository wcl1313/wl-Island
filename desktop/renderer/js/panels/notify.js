/**
 * Notification panel — history + the local push endpoint.
 * `POST http://127.0.0.1:7788/notify` is how any other tool (build scripts, CI,
 * a browser userscript) can talk to the island.
 */
import { icon } from '../icons.js';

const LEVEL_ICON = { info: 'notify', success: 'check', warn: 'notify', alarm: 'clock' };

export default {
  id: 'notify',
  label: '消息',
  icon: 'notify',
  height: 340,

  sub(S) {
    const n = S.notes.length;
    return n ? `${n} 条最近消息` : '暂无消息';
  },

  mount(view, ctx) {
    view.innerHTML = `
      <div class="row" style="justify-content:space-between;padding:2px 0 8px">
        <span class="label">最近通知</span>
        <button class="pillbtn" data-variant="ghost" id="ntTest">${icon('spark', 12)} 测试一条</button>
      </div>
      <div class="list" id="ntList"></div>
      <div class="divider"></div>
      <div class="label" style="padding-bottom:5px">本地推送接口</div>
      <div class="notice" style="background:rgba(255,255,255,.04);box-shadow:inset 0 0 0 .8px rgba(255,255,255,.08)">
        <div style="font-size:9.5px;line-height:1.6">
          <code>POST http://127.0.0.1:${ctx.S.cfg?.notify?.port || 7788}/notify</code><br/>
          <code>{"title":"构建完成","body":"3 分 12 秒","level":"success"}</code>
        </div>
        <button class="pillbtn" data-variant="ghost" id="ntCopy" style="margin-top:6px">${icon('copy', 12)} 复制示例</button>
      </div>`;

    const list = view.querySelector('#ntList');

    function fmt(ts) {
      const d = new Date(ts);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    function render() {
      const notes = ctx.S.notes;
      if (!notes.length) {
        list.innerHTML = `<div class="empty">${icon('notify', 24)}<div>还没有通知<br/><span class="faint">闹钟、提醒和外部推送都会出现在这里</span></div></div>`;
        requestAnimationFrame(() => ctx.fit());
        return;
      }
      list.innerHTML = notes.slice(0, 12).map((n) => `
        <div class="note-row">
          <div class="ni">${icon(LEVEL_ICON[n.level] || 'notify', 14)}</div>
          <div class="grow col">
            <div class="nt truncate">${ctx.esc(n.title)}</div>
            <div class="nb">${ctx.esc(n.body)}</div>
            <div class="nw">${fmt(n.at)}</div>
          </div>
        </div>`).join('');
      requestAnimationFrame(() => ctx.fit());
    }

    view.querySelector('#ntTest').addEventListener('click', () => ctx.invoke('notify:test').catch(() => {}));
    view.querySelector('#ntCopy').addEventListener('click', async () => {
      const example = `curl -X POST http://127.0.0.1:${ctx.S.cfg?.notify?.port || 7788}/notify -H "content-type: application/json" -d "{\\"title\\":\\"构建完成\\",\\"body\\":\\"3 分 12 秒\\",\\"level\\":\\"success\\"}"`;
      try {
        await ctx.invoke('sys:copyText', { text: example });
        ctx.pushNote({ title: '示例已复制', body: '粘贴到终端即可试', level: 'success' });
      } catch {}
    });

    render();
    ctx.invoke('notify:list').then((h) => { ctx.S.notes = h; render(); }).catch(() => {});
    const off = ctx.on('note', () => render());

    return { update: render, destroy: off };
  }
};
