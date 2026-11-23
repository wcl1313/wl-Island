/* Capture the promo stage frame by frame into .tmp/promo/frames/*.jpg.
 *
 * An offscreen BrowserWindow is used instead of a screen recorder: `seek(t)` is
 * deterministic, so every frame is exact and the render can be re-run after a
 * tweak without re-timing anything.
 *
 *   npx electron tools/promo            → full film
 *   npx electron tools/promo -- 0 60    → only frames 0..60 (quick check)
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const FPS = 30;
const OUT = path.join(__dirname, '..', '..', '.tmp', 'promo', 'frames');

const argFrames = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
const FROM = argFrames.length >= 2 ? argFrames[0] : 0;
const TO = argFrames.length >= 2 ? argFrames[1] : Infinity;

app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true }
  });
  win.webContents.setFrameRate(60);
  await win.loadFile(path.join(__dirname, 'index.html'));
  await new Promise((r) => setTimeout(r, 900));

  const total = await win.webContents.executeJavaScript('window.TOTAL');
  const frames = Math.round(Number(total) * FPS);
  const last = Math.min(frames - 1, TO);
  const t0 = Date.now();
  console.log(`[promo] ${frames} frames @${FPS}fps, rendering ${FROM}..${last}`);

  for (let i = FROM; i <= last; i++) {
    const t = i / FPS;
    // Two rAFs: the first lets layout/paint apply the new styles, the second
    // guarantees the compositor has produced the frame we are about to grab.
    await win.webContents.executeJavaScript(
      `new Promise(r=>{window.seek(${t});requestAnimationFrame(()=>requestAnimationFrame(()=>r(1)))})`,
      true
    );
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, String(i).padStart(5, '0') + '.jpg'), img.toJPEG(95));
    if (i % 30 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(`[promo] ${i}/${last}  ${el.toFixed(1)}s  ${((i - FROM + 1) / el).toFixed(1)} fps`);
    }
  }
  console.log('[promo] done in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  app.quit();
});
