'use strict';
/**
 * wl-Island — main process (Windows).
 *
 * Responsibilities: own the window, own the services, expose a narrow IPC
 * surface. Every channel is namespaced `wl:` and validated on the way in,
 * because the renderer is the only trusted-ish context and we still do not want
 * it to be able to write arbitrary files.
 */
const fs = require('fs');
const { execFile } = require('child_process');
const {
  app, ipcMain, shell, screen, globalShortcut, nativeImage, nativeTheme, powerMonitor, dialog
} = require('electron');

const { Config } = require('./services/config');
const { IslandWindow } = require('./window');
const { createAdapter } = require('./platform');
const { MediaService } = require('./services/media');
const { BluetoothService } = require('./services/bluetooth');
const { AiService, PRESETS } = require('./services/ai');
const { StashService } = require('./services/stash');
const { ClockService } = require('./services/clock');
const { HealthService } = require('./services/health');
const { NotifyService } = require('./services/notify');
const { TodoService } = require('./services/todo');
const { SysInfoService } = require('./services/sysinfo');
const { DeviceService } = require('./services/devices');
const { FullscreenService } = require('./services/fullscreen');
const { createTray } = require('./tray');
const { drawIslet } = require('./util/png');

const isDev = process.argv.includes('--dev');

app.commandLine.appendSwitch('enable-features', 'CSSBackdropFilter');
app.setAppUserModelId('com.wl-island.app');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  /* ------------------------------------------------------------------ boot */
  const ctx = {};
  let quitting = false;

  app.on('second-instance', () => ctx.win?.show());

  app.whenReady().then(async () => {
    if (process.platform !== 'win32') {
      console.error('[wl] 仅支持 Windows');
      app.quit();
      return;
    }

    ctx.cfg = new Config();
    ctx.adapter = createAdapter({ cfg: ctx.cfg });
    ctx.media = new MediaService({ adapter: ctx.adapter, cfg: ctx.cfg });
    ctx.bt = new BluetoothService({ adapter: ctx.adapter, cfg: ctx.cfg });
    ctx.ai = new AiService({ cfg: ctx.cfg });
    ctx.stash = new StashService({ cfg: ctx.cfg });
    ctx.clock = new ClockService({ cfg: ctx.cfg });
    ctx.health = new HealthService({ cfg: ctx.cfg });
    ctx.todo = new TodoService();
    ctx.sys = new SysInfoService({ adapter: ctx.adapter });
    ctx.devices = new DeviceService({ adapter: ctx.adapter });

    ctx.win = new IslandWindow(ctx.cfg, { isDev, adapter: ctx.adapter });
    ctx.win.create();

    // Hide-on-fullscreen needs the window, so it starts after create().
    ctx.full = new FullscreenService({ cfg: ctx.cfg, adapter: ctx.adapter, win: ctx.win });
    ctx.full.start();

    ctx.notify = new NotifyService({
      cfg: ctx.cfg,
      onNotify: (note) => {
        ctx.win.send('wl:note', note);
        if (ctx.cfg.get('general.autoCollapse', true)) ctx.win.show();
      }
    });

    wirePushEvents(ctx);
    registerIpc(ctx);

    ctx.tray = createTray({
      cfg: ctx.cfg,
      win: ctx.win,
      onAction: (action) => ctx.win.send('wl:ui:action', { action })
    });

    startServices(ctx);

    screen.on('display-added', () => ctx.win.applyPosition());
    screen.on('display-removed', () => ctx.win.applyPosition());
    screen.on('display-metrics-changed', () => ctx.win.applyPosition());
    powerMonitor.on('resume', () => {
      // Timers drift and the SMTC session usually changes across a sleep, so
      // every poller gets kicked once on wake instead of waiting a full cycle.
      ctx.media.poll().catch(() => {});
      ctx.bt.poll().catch(() => {});
      ctx.win.applyPosition();
    });

    /**
     * Config changes are reported per dot-path now, so one slider no longer
     * restarts every service (that churn used to blank the artwork tint and
     * drop the bluetooth list mid-drag).
     */
    const touched = (keys, prefix) => keys.some((k) => k === prefix || k.startsWith(`${prefix}.`));

    ctx.cfg.onChange((data, keys) => {
      ctx.win.send('wl:config', { config: data, keys });
      if (keys.includes('*')) {
        ctx.media.restart();
        ctx.bt.restart();
        ctx.health.restart();
        ctx.notify.startServer();
        ctx.win.applyPosition();
        return;
      }
      if (touched(keys, 'media')) ctx.media.restart();
      if (touched(keys, 'bluetooth')) ctx.bt.restart();
      if (touched(keys, 'health')) ctx.health.restart();
      if (touched(keys, 'notify')) ctx.notify.startServer();
      if (touched(keys, 'general.anchor') || touched(keys, 'general.displayId')) ctx.win.applyPosition();
      if (touched(keys, 'general.scale')) ctx.win.applyScale();
      if (touched(keys, 'general.alwaysOnTop')) ctx.win.setAlwaysOnTop(data.general?.alwaysOnTop !== false);
      if (touched(keys, 'general.opacity')) ctx.win.setOpacity(data.general?.opacity ?? 1);
      if (touched(keys, 'general.hideOnFullscreen')) ctx.full?.apply();
      if (touched(keys, 'appearance')) ctx.win.send('wl:ui:appearance', data.appearance);
    });

    try {
      app.setLoginItemSettings({
        openAtLogin: !!ctx.cfg.get('general.launchAtLogin', false),
        openAsHidden: true,
        args: ['--hidden']
      });
    } catch { /* unsupported */ }

    try {
      globalShortcut.register('CommandOrControl+Shift+I', () => ctx.win.toggle());
    } catch (err) {
      console.warn('[shortcut]', err.message);
    }

    app.on('activate', () => ctx.win?.show());
  });

  app.on('window-all-closed', (e) => {
    // The island lives in the tray; closing the window must not quit the app.
    e.preventDefault?.();
  });

  app.on('before-quit', () => {
    quitting = true;
    try { globalShortcut.unregisterAll(); } catch {}
    ctx.win?.dispose?.();
    ctx.media?.stop();
    ctx.bt?.stop();
    ctx.clock?.stop();
    ctx.health?.stop();
    ctx.notify?.dispose();
    ctx.full?.stop();
    ctx.adapter?.dispose?.();
    ctx.tray?.destroy?.();
  });

  /* ------------------------------------------------------------- services */
  /**
   * One service failing to start must not take the island down with it. Each
   * start is isolated: a broken polling loop (PowerShell bridge missing, WMI
   * slow, port already taken) leaves that panel empty instead of killing boot.
   */
  function guard(name, fn) {
    try {
      return fn();
    } catch (err) {
      console.error(`[wl] ${name} 启动失败:`, err?.message || err);
      return null;
    }
  }

  function startServices(c) {
    guard('media', () => c.media.start());
    guard('bluetooth', () => c.bt.start());
    guard('clock', () => c.clock.start());
    guard('health', () => c.health.start());
    guard('notify', () => c.notify.startServer());

    c.clock.on('alarm', (alarm) => {
      c.notify.push({
        title: `⏰ ${alarm.label || '闹钟'}`,
        body: `${alarm.time} 到了`,
        level: 'alarm',
        actions: [{ id: 'snooze', label: '稍后 5 分钟' }, { id: 'dismiss', label: '关闭' }]
      });
    });
    c.clock.on('timer-done', (t) => {
      c.notify.push({ title: '⏳ 计时结束', body: t.label || `${Math.round(t.total / 60)} 分钟到了`, level: 'alarm' });
    });
    c.health.on('remind', (r) => {
      if (r.kind === 'sitting') {
        c.notify.push({
          title: '🧍 该起来走走了',
          body: `你已经坐了 ${r.minutes} 分钟，站起来活动两分钟吧。`,
          level: 'warn',
          actions: [{ id: 'stood', label: '已起身' }]
        });
      } else {
        c.notify.push({
          title: '💧 喝水时间',
          body: `距离上次喝水 ${r.minutes} 分钟了，补充一点水分。`,
          level: 'info',
          actions: [{ id: 'drank', label: '喝过了' }]
        });
      }
    });
  }

  function wirePushEvents(c) {
    c.media.on('state', (s) => c.win.send('wl:media', s));
    c.media.on('artwork', (url) => c.win.send('wl:media:art', { url }));
    c.bt.on('changed', (p) => c.win.send('wl:bt', p));
  }

  /* ------------------------------------------------------------------ ipc */
  function registerIpc(c) {
    const handle = (channel, fn) => {
      ipcMain.handle(`wl:${channel}`, async (event, payload) => {
        try {
          return { ok: true, data: await fn(payload, event) };
        } catch (err) {
          return { ok: false, error: err?.message || String(err) };
        }
      });
    };
    const ask = (opts) => (c.win?.win
      ? dialog.showMessageBox(c.win.win, opts)
      : dialog.showMessageBox(opts));

    handle('app:info', async () => ({
      name: app.getName(),
      platform: process.platform,
      arch: process.arch,
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      userData: app.getPath('userData'),
      darkMode: nativeTheme.shouldUseDarkColors,
      isDev
    }));

    handle('app:diagnose', async () => diagnose(c));
    handle('app:quit', async () => { app.quit(); return true; });
    handle('app:hide', async () => { c.win.hide(); return true; });
    handle('app:show', async () => { c.full?.showOverride(); c.win.show(); return true; });
    handle('app:openExternal', async ({ url }) => {
      if (!/^https?:\/\//i.test(String(url))) throw new Error('只允许 http(s) 链接');
      await shell.openExternal(url);
      return true;
    });
    handle('app:reload', async () => { c.win.reload(); return true; });

    handle('config:get', async () => c.cfg.all());
    handle('config:patch', async (patch) => c.cfg.patch(patch || {}));
    handle('config:reset', async () => {
      c.cfg.patch({
        general: { scale: 1, opacity: 1 },
        appearance: { theme: 'midnight', blur: 34, tintOpacity: 0.68, noise: true, artworkTint: true }
      });
      return c.cfg.all();
    });

    handle('window:size', async ({ w, h }) => { c.win.setContentSize(w, h); return true; });
    handle('window:reposition', async () => { c.win.applyPosition(); return true; });
    handle('window:dragStart', async () => { c.win.startDrag(); return true; });
    handle('window:dragEnd', async () => { c.win.endDrag(); return true; });
    handle('window:preset', async ({ preset }) => {
      const wa = c.win.display.workArea;
      const a = c.win.anchor();
      const scale = c.cfg.get('general.scale', 1);
      const pad = Math.round(28 * scale);
      const half = Math.round((c.win.css.w * scale) / 2);
      const w = c.win.css.w * scale;
      const h = c.win.css.h * scale;
      const map = {
        'top-left': { x: wa.x + half + 6, y: wa.y + 8 * scale },
        'top-center': { x: Math.round(wa.x + wa.width / 2), y: wa.y + 8 * scale },
        'top-right': { x: wa.x + wa.width - half - 6, y: wa.y + 8 * scale },
        center: { x: Math.round(wa.x + wa.width / 2), y: Math.round(wa.y + (wa.height - h) / 2 + pad) },
        'bottom-center': { x: Math.round(wa.x + wa.width / 2), y: Math.round(wa.y + wa.height - h + pad - 8 * scale) }
      };
      const next = map[preset] || { x: a.x, y: a.y };
      c.win.applyAnchor(next, { persist: true });
      return next;
    });
    handle('window:resetPos', async () => {
      const wa = c.win.display.workArea;
      const next = { x: Math.round(wa.x + wa.width / 2), y: Math.round(wa.y + 8) };
      c.win.applyAnchor(next, { persist: true });
      return next;
    });

    handle('media:state', async () => c.media.fullState());
    handle('media:control', async ({ action, position }) => c.media.control(action, { position }));
    handle('media:sessions', async () => c.media.sessions());
    handle('media:art', async () => c.media.fullState().artwork);
    handle('media:target', async ({ id }) => {
      c.cfg.set('media.preferApp', id || '');
      c.media.poll().catch(() => {});
      return c.cfg.get('media.preferApp');
    });

    handle('ai:chat', async ({ text }) => {
      if (!text || !String(text).trim()) throw new Error('内容为空');
      const result = await c.ai.chat(String(text), {
        onDelta: (delta) => c.win.send('wl:ai:chunk', { delta })
      });
      c.win.send('wl:ai:done', result);
      return result;
    });
    handle('ai:stop', async () => { c.ai.stop(); return true; });
    handle('ai:balance', async () => c.ai.balance());
    handle('ai:reset', async () => { c.ai.reset(); return true; });
    handle('ai:models', async () => c.ai.models());
    handle('ai:presets', async () => PRESETS);

    handle('bt:list', async () => c.bt.public());

    handle('todo:list', async () => c.todo.list());
    handle('todo:add', async ({ text, flag }) => c.todo.add(text, { flag }));
    handle('todo:update', async ({ id, patch }) => c.todo.update(id, patch));
    handle('todo:remove', async ({ id }) => c.todo.remove(id));
    handle('todo:clearDone', async () => c.todo.clearDone());

    handle('clock:state', async () => c.clock.state());
    handle('clock:add', async (alarm) => c.clock.add(alarm));
    handle('clock:update', async ({ id, patch }) => c.clock.update(id, patch));
    handle('clock:remove', async ({ id }) => c.clock.remove(id));
    handle('clock:timer:start', async ({ minutes, label }) => c.clock.startTimer(minutes, label));
    handle('clock:timer:cancel', async () => { c.clock.cancelTimer(); return true; });

    handle('stash:list', async () => c.stash.list());
    handle('stash:add', async ({ paths }) => c.stash.add(paths || []));
    handle('stash:remove', async ({ id }) => c.stash.remove(id));
    handle('stash:clear', async () => c.stash.clear());
    handle('stash:reveal', async ({ id }) => { await c.stash.reveal(id); return true; });
    handle('stash:open', async ({ id }) => c.stash.openFile(id));
    handle('stash:copyPath', async ({ id }) => c.stash.copyPath(id));
    handle('stash:copyImage', async ({ id }) => c.stash.copyImage(id));
    handle('stash:dir', async () => c.stash.dir);
    handle('stash:drag', async ({ id }, event) => {
      const hit = (await c.stash.list()).find((i) => i.id === id);
      if (!hit) throw new Error('文件不存在');
      let icon = nativeImage.createFromPath(hit.path);
      if (icon.isEmpty()) icon = nativeImage.createFromBuffer(drawIslet(64));
      else icon = icon.resize({ width: 64, height: 64 });
      event.sender.startDrag({ file: hit.path, icon });
      return true;
    });

    handle('notify:list', async () => c.notify.history());
    handle('notify:test', async () => c.notify.push({
      title: 'wl-Island 已就绪',
      body: '通知链路正常，这就是一条测试消息。',
      level: 'success'
    }));
    handle('notify:action', async ({ action, note }) => {
      if (action === 'stood') c.health.reset('sitting');
      if (action === 'drank') c.health.reset('water');
      if (action === 'snooze') c.clock.startTimer(5, '小睡');
      if (action === 'dismiss' && note) c.notify.recent = c.notify.recent.filter((n) => n.id !== note.id);
      return true;
    });

    handle('health:status', async () => c.health.status());
    handle('health:reset', async ({ kind }) => c.health.reset(kind || 'all'));

    handle('sys:info', async () => c.sys.snapshot());
    handle('sys:devices', async ({ refresh } = {}) => {
      if (refresh) c.devices.invalidate();
      return c.devices.list();
    });
    handle('sys:storage', async () => c.sys.storage());
    // Cleanup is destructive, so it always goes through a native confirmation
    // that names the directory and the size. A panel button alone is too easy
    // to hit by accident.
    handle('sys:cleanTemp', async ({ days } = {}) => {
      const info = await c.sys.storage();
      const wait = Math.max(1, Number(days) || Number(c.cfg.get('storage.tempDays', 1)) || 1);
      const mb = info.temp.bytes / 1024 ** 2;
      const size = mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`;
      const res = await ask({
        type: 'warning',
        buttons: ['取消', '开始清理'],
        defaultId: 0,
        cancelId: 0,
        title: '清理临时文件',
        message: `删除 ${info.temp.path} 中超过 ${wait} 天未修改的项目`,
        detail: `当前临时目录共 ${info.temp.count} 项、约 ${size}。正在被程序占用的文件会自动跳过，操作不可撤销。`
      });
      if (res.response !== 1) return { canceled: true };
      const out = await c.sys.cleanTemp(wait);
      c.cfg.patch({ storage: { lastCleanAt: Date.now(), lastFreed: out.freed } }, { silent: true });
      return { ...out, days: wait };
    });
    handle('sys:hibernate', async ({ on } = {}) => {
      const want = on !== false;
      const info = await c.sys.storage();
      const gb = (info.hiberfil.bytes / 1024 ** 3).toFixed(1);
      const res = await ask({
        type: 'warning',
        buttons: ['取消', want ? '关闭休眠' : '开启休眠'],
        defaultId: 0,
        cancelId: 0,
        title: want ? '关闭休眠' : '开启休眠',
        message: want
          ? `关闭休眠并从 C: 移除 hiberfil.sys（当前 ${gb} GB）`
          : '重新启用休眠并重建 hiberfil.sys',
        detail: '需要管理员权限。关闭后「休眠」菜单会消失，快速启动也会一并关闭。'
      });
      if (res.response !== 1) return { canceled: true };
      const out = await c.sys.setHibernate(want);
      return out;
    });
    handle('sys:action', async ({ action }) => {
      switch (action) {
        case 'mute': return c.adapter.mute();
        case 'lock': execFile('rundll32.exe', ['user32.dll,LockWorkStation']); return true;
        case 'snip': execFile('explorer.exe', ['ms-screenclip:']); return true;
        case 'taskmgr': execFile('taskmgr.exe', []); return true;
        case 'settings': shell.openExternal('ms-settings:').catch(() => {}); return true;
        default: throw new Error(`未知操作: ${action}`);
      }
    });
    handle('sys:revealUserData', async () => { await shell.openPath(app.getPath('userData')); return true; });
    handle('sys:revealStash', async () => { await shell.openPath(c.stash.dir); return true; });
    handle('sys:copyText', async ({ text }) => {
      const { clipboard } = require('electron');
      clipboard.writeText(String(text || ''));
      return true;
    });
    handle('sys:battery', async () => c.adapter.battery?.() ?? null);
  }

  /* -------------------------------------------------------------- diagnose */
  async function diagnose(c) {
    const checks = [];
    const push = (name, status, detail) => checks.push({ name, status, detail });

    push('运行环境', 'ok', `Windows ${process.arch} · Electron ${process.versions.electron} · v${app.getVersion()}`);

    try {
      await c.adapter.bridge.request('ping', {}, 4000);
      push('SMTC 媒体桥', 'ok', '常驻 PowerShell 通道就绪');
    } catch (err) {
      push('SMTC 媒体桥', 'fail', err.message);
    }

    try {
      const list = await c.bt.public();
      push('蓝牙枚举', 'ok', `发现 ${list.devices.length} 个已配对设备`);
    } catch (err) {
      push('蓝牙枚举', 'warn', err.message);
    }

    push('AI', c.ai.configured ? 'ok' : 'warn', c.ai.configured ? `${c.cfg.get('ai.model')} @ ${c.cfg.get('ai.baseUrl')}` : '未配置 API Key，AI 面板只做本地提示');

    const stashDir = c.stash.dir;
    let stashWritable = false;
    try { fs.mkdirSync(stashDir, { recursive: true }); fs.accessSync(stashDir, fs.constants.W_OK); stashWritable = true; } catch {}
    push('文件中转站目录', stashWritable ? 'ok' : 'fail', stashDir);

    push('通知端口', c.cfg.get('notify.serverEnabled') ? 'ok' : 'warn', `http://127.0.0.1:${c.cfg.get('notify.port')}/notify`);

    return { checks, platform: process.platform };
  }

  app.on('child-process-gone', (_e, details) => {
    // GPU / utility crashes: the window keeps working on the software path, but
    // the reason is worth having in the log when someone reports a black island.
    console.error('[wl] child process gone:', details?.type, details?.reason, details?.exitCode ?? '');
  });

  process.on('uncaughtException', (err) => {
    console.error('[wl] uncaught:', err);
    void quitting;
  });
  process.on('unhandledRejection', (err) => {
    console.error('[wl] unhandled rejection:', err);
  });
}
