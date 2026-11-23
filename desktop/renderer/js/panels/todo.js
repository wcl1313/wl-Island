/**
 * 待办 — a real list, not a scratchpad.
 *
 * Sorted rather than ordered: undone before done, flagged before plain, newest
 * first inside each group. Double-click edits in place; the star survives to
 * the top of the list so the two things that actually matter stay visible.
 */
import { icon } from '../icons.js';

export default {
  id: 'todo',
  label: '待办',
  icon: 'todo',
  height: 302,

  sub(S) {
    const open = S.todo.filter((t) => !t.done).length;
    if (!S.todo.length) return '今天想做什么';
    return open ? `${open} 项待完成 · 共 ${S.todo.length} 项` : '全部完成 ✓';
  },

  mount(view, ctx) {
    view.innerHTML = `
      <div class="p-todo">
        <div class="todo-add">
          <input class="field" id="tdInput" maxlength="300" placeholder="添加一条待办，回车保存" />
          <button class="add-btn" id="tdAdd" title="添加" disabled>${icon('plus', 15)}</button>
        </div>
        <div class="todo-list" id="tdList"></div>
        <div class="todo-foot">
          <span class="todo-count" id="tdCount"></span>
          <button class="pillbtn" data-variant="ghost" id="tdClear">清除已完成</button>
        </div>
      </div>`;

    const input = view.querySelector('#tdInput');
    const addBtn = view.querySelector('#tdAdd');
    const list = view.querySelector('#tdList');
    const count = view.querySelector('#tdCount');

    const sorted = () => [...ctx.S.todo].sort((a, b) => (
      (a.done ? 1 : 0) - (b.done ? 1 : 0)
      || (b.flag ? 1 : 0) - (a.flag ? 1 : 0)
      || (b.createdAt || 0) - (a.createdAt || 0)
    ));

    function render() {
      const items = sorted();
      const left = items.filter((t) => !t.done).length;
      count.textContent = items.length ? `${left} 项待完成 · ${items.length - left} 项已完成` : '';

      if (!items.length) {
        list.innerHTML = `
          <div class="todo-empty">
            ${icon('spark', 20)}
            <div>还没有待办</div>
            <div class="tiny faint">上面输入一句，回车就存下来</div>
          </div>`;
        return;
      }

      list.innerHTML = items.map((t) => `
        <div class="titem" data-id="${ctx.esc(t.id)}" data-done="${t.done ? 1 : 0}" data-flag="${t.flag ? 1 : 0}">
          <button class="tcheck" data-act="done" title="${t.done ? '标为未完成' : '完成'}">${icon('check', 11)}</button>
          <div class="ttext" data-act="edit">${ctx.esc(t.text)}</div>
          <div class="tacts">
            <button class="ibtn tflag" data-act="flag" data-on="${t.flag ? 1 : 0}" title="重要">
              ${icon(t.flag ? 'starFill' : 'star', 13)}
            </button>
            <button class="ibtn" data-act="del" title="删除">${icon('trash', 13)}</button>
          </div>
        </div>`).join('');
    }

    async function commit(res) {
      if (Array.isArray(res)) { ctx.S.todo = res; render(); ctx.refreshHeader(); }
    }

    async function add() {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      addBtn.disabled = true;
      try {
        await commit(await ctx.invoke('todo:add', { text }));
      } catch (err) {
        ctx.pushNote({ title: '保存失败', body: err.message, level: 'warn' });
      }
      input.focus();
    }

    input.addEventListener('input', () => { addBtn.disabled = !input.value.trim(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); add(); }
      if (e.key === 'Escape') { input.value = ''; addBtn.disabled = true; input.blur(); }
    });
    addBtn.addEventListener('click', add);

    list.addEventListener('click', async (e) => {
      const row = e.target.closest('.titem');
      if (!row) return;
      const act = e.target.closest('[data-act]')?.dataset.act;
      const id = row.dataset.id;
      try {
        if (act === 'done') await commit(await ctx.invoke('todo:update', { id, patch: { done: row.dataset.done !== '1' } }));
        if (act === 'flag') await commit(await ctx.invoke('todo:update', { id, patch: { flag: row.dataset.flag !== '1' } }));
        if (act === 'del') {
          row.style.opacity = '0';
          row.style.transform = 'translateX(6px)';
          await new Promise((r) => setTimeout(r, 140));
          await commit(await ctx.invoke('todo:remove', { id }));
        }
      } catch (err) {
        ctx.pushNote({ title: '操作失败', body: err.message, level: 'warn' });
      }
    });

    // Double-click a line to edit it in place.
    list.addEventListener('dblclick', (e) => {
      const textEl = e.target.closest('.ttext');
      if (!textEl || textEl.querySelector('input')) return;
      const row = textEl.closest('.titem');
      const id = row.dataset.id;
      const before = textEl.textContent;
      textEl.innerHTML = `<input class="field" style="padding:4px 7px;font-size:11.5px" value="${ctx.esc(before)}"/>`;
      const field = textEl.querySelector('input');
      field.focus();
      field.select();
      field.setSelectionRange(field.value.length, field.value.length);

      const done = async (save) => {
        if (field.dataset.closed) return;
        field.dataset.closed = '1';
        const next = field.value.trim();
        if (!save || !next || next === before) { render(); return; }
        try { await commit(await ctx.invoke('todo:update', { id, patch: { text: next } })); } catch { render(); }
      };
      field.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); done(true); }
        if (ev.key === 'Escape') { ev.preventDefault(); done(false); }
      });
      field.addEventListener('blur', () => done(true));
    });

    view.querySelector('#tdClear').addEventListener('click', async () => {
      try { await commit(await ctx.invoke('todo:clearDone')); } catch {}
    });

    render();
    setTimeout(() => { try { input.focus({ preventScroll: true }); } catch {} }, 220);

    return {
      update: render,
      destroy: () => {}
    };
  }
};
