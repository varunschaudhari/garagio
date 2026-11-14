import { html, el, $ } from '../dom.js';
import { t } from '../i18n.js';
import { icon } from './icons.js';
import { readForm, showFieldErrors, checkRequired, busy } from './form.js';
import { toastError } from './toast.js';

let open = null;

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && open && !document.querySelector('.modal')) open.close();
});

/**
 * Side drawer with a form.
 * onSubmit(data, form) → resolve to close; throw ApiError to show field errors.
 * onOpen(root) for wiring extra behaviour. Resolves with onSubmit's result (or null if dismissed).
 */
export function openDrawer({ title, body, submitLabel, onSubmit, onOpen, wide = false, footer, noSubmit = false }) {
  if (open) open.close();
  return new Promise((resolve) => {
    const overlay = el('<div class="overlay"></div>');
    const drawer = el(html`
      <form class="drawer ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}" novalidate>
        <div class="drawer-head">
          <h2>${title}</h2>
          <button type="button" class="btn btn-ghost btn-icon" data-close aria-label="${t('common.close')}">${icon('x')}</button>
        </div>
        <div class="drawer-body">${body}</div>
        <div class="drawer-foot">
          ${footer || ''}
          <span class="spacer"></span>
          <button type="button" class="btn btn-secondary" data-close>${t('common.cancel')}</button>
          ${noSubmit ? '' : html`<button type="submit" class="btn btn-primary">${submitLabel || t('common.save')}</button>`}
        </div>
      </form>`);
    const prevFocus = document.activeElement;
    let result = null;
    const state = {
      close() {
        overlay.remove();
        drawer.remove();
        open = null;
        if (prevFocus && prevFocus.focus) prevFocus.focus();
        resolve(result);
      },
    };
    open = state;
    overlay.addEventListener('click', () => state.close());
    drawer.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) state.close();
    });
    drawer.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!onSubmit) return state.close();
      if (!checkRequired(drawer)) return;
      const btn = $('button[type=submit]', drawer);
      await busy(btn, async () => {
        try {
          result = await onSubmit(readForm(drawer), drawer);
          if (result !== false) state.close();
        } catch (err) {
          if (err && err.fields && showFieldErrors(drawer, err.fields)) return;
          toastError(err);
        }
      });
    });
    document.body.append(overlay, drawer);
    if (onOpen) onOpen(drawer, state.close);
    const first = $('.drawer-body input:not([type=hidden]):not([readonly]), .drawer-body select, .drawer-body textarea', drawer);
    if (first) first.focus();
  });
}
