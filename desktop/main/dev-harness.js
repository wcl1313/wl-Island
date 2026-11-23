'use strict';
/**
 * Dev-only harness: clicks through every panel and snapshots the window, plus
 * the desktop composite, so UI regressions are visible without a human.
 * Enabled by `npm run dev`; harmless (and deletable) in production builds.
 */
const fs = require('fs');
const path = require('path');
const { desktopCapturer, screen } = require('electron');

const OUT = path.join(process.cwd(), '.tmp');
// WL_REAL_MEDIA=1 skips the synthetic now-playing fixture so the harness can
// inspect the real OS media pipeline (useful when debugging a player adapter).
const REAL_MEDIA = process.env.WL_REAL_MEDIA === '1';
const IDS = ['media', 'todo', 'files', 'ai', 'clock', 'health', 'bt', 'status', 'notify', 'settings'];
const THEMES = ['midnight', 'titanium', 'moss', 'indigo', 'snow', 'ivory'];

module.exports = function attachHarness(win) {
  const js = (code) => win.webContents.executeJavaScript(code);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const outFile = (name) => {
    fs.mkdirSync(OUT, { recursive: true });
    return path.join(OUT, `${name}.png`);
  };
  /**
   * capturePage can hand back the previous frame right after the window is
   * resized (the morph changes bounds mid-flight), so retry until the image
   * matches the live content size.
   */
  const shotWindow = async (name) => {
    // getContentSize() is DIP, capturePage() is physical pixels — compare in the
    // same space or every shot waits out the retry loop on a scaled display.
    const sf = screen.getDisplayMatching(win.getBounds()).scaleFactor || 1;
    const want = win.getContentSize().map((n) => Math.round(n * sf));
    let img = await win.webContents.capturePage();
    for (let i = 0; i < 6; i++) {
      const s = img.getSize();
      if (Math.abs(s.width - want[0]) <= 1 && Math.abs(s.height - want[1]) <= 1) break;
      await wait(110);
      img = await win.webContents.capturePage();
    }
    fs.writeFileSync(outFile(name), img.toPNG());
    const got = img.getSize();
    return { want: want.join('x'), got: `${got.width}x${got.height}` };
  };
  const shotDesktop = async (name) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 3840, height: 2160 } });
    if (!sources[0]) return;
    const img = sources[0].thumbnail;
    const size = img.getSize();
    const w = 1000;
    const h = 760;
    const cropped = img.crop({
      x: Math.round(size.width / 2 - w / 2),
      y: 0,
      width: w,
      height: h
    });
    fs.writeFileSync(outFile(name), cropped.toPNG());
  };

  setTimeout(async () => {
    try {
      const dom = await js("({ stage: document.getElementById('stage').offsetWidth, island: document.getElementById('island').dataset.state, theme: document.documentElement.dataset.theme })");
      console.log('[harness] dom', JSON.stringify(dom));

      // No real cursor here, so the island would auto-collapse mid-run. A
      // synthetic hover keeps it open without touching the user's config.
      await js("document.getElementById('island').dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }))");
      await wait(60);

      // The onboarding hint fires on first run; drop it so the pill shots are
      // clean. Removing the node is a real state change — the ResizeObserver
      // shrinks the window through the normal path.
      await js("[...document.querySelectorAll('.banner')].forEach((b) => b.remove())");
      await wait(420);

      // ---- collapsed, idle: a pair of eyes and the clock -------------------
      if (!REAL_MEDIA) {
        await js("window.__wl.setMedia({ active: false, playing: false, title: '', artist: '', lyrics: [] })");
      }
      await wait(420);
      const idle = await shotWindow('pill-idle');
      await shotDesktop('desktop-idle');
      const eyeInfo = await js(`(() => {
        const i = document.getElementById('island').getBoundingClientRect();
        const e = document.getElementById('eyes').getBoundingClientRect();
        return { box: Math.round(i.width) + 'x' + Math.round(i.height), eyes: Math.round(e.width) + 'x' + Math.round(e.height) };
      })()`);
      console.log('[harness] pill-idle', JSON.stringify(eyeInfo), idle.got);

      // ---- collapsed with a lyric -----------------------------------------
      if (!REAL_MEDIA) {
        await js(`window.__wl.setMedia({
          active: true, playing: true, title: '成都', artist: '赵雷', app: '网易云音乐',
          position: 44, duration: 328, canControl: true,
          lyrics: [
            { t: 0, text: '让我掉下眼泪的' },
            { t: 20, text: '不止昨夜的酒' },
            { t: 40, text: '让我依依不舍的 不止你的温柔' },
            { t: 62, text: '余路还要走多久' }
          ]
        })`);
      }
      await wait(700);
      const pill = await shotWindow('pill-lyric');
      await wait(400);
      await shotDesktop('desktop-lyric');
      const lyricInfo = await js(`(() => {
        const i = document.getElementById('island');
        const on = i.querySelector('.pill-lyric .ly.on');
        const b = on && on.firstElementChild;
        return {
          box: Math.round(i.getBoundingClientRect().width) + 'x' + Math.round(i.getBoundingClientRect().height),
          mode: i.dataset.lyric,
          text: b ? b.textContent : '',
          slide: on ? on.classList.contains('slide') : false
        };
      })()`);
      console.log('[harness] pill-lyric', JSON.stringify(lyricInfo), pill.got);

      // ---- drop veil (pure CSS state, checked for layout only) -------------
      await js("document.getElementById('island').dataset.drop = '1'");
      await wait(360);
      await shotWindow('drop-veil');
      await js("document.getElementById('island').dataset.drop = '0'");
      await wait(160);

      // ---- every panel -----------------------------------------------------
      await js("document.getElementById('island').click()");
      await wait(780);

      await js(`window.__wl.setTodo([
        { id: 'a', text: '把 README 的截图换成新主题', done: false, flag: true, createdAt: Date.now() },
        { id: 'b', text: '给状态面板加上网络延迟', done: false, flag: false, createdAt: Date.now() - 1000 },
        { id: 'c', text: '调一版深海配色的对比度', done: true, flag: false, createdAt: Date.now() - 5000 }
      ])`);

      for (const id of IDS) {
        await js(`document.querySelector('.dock button[data-id="${id}"]')?.click()`);
        await wait(920);
        const shot = await shotWindow(`panel-${id}`);
        // scrollHeight > clientHeight would mean the panel is still clipped —
        // the fitter is supposed to make that impossible, so log it.
        const box = await js(`(() => {
          const v = document.getElementById('view');
          const i = document.getElementById('island').getBoundingClientRect();
          return { h: Math.round(i.height), view: v.clientHeight, content: v.scrollHeight };
        })()`);
        const clipped = box.content > box.view + 1 ? ' CLIPPED' : '';
        console.log('[harness] panel', id, JSON.stringify(box), shot.got, clipped);

        if (id === 'status') {
          await js("document.querySelector('#stTabs button[data-pane=\"devices\"]')?.click()");
          await wait(1100);
          await shotWindow('panel-status-devices');
          await js("document.querySelector('#stTabs button[data-pane=\"tune\"]')?.click()");
          await wait(900);
          await shotWindow('panel-status-tune');
          await js("document.querySelector('#stTabs button[data-pane=\"overview\"]')?.click()");
          await wait(500);
        }

        // The veil also has to sit on top of an expanded panel, not just the pill.
        if (id === 'files') {
          await js("document.getElementById('island').dataset.drop = '1'");
          await wait(360);
          await shotWindow('drop-veil-expanded');
          await js("document.getElementById('island').dataset.drop = '0'");
          await wait(200);
        }
      }

      // banner: switch to notifications and fire a test note
      await js("document.querySelector('.dock button[data-id=\"notify\"]')?.click()");
      await wait(520);
      await js("document.getElementById('ntTest')?.click()");
      await wait(950);
      await shotWindow('banner');
      await shotDesktop('desktop-expanded');

      // Typing must survive a cursor leave: folding the panel away while someone
      // is pasting an API key is the worst possible outcome of leave-to-collapse.
      await js("document.querySelector('.dock button[data-id=\"settings\"]')?.click()");
      await wait(700);
      await js("document.querySelector('.nav-item[data-tab=\"ai\"]')?.click()");
      await wait(520);
      await js("document.getElementById('stKey')?.focus()");
      await wait(150);
      await js("document.getElementById('island').dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }))");
      await wait(900);
      const typing = await js("document.getElementById('island').dataset.state");
      console.log('[harness] typing-keeps-open ->', typing);
      await js("document.activeElement instanceof HTMLElement && document.activeElement.blur()");

      // ---- themes ----------------------------------------------------------
      // Hover again: blurring the key field let the leave-timer fold the island.
      await js("document.getElementById('island').dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }))");
      await js("document.querySelector('.dock button[data-id=\"settings\"]')?.click()");
      await wait(760);
      await js("document.querySelector('.nav-item[data-tab=\"look\"]')?.click()");
      await wait(520);
      for (const t of THEMES) {
        await js(`window.__wl.setTheme('${t}')`);
        await wait(420);
        await shotWindow(`theme-${t}`);
      }
      await js("window.__wl.setTheme('midnight')");
      await wait(320);

      // leave-to-collapse: the cursor "leaves", nothing else touches the island,
      // and it must fold up on its own within the grace period.
      await js("document.getElementById('island').dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }))");
      await wait(900);
      const afterLeave = await js("document.getElementById('island').dataset.state");
      console.log('[harness] leave-collapse ->', afterLeave);
      if (afterLeave !== 'collapsed') await js("document.getElementById('btnCollapse').click()");
      await wait(700);
      const stateAfter = await js("document.getElementById('island').dataset.state");
      if (stateAfter !== 'collapsed') console.log('[harness] WARN still', stateAfter);
      await shotDesktop('desktop-collapsed');

      console.log('[harness] done');
    } catch (err) {
      console.error('[harness] failed', err.message);
    }
  }, 2200);
};
