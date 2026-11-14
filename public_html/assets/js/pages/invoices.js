import { html, setHTML, $, on, debounce, replaceQuery } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../ui/icons.js';
import { money, date } from '../format.js';
import { dataTable, bindTable, pager, emptyState, skeletonRows } from '../ui/table.js';
import { toastError } from '../ui/toast.js';

const PER_PAGE = 50;

export function billChips(inv) {
  if (inv.status === 'draft') return html`<span class="chip">${t('billing.draft')}</span>`;
  if (inv.status === 'cancelled') return html`<span class="chip danger">${t('billing.cancelled')}</span>`;
  const tone = { paid: 'success', partial: 'warning', unpaid: 'danger' }[inv.pay_status];
  return html`<span class="chip ${tone}">${t('billing.' + inv.pay_status)}</span>`;
}

export default async function invoices(ctx) {
  ctx.setTitle(t('billing.invoices'));
  const q = ctx.query;
  const st = { q: q.q || '', status: q.status || '', pay_status: q.pay_status || '', type: q.type || '', from: q.from || '', to: q.to || '', page: Number(q.page || 1) };

  setHTML(ctx.el, html`
    <div class="page-head">
      <div style="flex:1"><h1>${t('billing.invoices')}</h1><div class="sub" id="inv-sum"></div></div>
      <a class="btn btn-primary" href="#/invoices/counter">${icon('shopping-cart')}${t('billing.new_counter')}</a>
    </div>
    <div class="card">
      <div class="toolbar">
        <div class="input-group">${icon('search')}<input class="input" type="search" name="q" value="${st.q}" placeholder="${t('customers.search_placeholder')}" aria-label="${t('common.search')}"></div>
        <select class="select" name="status" style="width:auto" aria-label="${t('common.status')}">
          <option value="">${t('billing.all_status')}</option>
          ${['draft', 'final', 'cancelled'].map((s) => html`<option value="${s}" ${s === st.status ? 'selected' : ''}>${t('billing.' + s)}</option>`)}
        </select>
        <select class="select" name="pay_status" style="width:auto" aria-label="${t('billing.payment')}">
          <option value="">${t('billing.all_pay')}</option>
          ${['unpaid', 'partial', 'paid'].map((s) => html`<option value="${s}" ${s === st.pay_status ? 'selected' : ''}>${t('billing.' + s)}</option>`)}
        </select>
        <input class="input" type="date" name="from" value="${st.from}" style="width:auto" aria-label="${t('common.from')}">
        <input class="input" type="date" name="to" value="${st.to}" style="width:auto" aria-label="${t('common.to')}">
      </div>
      <div id="inv-list">${skeletonRows()}</div>
    </div>`);
  const list = $('#inv-list', ctx.el);

  const load = async () => {
    replaceQuery({ ...st, page: st.page > 1 ? st.page : '' });
    let data;
    try {
      data = await api.get('/invoices', { ...st, per_page: PER_PAGE });
    } catch (e) {
      toastError(e);
      return;
    }
    if (!ctx.alive()) return;
    $('#inv-sum', ctx.el).textContent = data.total ? `${t('billing.sum')}: ${money(data.sum_total)} · ${t('billing.sum_due')}: ${money(data.sum_due)}` : '';
    setHTML(list, html`${dataTable({
      columns: [
        { key: 'no', label: t('inv.invoice_no'), primary: true, render: (i) => html`<div class="t-title">${i.invoice_no || t('billing.draft') + ' #' + i.id}</div><div class="t-sub">${i.inv_type === 'job' ? `${i.job_no} · ${i.reg_no}` : t('billing.counter')}</div>` },
        { key: 'date', label: t('common.date'), render: (i) => date(i.invoice_date || i.created_at) },
        { key: 'customer', label: t('billing.customer'), render: (i) => html`${i.customer_name || t('billing.walk_in')}<div class="t-sub">${i.customer_phone || ''}</div>` },
        { key: 'status', label: t('common.status'), render: billChips },
        { key: 'total', label: t('common.total'), num: true, render: (i) => html`<span class="strong">${money(i.grand_total)}</span>${i.status === 'final' && i.balance > 0 ? html`<div class="t-sub badge-low">${t('billing.due')} ${money(i.balance)}</div>` : ''}` },
      ],
      rows: data.items,
      rowHref: (i) => '#/invoices/' + i.id,
      empty: emptyState({ ic: 'receipt', title: t('billing.empty_title'), text: t('billing.empty_text') }),
    })}${pager(data.total, st.page, PER_PAGE)}`);
  };

  bindTable(list);
  on(list, 'click', '[data-page]', (e, b) => { st.page = Number(b.dataset.page); load(); });
  on(ctx.el, 'input', 'input[name=q]', debounce((e) => { st.q = e.target.value.trim(); st.page = 1; load(); }, 250));
  on(ctx.el, 'change', 'select[name], input[type=date]', (e, c) => { st[c.name] = c.value; st.page = 1; load(); });
  await load();
}
