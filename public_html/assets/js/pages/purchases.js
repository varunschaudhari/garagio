import { html, setHTML, $, on, debounce, replaceQuery } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../ui/icons.js';
import { money, date } from '../format.js';
import { dataTable, bindTable, pager, emptyState, skeletonRows } from '../ui/table.js';
import { toastError } from '../ui/toast.js';

const PER_PAGE = 50;

export function modeChip(mode) {
  return html`<span class="chip ${mode === 'credit' ? 'warning' : 'success'}">${t('pay.' + mode)}</span>`;
}

export default async function purchases(ctx) {
  ctx.setTitle(t('purchases.title'));
  const q = ctx.query;
  const st = { q: q.q || '', supplier: q.supplier || '', mode: q.mode || '', from: q.from || '', to: q.to || '', page: Number(q.page || 1) };
  const sups = (await api.get('/suppliers', { all: 1, per_page: 500 })).items;
  if (!ctx.alive()) return;

  setHTML(ctx.el, html`
    <div class="page-head">
      <div style="flex:1"><h1>${t('purchases.title')}</h1><div class="sub" id="pur-sum"></div></div>
      <a class="btn btn-secondary" href="#/suppliers">${icon('store')}${t('nav.suppliers')}</a>
      <a class="btn btn-primary" href="#/purchases/new">${icon('plus')}${t('purchases.new')}</a>
    </div>
    <div class="card">
      <div class="toolbar">
        <div class="input-group">${icon('search')}<input class="input" type="search" name="q" value="${st.q}" placeholder="${t('purchases.bill_no')} / ${t('purchases.supplier')}" aria-label="${t('common.search')}"></div>
        <select class="select" name="supplier" style="width:auto" aria-label="${t('purchases.supplier')}">
          <option value="">${t('purchases.all_suppliers')}</option>
          ${sups.map((s) => html`<option value="${s.id}" ${String(s.id) === st.supplier ? 'selected' : ''}>${s.name}</option>`)}
        </select>
        <select class="select" name="mode" style="width:auto" aria-label="${t('purchases.payment_mode')}">
          <option value="">${t('purchases.all_modes')}</option>
          ${['credit', 'cash', 'upi', 'bank'].map((m) => html`<option value="${m}" ${m === st.mode ? 'selected' : ''}>${t('pay.' + m)}</option>`)}
        </select>
        <input class="input" type="date" name="from" value="${st.from}" style="width:auto" aria-label="${t('common.from')}">
        <input class="input" type="date" name="to" value="${st.to}" style="width:auto" aria-label="${t('common.to')}">
      </div>
      <div id="pur-list">${skeletonRows()}</div>
    </div>`);
  const list = $('#pur-list', ctx.el);

  const load = async () => {
    replaceQuery({ ...st, page: st.page > 1 ? st.page : '' });
    let data;
    try {
      data = await api.get('/purchases', { ...st, per_page: PER_PAGE });
    } catch (e) {
      toastError(e);
      return;
    }
    if (!ctx.alive()) return;
    $('#pur-sum', ctx.el).textContent = data.total ? `${t('purchases.sum')}: ${money(data.sum_total)}` : '';
    setHTML(list, html`${dataTable({
      columns: [
        { key: 'date', label: t('purchases.bill_date'), render: (p) => html`<span class="nowrap">${date(p.bill_date)}</span>` },
        { key: 'bill', label: t('purchases.bill_no'), primary: true, render: (p) => html`<div class="t-title">${p.bill_no}</div><div class="t-sub">${p.supplier_name}</div>` },
        { key: 'lines', label: t('purchases.line_count'), num: true, render: (p) => p.line_count },
        { key: 'mode', label: t('purchases.payment_mode'), render: (p) => modeChip(p.payment_mode) },
        { key: 'total', label: t('purchases.total'), num: true, render: (p) => html`<span class="strong">${money(p.total)}</span>` },
      ],
      rows: data.items,
      rowHref: (p) => '#/purchases/' + p.id,
      empty: emptyState({ ic: 'truck', title: t('purchases.empty_title'), text: t('purchases.empty_text'), action: html`<a class="btn btn-primary" href="#/purchases/new">${icon('plus')}${t('purchases.new')}</a>` }),
    })}${pager(data.total, st.page, PER_PAGE)}`);
  };

  bindTable(list);
  on(list, 'click', '[data-page]', (e, b) => { st.page = Number(b.dataset.page); load(); });
  on(ctx.el, 'input', 'input[name=q]', debounce((e) => { st.q = e.target.value.trim(); st.page = 1; load(); }, 250));
  on(ctx.el, 'change', 'select[name], input[type=date]', (e, c) => { st[c.name] = c.value; st.page = 1; load(); });
  await load();
}
