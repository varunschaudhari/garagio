// API client. Sends the token as both Authorization and X-Auth-Token (some cPanel hosts strip
// Authorization). Falls back to index.php?r= when the host has no mod_rewrite.

import { getToken } from './store.js';

let mode = 'pretty';
const unauthorizedListeners = new Set();

export class ApiError extends Error {
  constructor(status, code, message, fields = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields || {};
  }
}

export function onUnauthorized(fn) {
  unauthorizedListeners.add(fn);
}

function isJson(res) {
  return (res.headers.get('content-type') || '').includes('json');
}

/** Find a working API URL style and return /public/info. */
export async function detectApi() {
  try {
    const r = await fetch('api/public/info', { headers: { Accept: 'application/json' } });
    if (r.ok && isJson(r)) {
      mode = 'pretty';
      return r.json();
    }
  } catch {
    /* try fallback */
  }
  let r;
  try {
    r = await fetch('api/index.php?r=/public/info', { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError(0, 'network', 'Network error');
  }
  if (r.ok && isJson(r)) {
    mode = 'query';
    return r.json();
  }
  const data = isJson(r) ? await r.json() : null;
  throw new ApiError(r.status, data?.code || 'server_error', data?.error || 'Server not reachable');
}

export function apiUrl(path, params) {
  const qs = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '' && v !== false) qs.set(k, v === true ? '1' : v);
    }
  }
  if (mode === 'pretty') {
    const s = qs.toString();
    return 'api' + path + (s ? '?' + s : '');
  }
  const all = new URLSearchParams({ r: path });
  qs.forEach((v, k) => all.set(k, v));
  return 'api/index.php?' + all.toString();
}

export async function request(method, path, { body, params, raw = false, signal } = {}) {
  const headers = { Accept: 'application/json' };
  const token = getToken();
  if (token) {
    headers.Authorization = 'Bearer ' + token;
    headers['X-Auth-Token'] = token;
  }
  let payload;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(apiUrl(path, params), { method, headers, body: payload, signal, cache: 'no-store' });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'network', 'Network error');
  }
  if (!res.ok) {
    const data = isJson(res) ? await res.json().catch(() => null) : null;
    const err = new ApiError(res.status, data?.code || (res.status === 404 ? 'not_found' : 'server_error'), data?.error || res.statusText, data?.fields);
    if (res.status === 401 && path !== '/auth/login') unauthorizedListeners.forEach((fn) => fn(err));
    throw err;
  }
  if (raw) return res;
  return isJson(res) ? res.json() : res.text();
}

export const api = {
  get: (path, params, opts = {}) => request('GET', path, { params, ...opts }),
  post: (path, body, opts = {}) => request('POST', path, { body: body ?? {}, ...opts }),
  put: (path, body, opts = {}) => request('PUT', path, { body: body ?? {}, ...opts }),
  del: (path, opts = {}) => request('DELETE', path, opts),
};

/** Fetch an HTML document from the API (sent with the token) and open it in a new tab. */
export async function openApiHtml(path, params) {
  const win = window.open('', '_blank');
  try {
    const res = await request('GET', path, { params, raw: true });
    const text = await res.text();
    const blob = new Blob([text], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    if (win) win.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    if (win) win.close();
    throw e;
  }
}

/** Download a CSV (or any file) returned by the API. */
export async function downloadApiFile(path, params, fallbackName = 'export.csv') {
  const res = await request('GET', path, { params, raw: true });
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const m = cd.match(/filename="?([^"]+)"?/);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = m ? m[1] : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
