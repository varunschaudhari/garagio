import { html, setHTML, $, on } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../ui/icons.js';
import { money, date, todayISO } from '../format.js';
import { dataTable, emptyState, skeletonRows } from '../ui/table.js';
import { field } from '../ui/form.js';
import { openDrawer } from '../ui/drawer.js';
import { toast } from '../ui/toast.js';
import { openSupplierForm } from './suppliers.js';

const PAY_MODES = ['cash', 'upi', 'bank', 'card'];

/** Record a supplier payment (optionally against one bill). Resolves with the updated supplier. */
export function openSupplierPayment(supplier, { purchaseId = null, amount = null } = {}) {
  return openDrawer({
    title: t('suppliers.record_payment') + ' · ' + supplier.name,
    body: html`<div class="stack">
      <div class="banner ${supplier.balance > 0 ? 'warning' : ''}">${icon('indian-rupee')}<span>${t('suppliers.balance')}: <strong>${money(supplier.balance)}</strong></span></div>
      ${field({ name: 'amount', label: t('suppliers.amount') + ' (₹)', type: 'number', required: true, value: amount ?? (supplier.balance > 0 ? supplier.balance : '') })}
      ${field({ name: 'mode', label: t('suppliers.mode'), type: 'select', value: 'upi', options: PAY_MODES.map((m) => ({ value: m, label: t('pay.' + m) })) })}
      ${field({ name: 'reference', label: t('suppliers.reference'), placeholder: 'UTR / cheque no.' })}
      ${field({ name: 'paid_on', label: t('suppliers.paid_on'), type: 'date', value: todayISO() })}
      ${field({ name: 'note', label: t('common.note') })}
      ${purchaseId ? html`<input type="hidden" name="purchase_id" data-type="int" value="${purchaseId}">` : ''}
      <p class="small muted">${t('suppliers.advance_note')}</p>
    </div>`,
    onSubmit: async (d) => {
      const res = await api.post(`/suppliers/${supplier.id}/payments`, d);
      toast(t('suppliers.payment_saved'));
      return res.item;
    },
  });
}

const TYPE_LABEL = { opening: 'suppliers.entry_opening', bill: 'suppliers.entry_bill', payment: 'suppliers.entry_payment' };

export default async function supplierPage(ctx) {
  const id = Number(ctx.params.id);
  let range = { from: ctx.query.from || '', to: ctx.query.to || '' };
  setHTML(ctx.el, skeletonRows(5));

  const draw = async () => {
    const data = await api.get(`/suppliers/${id}/ledger`, range);
    if (!ctx.alive()) return;
    const s = data.supplier;
    ctx.setTitle(s.name);
    setHTML(ctx.el, html`
      <div class="page-head">
        <div style="flex:1;min-width:240px">
          <a href="#/suppliers" class="small muted">${icon('arrow-left', 14)} ${t('suppliers.title')}</a>
          <h1 style="margin-top:6px">${s.name} ${!s.active ? html`<span class="chip">${t('common.inactive')}</span>` : ''}</h1>
          <div class="sub">
            ${s.contact_person ? s.contact_person + ' · ' : ''}${s.phone ? html`<a href="tel:${s.phone}">${s.phone}</a> · ` : ''}${s.gstin || ''}${s.gstin ? ' · ' : ''}${s.state_code} ${s.state_name}
            ${s.state_code !== '27' ? html` <span class="chip info">${t('suppliers.interstate')}</span>` : ''}
          </div>
        </div>
        <button class="btn btn-secondary" data-act="edit">${icon('pencil')}${t('common.edit')}</button>
        <a class="btn btn-secondary" href="#/purchases/new?supplier=${s.id}">${icon('truck')}${t('suppliers.new_purchase')}</a>
        <button class="btn btn-primary" data-act="pay">${icon('hand-coins')}${t('suppliers.record_payment')}</button>
      </div>
      <div class="kpis" style="margin-bottom:20px">
        <div class="card kpi">
          <div class="kpi-label"><span class="kpi-icon ${s.balance > 0 ? 'danger' : 'success'}">${icon('indian-rupee', 18)}</span>${t('suppliers.balance')}</div>
          <div class="kpi-value">${money(s.balance)}</div>
          ${s.address ? html`<div class="kpi-sub">${s.address}</div>` : ''}
        </div>
      </div>
      <div class="card">
        <div class="card-head">
          <h3>${t('suppliers.ledger')}</h3>
          <input class="input" type="date" name="from" value="${range.from}" aria-label="${t('common.from')}" style="width:auto">
          <input class="input" type="date" name="to" value="${range.to}" aria-label="${t('common.to')}" style="width:auto">
        </div>
        ${range.from ? html`<div class="pager" style="border-top:0;border-bottom:1px solid var(--border)">${t('suppliers.brought_forward')}: <strong>${money(data.brought_forward)}</strong></div>` : ''}
        ${dataTable({
          columns: [
            { key: 'date', label: t('common.date'), render: (e) => html`<span class="nowrap">${date(e.date)}</span>` },
            { key: 'type', label: t('common.type'), primary: true, render: (e) => html`<div class="t-title">${t(TYPE_LABEL[e.type])}</div>${e.mode && e.type === 'payment' ? html`<div class="t-sub">${t('pay.' + e.mode)}${e.note ? ' · ' + e.note : ''}</div>` : e.mode === 'credit' ? html`<div class="t-sub">${t('pay.credit')}</div>` : ''}` },
            { key: 'ref', label: t('common.reference'), render: (e) => (e.ref_id && e.type === 'bill' ? html`<a href="#/purchases/${e.ref_id}">${e.ref}</a>` : e.ref || '—') },
            { key: 'bill', label: t('suppliers.bill'), num: true, render: (e) => (e.bill ? money(e.bill) : '') },
            { key: 'paid', label: t('suppliers.paid'), num: true, render: (e) => (e.paid ? money(e.paid) : '') },
            { key: 'balance', label: t('common.balance'), num: true, render: (e) => html`<span class="strong">${money(e.balance)}</span>` },
          ],
          rows: data.items,
          empty: emptyState({ ic: 'history', title: t('common.no_results') }),
        })}
      </div>`);
    return s;
  };

  let supplier = await draw();
  on(ctx.el, 'change', 'input[name=from], input[name=to]', async (e, inp) => {
    range = { ...range, [inp.name]: inp.value };
    history.replaceState(null, '', `#/suppliers/${id}?from=${range.from}&to=${range.to}`);
    supplier = await draw();
  });
  on(ctx.el, 'click', '[data-act="edit"]', async () => {
    if (await openSupplierForm(supplier)) supplier = await draw();
  });
  on(ctx.el, 'click', '[data-act="pay"]', async () => {
    if (await openSupplierPayment(supplier)) supplier = await draw();
  });
}
