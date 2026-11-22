import { html, setHTML, $, on, debounce } from '../dom.js';
import { t, nm, errorText } from '../i18n.js';
import { api } from '../api.js';
import { hasRole, session, can } from '../store.js';
import { icon } from '../ui/icons.js';
import { money, qty } from '../format.js';
import { combo } from '../ui/combo.js';
import { busy } from '../ui/form.js';
import { toast, toastError } from '../ui/toast.js';
import { promptDialog } from '../ui/modal.js';
import { paymentPanel, bindPaymentPanel } from './invoice.js';

/** Counter sale (POS): walk-in or known customer, parts by barcode / search, pay and print. */
export default async function counterSale(ctx) {
  ctx.setTitle(t('billing.new_counter'));
  const owner = can('give_discount');
  const canMrp = can('change_mrp');
  const st = { lines: [], customer: null, total: 0, billDisc: 0 };
  let dirty = false;
  ctx.setLeaveGuard(() => (dirty && st.lines.length ? t('stock.unsaved') : null));

  setHTML(ctx.el, html`
    <div class="page-head"><div style="flex:1"><a href="#/invoices" class="small muted">${icon('arrow-left', 14)} ${t('billing.invoices')}</a><h1 style="margin-top:6px">${t('billing.new_counter')}</h1></div></div>
    <div class="grid-main">
      <div class="card">
        <div class="toolbar" style="flex-wrap:wrap">
          <div class="input-group" style="max-width:none;flex:1">${icon('scan-line')}<input class="input" id="cs-code" placeholder="${t('billing.barcode')}" aria-label="${t('billing.barcode')}" style="min-height:48px;font-size:16px"></div>
        </div>
        <div id="cs-lines"></div>
      </div>
      <div class="stack-lg">
        <div class="card card-pad stack">
          <strong>${t('billing.customer')}</strong>
          <div style="position:relative"><input class="input" id="cs-cust" placeholder="${t('billing.pick_customer')}" aria-label="${t('billing.pick_customer')}"></div>
          <div id="cs-cust-box"></div>
          <div class="grid-2" style="gap:8px" id="cs-walkin">
            <div class="field"><label for="cs-name">${t('billing.walk_in_name')}</label><input id="cs-name" class="input"></div>
            <div class="field"><label for="cs-phone">${t('billing.walk_in_phone')}</label><input id="cs-phone" class="input" inputmode="tel"></div>
          </div>
        </div>
        <form class="card card-pad stack" id="cs-form">
          <dl class="dl" style="grid-template-columns:1fr auto" id="cs-totals"></dl>
          ${owner ? html`<div class="field"><label for="cs-bd">${t('billing.bill_discount')}</label><input id="cs-bd" class="input num" inputmode="decimal" style="max-width:120px"></div>` : ''}
          <div id="cs-pay"></div>
          <button class="btn btn-primary btn-lg" type="submit">${icon('check')}${t('billing.finalize')}</button>
        </form>
      </div>
    </div>`);

  const linesBox = $('#cs-lines', ctx.el);
  const codeInput = $('#cs-code', ctx.el);

  const drawLines = () => {
    setHTML(linesBox, st.lines.length
      ? html`<div class="table-wrap"><table class="table"><thead><tr><th>${t('parts.part')}</th><th class="num">${t('common.qty')}</th><th class="num">${t('inv.mrp')}</th>${owner ? html`<th class="num">${t('inv.disc')}</th>` : ''}<th class="num">${t('inv.rate')}</th><th class="num">${t('inv.amount')}</th><th></th></tr></thead>
        <tbody>${st.lines.map((l, i) => html`<tr>
          <td><div class="t-title">${nm(l.part)}</div><div class="t-sub">${l.part.part_no} · ${t('purchases.in_stock')} ${qty(l.part.current_stock)}${l.part.rack ? ' · ' + l.part.rack : ''}</div></td>
          <td class="num"><input class="input num" data-q="${i}" value="${qty(l.qty)}" inputmode="decimal" style="width:70px" aria-label="${t('common.qty')}"></td>
          <td class="num">${money(l.part.selling_price)}${canMrp ? html` <button type="button" class="btn btn-ghost btn-icon btn-sm" data-mrp="${i}" aria-label="${t('billing.change_mrp')}" title="${t('billing.change_mrp')}">${icon('pencil', 14)}</button>` : ''}</td>
          ${owner ? html`<td class="num"><input class="input num" data-d="${i}" value="${l.disc || ''}" inputmode="decimal" style="width:64px" aria-label="${t('inv.disc')}"></td>` : ''}
          <td class="num" data-rate="${i}"></td>
          <td class="num strong" data-amt="${i}"></td>
          <td class="actions"><button type="button" class="btn btn-ghost btn-icon btn-sm" data-rm="${i}" aria-label="${t('common.delete')}">${icon('trash-2', 16)}</button></td>
        </tr>`)}</tbody></table></div>`
      : html`<div class="empty" style="padding:40px">${icon('shopping-cart', 28)}<p>${t('billing.barcode')}</p></div>`);
    refresh();
  };

  const items = () => st.lines.map((l) => ({ part_id: l.part.id, qty: l.qty, disc_pct: owner ? l.disc || 0 : 0 }));

  let seq = 0;
  const refresh = debounce(async () => {
    const mine = ++seq;
    if (!st.lines.length) {
      st.total = 0;
      drawTotals(null);
      return;
    }
    try {
      const res = await api.post('/invoices/preview', { customer_id: st.customer?.id, items: items(), bill_disc_pct: owner ? st.billDisc : 0 });
      if (mine !== seq || !ctx.alive()) return;
      res.lines.forEach((l, i) => {
        const cell = linesBox.querySelector(`[data-amt="${i}"]`);
        if (cell) cell.textContent = money(l.line_total);
        const rate = linesBox.querySelector(`[data-rate="${i}"]`);
        if (rate) rate.textContent = money(l.rate);
      });
      st.total = res.totals.grand_total;
      drawTotals(res.totals);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }, 250);

  const drawTotals = (tt) => {
    const noGst = session.settings?.gst_registered === '0';
    setHTML($('#cs-totals', ctx.el), html`
      ${noGst ? '' : html`<dt>${t('inv.taxable')}</dt><dd class="num">${money(tt?.taxable_total)}</dd>`}
      ${tt?.discount_total ? html`<dt>${t('inv.discount')}</dt><dd class="num">−${money(tt.discount_total)}</dd>` : ''}
      ${noGst ? '' : tt?.igst ? html`<dt>${t('inv.igst')}</dt><dd class="num">${money(tt.igst)}</dd>` : html`<dt>${t('inv.cgst')} + ${t('inv.sgst')}</dt><dd class="num">${money((tt?.cgst || 0) + (tt?.sgst || 0))}</dd>`}
      <dt>${t('inv.round_off')}</dt><dd class="num">${money(tt?.round_off)}</dd>
      <dt class="strong grand">${t('inv.grand_total')}</dt><dd class="num strong grand">${money(tt?.grand_total)}</dd>`);
    pay.recalc();
  };

  const drawPay = () => setHTML($('#cs-pay', ctx.el), paymentPanel(st.total, st.customer));
  drawPay();
  const pay = bindPaymentPanel(ctx.el, () => st.total);

  const addPart = (p) => {
    const ex = st.lines.find((l) => l.part.id === p.id);
    if (ex) ex.qty += 1;
    else st.lines.push({ part: p, qty: 1, disc: 0 });
    dirty = true;
    drawLines();
    codeInput.value = '';
    codeInput.focus();
  };

  combo(codeInput, {
    fetch: async (q) => (await api.get('/parts', { q, per_page: 8, in_stock: 1 })).items,
    render: (p) => html`<div style="flex:1;min-width:0"><div class="strong ellipsis">${p.part_no} · ${nm(p)}</div><div class="small muted">${t('purchases.in_stock')} ${qty(p.current_stock)}</div></div><div class="num">${money(p.selling_price)}</div>`,
    onSelect: addPart,
    minChars: 2,
  });
  // Barcode scanners type the part number and press Enter.
  codeInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !codeInput.value.trim()) return;
    e.preventDefault();
    try {
      addPart((await api.get('/parts/by-code/' + encodeURIComponent(codeInput.value.trim()))).item);
    } catch {
      toast(t('mobile.scanned_unknown', { code: codeInput.value.trim() }), 'error');
    }
  });

  combo($('#cs-cust', ctx.el), {
    fetch: async (q) => (await api.get('/customers', { q, per_page: 8 })).items,
    render: (c) => html`<div style="flex:1;min-width:0"><div class="strong ellipsis">${c.name}</div><div class="small muted">${c.phone}${c.balance > 0 ? ' · ' + t('customers.balance') + ' ' + money(c.balance) : ''}</div></div>`,
    onSelect: (c) => {
      st.customer = c;
      $('#cs-cust', ctx.el).value = c.name;
      $('#cs-walkin', ctx.el).classList.add('hidden');
      setHTML($('#cs-cust-box', ctx.el), html`<div class="row"><span class="chip ${c.is_trusted ? 'success' : ''}">${c.is_trusted ? t('customers.trusted_only') : t('billing.not_trusted')}</span><button type="button" class="btn btn-ghost btn-sm" data-clear-cust>${icon('x', 14)}</button></div>`);
      drawPay();
      refresh();
    },
  });
  on(ctx.el, 'click', '[data-clear-cust]', () => {
    st.customer = null;
    $('#cs-cust', ctx.el).value = '';
    setHTML($('#cs-cust-box', ctx.el), '');
    $('#cs-walkin', ctx.el).classList.remove('hidden');
    drawPay();
    refresh();
  });
  on(linesBox, 'input', '[data-q]', (e, inp) => { st.lines[Number(inp.dataset.q)].qty = Number(inp.value.replace(',', '.')) || 0; refresh(); });
  on(linesBox, 'input', '[data-d]', (e, inp) => { st.lines[Number(inp.dataset.d)].disc = Number(inp.value.replace(',', '.')) || 0; refresh(); });
  on(linesBox, 'click', '[data-rm]', (e, b) => { st.lines.splice(Number(b.dataset.rm), 1); drawLines(); });
  // MRPs change: the new MRP is used now and on later bills.
  on(linesBox, 'click', '[data-mrp]', async (e, b) => {
    const l = st.lines[Number(b.dataset.mrp)];
    const v = await promptDialog({ title: t('billing.change_mrp'), message: t('billing.change_mrp_note', { part: nm(l.part) }), label: t('inv.mrp') + ' (₹)', value: String(Number(l.part.selling_price)) });
    if (v === null) return;
    try {
      const res = await api.post(`/parts/${l.part.id}/mrp`, { mrp: v.replace(',', '.') });
      l.part = { ...l.part, selling_price: res.item.selling_price };
      toast(t('billing.mrp_changed'));
      drawLines();
    } catch (err) {
      toastError(err);
    }
  });
  on(ctx.el, 'input', '#cs-bd', (e, inp) => { st.billDisc = Number(inp.value.replace(',', '.')) || 0; refresh(); });

  on(ctx.el, 'submit', '#cs-form', async (e, form) => {
    e.preventDefault();
    if (!st.lines.length) {
      toast(t('purchases.no_lines'), 'error');
      return;
    }
    await busy($('button[type=submit]', form), async () => {
      let draft;
      try {
        draft = (await api.post('/invoices', {
          items: items(),
          customer_id: st.customer?.id,
          cust_name: st.customer ? undefined : $('#cs-name', ctx.el).value.trim(),
          cust_phone: st.customer ? undefined : $('#cs-phone', ctx.el).value.trim(),
          bill_disc_pct: owner ? st.billDisc : 0,
        })).item;
      } catch (err) {
        toast(errorText(err), 'error');
        return;
      }
      dirty = false;
      try {
        const fin = (await api.post(`/invoices/${draft.id}/finalize`, { payments: pay.read() })).item;
        toast(t('billing.finalized', { no: fin.invoice_no }));
      } catch (err) {
        // e.g. credit not allowed: the draft is kept, fix it on the bill screen.
        toast(errorText(err), 'error', 6000);
      }
      location.hash = '#/invoices/' + draft.id;
    });
  });

  drawLines();
  codeInput.focus();
}
