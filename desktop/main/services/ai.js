'use strict';
/**
 * AI service — OpenAI-compatible chat streaming, provider presets, quota.
 *
 * `provider` is only a shortcut that fills in baseUrl/model defaults; the wire
 * protocol is always /chat/completions, which every provider worth using
 * speaks (DeepSeek, Moonshot, Zhipu, Qwen, SiliconFlow, Ollama, OpenRouter…).
 * That keeps "free choice of API" honest: the user can also type a raw base
 * URL and a model id that we have never heard of.
 *
 * Quota is provider specific:
 *   deepseek : GET {origin}/user/balance → real account balance
 *   others   : no public quota endpoint → token accounting from `usage`
 *
 * Token "remaining" is reported twice, because the two mean different things:
 *   • context  — how much of the model's window this session has consumed
 *   • month    — how many tokens this app has spent this calendar month
 */
const { EventEmitter } = require('events');

const PRESETS = [
  {
    id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat', balance: 'deepseek', context: 64000,
    models: ['deepseek-chat', 'deepseek-reasoner']
  },
  {
    id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini', balance: 'openai', context: 128000,
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'o4-mini']
  },
  {
    id: 'moonshot', label: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k', balance: 'none', context: 8000,
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-latest']
  },
  {
    id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash', balance: 'none', context: 128000,
    models: ['glm-4-flash', 'glm-4-plus', 'glm-4-air']
  },
  {
    id: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus', balance: 'none', context: 131072,
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max']
  },
  {
    id: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct', balance: 'none', context: 32768,
    models: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3', 'THUDM/glm-4-9b-chat']
  },
  {
    id: 'ollama', label: '本地 Ollama', baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b', balance: 'none', context: 32768, keyOptional: true,
    models: ['qwen2.5:7b', 'llama3.2', 'gemma2']
  },
  {
    id: 'custom', label: '自定义', baseUrl: '', model: '', balance: 'none', context: 64000, models: []
  }
];

