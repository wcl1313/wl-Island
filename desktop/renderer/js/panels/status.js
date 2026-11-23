/**
 * 状态 — three panes in one panel:
 *   概览   CPU / 内存 / C: / 电池 + 快捷操作 + 内存大户
 *   设备   USB 设备与串口（通信设备）
 *   优化   C: 剩余空间、%TEMP%、休眠文件
 *
 * Polling only runs while the overview is on screen; switching to devices or
 * cleanup stops the 2 s loop so an idle panel is genuinely idle.
 */
import { icon } from '../icons.js';

const fmtBytes = (n) => {
  const v = Number(n) || 0;
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(1)}`;
  if (v >= 1024 ** 2) return `${Math.round(v / 1024 ** 2)}`;
  return `${Math.round(v / 1024)}`;
};
const fmtUnit = (n) => (Number(n) >= 1024 ** 3 ? 'GB' : Number(n) >= 1024 ** 2 ? 'MB' : 'KB');

const fmtUptime = (sec) => {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d} 天 ${h} 小时`;
  if (h) return `${h} 小时 ${m} 分`;
  return `${m} 分钟`;
};

const level = (p) => (p >= 90 ? 'bad' : p >= 78 ? 'warn' : 'ok');

const CLS_LABEL = {
  USB: 'USB', USBDevice: 'USB', USBSTOR: '存储', HIDClass: 'HID',
  Keyboard: '键盘', Mouse: '鼠标', Bluetooth: '蓝牙', Ports: '串口',
  AudioEndpoint: '音频', Media: '媒体', DiskDrive: '磁盘', Net: '网络'
};

