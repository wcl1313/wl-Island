/**
 * 设置 — macOS System Settings layout: fixed sidebar, scrolling content.
 *
 * Live preview: sliders write CSS variables on `input` and persist on `change`,
 * so dragging never turns into an IPC storm. Everything else commits on click.
 */
import { icon } from '../icons.js';

const TABS = [
  { id: 'look', label: '外观', icon: 'palette' },
  { id: 'system', label: '系统', icon: 'settings' },
  { id: 'media', label: '媒体', icon: 'media' },
  { id: 'ai', label: 'AI', icon: 'ai' },
  { id: 'about', label: '关于', icon: 'spark' }
];

/** [id, label, bg-a, bg-b, accent, mini-pill, edge] */
const THEMES = [
  ['midnight', '极夜', '#1a1c23', '#08090d', '#0a84ff', 'rgba(0,0,0,.5)', 'rgba(255,255,255,.2)'],
  ['graphite', '石墨', '#2c2f36', '#0e0f13', '#9aa6b8', 'rgba(0,0,0,.48)', 'rgba(255,255,255,.18)'],
  ['titanium', '钛金', '#302e2c', '#111010', '#d8b48a', 'rgba(0,0,0,.48)', 'rgba(255,235,205,.22)'],
  ['ocean', '深海', '#0c202d', '#040b11', '#32c7ff', 'rgba(0,0,0,.48)', 'rgba(255,255,255,.18)'],
  ['forest', '森林', '#14261f', '#050d0a', '#30d158', 'rgba(0,0,0,.48)', 'rgba(190,255,215,.18)'],
  ['violet', '极光', '#201a38', '#09060f', '#a78bfa', 'rgba(0,0,0,.48)', 'rgba(220,200,255,.2)'],
  ['rose', '玫瑰', '#2e1a22', '#0f070a', '#ff6b9d', 'rgba(0,0,0,.48)', 'rgba(255,200,215,.2)'],
  ['ember', '余烬', '#2c1c16', '#0e0806', '#ff8a3d', 'rgba(0,0,0,.48)', 'rgba(255,200,160,.2)'],
  ['snow', '雪原', '#ffffff', '#e9edf4', '#0a72e8', 'rgba(255,255,255,.96)', 'rgba(20,28,42,.14)'],
  ['ivory', '象牙', '#fffbf4', '#f3ece1', '#c2762c', 'rgba(255,252,246,.98)', 'rgba(60,40,20,.16)'],
  ['moss', '苔原', '#182019', '#070b08', '#86a86f', 'rgba(0,0,0,.5)', 'rgba(210,240,195,.2)'],
  ['indigo', '靛蓝', '#1b1d3a', '#080810', '#5e5ce6', 'rgba(0,0,0,.5)', 'rgba(200,200,255,.22)'],
  ['clay', '陶土', '#2e241e', '#100b08', '#c98b6b', 'rgba(0,0,0,.5)', 'rgba(255,220,195,.2)'],
  ['steel', '钢蓝', '#232a33', '#0b0e12', '#7d8fa6', 'rgba(0,0,0,.5)', 'rgba(210,225,240,.2)']
];

const EYE_STYLES = [
  ['classic', '经典'],
  ['cat', '猫眼'],
  ['sparkle', '星芒'],
  ['ring', '光环'],
  ['pixel', '像素'],
  ['glasses', '眼镜'],
  ['sleepy', '困倦'],
  ['heart', '心动']
];

