import { html, setHTML, $, $$, on, debounce } from '../dom.js';
import { t, errorText } from '../i18n.js';
import { api, openApiHtml } from '../api.js';
import { hasRole, can } from '../store.js';
import { icon } from '../ui/icons.js';
import { money, qty, date, datetime } from '../format.js';
import { skeletonRows } from '../ui/table.js';
import { field, busy } from '../ui/form.js';
import { openDrawer } from '../ui/drawer.js';
import { confirmDialog, promptDialog } from '../ui/modal.js';
import { toast, toastError } from '../ui/toast.js';
import { billChips } from './invoices.js';
import { openBillEdit } from './invoice-edit.js';

const MODES = ['cash', 'upi', 'card', 'bank'];

/** Payment entry: one amount box per mode; whatever is left is credit. */
export function paymentPanel(total, customer) {
  return html`<div class="stack" id="pay-panel">
    <div class="row" style="justify-content:space-between"><strong>${t('billing.payment')}</strong>
      <button type="button" class="btn btn-ghost btn-sm" data-pay-full>${t('billing.exact')}</button></div>
    <div class="grid-2" style="gap:8px">
      ${MODES.map((m) => html`<div class="field"><label for="pay-${m}">${t('billing.pay_' + m)}</label><input id="pay-${m}" class="input num" data-pay="${m}" inputmode="decimal" placeholder="0"></div>`)}
    </div>
    <div class="field"><label for="pay-ref">${t('billing.reference')}</label><input id="pay-ref" class="input" data-pay-ref></div>
    <div class="row" style="justify-content:space-between"><span class="muted">${t('billing.credit_part')}</span><strong id="pay-credit" class="num">${money(total)}</strong></div>
    <div class="small muted">${customer?.is_trusted ? t('billing.trusted', { limit: Number(customer.credit_limit) ? money(customer.credit_limit) : '∞' }) : t('billing.not_trusted')} · ${t('billing.credit_note')}</div>
  </div>`;
}

export function bindPaymentPanel(root, getTotal) {
  const recalc = () => {
    const paid = $$('[data-pay]', root).reduce((s, i) => s + (Number(i.value.replace(',', '.')) || 0), 0);
    const credit = Math.max(0, Math.round((getTotal() - paid) * 100) / 100);
    const el = $('#pay-credit', root);
    if (el) {
      el.textContent = money(credit);
      el.style.color = credit > 0 ? 'var(--danger-text)' : 'var(--success-text)';
    }
  };
  on(root, 'input', '[data-pay]', recalc);
  on(root, 'click', '[data-pay-full]', () => {
    $$('[data-pay]', root).forEach((i) => (i.value = ''));
    $('[data-pay="cash"]', root).value = String(getTotal());
    recalc();
  });
  recalc();
  return {
    recalc,
    read() {
      const ref = $('[data-pay-ref]', root)?.value.trim();
      return $$('[data-pay]', root)
        .map((i) => ({ mode: i.dataset.pay, amount: Number(i.value.replace(',', '.')) || 0, reference: ref || undefined }))
        .filter((p) => p.amount > 0);
    },
  };
}

export async function openWhatsAppFor(getUrl) {
  const win = window.open('', '_blank');
  try {
    const url = await getUrl();
    if (win) win.location.href = url;
  } catch (e) {
    if (win) win.close();
    toastError(e);
  }
}

