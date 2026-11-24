import { html, $, on } from '../dom.js';
import { t } from '../i18n.js';
import { downloadApiFile } from '../api.js';
import { todayISO } from '../format.js';
import { openModal } from './modal.js';
import { toastError } from './toast.js';

/** [first day, last day] of this month (offset 0) or an earlier one (-1 = last month), as YYYY-MM-DD. */
export function monthRange(offset) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  const p = (x) => String(x).padStart(2, '0');
  const first = `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`;
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return [first, `${last.getFullYear()}-${p(last.getMonth() + 1)}-${p(last.getDate())}`];
}

/** Download an Excel file from the API; the server names it. Errors become a toast. */
export async function downloadExcel(path, params = {}, button = null) {
  if (button) button.disabled = true;
  try {
    await downloadApiFile(path, params, 'export.xlsx');
  } catch (e) {
    toastError(e);
  } finally {
    if (button) button.disabled = false;
  }
}

/** Ask for a date range (this month, last month, or any dates), then download. */
export async function excelRangeDialog({ title, path }) {
  let [from, to] = [monthRange(0)[0], todayISO()];
  const ok = await openModal({
    title,
    body: html`<div class="stack">
      <div class="filter-chips">
        <button type="button" class="filter-chip" data-preset="this" aria-pressed="true">${t('reports.this_month')}</button>
        <button type="button" class="filter-chip" data-preset="last">${t('reports.last_month')}</button>
      </div>
      <div class="form-grid">
        <div class="field"><label for="xl-from">${t('common.from')}</label><input id="xl-from" class="input" type="date" value="${from}" max="${todayISO()}"></div>
        <div class="field"><label for="xl-to">${t('common.to')}</label><input id="xl-to" class="input" type="date" value="${to}" max="${todayISO()}"></div>
      </div>
    </div>`,
    actions: [
      { label: t('common.cancel'), kind: 'secondary', value: false },
      { label: t('exports.download'), kind: 'primary', value: true },
    ],
    onOpen(root) {
      on(root, 'click', '[data-preset]', (e, b) => {
        [from, to] = b.dataset.preset === 'last' ? monthRange(-1) : [monthRange(0)[0], todayISO()];
        $('#xl-from', root).value = from;
        $('#xl-to', root).value = to;
        root.querySelectorAll('[data-preset]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      });
      on(root, 'change', 'input[type=date]', () => {
        from = $('#xl-from', root).value || from;
        to = $('#xl-to', root).value || to;
        root.querySelectorAll('[data-preset]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      });
    },
  });
  if (ok) await downloadExcel(path, { from, to });
}
