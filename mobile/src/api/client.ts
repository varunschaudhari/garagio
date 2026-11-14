// API client. Sends the token as both Authorization and X-Auth-Token (some cPanel hosts strip
// Authorization) and supports hosts without mod_rewrite (index.php?r=/path).

import { useSession, type Server } from '@/store/session';
import type { PublicInfo } from '@/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 20000;

type Params = Record<string, string | number | boolean | null | undefined>;

function query(params?: Params): URLSearchParams {
  const qs = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '' || v === false) continue;
      qs.set(k, v === true ? '1' : String(v));
    }
  }
  return qs;
}

export function apiUrl(server: Server, path: string, params?: Params): string {
  const qs = query(params);
  if (server.mode === 'pretty') {
    const s = qs.toString();
    return `${server.base}/api${path}${s ? '?' + s : ''}`;
  }
  const all = new URLSearchParams({ r: path });
  qs.forEach((v, k) => all.set(k, v));
  return `${server.base}/api/index.php?${all.toString()}`;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch {
    throw new ApiError(0, 'network', 'Network error');
  } finally {
    clearTimeout(timer);
  }
}

function isJson(res: Response) {
  return (res.headers.get('content-type') || '').includes('json');
}

/** "trimurtiauto.in/" → "https://trimurtiauto.in" */
export function normaliseServer(input: string): string {
  let s = input.trim().replace(/\s+/g, '');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  s = s.replace(/\/+$/, '').replace(/\/api(\/index\.php)?$/i, '');
  return s;
}

/** Check that an address is a Garage Manager server and find its URL style. */
export async function probeServer(input: string): Promise<{ server: Server; info: PublicInfo }> {
  const base = normaliseServer(input);
  for (const mode of ['pretty', 'query'] as const) {
    const server: Server = { base, mode };
    try {
      const res = await fetchWithTimeout(apiUrl(server, '/public/info'), { headers: { Accept: 'application/json' } });
      if (res.ok && isJson(res)) {
        const info = (await res.json()) as PublicInfo;
        if (info.app === 'garage-manager') return { server, info };
      }
    } catch {
      /* try next mode */
    }
  }
  throw new ApiError(0, 'server_invalid', 'Not a Garage Manager server');
}

interface RequestOpts {
  body?: unknown;
  params?: Params;
  /** Longer for uploads that the server passes on (e.g. job card reading). */
  timeoutMs?: number;
}

export async function request<T>(method: string, path: string, opts: RequestOpts = {}): Promise<T> {
  const { server, token, logout } = useSession.getState();
  if (!server) throw new ApiError(0, 'no_server', 'Server not set');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) {
    headers.Authorization = 'Bearer ' + token;
    headers['X-Auth-Token'] = token;
  }
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetchWithTimeout(apiUrl(server, path, opts.params), { method, headers, body }, opts.timeoutMs);
  if (!res.ok) {
    const data = isJson(res) ? ((await res.json().catch(() => null)) as { error?: string; code?: string; fields?: Record<string, unknown> } | null) : null;
    if (res.status === 401 && path !== '/auth/login' && token) {
      void logout();
    }
    throw new ApiError(res.status, data?.code ?? (res.status === 404 ? 'not_found' : 'server_error'), data?.error ?? res.statusText, data?.fields ?? {});
  }
  if (isJson(res)) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export const api = {
  get: <T>(path: string, params?: Params) => request<T>('GET', path, { params }),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, { body }),
  put: <T>(path: string, body: unknown = {}) => request<T>('PUT', path, { body }),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, body: FormData, timeoutMs = 60000) => request<T>('POST', path, { body, timeoutMs }),
};
