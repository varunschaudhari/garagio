import { html, setHTML, on, $ } from '../dom.js';
import { t, nm } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../ui/icons.js';
import { money, qty, date, datetime } from '../format.js';
import { dataTable, skeletonRows } from '../ui/table.js';
import { modeChip } from './purchases.js';
import { promptDialog } from '../ui/modal.js';
import { toast, toastError } from '../ui/toast.js';
import { openSupplierPayment } from './supplier.js';
import { billPhotoCard } from '../ui/bill-photo.js';

export default async function purchasePage(ctx) {
  const id = Number(ctx.params.id);
  setHTML(ctx.el, skeletonRows(5));

  const draw = async () => {
    const p = (await api.get('/purchases/' + id)).item;
    if (!ctx.alive()) return null;
    ctx.setTitle(`${t('purchases.bill')} ${p.bill_no}`);
    const cancelled = p.status === 'cancelled';
    const due = cancelled ? 0 : Math.max(0, Math.round((p.total - p.paid) * 100) / 100);
    const inter = Number(p.is_interstate) === 1;
    const line = (label, value, strong = false) => html`<dt>${label}</dt><dd class="num ${strong ? 'strong' : ''}">${value}</dd>`;
    setHTML(ctx.el, html`
      <div class="page-head">
        <div style="flex:1;min-width:240px">
          <a href="#/purchases" class="small muted">${icon('arrow-left', 14)} ${t('purchases.title')}</a>
          <h1 style="margin-top:6px">${t('purchases.bill')} ${p.bill_no} ${cancelled ? html`<span class="chip danger">${t('purchases.cancelled')}</span>` : modeChip(p.payment_mode)}</h1>
          <div class="sub"><a href="#/suppliers/${p.supplier_id}">${p.supplier_name}</a> · ${date(p.bill_date)}${p.supplier_gstin ? ' · ' + p.supplier_gstin : ''}</div>
          ${p.supplier_contact || p.supplier_phone ? html`<div class="small muted">${t('purchases.contact')}: ${p.supplier_contact || ''}${p.supplier_contact && p.supplier_phone ? ' · ' : ''}${p.supplier_phone ? html`<a href="tel:${p.supplier_phone}">${p.supplier_phone}</a>` : ''}</div>` : ''}
          <div class="small muted">${t(p.price_mode === 'mrp' ? 'purchases.mode_mrp_short' : 'purchases.mode_net_short')}</div>
        </div>
        ${cancelled ? '' : html`<button class="btn btn-ghost" data-act="cancel">${icon('ban')}${t('purchases.cancel')}</button>
          <a class="btn btn-secondary" href="#/purchases/new?replace=${p.id}">${icon('pencil')}${t('purchases.correct')}</a>`}
        ${due > 0 ? html`<button class="btn btn-primary" data-act="pay">${icon('hand-coins')}${t('suppliers.record_payment')}</button>` : ''}
      </div>
      ${cancelled ? html`<div class="banner danger" style="margin-bottom:16px">${icon('ban')}<span>${t('purchases.cancelled_by', { date: datetime(p.cancelled_at), name: p.cancelled_by_name || '—', reason: p.cancel_reason || '' })}${p.replaced_by_bill ? html` · <a href="#/purchases/${p.replaced_by_bill.id}">${t('purchases.replaced_by', { bill: p.replaced_by_bill.bill_no })}</a>` : ''}</span></div>` : ''}
      ${p.replaces_bill ? html`<div class="banner info" style="margin-bottom:16px">${icon('info')}<span><a href="#/purchases/${p.replaces_bill.id}">${t('purchases.replaces', { bill: p.replaces_bill.bill_no })}</a></span></div>` : ''}
      <div class="card" style="margin-bottom:20px">
        ${dataTable({
          columns: [
            { key: 'part', label: t('purchases.part'), primary: true, render: (i) => html`<a class="t-title" href="#/parts/${i.part_id}">${nm(i)}</a><div class="t-sub">${i.part_no}${i.hsn ? ' · HSN ' + i.hsn : ''}</div>` },
            { key: 'qty', label: t('purchases.qty'), num: true, render: (i) => `${qty(i.qty)} ${i.unit}` },
            { key: 'mrp', label: t('purchases.mrp'), num: true, render: (i) => (Number(i.mrp) ? money(i.mrp) : '—') },
            { key: 'price', label: t(p.price_mode === 'mrp' ? 'purchases.rate_incl' : 'purchases.rate_excl'), num: true, render: (i) => money(i.price) },
            { key: 'disc', label: t('purchases.disc'), num: true, render: (i) => qty(i.disc_pct) },
            { key: 'net', label: t('purchases.net_cost'), num: true, render: (i) => money(i.net_cost) },
            { key: 'gst', label: t('purchases.gst'), num: true, render: (i) => qty(i.gst_rate) + '%' },
            { key: 'taxable', label: t('purchases.taxable'), num: true, render: (i) => money(i.taxable) },
            { key: 'tax', label: t('purchases.tax'), num: true, render: (i) => money(i.tax_amount) },
            { key: 'total', label: t('purchases.total'), num: true, render: (i) => html`<span class="strong">${money(i.line_total)}</span>` },
          ],
          rows: p.items,
        })}
      </div>
      <div class="grid-2" style="align-items:start">
        <div class="card">
          <div class="card-head"><h3>${t('purchases.payments')}</h3></div>
          ${p.payments.length
            ? html`<div class="list">${p.payments.map((x) => html`<div class="list-item"><div style="flex:1"><div class="strong">${t('pay.' + x.mode)}${x.reference ? ' · ' + x.reference : ''}</div><div class="small muted">${date(x.paid_on)} · ${x.user_name || ''}</div></div><div class="num strong">${money(x.amount)}</div></div>`)}</div>`
            : html`<div class="card-body muted">—</div>`}
          ${p.notes ? html`<div class="card-body" style="border-top:1px solid var(--border)"><div class="small muted">${t('common.notes')}</div>${p.notes}</div>` : ''}
          <div class="card-body small muted" style="border-top:1px solid var(--border)">${t('purchases.entered_by')}: ${p.user_name || '—'} · ${datetime(p.created_at)}</div>
        </div>
        <div class="card card-pad">
          <dl class="dl" style="grid-template-columns:1fr auto">
            ${line(t('purchases.taxable'), money(p.taxable_total))}
            ${inter ? line(t('purchases.igst'), money(p.igst)) : html`${line(t('purchases.cgst'), money(p.cgst))}${line(t('purchases.sgst'), money(p.sgst))}`}
            ${p.other_charges ? line(t('purchases.other_charges'), money(p.other_charges)) : ''}
            ${line(t('purchases.round_off'), money(p.round_off))}
            ${line(t('purchases.total'), money(p.total), true)}
            ${line(t('purchases.paid'), money(p.paid))}
            <dt class="strong">${t('purchases.due')}</dt><dd class="num strong" style="color:${due > 0 ? 'var(--danger-text)' : 'var(--success-text)'}">${money(due)}</dd>
          </dl>
        </div>
      </div>
      <div id="bill-photo" style="margin-top:20px;max-width:640px"></div>`);
    billPhotoCard($('#bill-photo', ctx.el), {
      path: `/purchases/${id}/photo`,
      photo: p.photo,
      canEdit: true,
      onChanged: async () => {
        const s = await draw();
        if (s) state = s;
      },
    });
    return { p, due };
  };

  let state = await draw();
  on(ctx.el, 'click', '[data-act="pay"]', async () => {
    const supplier = (await api.get('/suppliers/' + state.p.supplier_id)).item;
    if (await openSupplierPayment(supplier, { purchaseId: id, amount: state.due })) state = await draw();
  });
  on(ctx.el, 'click', '[data-act="cancel"]', async () => {
    const reason = await promptDialog({ title: t('purchases.cancel'), label: t('purchases.cancel_reason'), message: t('purchases.cancel_note'), confirmLabel: t('purchases.cancel'), danger: true });
    if (reason === null) return;
    try {
      await api.post(`/purchases/${id}/cancel`, { reason });
      toast(t('purchases.cancelled_ok'));
      state = await draw();
    } catch (err) {
      toastError(err);
    }
  });
}