const FALLBACK_PRESETS = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', context: 64000 },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', context: 128000 },
  { id: 'moonshot', label: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', context: 8000 },
  { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', context: 128000 },
  { id: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', context: 131072 },
  { id: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct', context: 32768 },
  { id: 'ollama', label: '本地 Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b', context: 32768 },
  { id: 'custom', label: '自定义', baseUrl: '', model: '', context: 64000 }
];

export default {
  id: 'settings',
  label: '设置',
  icon: 'settings',
  height: 452,

  sub: () => '外观 · 系统 · 媒体 · AI',

  mount(view, ctx) {
    view.innerHTML = `
      <div class="set-wrap">
        <nav class="set-nav" id="stNav">
          ${TABS.map((t, i) => `<button class="nav-item" data-tab="${t.id}" data-on="${i === 0 ? 1 : 0}">
            ${icon(t.icon, 13)}<span>${t.label}</span>
          </button>`).join('')}
        </nav>
        <div class="set-body" id="stBody"></div>
      </div>`;

    const body = view.querySelector('#stBody');
    const nav = view.querySelector('#stNav');
    let active = 'look';
    let info = null;
    let presets = FALLBACK_PRESETS;

    const cfg = () => ctx.S.cfg || {};
    const g = () => cfg().general || {};
    const a = () => cfg().appearance || {};
    const m = () => cfg().media || {};
    const ai = () => cfg().ai || {};
    const st = () => cfg().storage || {};

    async function patch(partial) {
      try {
        ctx.S.cfg = await ctx.invoke('config:patch', partial);
        if (partial.general?.reduceMotion !== undefined) {
          document.body.dataset.reduceMotion = partial.general.reduceMotion ? '1' : '0';
        }
      } catch (err) {
        ctx.pushNote({ title: '保存失败', body: err.message, level: 'warn' });
      }
    }

    const row = (label, control, hint = '') => `
      <div class="kv">
        <div class="col"><span style="font-size:11.5px">${label}</span>${hint ? `<span class="label">${hint}</span>` : ''}</div>
        <div class="row" style="gap:6px">${control}</div>
      </div>`;

    const slider = (id, min, max, step, value, suffix = '') => `
      <input class="slider" id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" style="width:92px"/>
      <span class="num tiny" id="${id}V" style="width:44px;text-align:right">${value}${suffix}</span>`;

    const sw = (id, on) => `<button class="switch" id="${id}" data-on="${on ? 1 : 0}"></button>`;

    const paintRange = (el) => {
      if (!el) return;
      const min = Number(el.min || 0);
      const max = Number(el.max || 100);
      const p = max === min ? 0 : ((Number(el.value) - min) / (max - min)) * 100;
      el.style.setProperty('--p', `${p}%`);
    };

    const bindRange = (id, onInput, onChange) => {
      const el = body.querySelector(`#${id}`);
      if (!el) return null;
      paintRange(el);
      el.addEventListener('input', () => {
        paintRange(el);
        if (onInput) onInput(el);
      });
      if (onChange) el.addEventListener('change', () => onChange(el));
      return el;
    };

    const bindSwitch = (id, path, key) => {
      const el = body.querySelector(`#${id}`);
      if (!el) return;
      el.addEventListener('click', () => {
        const next = el.dataset.on !== '1';
        el.dataset.on = next ? '1' : '0';
        patch({ [path]: { [key]: next } });
      });
    };

    /* ---------------------------------------------------------------- LOOK */
    function look() {
      const theme = a().theme || 'midnight';
      const eyes = a().eyes || 'classic';
      body.innerHTML = `
        <div class="section-title">主题</div>
        <div class="themes" id="stThemes">
          ${THEMES.map(([id, label, sa, sb, sc, sd, se]) => `
            <button class="tcard" data-theme="${id}" data-on="${theme === id ? 1 : 0}"
                    style="--sa:${sa};--sb:${sb};--sc:${sc};--sd:${sd};--se:${se}">
              <span class="swatch"><i></i></span>
              <span class="tname">${label}</span>
            </button>`).join('')}
        </div>

        <div class="section-title">眼睛</div>
        <div class="eyes-grid" id="stEyes">
          ${EYE_STYLES.map(([id, label]) => `
            <button class="eye-card" data-eyes="${id}" data-on="${eyes === id ? 1 : 0}">
              <span class="eye-mini" data-style="${id}"><span></span><span></span></span>
              <span class="cap">${label}</span>
            </button>`).join('')}
        </div>

        <div class="section-title">尺寸与质感</div>
        ${row('整体大小', slider('stScale', 80, 150, 5, Math.round((g().scale || 1) * 100)), '缩放整个灵动岛')}
        ${row('不透明度', slider('stOpacity', 40, 100, 5, Math.round((g().opacity ?? 1) * 100)), '与桌面融合的程度')}
        ${row('背景模糊', slider('stBlur', 0, 60, 2, a().blur ?? 34), '封面取色的模糊半径')}

        <div class="section-title">细节</div>
        <div class="chip-togs">
          <button class="chip-tog" id="stArtTint" data-on="${a().artworkTint !== false ? 1 : 0}">${icon('spark', 12)} 封面取色</button>
          <button class="chip-tog" id="stNoise" data-on="${a().noise !== false ? 1 : 0}">${icon('wave', 12)} 噪点</button>
          <button class="chip-tog" id="stReduce" data-on="${g().reduceMotion ? 1 : 0}">${icon('power', 12)} 减弱动效</button>
        </div>
        <div class="row" style="justify-content:flex-end;padding-top:10px">
          <button class="pillbtn" data-variant="ghost" id="stResetLook">恢复默认外观</button>
        </div>`;

      body.querySelector('#stThemes').addEventListener('click', (e) => {
        const card = e.target.closest('[data-theme]');
        if (!card) return;
        body.querySelectorAll('.tcard').forEach((c) => { c.dataset.on = c === card ? '1' : '0'; });
        // Apply before the round-trip so the theme changes under the cursor.
        document.documentElement.dataset.theme = card.dataset.theme;
        patch({ appearance: { theme: card.dataset.theme } });
      });

      body.querySelector('#stEyes').addEventListener('click', (e) => {
        const card = e.target.closest('[data-eyes]');
        if (!card) return;
        body.querySelectorAll('.eye-card').forEach((c) => { c.dataset.on = c === card ? '1' : '0'; });
        const island = document.getElementById('island');
        if (island) island.dataset.eyes = card.dataset.eyes;
        patch({ appearance: { eyes: card.dataset.eyes } });
      });

      bindRange('stScale',
        (el) => { body.querySelector('#stScaleV').textContent = `${el.value}%`; },
        (el) => patch({ general: { scale: Number(el.value) / 100 } }));

      bindRange('stOpacity',
        (el) => {
          body.querySelector('#stOpacityV').textContent = `${el.value}%`;
          document.documentElement.style.setProperty('--tint-op', String(Number(el.value) / 100));
        },
        (el) => patch({ general: { opacity: Number(el.value) / 100 } }));

      bindRange('stBlur',
        (el) => {
          body.querySelector('#stBlurV').textContent = el.value;
          document.documentElement.style.setProperty('--blur', `${el.value}px`);
          document.documentElement.style.setProperty('--tint-blur', `${el.value}px`);
        },
        (el) => patch({ appearance: { blur: Number(el.value) } }));

      bindSwitch('stArtTint', 'appearance', 'artworkTint');
      bindSwitch('stNoise', 'appearance', 'noise');
      bindSwitch('stReduce', 'general', 'reduceMotion');

      body.querySelector('#stResetLook').addEventListener('click', async () => {
        try { ctx.S.cfg = await ctx.invoke('config:reset'); } catch {}
        document.documentElement.dataset.theme = ctx.S.cfg?.appearance?.theme || 'midnight';
        document.getElementById('island').dataset.eyes = ctx.S.cfg?.appearance?.eyes || 'classic';
        ctx.refreshHeader();
        look();
        ctx.pushNote({ title: '外观已重置', level: 'success' });
      });
    }

    /* -------------------------------------------------------------- SYSTEM */
    function system() {
      const n = cfg().notify || {};
      const s = cfg().stash || {};
      const opts = [
        ['top-left', '左上'], ['top-center', '顶部居中'], ['top-right', '右上'],
        ['center', '屏幕居中'], ['bottom-center', '底部居中']
      ];
      body.innerHTML = `
        <div class="section-title">行为</div>
        ${row('应用全屏时隐藏', sw('stFullHide', g().hideOnFullscreen !== false), '看电影、游戏、演示时自动让位')}
        ${row('自动收起', sw('stAuto', g().autoCollapse !== false), '长时间无操作后回到胶囊态')}
        ${row('移开即收起', sw('stLeave', g().collapseOnLeave !== false), '鼠标离开就收起，最跟手')}
        ${row('收起延迟', slider('stLeaveDelay', 0, 2, 0.1, Number(g().leaveDelay ?? 0.4), 's'), '给鼠标一点反应时间')}

        <div class="section-title">启动</div>
        ${row('开机自启', sw('stLogin', !!g().launchAtLogin))}
        ${row('总是置顶', sw('stTop', g().alwaysOnTop !== false))}

        <div class="section-title">停靠位置</div>
        <div class="pos-grid">
          ${opts.map(([v, l]) => `<button data-pos="${v}">${l}</button>`).join('')}
        </div>
        <div class="row" style="justify-content:space-between;padding-top:9px">
          <span class="label">也可以直接拖动岛或标题栏</span>
          <button class="pillbtn" data-variant="ghost" id="stResetPos">重置位置</button>
        </div>

        <div class="section-title">通知</div>
        ${row('镜像到系统通知', sw('stMirror', !!n.mirrorToSystem))}
        <div class="kv">
          <span class="label">本地端口</span>
          <input class="field" id="stPort" style="width:78px;text-align:center" value="${n.port || 7788}"/>
        </div>

        <div class="section-title">中转站</div>
        ${row('保留天数', slider('stKeep', 1, 30, 1, s.maxDays ?? 7, ' 天'))}
        <div class="row" style="justify-content:space-between;padding-top:8px">
          <span class="label">快捷键 Ctrl + Shift + I 显示 / 隐藏</span>
          <button class="pillbtn" data-variant="ghost" id="stOpenData">打开数据目录</button>
        </div>`;

      bindSwitch('stFullHide', 'general', 'hideOnFullscreen');
      bindSwitch('stLogin', 'general', 'launchAtLogin');
      bindSwitch('stTop', 'general', 'alwaysOnTop');
      bindSwitch('stAuto', 'general', 'autoCollapse');
      bindSwitch('stLeave', 'general', 'collapseOnLeave');
      bindSwitch('stMirror', 'notify', 'mirrorToSystem');

      bindRange('stLeaveDelay',
        (el) => { body.querySelector('#stLeaveDelayV').textContent = `${Number(el.value).toFixed(1)}s`; },
        (el) => patch({ general: { leaveDelay: Number(el.value) } }));

      bindRange('stKeep',
        (el) => { body.querySelector('#stKeepV').textContent = `${el.value} 天`; },
        (el) => patch({ stash: { maxDays: Number(el.value) } }));

      const port = body.querySelector('#stPort');
      port.addEventListener('change', () => patch({ notify: { port: Number(port.value) || 7788 } }));

      body.querySelectorAll('[data-pos]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try { await ctx.invoke('window:preset', { preset: btn.dataset.pos }); } catch {}
          body.querySelectorAll('[data-pos]').forEach((b) => { b.dataset.on = b === btn ? '1' : '0'; });
        });
      });
      body.querySelector('#stResetPos').addEventListener('click', async () => {
        try { await ctx.invoke('window:resetPos'); } catch {}
        body.querySelectorAll('[data-pos]').forEach((b) => { b.dataset.on = b.dataset.pos === 'top-center' ? '1' : '0'; });
      });
      body.querySelector('#stOpenData').addEventListener('click', () => ctx.invoke('sys:revealUserData').catch(() => {}));
    }

    /* --------------------------------------------------------------- MEDIA */
    function media() {
      body.innerHTML = `
        <div class="section-title">读取</div>
        ${row('轮询间隔', slider('stPoll', 800, 4000, 200, m().pollInterval ?? 1600, 'ms'), '越低越实时，越耗电')}
        ${row('显示封面', sw('stArt', m().showArtwork !== false))}
        <div class="section-title">歌词（可选）</div>
        ${row('网易云歌词', sw('stLyr', !!m().lyrics), '需本地 NetEaseCloudMusicApi')}
        ${row('收缩态显示歌词', sw('stLyricPill', m().lyricOnPill !== false), '胶囊里跟着唱当前一句')}
        <div class="col" style="gap:5px;padding:5px 0 2px">
          <span class="label">NetEaseCloudMusicApi 地址</span>
          <input class="field" id="stNetease" placeholder="http://127.0.0.1:3000" value="${ctx.esc(m().neteaseApi || '')}"/>
        </div>
        <div class="section-title">播放器</div>
        <div class="label" style="line-height:1.55;padding-bottom:6px">
          同时开着网易云 / 波点 / QQ音乐时，系统只会给我们“当前”那一个。点一下固定到你正在看的播放器。
        </div>
        <div class="players" id="stPlayers"></div>`;

      bindRange('stPoll',
        (el) => { body.querySelector('#stPollV').textContent = `${el.value}ms`; },
        (el) => patch({ media: { pollInterval: Number(el.value) } }));

      bindSwitch('stArt', 'media', 'showArtwork');
      bindSwitch('stLyr', 'media', 'lyrics');
      bindSwitch('stLyricPill', 'media', 'lyricOnPill');

      const netease = body.querySelector('#stNetease');
      netease.addEventListener('change', () => patch({ media: { neteaseApi: netease.value.trim() } }));

      const players = body.querySelector('#stPlayers');
      players.innerHTML = '<span class="label">读取中…</span>';
      ctx.invoke('media:sessions').then((list) => {
        const pinned = m().preferApp || '';
        if (!list.length) { players.innerHTML = '<span class="label">当前没有可见的播放器会话</span>'; return; }
        players.innerHTML = list.map((p) => `
          <button class="chip" data-id="${ctx.esc(p.id || '')}" data-on="${p.id === pinned ? 1 : 0}">
            ${ctx.esc(p.app || p.id)}
          </button>`).join('') + `<button class="chip" data-id="" data-on="${pinned ? 0 : 1}">自动</button>`;
        players.addEventListener('click', (e) => {
          const chip = e.target.closest('.chip');
          if (!chip) return;
          players.querySelectorAll('.chip').forEach((c) => { c.dataset.on = c === chip ? '1' : '0'; });
          patch({ media: { preferApp: chip.dataset.id } });
        });
      }).catch(() => { players.innerHTML = '<span class="label">读取失败</span>'; });
    }

    /* ------------------------------------------------------------------ AI */
    function aiTab() {
      const c = ai();
      const provider = presets.find((p) => p.id === c.provider) || presets[0];
      body.innerHTML = `
        <div class="section-title">服务商</div>
        <div class="providers" id="stProv">
          ${presets.map((p) => `
            <button class="provider" data-p="${p.id}" data-on="${p.id === c.provider ? 1 : 0}">
              <div class="pn">${p.label}</div>
              <div class="pu">${p.baseUrl ? ctx.esc(p.baseUrl.replace(/^https?:\/\//, '').split('/')[0]) : '任意兼容接口'}</div>
            </button>`).join('')}
        </div>

        <div class="section-title">接口</div>
        <div class="col" style="gap:5px;padding:3px 0">
          <span class="label">Base URL（OpenAI 兼容）</span>
          <input class="field" id="stBase" value="${ctx.esc(c.baseUrl || '')}" placeholder="https://api.deepseek.com/v1"/>
        </div>
        <div class="col" style="gap:5px;padding:3px 0">
          <span class="label">API Key</span>
          <div class="row" style="gap:5px">
            <input class="field" id="stKey" type="password" value="${ctx.esc(c.apiKey || '')}" placeholder="sk-…"/>
            <button class="ibtn" id="stKeyEye" title="显示 / 隐藏">${icon('eye', 14)}</button>
          </div>
        </div>
        <div class="col" style="gap:5px;padding:3px 0">
          <span class="label">模型</span>
          <div class="row" style="gap:5px">
            <input class="field" id="stModel" value="${ctx.esc(c.model || '')}" placeholder="${ctx.esc(provider?.model || 'deepseek-chat')}"/>
            <button class="ibtn" id="stModels" title="从接口拉取模型列表">${icon('refresh', 14)}</button>
          </div>
          <div class="players" id="stModelChips"></div>
        </div>
        ${row('创造力', slider('stTemp', 0, 1.4, 0.1, Number(c.temperature ?? 0.7)), '越高越发散')}
        ${row('单次上限', slider('stMaxTok', 300, 4000, 100, Number(c.maxTokens ?? 1200), ' tok'))}
        ${row('额度来源', `<div class="seg" id="stBalance">
            ${['deepseek', 'openai', 'none'].map((v) => `<button data-v="${v}" data-on="${c.balance === v ? 1 : 0}">${v === 'none' ? '仅本地' : v}</button>`).join('')}
          </div>`)}

        <div class="section-title">Token</div>
        <div class="token-meter">
          <span class="label" style="flex:none">上下文</span>
          <span class="track"><i id="stTokBar"></i></span>
          <b id="stTokText">—</b>
        </div>
        <div class="label" id="stTokNote" style="padding:1px 0 2px">读取中…</div>

        <div class="row" style="gap:6px;padding-top:10px">
          <button class="pillbtn" data-variant="accent" id="stAiSave">保存</button>
          <button class="pillbtn" data-variant="ghost" id="stAiTest">测试连接</button>
          <button class="pillbtn" data-variant="ghost" id="stAiClear">清空对话</button>
          <span class="tiny faint" id="stAiMsg"></span>
        </div>`;

      body.querySelector('#stProv').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-p]');
        if (!b) return;
        const p = presets.find((x) => x.id === b.dataset.p);
        if (!p) return;
        body.querySelectorAll('.provider').forEach((x) => { x.dataset.on = x === b ? '1' : '0'; });
        await patch({
          ai: {
            provider: p.id,
            ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
            ...(p.model ? { model: p.model } : {}),
            ...(p.context ? { contextWindow: p.context } : {}),
            ...(p.balance ? { balance: p.balance } : {})
          }
        });
        aiTab();
      });

      body.querySelector('#stKeyEye').addEventListener('click', () => {
        const el = body.querySelector('#stKey');
        el.type = el.type === 'password' ? 'text' : 'password';
      });

      body.querySelector('#stBalance').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-v]');
        if (!b) return;
        body.querySelectorAll('#stBalance button').forEach((x) => { x.dataset.on = x === b ? '1' : '0'; });
        patch({ ai: { balance: b.dataset.v } });
      });

      bindRange('stTemp', (el) => { body.querySelector('#stTempV').textContent = Number(el.value).toFixed(1); },
        (el) => patch({ ai: { temperature: Number(el.value) } }));
      bindRange('stMaxTok', (el) => { body.querySelector('#stMaxTokV').textContent = `${el.value} tok`; },
        (el) => patch({ ai: { maxTokens: Number(el.value) } }));

      body.querySelector('#stModels').addEventListener('click', async () => {
        const chips = body.querySelector('#stModelChips');
        chips.innerHTML = '<span class="label">拉取中…</span>';
        try {
          const res = await ctx.invoke('ai:models');
          const list = res.models || [];
          chips.innerHTML = list.length
            ? list.map((id) => `<button class="chip" data-model="${ctx.esc(id)}">${ctx.esc(id)}</button>`).join('')
            : '<span class="label">接口没有返回模型，手动填一个即可</span>';
          chips.onclick = async (ev) => {
            const chip = ev.target.closest('[data-model]');
            if (!chip) return;
            body.querySelector('#stModel').value = chip.dataset.model;
            await patch({ ai: { model: chip.dataset.model } });
            ctx.refreshHeader();
          };
        } catch (err) {
          chips.innerHTML = `<span class="label">${ctx.esc(err.message)}</span>`;
        }
      });

      const save = async () => {
        await patch({
          ai: {
            baseUrl: body.querySelector('#stBase').value.trim(),
            apiKey: body.querySelector('#stKey').value.trim(),
            model: body.querySelector('#stModel').value.trim()
          }
        });
        ctx.refreshHeader();
      };

      body.querySelector('#stAiSave').addEventListener('click', async () => {
        await save();
        const msg = body.querySelector('#stAiMsg');
        msg.textContent = '已保存';
        setTimeout(() => { msg.textContent = ''; }, 1800);
      });

      body.querySelector('#stAiTest').addEventListener('click', async () => {
        const msg = body.querySelector('#stAiMsg');
        msg.textContent = '测试中…';
        await save();
        try {
          const b = await ctx.invoke('ai:balance');
          msg.textContent = b.configured
            ? (b.remote ? `余额 ${b.remote.total} ${b.remote.currency}` : '接口可用')
            : '还没填 Key';
        } catch (err) {
          msg.textContent = err.message.slice(0, 40);
        }
      });

      body.querySelector('#stAiClear').addEventListener('click', async () => {
        await ctx.invoke('ai:reset').catch(() => {});
        ctx.S.ai.messages = [];
        ctx.pushNote({ title: '对话已清空', level: 'success' });
      });

      refreshToken();
    }

    async function refreshToken() {
      try {
        const b = await ctx.invoke('ai:balance');
        const bar = body.querySelector('#stTokBar');
        const txt = body.querySelector('#stTokText');
        const note = body.querySelector('#stTokNote');
        if (!bar || !txt) return;
        const c = b.context || { limit: 64000, used: 0, percent: 0 };
        bar.style.width = `${Math.max(2, c.percent)}%`;
        txt.textContent = `${fmtTokens(c.used)} / ${fmtTokens(c.limit)}`;
        const month = `本月 ${b.requests || 0} 次 · ${fmtTokens(b.totalTokens || 0)} tok`;
        note.textContent = b.remote
          ? `余额 ${b.remote.currency === 'CNY' ? '¥' : '$'}${b.remote.total.toFixed(2)} · ${month}`
          : b.configured ? month : '未配置接口，填入任意 OpenAI 兼容服务即可';
      } catch { /* leave the placeholder */ }
    }

    /* --------------------------------------------------------------- ABOUT */
    async function about() {
      body.innerHTML = `<div class="empty">${icon('spark', 22)}<div>读取中…</div></div>`;
      info = info || await ctx.invoke('app:info').catch(() => null);
      body.innerHTML = `
        <div class="card" style="text-align:center;padding:14px">
          <div style="font-size:16px;font-weight:660;letter-spacing:.01em">wl-Island</div>
          <div class="label" style="margin-top:4px">灵动岛 · v${info?.version || '1.0.0'} · ${info?.arch || 'x64'}</div>
          <div class="label" style="margin-top:2px">Electron ${info?.electron || ''} · Windows</div>
        </div>
        <div class="row" style="gap:6px;padding-top:10px">
          <button class="pillbtn" data-variant="accent" id="stDiag" style="flex:1">${icon('check', 13)} 运行诊断</button>
          <button class="pillbtn" data-variant="ghost" id="stGithub">${icon('link', 13)} 开源仓库</button>
        </div>
        <div class="diag" id="stDiagList" style="margin-top:10px"></div>
        <div class="row" style="justify-content:space-between;padding-top:11px">
          <span class="label">MIT License · 本地优先，数据不出机器</span>
        </div>`;

      body.querySelector('#stDiag').addEventListener('click', async () => {
        const list = body.querySelector('#stDiagList');
        list.innerHTML = '<div class="label">诊断中…</div>';
        try {
          const res = await ctx.invoke('app:diagnose');
          list.innerHTML = res.checks.map((c) => `
            <div class="d" data-s="${c.status}">
              <span class="bullet"></span>
              <div class="grow"><b>${ctx.esc(c.name)}</b><br/><span class="faint">${ctx.esc(c.detail)}</span></div>
            </div>`).join('');
        } catch (err) {
          list.innerHTML = `<div class="d" data-s="fail"><span class="bullet"></span><div>${ctx.esc(err.message)}</div></div>`;
        }
      });
      body.querySelector('#stGithub').addEventListener('click', () => {
        ctx.invoke('app:openExternal', { url: 'https://github.com/wl-island/wl-island' }).catch(() => {});
      });
    }

    function paint(tab) {
      active = tab;
      nav.querySelectorAll('button').forEach((b) => { b.dataset.on = b.dataset.tab === tab ? '1' : '0'; });
      if (tab === 'look') look();
      if (tab === 'system') system();
      if (tab === 'media') media();
      if (tab === 'ai') aiTab();
      if (tab === 'about') about();
    }

    nav.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (b) paint(b.dataset.tab);
    });

    paint(active);

    ctx.invoke('ai:presets').then((list) => {
      if (Array.isArray(list) && list.length) {
        presets = list;
        if (active === 'ai') paint('ai');
      }
    }).catch(() => {});

    return {
      update: () => {},
      destroy: () => {},
      goto: (tab) => paint(tab)
    };
  }
};

function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}
