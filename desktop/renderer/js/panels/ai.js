/**
 * AI — Apple Intelligence flavoured chat.
 *
 * The assistant speaks on the glass (no bubble), the user speaks in an accent
 * bubble. A single gradient orb is the only avatar, and it is also the empty
 * state, the thinking indicator and the send button's sibling — one visual
 * idea repeated instead of three different ones.
 *
 * Quota is honest: the bar shows *context window* usage when the provider
 * reports usage, and the line under it shows the real balance when the
 * provider has a balance endpoint (DeepSeek) or this month's tokens otherwise.
 */
import { icon } from '../icons.js';

const SUGGESTIONS = [
  '排一下今天要做的事',
  '这段报错是什么原因',
  '把这段文字压缩成三行',
  '写封简短的请假邮件'
];

/** Escape first, then allow a very small subset of markdown. */
function fmt(text) {
  const esc = String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/^\s*[-*]\s+/gm, '· ')
    .replace(/\n/g, '<br/>');
}

function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

export default {
  id: 'ai',
  label: 'AI',
  icon: 'ai',
  height: 384,

  sub(S) {
    const a = S.cfg?.ai || {};
    if (!a.apiKey && a.provider !== 'ollama') return '未接入 · 在设置里选一个服务商';
    return `${a.model || 'model'} · ${a.provider || 'custom'}`;
  },

  mount(view, ctx) {
    const { S } = ctx;
    const a = S.cfg?.ai || {};
    const configured = Boolean(a.apiKey) || a.provider === 'ollama';

    view.innerHTML = `
      <div class="p-ai">
        <div class="ai-bar">
          <span class="model-pill" data-off="${configured ? 0 : 1}">
            <i class="dot"></i>
            <span id="aiModel">${ctx.esc(a.model || '未接入')}</span>
          </span>
          <span class="token-bar" title="上下文占用">
            <span class="track"><i id="aiBar"></i></span>
            <b id="aiTok">—</b>
          </span>
        </div>
        <div class="chat" id="chat"></div>
        <div class="ai-input">
          <textarea id="inp" rows="1" placeholder="${configured ? '问点什么…  Enter 发送 · Shift+Enter 换行' : '先在设置 → AI 里接入一个接口'}"></textarea>
          <button class="cbtn" data-main="1" id="send" title="发送">${icon('chevronRight', 18)}</button>
        </div>
      </div>`;

    const chat = view.querySelector('#chat');
    const inp = view.querySelector('#inp');
    const send = view.querySelector('#send');
    const tok = view.querySelector('#aiTok');
    const bar = view.querySelector('#aiBar');

    const scroll = (force = false) => {
      const near = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 60;
      if (force || near) chat.scrollTop = chat.scrollHeight;
    };

    function row(role, text = '') {
      const wrap = document.createElement('div');
      wrap.className = `msg-row ${role === 'user' ? 'user' : 'bot'}`;
      if (role !== 'user') {
        const av = document.createElement('span');
        av.className = 'bot-av';
        wrap.appendChild(av);
      }
      const el = document.createElement('div');
      el.className = `msg ${role === 'user' ? 'user' : role}`;
      el.innerHTML = fmt(text);
      wrap.appendChild(el);
      chat.appendChild(wrap);
      scroll(true);
      return { wrap, el };
    }

    function hero() {
      const wrap = document.createElement('div');
      wrap.className = 'ai-hero';
      wrap.innerHTML = `
        <div class="ai-orb"></div>
        <div class="t">${configured ? '今天想聊点什么？' : 'AI 还没接上'}</div>
        <div class="s">${configured
          ? '可以用任意 OpenAI 兼容接口：DeepSeek、OpenAI、Moonshot、通义、硅基流动，或本机 Ollama。'
          : '打开设置 → AI，选一个服务商填入 Key 就能用。'}</div>
        ${configured ? `<div class="sugg">${SUGGESTIONS.map((s) => `<button data-sugg="${ctx.esc(s)}">${ctx.esc(s)}</button>`).join('')}</div>` : ''}`;
      chat.appendChild(wrap);
      wrap.querySelector('.sugg')?.addEventListener('click', (e) => {
        const b = e.target.closest('[data-sugg]');
        if (!b) return;
        inp.value = b.dataset.sugg;
        submit();
      });
      if (!configured) {
        wrap.style.cursor = 'pointer';
        wrap.addEventListener('click', () => ctx.open('settings'));
      }
    }

    const history = S.ai.messages || [];
    if (!history.length) hero();
    else history.forEach((m) => row(m.role === 'user' ? 'user' : 'bot', m.text));

    async function refreshQuota() {
      try {
        const b = await ctx.invoke('ai:balance');
        const c = b.context || { limit: 64000, used: 0, percent: 0 };
        bar.style.width = `${Math.max(2, c.percent)}%`;
        tok.textContent = `${fmtTokens(c.used)}/${fmtTokens(c.limit)}`;
        tok.title = b.remote
          ? `余额 ${b.remote.currency === 'CNY' ? '¥' : '$'}${b.remote.total.toFixed(2)} · 本月 ${b.requests} 次`
          : `本月 ${b.requests || 0} 次 · ${fmtTokens(b.totalTokens || 0)} tokens`;
      } catch {
        tok.textContent = '—';
      }
    }
    refreshQuota();

    let busy = false;
    let streaming = null;

    async function submit() {
      const text = inp.value.trim();
      if (!text || busy) return;
      if (!configured) { ctx.open('settings'); return; }
      inp.value = '';
      inp.style.height = 'auto';
      chat.querySelector('.ai-hero')?.remove();

      S.ai.messages.push({ role: 'user', text });
      row('user', text);
      const bot = row('bot', '');
      bot.el.innerHTML = '<span class="think"><i></i><i></i><i></i></span>';
      streaming = bot.el;
      busy = true;
      send.innerHTML = icon('close', 15);
      send.title = '停止';

      try {
        await ctx.invoke('ai:chat', { text });
      } catch (err) {
        bot.el.className = 'msg err';
        bot.el.textContent = `请求失败：${err.message}`;
      } finally {
        busy = false;
        streaming = null;
        send.innerHTML = icon('chevronRight', 18);
        send.title = '发送';
        refreshQuota();
      }
    }

    const offChunk = ctx.on('ai:chunk', ({ delta }) => {
      if (!streaming) return;
      const cursor = streaming.querySelector('.think');
      const base = streaming.dataset.raw || '';
      const next = base + delta;
      streaming.dataset.raw = next;
      streaming.innerHTML = `${fmt(next)}${cursor ? '<span class="think"><i></i><i></i><i></i></span>' : ''}`;
      scroll();
    });

    const offDone = ctx.on('ai:done', ({ text }) => {
      if (streaming) {
        streaming.dataset.raw = text || '';
        streaming.innerHTML = fmt(text || '');
      }
      const last = S.ai.messages[S.ai.messages.length - 1];
      if (last && last.role === 'user') S.ai.messages.push({ role: 'assistant', text });
      else if (last) last.text = text;
      scroll();
    });

    const onKey = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    };
    const onInput = () => {
      inp.style.height = 'auto';
      inp.style.height = `${Math.min(70, inp.scrollHeight)}px`;
    };
    inp.addEventListener('keydown', onKey);
    inp.addEventListener('input', onInput);
    send.addEventListener('click', () => {
      if (busy) { ctx.invoke('ai:stop').catch(() => {}); return; }
      submit();
    });
    setTimeout(() => { if (configured) inp.focus(); }, 240);

    return {
      update: () => refreshQuota(),
      destroy: () => {
        offChunk();
        offDone();
        ctx.invoke('ai:stop').catch(() => {});
      }
    };
  }
};
