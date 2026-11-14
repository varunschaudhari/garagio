import { html, el } from '../dom.js';
import { icon } from './icons.js';
import { errorText } from '../i18n.js';

function host() {
  let h = document.getElementById('toasts');
  if (!h) {
    h = el('<div id="toasts" class="toasts" role="status" aria-live="polite"></div>');
    document.body.appendChild(h);
  }
  return h;
}

/** Show a short message. type: success | error | info */
export function toast(message, type = 'success', ms = 3500) {
  const ic = type === 'error' ? 'circle-alert' : type === 'info' ? 'info' : 'circle-check';
  const node = el(html`<div class="toast ${type}">${icon(ic, 18)}<div>${message}</div></div>`);
  host().appendChild(node);
  if (navigator.vibrate && type === 'error') navigator.vibrate(60);
  setTimeout(() => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 250);
  }, ms);
}

export function toastError(err) {
  toast(errorText(err), 'error', 5000);
}