export default async function invoicePage(ctx) {
  const id = Number(ctx.params.id);
  const owner = can('give_discount'); // discounts on the draft
  const canMrp = can('change_mrp');
  const canCancel = can('cancel_bills');
  let inv;
  setHTML(ctx.el, skeletonRows(6));

  const draw = (i) => {
    inv = i;
    if (!ctx.alive()) return;
    const draft = i.status === 'draft';
    const final = i.status === 'final';
    ctx.setTitle(i.invoice_no || `${t('billing.draft')} #${i.id}`);
    const lineDisc = (it) => (draft && owner
      ? html`<input class="input num" style="width:72px" data-disc="${i.inv_type === 'job' ? (it.item_type === 'part' ? 'part:' + it.job_part_id : 'labour:' + it.job_labour_id) : 'line'}" data-part="${it.part_id || ''}" data-qty="${it.qty}" value="${Number(it.disc_pct) || ''}" inputmode="decimal" aria-label="${t('billing.discount')}">`
      : Number(it.disc_pct) ? qty(it.disc_pct) + '%' : '');
    setHTML(ctx.el, html`
      <div class="page-head">
        <div style="flex:1;min-width:260px">
          <a href="#/invoices" class="small muted">${icon('arrow-left', 14)} ${t('billing.invoices')}</a>
          <h1 style="margin-top:6px">${i.invoice_no || t('billing.draft') + ' #' + i.id} ${billChips(i)}</h1>
          <div class="sub">${i.inv_type === 'job' ? html`<a href="#/jobs/${i.job_card_id}">${i.job_no} · ${i.reg_no}</a> · ` : t('billing.counter') + ' · '}
            ${i.customer_id ? html`<a href="#/customers/${i.customer_id}">${i.customer_name}</a>` : i.cust_name || t('billing.walk_in')}
            ${i.invoice_date ? ' · ' + date(i.invoice_date) : ''}</div>
        </div>
        ${final || draft ? html`<button class="btn btn-secondary" data-act="receipt">${icon('printer')}${t('billing.print_receipt')}</button><button class="btn btn-secondary" data-act="print">${icon('file-text')}${t('billing.print_a4')}</button>` : ''}
        ${final && (i.customer_phone || i.cust_phone) ? html`<button class="btn btn-secondary" data-act="wa">${icon('message-circle')}${t('billing.whatsapp')}</button>` : ''}
        ${final && i.balance > 0 ? html`<button class="btn btn-primary" data-act="pay">${icon('hand-coins')}${t('billing.record_payment')}</button>` : ''}
        ${final && i.job_card_id && i.job_status === 'ready' ? html`<button class="btn btn-primary" data-act="deliver">${icon('bike')}${t('billing.deliver')}</button>` : ''}
        ${final && canCancel ? html`<button class="btn btn-secondary" data-act="return">${icon('undo-2')}${t('billing.return')}</button>` : ''}
        ${final && canCancel && !Number(i.returned_total) ? html`<button class="btn btn-secondary" data-act="edit">${icon('pencil')}${t('billing.edit')}</button>` : ''}
        ${final && canCancel && !Number(i.returned_total) ? html`<button class="btn btn-ghost" data-act="cancel">${icon('ban')}${t('billing.cancel')}</button>` : ''}
        ${draft ? html`<button class="btn btn-ghost" data-act="delete">${icon('trash-2')}${t('billing.delete_draft')}</button>` : ''}
      </div>
      ${i.status === 'cancelled' ? html`<div class="banner danger" style="margin-bottom:16px">${icon('ban')}<span>${t('billing.cancelled')}: ${i.cancel_reason}</span></div>` : ''}
      ${i.edited_at ? html`<div class="banner info" style="margin-bottom:16px" id="bill-edited">${icon('pencil')}<span>${t('billing.edited_by', { date: datetime(i.edited_at), name: i.edited_by_name || '—' })}${(i.refunds || []).map((r) => html` · ${t('billing.given_back', { amount: money(r.amount), date: date(r.refunded_on) })} (${t('pay.' + r.mode)})`)}</span></div>` : ''}
      <div class="grid-2" style="grid-template-columns:minmax(0,3fr) minmax(0,2fr);align-items:start">
        <div class="card">
          <div class="card-head"><h3>${t('billing.items')}</h3>${draft && !owner ? html`<span class="small muted">${t('billing.owner_discount')}</span>` : ''}</div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>${t('inv.description')}</th><th class="num">${t('inv.qty')}</th><th class="num">${t('inv.mrp')}</th><th class="num">${t('inv.disc')}</th><th class="num">${t('inv.rate')}</th><th class="num">${t('inv.gst')}</th><th class="num">${t('inv.amount')}</th></tr></thead>
            <tbody>${i.items.map((it) => html`<tr>
              <td><div class="t-title">${it.description_en}${Number(it.returned_qty) ? html` <span class="chip warning">${t('billing.returned_qty', { qty: qty(it.returned_qty) })}</span>` : ''}</div><div class="t-sub">${it.part_no ? html`<strong>${it.part_no}</strong> · ` : ''}${it.description_mr || ''}${it.hsn ? ' · ' + it.hsn : ''}</div></td>
              <td class="num">${qty(it.qty)}</td><td class="num">${it.item_type === 'part' ? money(it.unit_price) : ''}${draft && canMrp && it.item_type === 'part' && it.part_id ? html` <button type="button" class="btn btn-ghost btn-icon btn-sm" data-mrp="${it.part_id}" data-name="${it.description_en}" data-price="${it.unit_price}" aria-label="${t('billing.change_mrp')}" title="${t('billing.change_mrp')}">${icon('pencil', 14)}</button>` : ''}</td>
              <td class="num">${lineDisc(it)}</td><td class="num">${money(it.rate)}</td><td class="num">${qty(it.gst_rate)}%</td><td class="num strong">${money(it.line_total)}</td>
            </tr>`)}</tbody>
          </table></div>
        </div>
        <div class="stack-lg">
          <div class="card card-pad">
            <dl class="dl" style="grid-template-columns:1fr auto">
              ${Number(i.gst_registered) ? html`<dt>${t('inv.taxable')}</dt><dd class="num">${money(i.taxable_total)}</dd>` : ''}
              ${i.discount_total ? html`<dt>${t('inv.discount')}</dt><dd class="num">−${money(i.discount_total)}</dd>` : ''}
              ${!Number(i.gst_registered) ? html`<dt class="small" style="grid-column:1 / -1">${t('inv.no_gst_note')}</dt>` : Number(i.is_interstate) ? html`<dt>${t('inv.igst')}</dt><dd class="num">${money(i.igst)}</dd>` : html`<dt>${t('inv.cgst')}</dt><dd class="num">${money(i.cgst)}</dd><dt>${t('inv.sgst')}</dt><dd class="num">${money(i.sgst)}</dd>`}
              <dt>${t('inv.round_off')}</dt><dd class="num">${money(i.round_off)}</dd>
              <dt class="strong grand">${t('inv.grand_total')}</dt><dd class="num strong grand">${money(i.grand_total)}</dd>
              ${Number(i.returned_total) ? html`<dt>${t('billing.returned')}</dt><dd class="num">−${money(i.returned_total)}</dd>` : ''}
              ${final ? html`<dt>${t('inv.paid')}</dt><dd class="num">${money(i.paid_total)}</dd><dt class="strong">${t('inv.balance')}</dt><dd class="num strong" style="color:${i.balance > 0 ? 'var(--danger-text)' : 'var(--success-text)'}">${money(i.balance)}</dd>` : ''}
            </dl>
            ${draft && owner ? html`<div class="field" style="margin-top:12px"><label for="bill-disc">${t('billing.bill_discount')}</label><input id="bill-disc" class="input num" value="${Number(i.bill_disc_pct) || ''}" inputmode="decimal" style="max-width:120px"></div>` : ''}
          </div>
          ${draft ? html`<form class="card card-pad stack" id="fin-form">
            ${paymentPanel(i.grand_total, i.customer_id ? { is_trusted: Number(i.is_trusted), credit_limit: i.credit_limit } : null)}
            <button class="btn btn-primary btn-lg" type="submit">${icon('check')}${t('billing.finalize')}</button>
          </form>` : ''}
          ${i.returns?.length ? html`<div class="card"><div class="card-head"><h3>${t('billing.returns')}</h3></div><div class="list">${i.returns.map((r) => html`<div class="list-item">
            <div style="flex:1"><div class="strong">${r.return_no}</div><div class="small muted">${date(r.return_date)} · ${r.user_name || ''} · ${r.reason}${Number(r.refund_amount) ? ' · ' + t('billing.refunded_amount', { amount: money(r.refund_amount) }) + ' (' + t('pay.' + r.refund_mode) + ')' : ''}</div></div>
            <div class="num strong">−${money(r.total)}</div>
            <button class="btn btn-ghost btn-icon btn-sm" data-ret-print="${r.id}" aria-label="${t('billing.print_receipt')}" title="${t('billing.print_receipt')}">${icon('printer', 16)}</button></div>`)}</div></div>` : ''}
          ${i.payments.length ? html`<div class="card"><div class="card-head"><h3>${t('purchases.payments')}</h3></div><div class="list">${i.payments.map((p) => html`<div class="list-item"><div style="flex:1"><div class="strong">${t('pay.' + p.mode)}${p.reference ? ' · ' + p.reference : ''}</div><div class="small muted">${date(p.received_on)} · ${p.user_name || ''}</div></div><div class="num strong">${money(p.amount)}</div></div>`)}</div></div>` : ''}
          ${i.finalized_at ? html`<div class="small muted">${t('purchases.entered_by')}: ${i.created_by_name || '—'} · ${datetime(i.finalized_at)}</div>` : ''}
        </div>
      </div>`);
    if (draft && payPanel) payPanel.recalc();
  };

  let payPanel = null;
  const reload = async () => draw((await api.get('/invoices/' + id)).item);
  await reload();
  // Delegated listeners: bound once, they keep working after each redraw.
  payPanel = bindPaymentPanel(ctx.el, () => Number(inv.grand_total));

  // Owner discounts on a draft: recompute on the server as they type.
  const pushDiscounts = debounce(async () => {
    const discounts = {};
    const items = [];
    for (const inp of $$('[data-disc]', ctx.el)) {
      const v = Number(inp.value.replace(',', '.')) || 0;
      if (inp.dataset.disc === 'line') items.push({ part_id: Number(inp.dataset.part), qty: Number(inp.dataset.qty), disc_pct: v });
      else discounts[inp.dataset.disc] = v;
    }
    const body = { bill_disc_pct: Number(($('#bill-disc', ctx.el)?.value || '0').replace(',', '.')) || 0 };
    if (inv.inv_type === 'job') body.discounts = discounts;
    else body.items = items;
    try {
      draw((await api.put('/invoices/' + id, body)).item);
    } catch (e) {
      toastError(e);
    }
  }, 600);
  on(ctx.el, 'change', '[data-disc], #bill-disc', pushDiscounts);

  on(ctx.el, 'submit', '#fin-form', async (e, form) => {
    e.preventDefault();
    await busy($('button[type=submit]', form), async () => {
      try {
        const res = await api.post(`/invoices/${id}/finalize`, { payments: payPanel.read() });
        toast(t('billing.finalized', { no: res.item.invoice_no }));
        draw(res.item);
      } catch (err) {
        toast(errorText(err), 'error', 6000);
      }
    });
  });
  on(ctx.el, 'click', '[data-mrp]', async (e, b) => {
    const v = await promptDialog({ title: t('billing.change_mrp'), message: t('billing.change_mrp_note', { part: b.dataset.name }), label: t('inv.mrp') + ' (₹)', value: String(Number(b.dataset.price)) });
    if (v === null) return;
    try {
      const res = await api.post(`/parts/${b.dataset.mrp}/mrp`, { mrp: v.replace(',', '.'), invoice_id: id });
      toast(t('billing.mrp_changed'));
      draw(res.invoice);
    } catch (err) {
      toastError(err);
    }
  });
  on(ctx.el, 'click', '[data-act="print"]', () => openApiHtml(`/invoices/${id}/html`).catch(toastError));
  on(ctx.el, 'click', '[data-act="receipt"]', () => openApiHtml(`/invoices/${id}/receipt`).catch(toastError));
  on(ctx.el, 'click', '[data-act="wa"]', () => openWhatsAppFor(async () => (await api.post(`/invoices/${id}/whatsapp`)).url));
  on(ctx.el, 'click', '[data-act="pay"]', async () => {
    const res = await openDrawer({
      title: `${t('billing.record_payment')} · ${inv.invoice_no}`,
      body: html`<div class="stack">
        ${field({ name: 'amount', label: t('common.amount') + ' (₹)', type: 'number', value: inv.balance, required: true })}
        ${field({ name: 'mode', label: t('suppliers.mode'), type: 'select', value: 'cash', options: MODES.map((m) => ({ value: m, label: t('pay.' + m) })) })}
        ${field({ name: 'reference', label: t('billing.reference') })}
      </div>`,
      onSubmit: (d) => api.post(`/invoices/${id}/payments`, d),
    });
    if (res) {
      toast(t('billing.payment_saved'));
      draw(res.item);
    }
  });
  on(ctx.el, 'click', '[data-act="deliver"]', async (e, b) => {
    await busy(b, async () => {
      try {
        await api.post(`/jobs/${inv.job_card_id}/status`, { status: 'delivered' });
        toast(t('billing.delivered_ok'));
        reload();
      } catch (err) {
        toastError(err);
      }
    });
  });
  on(ctx.el, 'click', '[data-ret-print]', (e, b) => openApiHtml(`/returns/${b.dataset.retPrint}/receipt`).catch(toastError));
  on(ctx.el, 'click', '[data-act="return"]', () => openReturn());
  const openReturn = async () => {
    const rows = inv.items.map((it) => ({ it, left: Math.round((it.qty - (it.returned_qty || 0)) * 100) / 100 }));
    let preview = null;
    const res = await openDrawer({
      title: t('billing.return_title', { no: inv.invoice_no }),
      wide: true,
      submitLabel: t('billing.return'),
      body: html`<div class="stack">
        <p class="small muted">${t('billing.return_hint')}</p>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>${t('inv.description')}</th><th class="num">${t('inv.qty')}</th><th class="num">${t('billing.return_qty')}</th><th></th></tr></thead>
          <tbody>${rows.map(({ it, left }) => html`<tr>
            <td><div class="t-title">${it.description_en}</div><div class="t-sub">${it.part_no || ''}${it.returned_qty ? ' · ' + t('billing.already_back', { qty: qty(it.returned_qty) }) : ''}</div></td>
            <td class="num">${qty(it.qty)}</td>
            <td class="num"><input class="input num" style="width:80px;margin-left:auto" data-ret="${it.id}" data-left="${left}" inputmode="decimal" placeholder="0" ${left > 0 ? '' : 'disabled'} aria-label="${t('billing.return_qty')} · ${it.description_en}"></td>
            <td>${it.part_id ? html`<label class="check"><input type="checkbox" data-restock="${it.id}" checked><span>${t('billing.restock')}</span></label>` : ''}</td>
          </tr>`)}</tbody>
        </table></div>
        ${field({ name: 'reason', label: t('billing.return_reason'), required: true })}
        <dl class="dl" id="ret-sum" style="grid-template-columns:1fr auto"></dl>
        <div id="ret-refund" class="stack hidden">
          <div class="banner info">${icon('info')}<span id="ret-refund-hint"></span></div>
          <div class="grid-2">
            ${field({ name: 'refund', label: t('billing.refund') + ' (₹)', type: 'number' })}
            ${field({ name: 'refund_mode', label: t('billing.refund_mode'), type: 'select', value: 'cash', options: ['cash', 'upi', 'bank'].map((m) => ({ value: m, label: t('pay.' + m) })) })}
          </div>
        </div>
      </div>`,
      onOpen(root) {
        const lines = () => $$('[data-ret]', root)
          .map((inp) => ({ invoice_item_id: Number(inp.dataset.ret), qty: Number(inp.value.replace(',', '.')) || 0, restock: $(`[data-restock="${inp.dataset.ret}"]`, root)?.checked ?? false }))
          .filter((l) => l.qty > 0);
        const update = debounce(async () => {
          const items = lines();
          for (const inp of $$('[data-ret]', root)) inp.closest('td').classList.toggle('cell-invalid', (Number(inp.value.replace(',', '.')) || 0) > Number(inp.dataset.left));
          if (!items.length) {
            preview = null;
            setHTML($('#ret-sum', root), '');
            $('#ret-refund', root).classList.add('hidden');
            return;
          }
          try {
            preview = await api.post(`/invoices/${id}/returns/preview`, { items });
          } catch {
            return;
          }
          setHTML($('#ret-sum', root), html`<dt class="strong">${t('billing.return_total')}</dt><dd class="num strong" style="font-size:20px">${money(preview.totals.total)}</dd>
            ${preview.max_refund > 0 ? '' : html`<dt class="small muted" style="grid-column:1 / -1">${t('billing.no_refund')}</dt>`}`);
          $('#ret-refund', root).classList.toggle('hidden', !(preview.max_refund > 0));
          $('#ret-refund-hint', root).textContent = preview.must_refund > 0 ? t('billing.refund_walkin', { amount: money(preview.must_refund) }) : t('billing.refund_max', { amount: money(preview.max_refund) });
          $('[name=refund]', root).value = String(preview.max_refund);
        }, 300);
        root.addEventListener('input', (e) => e.target.matches('[data-ret]') && update());
        root.addEventListener('change', (e) => e.target.matches('[data-restock]') && update());
        $('[data-ret]:not([disabled])', root)?.focus();
        root._lines = lines;
      },
      onSubmit: async (d, form) => {
        const items = form._lines();
        if (!items.length) {
          toast(t('billing.return_hint'), 'error');
          return false;
        }
        return api.post(`/invoices/${id}/returns`, { items, reason: d.reason, refund: preview?.max_refund > 0 ? d.refund || 0 : 0, refund_mode: d.refund_mode });
      },
    });
    if (res) {
      toast(t('billing.returned_ok', { no: res.item.return_no }));
      draw(res.invoice);
      openApiHtml(`/returns/${res.item.id}/receipt`).catch(toastError);
    }
  };
  on(ctx.el, 'click', '[data-act="edit"]', async () => {
    const saved = await openBillEdit((await api.get('/invoices/' + id)).item);
    if (saved) {
      toast(t('billing.edited'));
      draw(saved);
    }
  });
  on(ctx.el, 'click', '[data-act="cancel"]', async () => {
    const reason = await promptDialog({ title: t('billing.cancel'), label: t('billing.cancel_reason') });
    if (reason === null) return;
    try {
      draw((await api.post(`/invoices/${id}/cancel`, { reason })).item);
      toast(t('billing.cancelled_ok'));
    } catch (err) {
      toastError(err);
    }
  });
  on(ctx.el, 'click', '[data-act="delete"]', async () => {
    if (!(await confirmDialog({ title: t('billing.delete_draft') + '?', danger: true, confirmLabel: t('common.delete') }))) return;
    try {
      await api.del('/invoices/' + id);
      location.hash = inv.job_card_id ? '#/jobs/' + inv.job_card_id : '#/invoices';
    } catch (err) {
      toastError(err);
    }
  });
}