export default {
  id: 'status',
  label: '状态',
  icon: 'status',
  height: 446,

  sub: (S) => (S.sys?.cpu != null ? `CPU ${S.sys.cpu}% · 内存 ${S.sys.mem?.percent ?? 0}%` : '系统 · 设备 · 优化'),

  mount(view, ctx) {
    ctx.S.sys = ctx.S.sys || null;

    view.innerHTML = `
      <div class="p-status">
        <div class="status-tabs">
          <div class="seg" id="stTabs">
            <button data-pane="overview" data-on="1">概览</button>
            <button data-pane="devices" data-on="0">设备</button>
            <button data-pane="tune" data-on="0">优化</button>
          </div>
        </div>
        <div id="pane"></div>
      </div>`;

    const pane = view.querySelector('#pane');
    const tabs = view.querySelector('#stTabs');
    let alive = true;
    let timer = null;
    let current = 'overview';

    /* ------------------------------------------------------------- overview */
    function overview() {
      pane.innerHTML = `
        <div class="stat-grid" id="stGrid">
          <div class="stat" data-k="cpu">
            <div class="sv"><span data-v>–</span><span class="su">%</span></div>
            <div class="sl" data-sub>处理器</div>
            <div class="sbar"><i style="width:0%"></i></div>
          </div>
          <div class="stat" data-k="mem">
            <div class="sv"><span data-v>–</span><span class="su">%</span></div>
            <div class="sl" data-sub>内存</div>
            <div class="sbar"><i style="width:0%"></i></div>
          </div>
          <div class="stat" data-k="disk">
            <div class="sv"><span data-v>–</span><span class="su">%</span></div>
            <div class="sl" data-sub>磁盘 C:</div>
            <div class="sbar"><i style="width:0%"></i></div>
          </div>
          <div class="stat" data-k="battery">
            <div class="sv"><span data-v>–</span><span class="su">%</span></div>
            <div class="sl">电池</div>
            <div class="sbar"><i style="width:0%"></i></div>
          </div>
        </div>

        <div class="meta-rows">
          <div class="meta"><span>网络</span><b id="stIp">—</b></div>
          <div class="meta"><span>开机时长</span><b id="stUp">—</b></div>
          <div class="meta"><span>主机</span><code id="stHost">—</code></div>
        </div>

        <div class="section-title">快捷操作</div>
        <div class="actions">
          <button class="act" data-act="mute">${icon('mute', 15)}<span>静音</span></button>
          <button class="act" data-act="snip">${icon('snip', 15)}<span>截图</span></button>
          <button class="act" data-act="lock">${icon('lock', 15)}<span>锁屏</span></button>
          <button class="act" data-act="taskmgr">${icon('cpu', 15)}<span>任务</span></button>
        </div>

        <div class="section-title">内存占用前 5</div>
        <div class="proc-list" id="stProcs"><span class="label">读取中…</span></div>`;

      const grid = pane.querySelector('#stGrid');
      const ipEl = pane.querySelector('#stIp');
      const upEl = pane.querySelector('#stUp');
      const hostEl = pane.querySelector('#stHost');
      const procs = pane.querySelector('#stProcs');

      const paintStat = (k, percent, sub) => {
        const el = grid.querySelector(`.stat[data-k="${k}"]`);
        if (!el) return;
        el.dataset.level = level(percent);
        el.querySelector('[data-v]').textContent = percent == null ? '—' : Math.round(percent);
        el.querySelector('.sbar i').style.width = `${Math.max(0, Math.min(100, percent || 0))}%`;
        if (sub) el.querySelector('[data-sub]').textContent = sub;
      };

      async function tick() {
        if (!alive || current !== 'overview') return;
        try {
          const s = await ctx.invoke('sys:info');
          if (!alive || current !== 'overview') return;
          ctx.S.sys = s;
          paintStat('cpu', s.cpu, `${s.cores} 线程`);
          paintStat('mem', s.mem?.percent, `${fmtBytes(s.mem?.used)}/${fmtBytes(s.mem?.total)} GB`);
          if (s.disk) paintStat('disk', s.disk.percent, `剩 ${fmtBytes(s.disk.free)} GB`);
          if (s.battery) {
            paintStat('battery', s.battery.percent, '电量');
          } else {
            // Desktops have no battery. An empty "—%" card is dead weight, so
            // the slot becomes available memory — the number people actually
            // look for when the memory card is near the top.
            const el = grid.querySelector('.stat[data-k="battery"]');
            if (el) {
              const freeMem = Math.max(0, (s.mem?.total || 0) - (s.mem?.used || 0));
              el.dataset.level = level(100 - (s.mem?.percent || 0));
              el.querySelector('[data-v]').textContent = fmtBytes(freeMem);
              el.querySelector('.su').textContent = fmtUnit(freeMem);
              el.querySelector('.sbar i').style.width = `${Math.max(0, 100 - (s.mem?.percent || 0))}%`;
              el.querySelector('.sl').textContent = '可用内存';
            }
          }
          ipEl.textContent = s.ip || '离线';
          upEl.textContent = fmtUptime(s.uptime || 0);
          hostEl.textContent = s.host || '—';

          if (s.procs?.length) {
            const max = Math.max(...s.procs.map((p) => p.mem), 1);
            procs.innerHTML = s.procs.map((p) => `
              <div class="proc">
                <span class="pn" title="${ctx.esc(p.name)}">${ctx.esc(p.name)}</span>
                <span class="pbar"><i style="width:${Math.round((p.mem / max) * 100)}%"></i></span>
                <span class="pm">${fmtBytes(p.mem)} ${fmtUnit(p.mem)}</span>
              </div>`).join('');
          } else {
            procs.innerHTML = '<span class="label">进程列表不可用</span>';
          }
          ctx.refreshHeader();
          ctx.fit();
        } catch (err) {
          console.error('[wl] sys:info failed', err);
          if (alive) procs.innerHTML = `<span class="label">状态读取失败：${ctx.esc(err.message)}</span>`;
        }
        if (alive && current === 'overview') timer = setTimeout(tick, 2000);
      }

      pane.querySelector('.actions').addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const act = btn.dataset.act;
        try {
          await ctx.invoke('sys:action', { action: act });
          const label = { mute: '已静音 / 取消静音', snip: '截屏工具已唤起', lock: '即将锁屏', taskmgr: '任务管理器已打开' }[act];
          if (label) ctx.pushNote({ title: label, level: 'success' });
        } catch (err) {
          ctx.pushNote({ title: '操作失败', body: err.message, level: 'warn' });
        }
      });

      clearTimeout(timer);
      tick();
    }

    /* -------------------------------------------------------------- devices */
    async function devices(refresh = false) {
      clearTimeout(timer);
      pane.innerHTML = `
        <div class="dev-head" style="padding:2px 2px 7px">
          <span class="label" id="devSummary">读取中…</span>
          <button class="ibtn" id="devRefresh" title="重新枚举">${icon('refresh', 15)}</button>
        </div>
        <div id="devBody"><div class="empty">${icon('usb', 22)}<div>正在枚举设备…</div></div></div>`;

      pane.querySelector('#devRefresh').addEventListener('click', () => devices(true));

      let res;
      try {
        res = await ctx.invoke('sys:devices', { refresh });
      } catch (err) {
        pane.querySelector('#devBody').innerHTML = `<div class="empty">${icon('usb', 22)}<div>${ctx.esc(err.message)}</div></div>`;
        return;
      }
      if (!alive || current !== 'devices') return;

      const usb = res.usb || [];
      const serial = res.serial || [];
      pane.querySelector('#devSummary').textContent = `${usb.length} 个 USB 设备 · ${serial.length} 个通信端口`;

      const list = (items, kind) => items.map((d) => `
        <div class="dev" data-kind="${kind}" data-ok="${d.ok ? 1 : 0}">
          <span class="dev-ic">${icon(kind === 'com' ? 'plug' : 'usb', 15)}</span>
          <div class="grow col">
            <span class="dev-name truncate" title="${ctx.esc(d.name)}">${ctx.esc(d.name)}</span>
            <span class="dev-sub truncate">${ctx.esc(d.id || d.cls || '')}</span>
          </div>
          <span class="dev-badge">${kind === 'com' ? 'COM' : ctx.esc(CLS_LABEL[d.cls] || d.cls || 'USB')}</span>
        </div>`).join('');

      pane.querySelector('#devBody').innerHTML = `
        <div class="section-title" style="margin-top:0">USB 设备</div>
        <div class="dev-list">${usb.length ? list(usb, 'usb') : '<span class="label">没有发现 USB 设备</span>'}</div>
        <div class="section-title">通信设备（串口）</div>
        <div class="dev-list">${serial.length ? list(serial, 'com') : '<span class="label">没有发现串口设备</span>'}</div>
        <div class="label" style="padding-top:10px;line-height:1.5">
          蓝牙音频设备在「蓝牙」面板；这里只列 USB 与串口，避免重复。
        </div>`;
      ctx.fit();
    }

    /* ----------------------------------------------------------------- tune */
    async function tune() {
      clearTimeout(timer);
      pane.innerHTML = `<div class="empty">${icon('disk', 22)}<div>读取磁盘信息…</div></div>`;

      let s;
      try {
        s = await ctx.invoke('sys:storage');
      } catch (err) {
        pane.innerHTML = `<div class="empty">${icon('disk', 22)}<div>${ctx.esc(err.message)}</div></div>`;
        return;
      }
      if (!alive || current !== 'tune') return;

      const d = s.disk || { total: 0, free: 0, used: 0, percent: 0 };
      const circ = 2 * Math.PI * 26;
      const dash = (d.percent / 100) * circ;
      const tempMb = s.temp.bytes / 1024 ** 2;
      const tempText = tempMb >= 1024 ? `${(tempMb / 1024).toFixed(2)} GB` : `${Math.round(tempMb)} MB`;
      const hibGb = s.hiberfil.bytes / 1024 ** 3;

      pane.innerHTML = `
        <div class="opt-hero">
          <div class="free-ring">
            <svg viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="26" fill="none" stroke="var(--surface-3)" stroke-width="6"/>
              <circle class="fg" cx="32" cy="32" r="26" fill="none" stroke="var(--accent-2)" stroke-width="6"
                      stroke-linecap="round" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${(circ - dash).toFixed(1)}"/>
            </svg>
            <div class="mid"><b>${fmtBytes(d.free)}</b><span>GB 可用</span></div>
          </div>
          <div class="grow">
            <div class="t">C: 共 ${fmtBytes(d.total)} GB，已用 ${d.percent}%</div>
            <div class="s">C 盘剩余空间决定系统更新与临时文件能否落地。这里只做清理，不动任何个人文件。</div>
          </div>
        </div>

        <div class="section-title">临时文件</div>
        <div class="clean-row">
          <span class="cic">${icon('broom', 15)}</span>
          <div class="grow">
            <div class="t">清理 %TEMP%</div>
            <div class="s" id="tempInfo">${s.temp.count} 项 · ${tempText}</div>
          </div>
          <button class="go" id="cleanTemp">清理</button>
        </div>

        <div class="section-title">休眠文件</div>
        <div class="clean-row">
          <span class="cic">${icon('power', 15)}</span>
          <div class="grow">
            <div class="t">hiberfil.sys</div>
            <div class="s" id="hibInfo">${s.hiberfil.on
              ? `休眠开启 · 占用 ${hibGb.toFixed(1)} GB`
              : '休眠已关闭 · 不占用空间'}</div>
          </div>
          <button class="go" data-danger="${s.hiberfil.on ? 1 : 0}" id="toggleHib">${s.hiberfil.on ? '关闭' : '开启'}</button>
        </div>

        <div class="label" style="padding-top:10px;line-height:1.55">
          清理与休眠开关都会先弹出系统确认框。关闭休眠需要管理员权限，同时会关闭快速启动。
        </div>`;

      pane.querySelector('#cleanTemp').addEventListener('click', async () => {
        const btn = pane.querySelector('#cleanTemp');
        btn.disabled = true;
        btn.textContent = '清理中';
        try {
          const out = await ctx.invoke('sys:cleanTemp', { days: ctx.S.cfg?.storage?.tempDays || 1 });
          if (out.canceled) { btn.textContent = '清理'; return; }
          ctx.pushNote({
            title: `释放 ${fmtBytes(out.freed)} ${fmtUnit(out.freed)}`,
            body: `删除 ${out.removed} 个临时项目`,
            level: 'success'
          });
          await tune();
        } catch (err) {
          ctx.pushNote({ title: '清理失败', body: err.message, level: 'warn' });
          btn.disabled = false;
          btn.textContent = '清理';
        }
      });

      pane.querySelector('#toggleHib').addEventListener('click', async () => {
        const btn = pane.querySelector('#toggleHib');
        btn.disabled = true;
        try {
          const out = await ctx.invoke('sys:hibernate', { on: !s.hiberfil.on });
          if (out.canceled) return;
          ctx.pushNote({
            title: out.enabled ? '休眠已开启' : '休眠已关闭',
            body: out.enabled ? 'hiberfil.sys 会重新生成' : '已释放休眠文件占用的空间',
            level: 'success'
          });
          await tune();
        } catch (err) {
          ctx.pushNote({ title: '操作未完成', body: err.message, level: 'warn' });
        } finally {
          btn.disabled = false;
        }
      });

      ctx.fit();
    }

    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-pane]');
      if (!b) return;
      current = b.dataset.pane;
      tabs.querySelectorAll('button').forEach((x) => { x.dataset.on = x === b ? '1' : '0'; });
      if (current === 'overview') overview();
      if (current === 'devices') devices(false);
      if (current === 'tune') tune();
    });

    overview();

    return {
      update: () => {},
      destroy: () => { alive = false; clearTimeout(timer); }
    };
  }
};
