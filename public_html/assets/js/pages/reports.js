import { html, setHTML, $, on } from '../dom.js';
import { t } from '../i18n.js';
import { api, downloadApiFile } from '../api.js';
import { hasRole, can } from '../store.js';
import { icon } from '../ui/icons.js';
import { money, qty, date, todayISO } from '../format.js';
import { skeletonRows, emptyState } from '../ui/table.js';
import { toastError } from '../ui/toast.js';

const ALL = ['sales', 'purchases', 'stock', 'profit', 'dues', 'payables', 'gst', 'mechanics'];
/** Reports that are a snapshot "as of now" rather than a date range. */
const NO_RANGE = ['stock', 'dues', 'payables'];
const TEXT_COLS = new Set(['date', 'invoice_no', 'type', 'customer', 'gstin', 'bill_no', 'supplier', 'mode', 'part_no', 'name', 'category', 'location', 'rack', 'unit', 'month', 'phone', 'last_bill', 'last_payment', 'mechanic']);
const QTY_COLS = new Set(['stock', 'jobs', 'rate']);

function monthRange(offset) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  const p = (x) => String(x).padStart(2, '0');
  const first = `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`;
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return [first, `${last.getFullYear()}-${p(last.getMonth() + 1)}-${p(last.getDate())}`];
}

function cell(key, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (key === 'date' || key === 'last_bill' || key === 'last_payment') return date(v);
  if (key === 'type') return t(v === 'job' ? 'billing.job_bill' : 'billing.counter');
  if (key === 'mode') return t('pay.' + v);
  if (key === 'rate') return qty(v) + '%';
  if (QTY_COLS.has(key)) return qty(v);
  if (TEXT_COLS.has(key)) return String(v);
  return money(v);
}

export default async function reports(ctx) {
  ctx.setTitle(t('reports.title'));
  // Each report needs the permission for its data (see the API).
  const NEEDS = { sales: 'see_money', profit: 'see_money', dues: 'see_money', gst: 'see_money', mechanics: 'see_money', stock: 'see_costs', purchases: 'purchases', payables: 'purchases' };
  const tabs = ALL.filter((k) => can(NEEDS[k]));
  let tab = tabs.includes(ctx.query.tab) ? ctx.query.tab : tabs[0];
  let [from, to] = [ctx.query.from || monthRange(0)[0], ctx.query.to || todayISO()];

  setHTML(ctx.el, html`
    <div class="page-head"><h1>${t('reports.title')}</h1></div>
    <div class="tabs" role="tablist">${tabs.map((k) => html`<button role="tab" data-tab="${k}" aria-selected="${k === tab}">${t('reports.' + k)}</button>`)}</div>
    <div class="card">
      <div class="toolbar" id="r-tools"></div>
      <div id="r-body">${skeletonRows(5)}</div>
    </div>`);
  const tools = $('#r-tools', ctx.el);
  const body = $('#r-body', ctx.el);

  const drawTools = () => {
    const range = !NO_RANGE.includes(tab);
    setHTML(tools, html`
      ${range ? html`
        <input class="input" type="date" name="from" value="${from}" style="width:auto" aria-label="${t('common.from')}">
        <input class="input" type="date" name="to" value="${to}" style="width:auto" aria-label="${t('common.to')}">
        <div class="filter-chips">
          <button class="filter-chip" data-preset="today">${t('reports.today')}</button>
          <button class="filter-chip" data-preset="this">${t('reports.this_month')}</button>
          <button class="filter-chip" data-preset="last">${t('reports.last_month')}</button>
        </div>` : html`<span class="muted">${date(todayISO())}</span>`}
      <span class="spacer"></span>
      <button class="btn btn-secondary" data-act="csv">${icon('download')}${t('reports.export')}</button>`);
  };

  const load = async () => {
    history.replaceState(null, '', `#/reports?tab=${tab}&from=${from}&to=${to}`);
    setHTML(body, skeletonRows(5));
    let r;
    try {
      r = await api.get('/reports/' + tab, { from, to });
    } catch (e) {
      toastError(e);
      return;
    }
    if (!ctx.alive()) return;
    const cols = r.columns;
    const summary = tab === 'profit' && r.summary ? html`
      <div class="kpis" style="padding:16px">
        ${[['sales', 'col.sales'], ['parts_cost', 'col.parts_cost'], ['mechanic_payments', 'col.mechanic_payments'], ['profit', 'col.profit']].map(([k, label]) => html`
          <div class="card kpi"><div class="kpi-label">${t('reports.' + label)}</div><div class="kpi-value" style="${k === 'profit' ? `color:${r.summary.profit < 0 ? 'var(--danger-text)' : 'var(--success-text)'}` : ''}">${money(r.summary[k])}</div></div>`)}
      </div>
      <div class="banner" style="margin:0 16px 16px">${icon('info')}<span>${t('reports.profit_formula')}</span></div>` : '';
    const note = tab === 'gst' ? html`<div class="banner warning" style="margin:16px">${icon('info')}<span>${t('reports.gst_note')}</span></div>` : '';
    setHTML(body, html`${summary}${note}${r.rows.length ? html`
      <div class="table-wrap" style="max-height:65vh"><table class="table">
        <thead><tr>${cols.map((k) => html`<th class="${TEXT_COLS.has(k) ? '' : 'num'}">${t('reports.col.' + k)}</th>`)}</tr></thead>
        <tbody>${r.rows.map((row) => html`<tr>${cols.map((k) => {
          const v = cell(k, row[k]);
          if (k === 'invoice_no' && row.invoice_no) return html`<td>${v}</td>`;
          if (k === 'customer' && row.customer_id) return html`<td><a href="#/customers/${row.customer_id}">${v}</a></td>`;
          if (k === 'supplier' && row.supplier_id) return html`<td><a href="#/suppliers/${row.supplier_id}">${v}</a></td>`;
          return html`<td class="${TEXT_COLS.has(k) ? '' : 'num'}">${v}</td>`;
        })}</tr>`)}</tbody>
        ${r.totals && Object.keys(r.totals).length && tab !== 'profit' ? html`<tfoot><tr>${cols.map((k, i) => html`<td class="${TEXT_COLS.has(k) ? '' : 'num'}">${i === 0 ? t('common.total') : r.totals[k] !== undefined ? cell(k, r.totals[k]) : ''}</td>`)}</tr></tfoot>` : ''}
      </table></div>` : emptyState({ ic: 'chart-column', title: t('common.no_results') })}`);
  };

  on(ctx.el, 'click', '[data-tab]', (e, b) => {
    tab = b.dataset.tab;
    ctx.el.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    drawTools();
    load();
  });
  on(tools, 'change', 'input[type=date]', (e, inp) => {
    if (inp.name === 'from') from = inp.value;
    else to = inp.value;
    load();
  });
  on(tools, 'click', '[data-preset]', (e, b) => {
    const p = b.dataset.preset;
    [from, to] = p === 'today' ? [todayISO(), todayISO()] : p === 'last' ? monthRange(-1) : [monthRange(0)[0], todayISO()];
    drawTools();
    load();
  });
  on(tools, 'click', '[data-act="csv"]', () => downloadApiFile('/reports/' + tab, { from, to, format: 'csv' }, `${tab}.csv`).catch(toastError));

  drawTools();
  await load();
}
