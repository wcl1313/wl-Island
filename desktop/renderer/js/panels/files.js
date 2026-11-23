/**
 * 文件中转站 — drop in, drag out.
 *
 * Files are copied into the stash by the main process; this panel never touches
 * the filesystem itself, it only sends paths and ids. The actual drop handling
 * lives in app.js so that dropping onto a *collapsed* pill works too.
 */
import { icon } from '../icons.js';

const KIND_TEXT = {
  image: 'IMG', video: 'VID', audio: 'AUD', pdf: 'PDF', archive: 'ZIP',
  doc: 'DOC', sheet: 'XLS', slides: 'PPT', code: 'TXT', app: 'APP', file: 'FILE'
};

export default {
  id: 'files',
  label: '中转站',
  icon: 'files',
  height: 330,

  sub(S) {
    const n = S.stash.items.length;
    return n ? `${n} 个文件暂存中` : '把文件拖到岛上';
  },

  mount(view, ctx) {
    view.innerHTML = `
      <div class="drop" id="drop">
        ${icon('files', 26)}
        <div style="font-size:11.5px;font-weight:560">拖文件到这里</div>
        <div class="hint">拖到岛的任意位置都会收下<br/>之后可拖到任何应用，或直接打开</div>
      </div>
      <div class="row" style="justify-content:space-between;padding:9px 2px 5px">
        <span class="label" id="fsCount">—</span>
        <div class="row" style="gap:3px">
          <button class="ibtn" id="fsOpenDir" title="打开中转站目录">${icon('folder', 15)}</button>
          <button class="ibtn" id="fsClear" title="清空">${icon('trash', 15)}</button>
        </div>
      </div>
      <div class="list" id="fsList"></div>`;

    const drop = view.querySelector('#drop');
    const list = view.querySelector('#fsList');
    const count = view.querySelector('#fsCount');

    function render() {
      const items = ctx.S.stash.items;
      count.textContent = items.length ? `${items.length} 个文件` : '中转站是空的';
      if (!items.length) {
        list.innerHTML = '';
        return;
      }
      list.innerHTML = items.map((f) => `
        <div class="file" draggable="true" data-id="${f.id}">
          <div class="fic" data-k="${f.kind}">${KIND_TEXT[f.kind] || 'FILE'}</div>
          <div class="grow col">
            <div class="fname truncate">${ctx.esc(f.name)}</div>
            <div class="fmeta">${f.sizeText}</div>
          </div>
          <div class="facts">
            <button class="ibtn" data-act="open" title="打开">${icon('external', 14)}</button>
            <button class="ibtn" data-act="reveal" title="在文件夹中显示">${icon('folder', 14)}</button>
            <button class="ibtn" data-act="copy" title="复制路径">${icon('copy', 14)}</button>
            <button class="ibtn" data-act="del" title="删除">${icon('trash', 14)}</button>
          </div>
        </div>`).join('');
    }

    async function reload() {
      try {
        ctx.S.stash.items = await ctx.invoke('stash:list');
        render();
        ctx.refreshHeader();
      } catch {}
    }

    // Visual feedback only — the drop itself is handled once, in app.js.
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('hot'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('hot'));
    ['dragenter'].forEach((ev) => view.addEventListener(ev, () => drop.classList.add('hot')));
    view.addEventListener('dragleave', () => drop.classList.remove('hot'));

    list.addEventListener('dragstart', (e) => {
      const row = e.target.closest('.file');
      if (!row) return;
      // Hands the real file to the OS drag session (works into Explorer).
      ctx.invoke('stash:drag', { id: row.dataset.id }).catch(() => {});
      e.preventDefault();
    });

    list.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      const row = e.target.closest('.file');
      if (!row) return;
      const id = row.dataset.id;
      const act = btn?.dataset.act;
      try {
        if (!act || act === 'open') await ctx.invoke('stash:open', { id });
        if (act === 'reveal') await ctx.invoke('stash:reveal', { id });
        if (act === 'copy') {
          await ctx.invoke('stash:copyPath', { id });
          ctx.pushNote({ title: '路径已复制', level: 'success' });
        }
        if (act === 'del') {
          ctx.S.stash.items = await ctx.invoke('stash:remove', { id });
          render();
          ctx.refreshHeader();
        }
      } catch {}
    });

    view.querySelector('#fsClear').addEventListener('click', async () => {
      try {
        await ctx.invoke('stash:clear');
        ctx.S.stash.items = [];
        render();
        ctx.refreshHeader();
      } catch {}
    });
    view.querySelector('#fsOpenDir').addEventListener('click', () => {
      ctx.invoke('sys:revealStash').catch(() => {});
    });

    drop.addEventListener('click', () => {
      ctx.invoke('sys:revealStash').catch(() => {});
    });

    render();
    reload();
    return { update: render, destroy: () => {} };
  }
};
