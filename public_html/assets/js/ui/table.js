import { html, raw } from '../dom.js';
import { t } from '../i18n.js';
import { icon } from './icons.js';

/**
 * Data table markup. On narrow containers it turns into cards (CSS container query).
 *
 * columns: [{ key, label, render?(row) → Html|string, num?, primary?, sort?: 'key', cls?, hideSm? }]
 * rows: data rows; rowHref(row) → '#/...' makes rows clickable
 * sort: { key, dir } current sort for the header indicator
 */
export function dataTable({ columns, rows, rowHref, empty, sort, foot, cls = '' }) {
  if (!rows.length && empty) return empty;
  return html`
    <div class="table-wrap">
      <table class="table responsive ${cls}">
        <thead><tr>
          ${columns.map((c) => {
            const sorted = sort && c.sort && sort.key === c.sort;
            const ind = c.sort ? html`<span class="sort-ind">${sorted ? (sort.dir === 'desc' ? '↓' : '↑') : '↕'}</span>` : '';
            return html`<th class="${c.num ? 'num' : ''} ${c.sort ? 'sortable' : ''} ${sorted ? 'sorted' : ''}" ${c.sort ? raw(`data-sort="${c.sort}" tabindex="0" aria-sort="${sorted ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}"`) : ''}>${c.label}${ind}</th>`;
          })}
        </tr></thead>
        <tbody>
          ${rows.map((r) => {
            const href = rowHref ? rowHref(r) : null;
            return html`<tr class="${href ? 'clickable' : ''}" ${href ? raw(`data-href="${href}"`) : ''}>
              ${columns.map((c) => {
                const v = c.render ? c.render(r) : r[c.key];
                return html`<td class="${c.num ? 'num' : ''} ${c.primary ? 'primary-cell' : ''} ${c.key === 'actions' ? 'actions' : ''} ${c.cls || ''}" data-label="${c.label}">${v ?? ''}</td>`;
              })}
            </tr>`;
          })}
        </tbody>
        ${foot ? html`<tfoot>${foot}</tfoot>` : ''}
      </table>
    </div>`;
}

/** Make rows with data-href navigate and headers with data-sort call onSort. */
export function bindTable(root, { onSort } = {}) {
  root.addEventListener('click', (e) => {
    if (e.target.closest('a, button, input, select, label')) return;
    const th = e.target.closest('th[data-sort]');
    if (th && onSort) return onSort(th.dataset.sort);
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href.replace(/^#/, '');
  });
  root.addEventListener('keydown', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th && onSort && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onSort(th.dataset.sort);
    }
  });
}

/** Pagination bar. */
export function pager(total, page, perPage) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (total <= perPage) return '';
  const from = (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  return html`<div class="pager">
    <span>${t('common.showing', { from, to, total })}</span>
    <span class="spacer"></span>
    <button class="btn btn-secondary btn-sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="${t('common.previous')}">${icon('chevron-left', 16)}</button>
    <span>${page} / ${pages}</span>
    <button class="btn btn-secondary btn-sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="${t('common.next')}">${icon('chevron-right', 16)}</button>
  </div>`;
}

export function emptyState({ ic = 'inbox', title, text, action }) {
  return html`<div class="empty">
    <div class="empty-art">${icon(ic, 32)}</div>
    <h3>${title}</h3>
    ${text ? html`<p>${text}</p>` : ''}
    ${action || ''}
  </div>`;
}

export function skeletonRows(n = 6) {
  return html`<div class="stack" style="padding:16px">${Array.from({ length: n }, () => html`<div class="skeleton" style="height:36px"></div>`)}</div>`;
}

/** Status chip with a colour per status. */
const STATUS_TONE = {
  pending: '', estimate_sent: 'info', approved: 'primary', in_progress: 'warning', waiting_parts: 'danger', ready: 'success', delivered: '', cancelled: '',
  requested: 'info', needs_approval: 'warning', issued: 'success', unavailable: 'danger', rejected: 'danger', open: 'info', closed: '',
  draft: '', sent: 'info', superseded: '', final: 'success', paid: 'success', partial: 'warning', unpaid: 'danger',
};
export function statusChip(status, label) {
  return html`<span class="chip ${STATUS_TONE[status] ?? ''}">${label || t('status.' + status)}</span>`;
}
