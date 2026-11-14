// Hash router: #/parts/12?low=1 → page module default export (ctx) => cleanup?

import { hasRole } from './store.js';

const routes = [];
let cleanup = null;
let renderSeq = 0;
let guard = null;

/**
 * @param {string} pattern  e.g. '/parts/:id'
 * @param {() => Promise<any>} load  dynamic import of the page module
 * @param {{roles?: string[], title?: string}} opts
 */
export function route(pattern, load, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
  routes.push({ pattern, re, keys, load, opts });
}

export function parseHash() {
  const h = location.hash.slice(1) || '/';
  const [path, qs = ''] = h.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs)) };
}

export function go(path) {
  if (location.hash === '#' + path) render();
  else location.hash = '#' + path;
}

/** A page can block navigation (e.g. unsaved stock count). Return a message to block. */
export function setLeaveGuard(fn) {
  guard = fn;
}

let lastHash = location.hash;
let factory = null;

export function startRouter(ctxFactory) {
  factory = ctxFactory;
  window.addEventListener('hashchange', () => {
    if (guard) {
      const msg = guard();
      if (msg && !window.confirm(msg)) {
        history.replaceState(null, '', lastHash || '#/');
        return;
      }
    }
    render();
  });
  return render();
}

export async function render() {
  const seq = ++renderSeq;
  lastHash = location.hash;
  guard = null;
  const { path, query } = parseHash();
  let match = null;
  let params = {};
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      match = r;
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      break;
    }
  }
  if (typeof cleanup === 'function') {
    try { cleanup(); } catch { /* ignore */ }
  }
  cleanup = null;
  const ctx = factory({ path, query, params, route: match });
  if (!match) {
    ctx.notFound();
    return;
  }
  if (match.opts.roles && !hasRole(...match.opts.roles)) {
    ctx.forbidden();
    return;
  }
  try {
    const mod = await match.load();
    if (seq !== renderSeq) return;
    const result = await mod.default(ctx);
    if (seq === renderSeq && typeof result === 'function') cleanup = result;
  } catch (e) {
    if (seq === renderSeq) ctx.fail(e);
  }
}
