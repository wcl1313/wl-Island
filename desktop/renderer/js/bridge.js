/** Thin, promise-shaped wrapper over the preload bridge. */
const api = window.wl;

export const platform = api?.platform || 'unknown';

/** Invoke an IPC channel; throws on the {ok:false} envelope. */
export async function invoke(channel, payload) {
  if (!api) throw new Error('bridge unavailable');
  const res = await api.invoke(channel, payload);
  if (!res || res.ok === false) throw new Error(res?.error || `${channel} 失败`);
  return res.data;
}

export const on = (event, cb) => api.on(event, cb);

export const pathForFile = (file) => (api ? api.pathForFile(file) : null);