const PRICE_PER_MTOK = {
  'deepseek-chat': { in: 0.5, out: 8 },
  'deepseek-reasoner': { in: 4, out: 16 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4o': { in: 2.5, out: 10 }
};

function originOf(baseUrl) {
  try { return new URL(baseUrl).origin; } catch { return 'https://api.deepseek.com'; }
}

function monthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function presetOf(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

class AiService extends EventEmitter {
  constructor({ cfg }) {
    super();
    this.cfg = cfg;
    this.abort = null;
    this.history = [];
    this.lastUsage = null;
  }

  get preset() {
    return presetOf(this.cfg.get('ai.provider', 'deepseek')) || presetOf('custom');
  }

  get configured() {
    const key = (this.cfg.get('ai.apiKey') || '').trim();
    if (key) return true;
    return !!this.preset?.keyOptional && !!this.cfg.get('ai.baseUrl');
  }

  _monthRoll() {
    const m = monthKey();
    if (this.cfg.get('usage.month') !== m) {
      this.cfg.patch({ usage: { month: m, promptTokens: 0, completionTokens: 0, requests: 0 } }, { silent: true });
    }
  }

  _trackUsage(usage) {
    if (!usage) return;
    this._monthRoll();
    const u = this.cfg.get('usage');
    this.cfg.patch({
      usage: {
        month: u.month || monthKey(),
        promptTokens: (u.promptTokens || 0) + (usage.prompt_tokens || 0),
        completionTokens: (u.completionTokens || 0) + (usage.completion_tokens || 0),
        requests: (u.requests || 0) + 1
      }
    }, { silent: true });
  }

  async chat(userText, { onDelta, attachments } = {}) {
    if (!this.configured) throw new Error('未配置 API Key');
    const baseUrl = (this.cfg.get('ai.baseUrl') || '').replace(/\/+$/, '');
    if (!baseUrl) throw new Error('未填写 Base URL');
    const model = this.cfg.get('ai.model') || this.preset?.model || 'deepseek-chat';
    const key = (this.cfg.get('ai.apiKey') || '').trim();
    const system = this.cfg.get('ai.systemPrompt') || '你是桌面助手。';

    const content = attachments?.length
      ? `${userText}\n\n[附带内容]\n${attachments.join('\n')}`
      : userText;

    this.history.push({ role: 'user', content });
    // Keeping the last 12 turns is enough for a desktop assistant and bounds
    // the prompt size so a long session cannot silently blow the context.
    if (this.history.length > 12) this.history = this.history.slice(-12);

    const body = {
      model,
      stream: true,
      stream_options: { include_usage: true },
      temperature: Number(this.cfg.get('ai.temperature', 0.7)),
      max_tokens: Number(this.cfg.get('ai.maxTokens', 1200)) || 1200,
      messages: [{ role: 'system', content: system }, ...this.history]
    };

    this.abort?.abort();
    this.abort = new AbortController();

    const headers = { 'content-type': 'application/json' };
    if (key) headers.authorization = `Bearer ${key}`;

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: this.abort.signal
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let msg = text.slice(0, 300);
      try { msg = JSON.parse(text).error?.message || msg; } catch { /* keep raw */ }
      this.history.pop();
      throw new Error(`${res.status} ${msg || res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    let full = '';
    let usage = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        let json;
        try { json = JSON.parse(payload); } catch { continue; }
        if (json.usage) usage = json.usage;
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onDelta?.(delta);
        }
      }
    }

    this.history.push({ role: 'assistant', content: full });
    const finalUsage = usage || estimateUsage(body.messages, full);
    this.lastUsage = finalUsage;
    this._trackUsage(finalUsage);
    return { text: full, usage: finalUsage };
  }

  stop() {
    this.abort?.abort();
    this.abort = null;
  }

  reset() {
    this.history = [];
    this.lastUsage = null;
  }

  /** Model list: ask the provider, fall back to the preset's curated list. */
  async models() {
    const preset = this.preset || {};
    const fallback = Array.isArray(preset.models) ? preset.models : [];
    if (!this.configured) return { models: fallback, source: 'preset' };
    try {
      const baseUrl = (this.cfg.get('ai.baseUrl') || '').replace(/\/+$/, '');
      const key = (this.cfg.get('ai.apiKey') || '').trim();
      const headers = key ? { authorization: `Bearer ${key}` } : {};
      const res = await fetch(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(6000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const list = (j.data || j.models || [])
        .map((m) => (typeof m === 'string' ? m : m.id || m.name))
        .filter(Boolean);
      if (!list.length) throw new Error('empty');
      return { models: [...new Set([...list, ...fallback])].slice(0, 80), source: 'remote' };
    } catch (err) {
      return { models: fallback, source: 'preset', error: err.message };
    }
  }

  async balance() {
    const mode = this.cfg.get('ai.balance', 'deepseek');
    this._monthRoll();
    const usage = this.cfg.get('usage') || {};
    const price = PRICE_PER_MTOK[this.cfg.get('ai.model')] || { in: 1, out: 3 };
    const estimate = ((usage.promptTokens || 0) / 1e6) * price.in + ((usage.completionTokens || 0) / 1e6) * price.out;
    const ctxLimit = Number(this.cfg.get('ai.contextWindow')) || this.preset?.context || 64000;
    const lastPrompt = Number(this.lastUsage?.prompt_tokens) || 0;

    const local = {
      configured: this.configured,
      mode,
      provider: this.cfg.get('ai.provider', 'deepseek'),
      model: this.cfg.get('ai.model', ''),
      month: usage.month,
      requests: usage.requests || 0,
      promptTokens: usage.promptTokens || 0,
      completionTokens: usage.completionTokens || 0,
      totalTokens: (usage.promptTokens || 0) + (usage.completionTokens || 0),
      estimatedCost: Math.round(estimate * 10000) / 10000,
      currency: 'CNY',
      context: {
        limit: ctxLimit,
        used: lastPrompt,
        percent: ctxLimit ? Math.min(100, Math.round((lastPrompt / ctxLimit) * 100)) : 0
      }
    };

    if (!this.configured || mode === 'none') return { ...local, remote: null };

    if (mode === 'deepseek') {
      try {
        const key = (this.cfg.get('ai.apiKey') || '').trim();
        const res = await fetch(`${originOf(this.cfg.get('ai.baseUrl'))}/user/balance`, {
          headers: key ? { authorization: `Bearer ${key}` } : {},
          signal: AbortSignal.timeout(8000)
        });
        if (res.ok) {
          const j = await res.json();
          const info = (j.balance_infos || [])[0] || {};
          return {
            ...local,
            remote: {
              available: !!j.is_available,
              total: Number(info.total_balance) || 0,
              granted: Number(info.granted_balance) || 0,
              toppedUp: Number(info.topped_up_balance) || 0,
              currency: info.currency || 'CNY'
            }
          };
        }
        return { ...local, remote: null, error: `HTTP ${res.status}` };
      } catch (err) {
        return { ...local, remote: null, error: err.message };
      }
    }

    return { ...local, remote: null };
  }
}

/** Cheap fallback when the provider sends no usage block: ~4 chars/token. */
function estimateUsage(messages, answer) {
  const promptChars = messages.reduce((n, m) => n + String(m.content || '').length, 0);
  return {
    prompt_tokens: Math.ceil(promptChars / 3.2),
    completion_tokens: Math.ceil(String(answer).length / 3.2)
  };
}

module.exports = { AiService, PRESETS };
