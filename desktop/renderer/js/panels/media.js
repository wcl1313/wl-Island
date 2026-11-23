/**
 * Media panel — the centrepiece.
 *
 * Design decisions worth knowing:
 *  • Position is interpolated locally at 60 fps from (position, stamp, playing),
 *    so the progress bar is smooth even though we only poll the OS every ~1.6 s.
 *  • The player chips exist because 网易云 / 波点 / QQ音乐 each publish their own
 *    media session; Windows hands us "the current one", which is not always the
 *    one the user is looking at. Pinning a session fixes that for good.
 *  • Controls are optimistic: the icon flips instantly, then the poll reconciles.
 */
import { icon } from '../icons.js';
import { fmtTime } from '../dom.js';

export default {
  id: 'media',
  label: '媒体',
  icon: 'media',
  height: 356,

  sub(S) {
    if (!S.media.active) return '没有正在播放的内容';
    return S.media.app || '正在播放';
  },

  mount(view, ctx) {
    const { S } = ctx;
    view.innerHTML = `
      <div class="p-media">
        <div class="np">
          <div class="art" id="art">${icon('media', 22)}</div>
          <div class="grow col">
            <div class="np-title truncate" id="mTitle">未在播放</div>
            <div class="np-artist truncate" id="mArtist">打开任意音乐应用试试</div>
            <div class="np-app" id="mApp"></div>
          </div>
        </div>
        <div class="progress-wrap">
          <div class="progress" id="mProg">
            <div class="track"><div class="fill" id="mFill"></div></div>
            <div class="knob" id="mKnob"></div>
          </div>
          <div class="times"><span id="mCur">0:00</span><span id="mDur">0:00</span></div>
        </div>
        <div class="controls">
          <button class="cbtn" data-act="prev" title="上一首">${icon('prev', 20)}</button>
          <button class="cbtn" data-main="1" data-act="toggle" title="播放 / 暂停">${icon('play', 22)}</button>
          <button class="cbtn" data-act="next" title="下一首">${icon('next', 20)}</button>
        </div>
        <div class="lyric" id="mLyric"></div>
        <div class="players" id="mPlayers"></div>
      </div>`;

    const $ = (id) => view.querySelector(`#${id}`);
    const art = $('art');
    const title = $('mTitle');
    const artist = $('mArtist');
    const appEl = $('mApp');
    const fill = $('mFill');
    const knob = $('mKnob');
    const cur = $('mCur');
    const dur = $('mDur');
    const lyricEl = $('mLyric');
    const players = $('mPlayers');
    const toggleBtn = view.querySelector('[data-act="toggle"]');

    let base = { pos: 0, stamp: Date.now(), playing: false, dur: 0 };
    let seeking = false;
    let pinned = S.cfg?.media?.preferApp || '';

    function paintProgress() {
      if (seeking) return;
      const elapsed = base.playing ? (Date.now() - base.stamp) / 1000 : 0;
      const pos = Math.min(base.dur || 0, base.pos + elapsed);
      const pct = base.dur > 0 ? (pos / base.dur) * 100 : 0;
      fill.style.width = `${pct}%`;
      knob.style.left = `${pct}%`;
      cur.textContent = fmtTime(pos);
      dur.textContent = fmtTime(base.dur);
      paintLyric(pos);
    }

    let lyricLines = [];
    let lastLyricIdx = -1;
    function paintLyric(pos) {
      if (!lyricLines.length) { lyricEl.textContent = ''; lyricEl.style.opacity = '0'; return; }
      let idx = -1;
      for (let i = 0; i < lyricLines.length; i += 1) {
        if (lyricLines[i].t <= pos) idx = i; else break;
      }
      if (idx === lastLyricIdx) return;
      lastLyricIdx = idx;
      lyricEl.style.opacity = '0';
      setTimeout(() => {
        lyricEl.textContent = idx >= 0 ? lyricLines[idx].text : '';
        lyricEl.style.opacity = '1';
      }, 120);
    }

    function paint(state) {
      const m = state.media;
      // Fallback players (网易云 3.x) expose no timeline, so the progress row
      // would sit there frozen at 0:00 / 0:00 and eat the vertical space.
      const timed = (m.duration || 0) > 0;
      view.querySelector('.p-media')?.classList.toggle('no-progress', !timed);
      art.style.backgroundImage = state.artUrl ? `url("${state.artUrl}")` : '';
      art.dataset.playing = m.playing ? '1' : '0';
      art.innerHTML = state.artUrl ? '' : icon('media', 22);
      title.textContent = m.title || '未在播放';
      artist.textContent = m.artist || (m.active ? '未知艺术家' : '打开任意音乐应用试试');
      appEl.innerHTML = m.active
        ? `<span class="apptag">${icon('wave', 10)}${ctx.esc(m.app || '播放器')}</span>`
        : '';
      toggleBtn.innerHTML = icon(m.playing ? 'pause' : 'play', 22);
      base = {
        pos: m.position || 0,
        stamp: m.stamp || Date.now(),
        playing: !!m.playing,
        dur: m.duration || 0
      };
      lyricLines = Array.isArray(m.lyrics) ? m.lyrics : [];
      lastLyricIdx = -1;
      paintProgress();
      [...view.querySelectorAll('.cbtn')].forEach((b) => {
        b.disabled = !m.canControl && !m.active;
      });
    }

    async function loadPlayers() {
      try {
        const list = await ctx.invoke('media:sessions');
        if (!Array.isArray(list) || !list.length) {
          players.innerHTML = '<span class="label" style="line-height:1.5">没有可切换的播放器会话。多个播放器同时运行时，可以在这里固定一个。</span>';
          return;
        }
        players.innerHTML = list.map((p, i) => `
          <button class="chip" data-id="${ctx.esc(p.id || '')}" data-on="${p.id === pinned || (!pinned && i === 0) ? '1' : '0'}"
                  title="${ctx.esc(`${p.app || p.id}${p.playing ? ' · 播放中' : ''}`)}">
            ${ctx.esc(p.app || String(p.id).split('.').pop())}
          </button>`).join('');
      } catch { players.innerHTML = ''; }
    }

    view.querySelectorAll('.cbtn').forEach((b) => {
      b.addEventListener('click', async () => {
        const act = b.dataset.act;
        if (act === 'toggle') {
          const next = !base.playing;
          base.playing = next;
          base.stamp = Date.now();
          toggleBtn.innerHTML = icon(next ? 'pause' : 'play', 22);
          paintProgress();
        }
        try { await ctx.invoke('media:control', { action: act }); } catch { /* reconciled by poll */ }
      });
    });

    const prog = $('mProg');
    const ratioFromEvent = (e) => {
      const r = prog.getBoundingClientRect();
      return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    };
    prog.addEventListener('pointerdown', (e) => {
      if (!base.dur) return;
      seeking = true;
      prog.setPointerCapture(e.pointerId);
      const pct = ratioFromEvent(e) * 100;
      fill.style.width = `${pct}%`;
      knob.style.left = `${pct}%`;
      cur.textContent = fmtTime(ratioFromEvent(e) * base.dur);
    });
    prog.addEventListener('pointerup', async (e) => {
      if (!seeking) return;
      seeking = false;
      const ratio = ratioFromEvent(e);
      try { await ctx.invoke('media:control', { action: 'seek', position: ratio * base.dur }); } catch {}
      base.pos = ratio * base.dur;
      base.stamp = Date.now();
      paintProgress();
    });

    players.addEventListener('click', async (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      pinned = chip.dataset.id;
      players.querySelectorAll('.chip').forEach((c) => {
        c.dataset.on = c === chip ? '1' : '0';
      });
      try { await ctx.invoke('media:target', { id: pinned }); } catch {}
    });

    const timer = setInterval(paintProgress, 250);
    const playerTimer = setInterval(loadPlayers, 12000);
    loadPlayers();

    ctx.on('media', (m) => paint({ ...ctx.S, media: m, artUrl: ctx.S.artUrl }));
    ctx.on('media:art', ({ url }) => {
      ctx.S.artUrl = url;
      paint(ctx.S);
    });

    paint(S);
    if (!S.artUrl) ctx.invoke('media:art').then((url) => { if (url) { ctx.S.artUrl = url; paint(ctx.S); } }).catch(() => {});

    return {
      update: () => paint(ctx.S),
      destroy: () => { clearInterval(timer); clearInterval(playerTimer); }
    };
  }
};
