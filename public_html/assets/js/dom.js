// Tiny DOM helpers. `html` is a tagged template that escapes every interpolated value
// unless it is itself Html (from html`` or raw()). Arrays are joined.

export class Html {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Trusted markup. Only pass strings you built yourself. */
export const raw = (s) => new Html(String(s ?? ''));

function part(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Html) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return new Html(out);
}

/** Attribute list from an object: {disabled: true, value: 'x', hidden: false} */
export function attrs(obj) {
  let out = '';
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === false || v === null || v === undefined) continue;
    out += v === true ? ` ${k}` : ` ${k}="${esc(v)}"`;
  }
  return raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Delegated event listener. Returns an unsubscribe function. */
export function on(root, type, selector, fn, opts) {
  const handler = (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) fn(e, target);
  };
  root.addEventListener(type, handler, opts);
  return () => root.removeEventListener(type, handler, opts);
}

export function setHTML(el, h) {
  el.innerHTML = String(h);
  return el;
}

/** Create one element from markup. */
export function el(markup) {
  const t = document.createElement('template');
  t.innerHTML = String(markup).trim();
  return t.content.firstElementChild;
}

export function debounce(fn, ms = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Replace the current hash query without triggering navigation. */
export function replaceQuery(query) {
  const [path] = (location.hash.slice(1) || '/').split('?');
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== '' && v !== null && v !== undefined && v !== false) qs.set(k, v);
  const s = qs.toString();
  history.replaceState(null, '', '#' + path + (s ? '?' + s : ''));
}
