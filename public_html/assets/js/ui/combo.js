import { html, el, debounce } from '../dom.js';
import { t } from '../i18n.js';

/**
 * Turn a text input into a searchable picker.
 *   fetch(q)       → Promise<items[]>
 *   render(item)   → Html for one option
 *   onSelect(item) → called on click or Enter
 * Arrow keys move, Enter picks, Escape closes. Returns { close, destroy }.
 */
export function combo(input, { fetch, render, onSelect, minChars = 1, emptyText }) {
  const wrap = input.parentElement;
  if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('autocomplete', 'off');

  let list = null;
  let items = [];
  let sel = 0;
  let seq = 0;

  const close = () => {
    if (list) list.remove();
    list = null;
    input.setAttribute('aria-expanded', 'false');
  };

  const draw = () => {
    if (!list) {
      list = el('<div class="combo-list" role="listbox"></div>');
      wrap.appendChild(list);
      input.setAttribute('aria-expanded', 'true');
      list.addEventListener('mousedown', (e) => {
        const opt = e.target.closest('[data-i]');
        if (!opt) return;
        e.preventDefault();
        pick(Number(opt.dataset.i));
      });
    }
    list.innerHTML = items.length
      ? String(html`${items.map((it, i) => html`<div class="combo-item" role="option" data-i="${i}" aria-selected="${i === sel}">${render(it)}</div>`)}`)
      : String(html`<div class="combo-empty">${emptyText || t('common.no_results')}</div>`);
    const active = list.querySelector('[aria-selected="true"]');
    if (active) active.scrollIntoView({ block: 'nearest' });
  };

  const pick = (i) => {
    const it = items[i];
    if (!it) return;
    close();
    onSelect(it);
  };

  const search = debounce(async () => {
    const q = input.value.trim();
    if (q.length < minChars) {
      close();
      return;
    }
    const mine = ++seq;
    let found = [];
    try {
      found = await fetch(q);
    } catch {
      found = [];
    }
    if (mine !== seq || document.activeElement !== input) return;
    items = found;
    sel = 0;
    draw();
  }, 180);

  const onKey = (e) => {
    if (!list) {
      if (e.key === 'ArrowDown') search();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      sel = Math.min(items.length - 1, sel + 1);
      draw();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      sel = Math.max(0, sel - 1);
      draw();
    } else if (e.key === 'Enter' && items.length) {
      e.preventDefault();
      e.stopImmediatePropagation();
      pick(sel);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  const onBlur = () => setTimeout(close, 150);

  input.addEventListener('input', search);
  input.addEventListener('keydown', onKey);
  input.addEventListener('blur', onBlur);

  return {
    close,
    destroy() {
      close();
      input.removeEventListener('input', search);
      input.removeEventListener('keydown', onKey);
      input.removeEventListener('blur', onBlur);
    },
  };
}
