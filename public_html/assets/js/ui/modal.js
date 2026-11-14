import { html, el, $ } from '../dom.js';
import { t } from '../i18n.js';

const stack = [];

function trapKeys(e) {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    top.close(null);
  }
}
document.addEventListener('keydown', trapKeys);

/**
 * Generic modal. body: Html. actions: [{label, kind, value}] → resolves with the clicked value
 * (null when dismissed). onOpen(root, close) lets the caller wire inputs.
 */
export function openModal({ title, body, actions = [], wide = false, onOpen } = {}) {
  return new Promise((resolve) => {
    const overlay = el('<div class="overlay"></div>');
    const modal = el(html`
      <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${title || ''}">
        <div class="modal-body">
          ${title ? html`<h2>${title}</h2>` : ''}
          ${body || ''}
        </div>
        ${actions.length
          ? html`<div class="modal-foot">${actions.map((a, i) => html`<button type="button" class="btn btn-${a.kind || 'secondary'}" data-i="${i}">${a.label}</button>`)}</div>`
          : ''}
      </div>`);
    const prevFocus = document.activeElement;
    let closed = false;
    const entry = {
      close(value) {
        if (closed) return;
        closed = true;
        overlay.remove();
        modal.remove();
        stack.splice(stack.indexOf(entry), 1);
        if (prevFocus && prevFocus.focus) prevFocus.focus();
        resolve(value);
      },
    };
    stack.push(entry);
    overlay.addEventListener('click', () => entry.close(null));
    modal.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) entry.close(actions[Number(b.dataset.i)].value);
    });
    document.body.append(overlay, modal);
    if (onOpen) onOpen(modal, entry.close);
    const focusable = $('input, select, textarea', modal) || $('.btn-primary, .btn-danger', modal) || $('button', modal);
    if (focusable) focusable.focus();
  });
}

export function confirmDialog({ title, message, confirmLabel, danger = false }) {
  return openModal({
    title,
    body: message ? html`<p class="muted">${message}</p>` : '',
    actions: [
      { label: t('common.cancel'), kind: 'secondary', value: false },
      { label: confirmLabel || t('common.confirm'), kind: danger ? 'danger' : 'primary', value: true },
    ],
  }).then((v) => v === true);
}

/** Ask for one line of text. Resolves with the trimmed text, or null. */
export function promptDialog({ title, label, placeholder = '', required = true, confirmLabel, value = '' }) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: html`<div class="field"><label for="prompt-in">${label}</label><input id="prompt-in" class="input" placeholder="${placeholder}" value="${value}" autocomplete="off"><div class="err">${t('fields.required')}</div></div>`,
      actions: [
        { label: t('common.cancel'), kind: 'secondary', value: null },
        { label: confirmLabel || t('common.confirm'), kind: 'primary', value: '__ok' },
      ],
      onOpen(root, close) {
        const input = $('#prompt-in', root);
        const ok = root.querySelector('.btn-primary');
        const submit = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const v = input.value.trim();
          if (required && !v) {
            input.closest('.field').classList.add('invalid');
            input.focus();
            return;
          }
          close('__val:' + v);
        };
        ok.addEventListener('click', submit, true);
        input.addEventListener('keydown', (e) => e.key === 'Enter' && submit(e));
      },
    }).then((v) => resolve(typeof v === 'string' && v.startsWith('__val:') ? v.slice(6) : null));
  });
}
