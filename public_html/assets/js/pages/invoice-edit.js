import { html, setHTML, $, $$, on, debounce } from '../dom.js';
import { t, nm, errorText } from '../i18n.js';
import { api } from '../api.js';
import { can } from '../store.js';
import { icon } from '../ui/icons.js';
import { money, qty } from '../format.js';
import { combo } from '../ui/combo.js';
import { openDrawer } from '../ui/drawer.js';

const PAY = ['cash', 'upi', 'card', 'bank'];

/**
 * The owner edits a final bill; it keeps its number. Every change is previewed by the server (new total, what to
 * collect or give back) before saving. Resolves with the saved bill or null.
 */
export function openBillEdit(inv) {
  const counter = inv.inv_type === 'counter';
  const walkIn = !inv.customer_id;
  const owner = can('give_discount');
  const added = []; // {part, qty, price}

  const lineRow = (it) => html`<tr data-item="${it.id}">
    <td><div class="strong">${it.description_en}</div><div class="small muted">${it.part_no || ''}</div></td>
    <td class="num">${it.item_type === 'part' ? html`<input class="input num" data-e-qty value="${qty(it.qty)}" inputmode="decimal" style="width:72px" aria-label="${t('inv.qty')}">` : '1'}</td>
    <td class="num"><input class="input num" data-e-price value="${Number(it.unit_price)}" inputmode="decimal" style="width:96px" aria-label="${t('inv.mrp')}"></td>
    <td class="num">${owner ? html`<input class="input num" data-e-disc value="${Number(it.disc_pct) || ''}" inputmode="decimal" style="width:64px" aria-label="${t('inv.disc')}">` : qty(it.disc_pct)}</td>
    <td class="num"><input type="checkbox" data-e-rm aria-label="${t('billing.edit_remove')}"></td>
  </tr>`;

  return openDrawer({
    title: t('billing.edit_title', { no: inv.invoice_no }),
    wide: true,
    submitLabel: t('billing.edit_save'),
    body: html`<div class="stack">
      <div class="banner info">${icon('info')}<span>${t('billing.edit_note')}${counter ? '' : ' ' + t('billing.edit_job_qty')}</span></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>${t('inv.description')}</th><th class="num">${t('inv.qty')}</th><th class="num">${t('inv.mrp')}</th><th class="num">${t('inv.disc')}</th><th class="num">${t('billing.edit_remove')}</th></tr></thead>
        <tbody id="e-lines">${inv.items.map(lineRow)}</tbody>
        <tbody id="e-added"></tbody>
      </table></div>
      ${counter ? html`<div class="field"><label for="e-add">${t('billing.edit_add_part')}</label><div style="position:relative"><input id="e-add" class="input" placeholder="${t('purchases.search_part')}"></div></div>` : ''}
      <div class="form-grid">
        ${owner ? html`<div class="field"><label for="e-bd">${t('billing.bill_discount')}</label><input id="e-bd" class="input num" inputmode="decimal" value="${Number(inv.bill_disc_pct) || ''}"></div>` : ''}
        ${counter && walkIn ? html`<div class="field"><label for="e-name">${t('billing.walk_in_name')}</label><input id="e-name" class="input" value="${inv.cust_name || ''}"></div>
          <div class="field"><label for="e-phone">${t('billing.walk_in_phone')}</label><input id="e-phone" class="input" inputmode="tel" value="${inv.cust_phone || ''}"></div>` : ''}
      </div>
      <div class="card card-pad" id="e-sum" aria-live="polite"></div>
      <div class="form-grid hidden" id="e-pay">
        <div class="field"><label for="e-pay-mode">${t('suppliers.mode')}</label><select id="e-pay-mode" class="select">${PAY.map((m) => html`<option value="${m}">${t('pay.' + m)}</option>`)}</select></div>
        <div class="field"><label for="e-pay-amt">${t('common.amount')} (₹)</label><input id="e-pay-amt" class="input num" inputmode="decimal"></div>
      </div>
      <div class="field hidden" id="e-refund"><label for="e-refund-mode">${t('suppliers.mode')}</label><select id="e-refund-mode" class="select">${['cash', 'upi', 'bank'].map((m) => html`<option value="${m}">${t('pay.' + m)}</option>`)}</select></div>
      <div class="field"><label for="e-reason">${t('billing.edit_reason')}<span class="req">*</span></label><input id="e-reason" name="reason" class="input" required><div class="err">${t('fields.required')}</div></div>
    </div>`,
    onOpen(form) {
      const num = (el) => (el ? el.value.trim().replace(',', '.') : '');
      const body = () => {
        const lines = $$('#e-lines tr[data-item]', form).map((tr) => {
          const l = { item_id: Number(tr.dataset.item) };
          const q = $('[data-e-qty]', tr);
          if (q) l.qty = num(q);
          l.unit_price = num($('[data-e-price]', tr));
          const d = $('[data-e-disc]', tr);
          if (d) l.disc_pct = num(d) || 0;
          if ($('[data-e-rm]', tr).checked) l.remove = true;
          return l;
        });
        for (const a of added) lines.push({ part_id: a.part.id, qty: a.qty, unit_price: a.price, disc_pct: 0 });
        const b = { lines, refund_mode: $('#e-refund-mode', form).value };
        if ($('#e-bd', form)) b.bill_disc_pct = num($('#e-bd', form)) || 0;
        if ($('#e-name', form)) {
          b.cust_name = $('#e-name', form).value.trim();
          b.cust_phone = $('#e-phone', form).value.trim();
        }
        const amt = Number(num($('#e-pay-amt', form)));
        if (!$('#e-pay', form).classList.contains('hidden') && amt > 0) b.payment = { mode: $('#e-pay-mode', form).value, amount: amt };
        return b;
      };
      const drawAdded = () =>
        setHTML($('#e-added', form), html`${added.map((a, i) => html`<tr>
          <td><div class="strong">${nm(a.part)}</div><div class="small muted">${a.part.part_no} · ${t('purchases.new_tag')}</div></td>
          <td class="num"><input class="input num" data-a-qty="${i}" value="${a.qty}" inputmode="decimal" style="width:72px" aria-label="${t('inv.qty')}"></td>
          <td class="num"><input class="input num" data-a-price="${i}" value="${a.price}" inputmode="decimal" style="width:96px" aria-label="${t('inv.mrp')}"></td>
          <td></td>
          <td class="num"><button type="button" class="btn btn-ghost btn-icon btn-sm" data-a-rm="${i}" aria-label="${t('billing.edit_remove')}">${icon('trash-2', 16)}</button></td>
        </tr>`)}`);
      const preview = debounce(async () => {
        const sum = $('#e-sum', form);
        try {
          const r = await api.post(`/invoices/${inv.id}/edit/preview`, body());
          const line = (k, v, strong) => html`<div class="row" style="justify-content:space-between"><span class="${strong ? 'strong' : 'muted'}">${k}</span><span class="num ${strong ? 'strong' : ''}">${v}</span></div>`;
          let money_ = t('billing.edit_same');
          if (r.to_refund > 0) money_ = t('billing.edit_refund', { amount: money(r.to_refund) });
          else if (r.to_collect > 0) money_ = r.credit_ok && !walkIn ? t('billing.edit_credit', { amount: money(r.to_collect) }) : t('billing.edit_collect', { amount: money(r.to_collect) });
          else if (r.total < r.paid - 0.004 && !walkIn) money_ = t('billing.edit_advance', { amount: money(r.paid - r.total) });
          setHTML(sum, html`${line(t('billing.edit_old_total'), money(r.old_total))}${line(t('billing.edit_new_total'), money(r.total), true)}<div class="strong" style="margin-top:8px">${money_}</div>`);
          const needPay = r.to_collect > 0;
          $('#e-pay', form).classList.toggle('hidden', !needPay);
          if (needPay && !$('#e-pay-amt', form).value) $('#e-pay-amt', form).value = r.credit_ok && !walkIn ? '' : String(r.to_collect);
          $('#e-refund', form).classList.toggle('hidden', !(r.to_refund > 0));
        } catch (err) {
          setHTML(sum, html`<div class="strong" style="color:var(--danger-text)">${errorText(err)}</div>`);
        }
      }, 300);
      on(form, 'input', '[data-e-qty], [data-e-price], [data-e-disc], #e-bd', preview);
      on(form, 'change', '[data-e-rm]', preview);
      on(form, 'input', '[data-a-qty]', (e, el) => { added[Number(el.dataset.aQty)].qty = el.value.trim().replace(',', '.'); preview(); });
      on(form, 'input', '[data-a-price]', (e, el) => { added[Number(el.dataset.aPrice)].price = el.value.trim().replace(',', '.'); preview(); });
      on(form, 'click', '[data-a-rm]', (e, b) => { added.splice(Number(b.dataset.aRm), 1); drawAdded(); preview(); });
      const addInput = $('#e-add', form);
      if (addInput) {
        combo(addInput, {
          fetch: async (q) => (await api.get('/parts', { q, per_page: 8 })).items,
          render: (p) => html`<div style="flex:1;min-width:0"><div class="strong ellipsis">${p.part_no} · ${nm(p)}</div><div class="small muted">${t('purchases.in_stock')} ${qty(p.current_stock)}</div></div><div class="num">${money(p.selling_price)}</div>`,
          onSelect: (p) => {
            added.push({ part: p, qty: '1', price: String(Number(p.selling_price)) });
            addInput.value = '';
            drawAdded();
            preview();
          },
        });
      }
      form._editBody = body;
      preview();
    },
    onSubmit: async (data, form) => {
      const b = form._editBody();
      b.reason = $('#e-reason', form).value.trim();
      const res = await api.put(`/invoices/${inv.id}/edit`, b);
      return res.item;
    },
  }).then((saved) => saved || null);
}

