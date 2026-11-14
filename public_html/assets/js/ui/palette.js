import { html, el, $, $$, debounce } from '../dom.js';
import { t, getLang } from '../i18n.js';
import { api } from '../api.js';
import { icon } from './icons.js';

const TYPE_ICON = { part: 'package', job: 'clipboard-list', customer: 'user', vehicle: 'bike', invoice: 'receipt', page: 'arrow-right' };

let pagesProvider = () => [];
/** The shell registers the pages the user may open, for quick navigation. */
export function setPaletteSource(fn) {
  pagesProvider = fn;
}

let openState = null;

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    if (!document.querySelector('.app')) return;
    e.preventDefault();
    if (openState) openState.close();
    else openPalette();
  }
});

export function openPalette() {
  if (openState) return;
  const overlay = el('<div class="overlay"></div>');
  const box = el(html`
    <div class="palette" role="dialog" aria-modal="true" aria-label="${t('common.search')}">
      <div class="palette-input">${icon('search', 20)}<input type="text" placeholder="${t('common.search_placeholder')}" aria-label="${t('common.search')}" autocomplete="off"><kbd>Esc</kbd></div>
      <div class="palette-list" role="listbox"></div>
    </div>`);
  const input = $('input', box);
  const list = $('.palette-list', box);
  let items = [];
  let sel = 0;
  let seq = 0;

  const close = () => {
    overlay.remove();
    box.remove();
    openState = null;
  };
  openState = { close };

  const draw = () => {
    if (!items.length) {
      list.innerHTML = String(html`<div class="combo-empty">${input.value.trim().length < 2 ? t('common.search_placeholder') : t('common.no_results')}</div>`);
      return;
    }
    let lastGroup = null;
    list.innerHTML = String(html`${items.map((it, i) => {
      const group = it.type === 'page' ? t('common.open') : '';
      const head = group && group !== lastGroup ? html`<div class="palette-group">${group}</div>` : '';
      lastGroup = group || lastGroup;
      const title = getLang() === 'mr' && it.title_mr ? `${it.title} · ${it.title_mr}` : it.title;
      return html`${head}<a class="palette-item" href="${it.link}" role="option" aria-selected="${i === sel}" data-i="${i}">
        <span class="pi-icon">${icon(TYPE_ICON[it.type] || 'arrow-right', 16)}</span>
        <span style="min-width:0"><div class="ellipsis strong">${title}</div>${it.sub ? html`<div class="small muted ellipsis">${it.sub}</div>` : ''}</span>
      </a>`;
    })}`);
  };

  const pages = () => {
    const q = input.value.trim().toLowerCase();
    return pagesProvider()
      .filter((p) => !q || p.title.toLowerCase().includes(q))
      .slice(0, 6)
      .map((p) => ({ type: 'page', title: p.title, link: p.href }));
  };

  const search = debounce(async () => {
    const q = input.value.trim();
    const mine = ++seq;
    let found = [];
    if (q.length >= 2) {
      try {
        found = (await api.get('/search', { q })).items || [];
      } catch {
        found = [];
      }
    }
    if (mine !== seq) return;
    items = [...found, ...pages()];
    sel = 0;
    draw();
  }, 200);

  input.addEventListener('input', search);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === 'Enter' && items[sel]) { e.preventDefault(); location.hash = items[sel].link.replace(/^#/, ''); close(); }
  });
  list.addEventListener('click', (e) => {
    if (e.target.closest('a')) close();
  });
  overlay.addEventListener('click', close);
  document.body.append(overlay, box);
  items = pages();
  draw();
  input.focus();
  $$('a', list);
}
