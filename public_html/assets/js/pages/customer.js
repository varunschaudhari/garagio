import { html, setHTML, $, on } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { hasRole } from '../store.js';
import { icon } from '../ui/icons.js';
import { money, date } from '../format.js';
import { dataTable, statusChip, emptyState, skeletonRows } from '../ui/table.js';
import { busy, field } from '../ui/form.js';
import { openDrawer } from '../ui/drawer.js';
import { toast, toastError } from '../ui/toast.js';
import { openCustomerForm, openVehicleForm } from './customers.js';

export default async function customerPage(ctx) {
  const id = Number(ctx.params.id);
  setHTML(ctx.el, skeletonRows(5));
  let c;

  const draw = async () => {
    c = (await api.get('/customers/' + id)).item;
    if (!ctx.alive()) return;
    ctx.setTitle(c.name);
    const owner = hasRole('owner');
    const wa = 'https://wa.me/91' + c.phone;
    setHTML(ctx.el, html`
      <div class="page-head">
        <div style="flex:1;min-width:240px">
          <a href="#/customers" class="small muted">${icon('arrow-left', 14)} ${t('customers.title')}</a>
          <h1 style="margin-top:6px">${c.name}</h1>
          <div class="sub"><a href="tel:${c.phone}">${c.phone}</a>${c.alt_phone ? ' · ' + c.alt_phone : ''} · ${c.language === 'mr' ? 'मराठी' : 'English'}${c.gstin ? ' · ' + c.gstin : ''}</div>
        </div>
        <a class="btn btn-secondary" href="${wa}" target="_blank" rel="noopener">${icon('message-circle')}WhatsApp</a>
        <button class="btn btn-secondary" data-act="edit">${icon('pencil')}${t('common.edit')}</button>
        <a class="btn btn-primary" href="#/jobs/new?customer=${c.id}">${icon('plus')}${t('jobs.new')}</a>
      </div>
      <div class="grid-2" style="align-items:start;margin-bottom:20px">
        <div class="card kpi">
          <div class="kpi-label"><span class="kpi-icon ${c.balance > 0 ? 'danger' : 'success'}">${icon('indian-rupee', 18)}</span>${t('customers.balance')}</div>
          <div class="kpi-value">${money(c.balance)}</div>
          ${c.address ? html`<div class="kpi-sub">${c.address}</div>` : ''}
        </div>
        <form class="card card-pad stack" id="credit-form">
          <div class="row"><span class="kpi-icon ${c.is_trusted ? 'success' : ''}">${icon('shield-check', 18)}</span><strong>${t('customers.credit')}</strong></div>
          <label class="switch"><input type="checkbox" name="is_trusted" ${c.is_trusted ? 'checked' : ''} ${owner ? '' : 'disabled'}><span class="track"></span><span>${t('customers.trusted')}</span></label>
          <div class="field"><label for="cr-limit">${t('customers.credit_limit')}</label>
            <input id="cr-limit" class="input num" name="credit_limit" inputmode="decimal" value="${c.credit_limit}" ${owner ? '' : 'disabled'}></div>
          ${owner ? html`<div><button class="btn btn-secondary btn-sm" type="submit">${t('common.save')}</button></div>` : html`<p class="small muted">${t('customers.owner_only')}</p>`}
        </form>
      </div>
      <div class="card" style="margin-bottom:20px">
        <div class="card-head"><h3>${t('customers.bikes')}</h3><button class="btn btn-secondary btn-sm" data-act="add-bike">${icon('plus', 16)}${t('customers.add_bike')}</button></div>
        ${c.vehicles.length ? html`<div class="list">${c.vehicles.map((v) => html`
          <div class="list-item">
            <span class="kpi-icon">${icon('bike', 18)}</span>
            <div style="flex:1"><div><span class="plate">${v.reg_no}</span></div><div class="small muted">${[v.make, v.model, v.year].filter(Boolean).join(' · ')}${v.last_odometer ? ' · ' + v.last_odometer + ' km' : ''}${v.last_service_on ? ' · ' + date(v.last_service_on) : ''}</div></div>
            <button class="btn btn-ghost btn-sm" data-edit-bike="${v.id}">${icon('pencil', 16)}</button>
            <a class="btn btn-secondary btn-sm" href="#/jobs/new?customer=${c.id}&vehicle=${v.id}">${icon('plus', 16)}${t('jobs.job')}</a>
          </div>`)}</div>` : html`<div class="card-body muted">—</div>`}
      </div>
      <div class="card" style="margin-bottom:20px" id="ledger-card"></div>
      <div class="card">
        <div class="card-head"><h3>${t('customers.history')}</h3></div>
        ${dataTable({
          columns: [
            { key: 'job', label: t('jobs.job_no'), primary: true, render: (j) => html`<div class="t-title">${j.job_no}</div><div class="t-sub">${j.reg_no}</div>` },
            { key: 'date', label: t('jobs.opened'), render: (j) => date(j.created_at) },
            { key: 'status', label: t('common.status'), render: (j) => statusChip(j.status) },
            { key: 'bill', label: t('purchases.total'), num: true, render: (j) => (j.invoice_total ? money(j.invoice_total) : '—') },
          ],
          rows: c.jobs,
          rowHref: (j) => '#/jobs/' + j.id,
          empty: emptyState({ ic: 'clipboard-list', title: t('common.no_results') }),
        })}
      </div>`);
  };

  const drawLedger = async () => {
    const l = await api.get(`/customers/${id}/ledger`);
    if (!ctx.alive()) return;
    const box = $('#ledger-card', ctx.el);
    if (!box) return;
    const typeLabel = { opening: 'billing.entry_opening', invoice: 'billing.entry_invoice', payment: 'billing.entry_payment', return: 'billing.entry_return', refund: 'billing.entry_refund' };
    setHTML(box, html`<div class="card-head"><h3>${t('billing.ledger')}</h3><button class="btn btn-primary btn-sm" data-act="pay">${icon('hand-coins', 16)}${t('billing.record_payment')}</button></div>
      ${dataTable({
        columns: [
          { key: 'date', label: t('common.date'), render: (e) => date(e.date) },
          { key: 'type', label: t('common.type'), primary: true, render: (e) => html`<div class="t-title">${t(typeLabel[e.type])}</div>${e.mode ? html`<div class="t-sub">${t('pay.' + e.mode)}</div>` : ''}` },
          { key: 'ref', label: t('common.reference'), render: (e) => (['invoice', 'return', 'refund'].includes(e.type) && e.ref_id ? html`<a href="#/invoices/${e.ref_id}">${e.ref}</a>` : e.ref || '—') },
          { key: 'debit', label: t('billing.debit'), num: true, render: (e) => (e.debit ? money(e.debit) : '') },
          { key: 'credit', label: t('billing.credit'), num: true, render: (e) => (e.credit ? money(e.credit) : '') },
          { key: 'balance', label: t('common.balance'), num: true, render: (e) => html`<span class="strong">${money(e.balance)}</span>` },
        ],
        rows: l.items,
        empty: emptyState({ ic: 'receipt', title: t('common.no_results') }),
      })}`);
    box.dataset.open = JSON.stringify(l.open_invoices);
  };

  const redraw = async () => {
    await draw();
    await drawLedger();
  };
  await redraw();
  on(ctx.el, 'click', '[data-act="pay"]', async () => {
    const open = JSON.parse($('#ledger-card', ctx.el).dataset.open || '[]');
    const res = await openDrawer({
      title: `${t('billing.record_payment')} · ${c.name}`,
      body: html`<div class="stack">
        <div class="banner ${c.balance > 0 ? 'warning' : ''}">${t('customers.balance')}: <strong>${money(c.balance)}</strong></div>
        ${field({ name: 'amount', label: t('common.amount') + ' (₹)', type: 'number', required: true, value: c.balance > 0 ? c.balance : '' })}
        ${field({ name: 'mode', label: t('suppliers.mode'), type: 'select', value: 'cash', options: ['cash', 'upi', 'card', 'bank'].map((m) => ({ value: m, label: t('pay.' + m) })) })}
        ${field({ name: 'invoice_id', label: t('billing.open_invoices'), type: 'select', dtype: 'int', options: [{ value: '', label: '—' }, ...open.map((o) => ({ value: o.id, label: `${o.invoice_no} · ${money(o.balance)}` }))] })}
        ${field({ name: 'reference', label: t('billing.reference') })}
      </div>`,
      onSubmit: (d) => api.post(`/customers/${id}/payments`, d),
    });
    if (res) {
      toast(t('billing.payment_saved') + (res.allocations.length ? ' · ' + t('billing.allocated', { n: res.allocations.length }) : '') + (res.unallocated > 0 ? ' · ' + t('billing.advance', { amount: money(res.unallocated) }) : ''));
      await redraw();
    }
  });
  on(ctx.el, 'click', '[data-act="edit"]', async () => { if (await openCustomerForm(c)) redraw(); });
  on(ctx.el, 'click', '[data-act="add-bike"]', async () => { if (await openVehicleForm(id)) redraw(); });
  on(ctx.el, 'click', '[data-edit-bike]', async (e, b) => {
    const v = c.vehicles.find((x) => x.id === Number(b.dataset.editBike));
    if (await openVehicleForm(id, v)) redraw();
  });
  on(ctx.el, 'submit', '#credit-form', async (e, form) => {
    e.preventDefault();
    await busy($('button[type=submit]', form), async () => {
      try {
        await api.put(`/customers/${id}/credit`, { is_trusted: form.is_trusted.checked, credit_limit: form.credit_limit.value || 0 });
        toast(t('customers.credit_saved'));
        redraw();
      } catch (err) {
        toastError(err);
      }
    });
  });
}
