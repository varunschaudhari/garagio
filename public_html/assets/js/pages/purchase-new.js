import { html, setHTML, el, $, $$, on, debounce } from '../dom.js';
import { t, nm, errorText } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../ui/icons.js';
import { money, qty, todayISO } from '../format.js';
import { combo } from '../ui/combo.js';
import { busy } from '../ui/form.js';
import { toast, toastError } from '../ui/toast.js';
import { openPartForm } from './part-form.js';
import { openSupplierForm } from './suppliers.js';
import { uploadBillPhoto } from '../ui/bill-photo.js';

const GST_RATES = [0, 5, 12, 18, 28, 40];
const FIELDS = ['part', 'qty', 'mrp', 'price', 'disc', 'gst'];

let rowSeq = 0;

export default async function purchaseNew(ctx) {
  // ?replace=<id>: correct an earlier bill. The form starts from that bill; saving replaces it.
  const replaceId = Number(ctx.query.replace || 0);
  let old = null;
  if (replaceId) {
    old = (await api.get('/purchases/' + replaceId)).item;
    if (!ctx.alive()) return;
    if (old.status !== 'final') {
      toast(t('errors.purchase_cancelled'), 'error');
      location.hash = '#/purchases/' + replaceId;
      return;
    }
  }
  const heading = old ? t('purchases.correct_title', { bill: old.bill_no }) : t('purchases.new');
  ctx.setTitle(heading);
  // priceMode 'mrp': the supplier's rate includes GST (usually the MRP) less a discount; 'net': rate without GST.
  const st = { supplier: null, rows: [], interstate: false, priceMode: old?.price_mode || 'mrp' };
  let dirty = false;
  const rateLabel = () => t(st.priceMode === 'mrp' ? 'purchases.rate_incl' : 'purchases.rate_excl');
  ctx.setLeaveGuard(() => (dirty ? t('stock.unsaved') : null));

  setHTML(ctx.el, html`
    <div class="page-head">
      <div style="flex:1"><a href="#/purchases${old ? '/' + old.id : ''}" class="small muted">${icon('arrow-left', 14)} ${old ? t('purchases.bill') + ' ' + old.bill_no : t('purchases.title')}</a><h1 style="margin-top:6px">${heading}</h1></div>
    </div>
    ${old ? html`<div class="banner info" style="margin-bottom:16px">${icon('info')}<span>${t('purchases.correct_note')}</span></div>` : ''}
    <form class="stack-lg" id="pur-form" novalidate>
      <div class="card card-pad">
        <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
          <div class="field" id="f-supplier">
            <label for="pur-supplier">${t('purchases.supplier')}<span class="req">*</span></label>
            <div class="row" style="gap:6px">
              <div style="position:relative;flex:1"><input id="pur-supplier" class="input" placeholder="${t('purchases.choose_supplier')}"></div>
              <button type="button" class="btn btn-secondary btn-icon" data-act="new-supplier" title="${t('suppliers.new')}" aria-label="${t('suppliers.new')}">${icon('plus')}</button>
            </div>
            <div class="hint" id="sup-hint"></div>
            <div class="err">${t('fields.required')}</div>
          </div>
          <div class="field" id="f-bill_no">
            <label for="pur-bill">${t('purchases.bill_no')}<span class="req">*</span></label>
            <input id="pur-bill" class="input" name="bill_no" autocomplete="off">
            <div class="err">${t('fields.required')}</div>
          </div>
          <div class="field">
            <label for="pur-date">${t('purchases.bill_date')}</label>
            <input id="pur-date" class="input" type="date" name="bill_date" value="${todayISO()}" max="${todayISO()}">
          </div>
          <div class="field">
            <label for="pur-mode">${t('purchases.payment_mode')}</label>
            <select id="pur-mode" class="select" name="payment_mode">
              ${['credit', 'cash', 'upi', 'bank'].map((m) => html`<option value="${m}">${t('pay.' + m)}</option>`)}
            </select>
          </div>
          <div class="field">
            <label for="pur-photo">${t('bills.photo')}</label>
            <input id="pur-photo" class="input" type="file" accept="image/*">
          </div>
          <div class="field">
            <label for="pur-price-mode">${t('purchases.price_mode')}</label>
            <select id="pur-price-mode" class="select" name="price_mode">
              ${['mrp', 'net'].map((m) => html`<option value="${m}" ${m === st.priceMode ? 'selected' : ''}>${t('purchases.mode_' + m)}</option>`)}
            </select>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>${t('purchases.items')}</h3>
          <span class="small muted hide-sm">${t('purchases.grid_hint')}</span>
          <button type="button" class="btn btn-secondary btn-sm" data-act="new-part">${icon('package-plus', 16)}${t('purchases.new_part')}</button>
        </div>
        <div id="pur-interstate" class="banner info hidden" style="margin:12px 16px 0">${icon('info')}<span>${t('purchases.interstate_note')}</span></div>
        <div class="table-wrap">
          <table class="table purchase-grid">
            <thead><tr>
              <th style="width:36px">#</th><th style="min-width:260px">${t('purchases.part')}</th>
              <th class="num" style="width:90px">${t('purchases.qty')}</th><th class="num" style="width:110px" title="${t('purchases.mrp_hint')}">${t('purchases.mrp')}</th>
              <th class="num" style="width:120px" id="pur-rate-head">${rateLabel()}</th>
              <th class="num" style="width:90px">${t('purchases.disc')}</th><th style="width:96px">${t('purchases.gst')}</th>
              <th class="num">${t('purchases.taxable')}</th><th class="num">${t('purchases.total')}</th><th style="width:44px"></th>
            </tr></thead>
            <tbody id="pur-rows"></tbody>
          </table>
        </div>
        <div class="card-foot" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><button type="button" class="btn btn-ghost btn-sm" data-act="add-row">${icon('plus', 16)}${t('purchases.add_line')}</button><span class="small muted">${t('purchases.mrp_hint')}</span></div>
      </div>

      <div class="grid-2" style="align-items:start">
        <div class="card card-pad"><div class="field"><label for="pur-notes">${t('common.notes')}</label><textarea id="pur-notes" class="input" name="notes" rows="3"></textarea></div></div>
        <div class="card card-pad">
          <dl class="dl" id="pur-totals" style="grid-template-columns:1fr auto"></dl>
          <div class="row" style="margin-top:16px;justify-content:flex-end">
            <button type="submit" class="btn btn-primary btn-lg">${icon('check')}${t('purchases.save')}</button>
          </div>
        </div>
      </div>
    </form>`);

  const form = $('#pur-form', ctx.el);
  const tbody = $('#pur-rows', ctx.el);
  const supInput = $('#pur-supplier', ctx.el);

  /* ------------------------------------------------------------ supplier */
  const setSupplier = (s) => {
    st.supplier = s;
    supInput.value = s ? s.name : '';
    $('#sup-hint', ctx.el).textContent = s ? [s.contact_person, s.phone, s.gstin || s.state_code, `${t('suppliers.balance')} ${money(s.balance)}`].filter(Boolean).join(' · ') : '';
    $('#f-supplier', ctx.el).classList.remove('invalid');
    refresh();
  };
  combo(supInput, {
    fetch: async (q) => (await api.get('/suppliers', { q, per_page: 8 })).items,
    render: (s) => html`<div style="flex:1;min-width:0"><div class="strong ellipsis">${s.name}</div><div class="small muted">${s.phone || ''} ${s.gstin || ''}</div></div><div class="small num">${money(s.balance)}</div>`,
    onSelect: (s) => {
      setSupplier(s);
      $('#pur-bill', ctx.el).focus();
    },
  });
  supInput.addEventListener('input', () => {
    if (st.supplier && supInput.value !== st.supplier.name) {
      st.supplier = null;
      $('#sup-hint', ctx.el).textContent = '';
    }
  });

  /* ------------------------------------------------------------ rows */
  const rowOf = (key) => st.rows.find((r) => r.key === key);

  const partLabel = (p) => (p ? `${p.part_no} · ${nm(p)}` : '');

  const setPart = (row, p) => {
    row.part = p;
    const tr = tbody.querySelector(`tr[data-key="${row.key}"]`);
    $('[data-f="part"]', tr).value = partLabel(p);
    $('[data-sub]', tr).textContent = p ? `${t('purchases.in_stock')}: ${qty(p.current_stock)} ${p.unit}` : '';
    if (p) {
      row.mrp = Number(p.selling_price) ? String(Number(p.selling_price)) : row.mrp;
      startPrice(row);
      row.disc = p.last_purchase_disc_pct ? String(p.last_purchase_disc_pct) : row.disc;
      row.gst = String(Number(p.gst_rate));
      for (const f of ['mrp', 'price', 'disc', 'gst']) $(`[data-f="${f}"]`, tr).value = row[f];
      if (!row.qty) {
        row.qty = '1';
        $('[data-f="qty"]', tr).value = '1';
      }
    }
    dirty = true;
    refresh();
  };

  // MRP bills: the rate follows the MRP until someone types a different rate.
  const startPrice = (row) => {
    if (st.priceMode === 'mrp') {
      row.price = row.mrp;
      row.follow = true;
    } else {
      row.price = row.part?.last_purchase_price ? String(row.part.last_purchase_price) : '';
      row.follow = false;
    }
  };

  const addRow = (focus = true) => {
    const row = { key: ++rowSeq, part: null, qty: '', mrp: '', price: '', disc: '', gst: '18', follow: true };
    st.rows.push(row);
    const tr = el(html`<table><tbody><tr data-key="${row.key}">
      <td class="muted num" data-n></td>
      <td><div style="position:relative"><input class="input" data-f="part" placeholder="${t('purchases.search_part')}" aria-label="${t('purchases.part')}"></div><div class="small muted" data-sub></div></td>
      <td><input class="input num" data-f="qty" inputmode="decimal" aria-label="${t('purchases.qty')}"></td>
      <td><input class="input num" data-f="mrp" inputmode="decimal" aria-label="${t('purchases.mrp')}"></td>
      <td><input class="input num" data-f="price" inputmode="decimal" aria-label="${rateLabel()}"></td>
      <td><input class="input num" data-f="disc" inputmode="decimal" aria-label="${t('purchases.disc')}"></td>
      <td><select class="select" data-f="gst" aria-label="${t('purchases.gst')}">${GST_RATES.map((g) => html`<option value="${g}" ${g === 18 ? 'selected' : ''}>${g}%</option>`)}</select></td>
      <td class="num" data-out="taxable"></td>
      <td class="num strong" data-out="total"></td>
      <td><button type="button" class="btn btn-ghost btn-icon btn-sm" data-remove aria-label="${t('purchases.remove_line')}">${icon('trash-2', 16)}</button></td>
    </tr></tbody></table>`).querySelector('tr');
    tbody.appendChild(tr);
    combo($('[data-f="part"]', tr), {
      fetch: async (q) => (await api.get('/parts', { q, per_page: 8 })).items,
      render: (p) => html`<div style="flex:1;min-width:0"><div class="strong ellipsis">${p.part_no} · ${nm(p)}</div><div class="small muted">${t('purchases.in_stock')} ${qty(p.current_stock)} · ${p.rack || ''}</div></div><div class="small num">${t('purchases.mrp')} ${money(p.selling_price)}</div>`,
      onSelect: (p) => {
        setPart(row, p);
        const q = $('[data-f="qty"]', tr);
        q.focus();
        q.select();
      },
    });
    numberRows();
    if (focus) $('[data-f="part"]', tr).focus();
    return row;
  };

  const numberRows = () => $$('tr[data-key]', tbody).forEach((tr, i) => ($('[data-n]', tr).textContent = String(i + 1)));

  const validRows = () => st.rows.filter((r) => r.part && Number(r.qty) > 0);

  const payload = () => ({
    supplier_id: st.supplier?.id,
    bill_no: $('#pur-bill', ctx.el).value.trim(),
    bill_date: $('#pur-date', ctx.el).value,
    payment_mode: $('#pur-mode', ctx.el).value,
    price_mode: st.priceMode,
    other_charges: $('#pur-other', ctx.el)?.value.trim() || 0,
    notes: $('#pur-notes', ctx.el).value.trim(),
    items: validRows().map((r) => ({ part_id: r.part.id, qty: r.qty, price: r.price || 0, disc_pct: r.disc || 0, gst_rate: r.gst, mrp: r.mrp })),
    ...(old ? { replaces_id: old.id } : {}),
  });

  /* ------------------------------------------------------------ totals (from the server) */
  let otherCharges = '';
  const drawTotals = (tot) => {
    const line = (label, value, strong = false) => html`<dt>${label}</dt><dd class="num ${strong ? 'strong' : ''}">${value}</dd>`;
    setHTML($('#pur-totals', ctx.el), html`
      ${line(t('purchases.taxable'), money(tot?.taxable_total))}
      ${st.interstate ? line(t('purchases.igst'), money(tot?.igst)) : html`${line(t('purchases.cgst'), money(tot?.cgst))}${line(t('purchases.sgst'), money(tot?.sgst))}`}
      <dt><label for="pur-other">${t('purchases.other_charges')}</label></dt>
      <dd><input id="pur-other" class="input num" inputmode="decimal" value="${otherCharges}" style="max-width:140px;margin-left:auto"></dd>
      ${line(t('purchases.round_off'), money(tot?.round_off))}
      <dt class="strong" style="font-size:18px;color:var(--text)">${t('purchases.total')}</dt><dd class="num strong" style="font-size:22px">${money(tot?.grand_total)}</dd>`);
  };
  drawTotals(null);

  let previewSeq = 0;
  const refresh = debounce(async () => {
    const body = payload();
    const rowsWithPart = validRows();
    for (const tr of $$('tr[data-key]', tbody)) {
      $('[data-out="taxable"]', tr).textContent = '';
      $('[data-out="total"]', tr).textContent = '';
    }
    if (!body.supplier_id || !body.items.length) {
      st.interstate = false;
      $('#pur-interstate', ctx.el).classList.add('hidden');
      drawTotals(null);
      return;
    }
    const mine = ++previewSeq;
    try {
      const res = await api.post('/purchases/preview', body);
      if (mine !== previewSeq || !ctx.alive()) return;
      st.interstate = res.interstate;
      $('#pur-interstate', ctx.el).classList.toggle('hidden', !res.interstate);
      res.lines.forEach((l, i) => {
        const r = rowsWithPart[i];
        const tr = r && tbody.querySelector(`tr[data-key="${r.key}"]`);
        if (!tr) return;
        $('[data-out="taxable"]', tr).textContent = money(l.taxable);
        $('[data-out="total"]', tr).textContent = money(l.line_total);
      });
      const focused = document.activeElement?.id === 'pur-other';
      drawTotals(res.totals);
      if (focused) {
        const o = $('#pur-other', ctx.el);
        o.focus();
        o.setSelectionRange(o.value.length, o.value.length);
      }
    } catch {
      /* invalid numbers mid-typing: keep the last totals */
    }
  }, 300);

  /* ------------------------------------------------------------ events */
  on(tbody, 'input', '[data-f]', (e, inp) => {
    const row = rowOf(Number(inp.closest('tr').dataset.key));
    const f = inp.dataset.f;
    if (f === 'part') {
      if (row.part && inp.value !== partLabel(row.part)) {
        row.part = null;
        $('[data-sub]', inp.closest('tr')).textContent = '';
        refresh();
      }
      return;
    }
    row[f] = inp.value.trim().replace(',', '.');
    if (f === 'price') row.follow = st.priceMode === 'mrp' && row.price === row.mrp;
    if (f === 'mrp' && row.follow) {
      row.price = row.mrp;
      $('[data-f="price"]', inp.closest('tr')).value = row.price;
    }
    inp.closest('td').classList.remove('cell-invalid');
    dirty = true;
    refresh();
  });
  on(tbody, 'change', 'select[data-f="gst"]', (e, s) => {
    rowOf(Number(s.closest('tr').dataset.key)).gst = s.value;
    refresh();
  });
  on(ctx.el, 'change', '#pur-price-mode', (e, s) => {
    st.priceMode = s.value;
    $('#pur-rate-head', ctx.el).textContent = rateLabel();
    for (const row of st.rows) {
      const tr = tbody.querySelector(`tr[data-key="${row.key}"]`);
      $('[data-f="price"]', tr).setAttribute('aria-label', rateLabel());
      if (!row.part) continue;
      startPrice(row);
      $('[data-f="price"]', tr).value = row.price;
    }
    dirty = true;
    refresh();
  });
  on(ctx.el, 'input', '#pur-other', (e, inp) => {
    otherCharges = inp.value.trim();
    refresh();
  });
  on(tbody, 'click', '[data-remove]', (e, b) => {
    const tr = b.closest('tr');
    st.rows = st.rows.filter((r) => r.key !== Number(tr.dataset.key));
    tr.remove();
    if (!st.rows.length) addRow();
    numberRows();
    refresh();
  });

  // Enter walks the grid: part → qty → price → disc → GST → next line (added if needed).
  on(tbody, 'keydown', '[data-f]', (e, inp) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const tr = inp.closest('tr');
    const idx = FIELDS.indexOf(inp.dataset.f);
    if (inp.dataset.f === 'part' && !rowOf(Number(tr.dataset.key)).part) return;
    if (idx < FIELDS.length - 1) {
      const next = $(`[data-f="${FIELDS[idx + 1]}"]`, tr);
      next.focus();
      if (next.select) next.select();
      return;
    }
    const nextTr = tr.nextElementSibling;
    if (nextTr) $('[data-f="part"]', nextTr).focus();
    else addRow();
  });

  on(ctx.el, 'click', '[data-act="add-row"]', () => addRow());
  on(ctx.el, 'click', '[data-act="new-part"]', async () => {
    const p = await openPartForm();
    if (!p) return;
    const target = st.rows.find((r) => !r.part) || addRow(false);
    setPart(target, p);
    $('[data-f="qty"]', tbody.querySelector(`tr[data-key="${target.key}"]`)).focus();
  });
  on(ctx.el, 'click', '[data-act="new-supplier"]', async () => {
    const s = await openSupplierForm();
    if (s) setSupplier(s);
  });
  on(form, 'input', '#pur-bill', () => $('#f-bill_no', ctx.el).classList.remove('invalid'));

  const keyHandler = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      form.requestSubmit();
    }
  };
  document.addEventListener('keydown', keyHandler);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = payload();
    let bad = false;
    if (!body.supplier_id) {
      $('#f-supplier', ctx.el).classList.add('invalid');
      bad = true;
    }
    if (!body.bill_no) {
      $('#f-bill_no', ctx.el).classList.add('invalid');
      bad = true;
    }
    if (!body.items.length) {
      toast(t('purchases.no_lines'), 'error');
      bad = true;
    }
    if (bad) return;
    await busy($('button[type=submit]', form), async () => {
      try {
        const res = await api.post('/purchases', body);
        dirty = false;
        toast(old ? t('purchases.corrected') : t('purchases.saved'));
        const photo = $('#pur-photo', ctx.el).files[0];
        if (photo) await uploadBillPhoto(`/purchases/${res.item.id}/photo`, photo).catch(toastError);
        location.hash = '#/purchases/' + res.item.id;
      } catch (err) {
        if (err.code === 'duplicate_bill') {
          const f = $('#f-bill_no', ctx.el);
          f.classList.add('invalid');
          $('.err', f).textContent = errorText(err);
          $('#pur-bill', ctx.el).focus();
          return;
        }
        // items.N → highlight the cells of that line
        const vr = validRows();
        let marked = false;
        for (const [k, v] of Object.entries(err.fields || {})) {
          const m = /^items\.(\d+)/.exec(k);
          const r = m && vr[Number(m[1])];
          if (!r) continue;
          const tr = tbody.querySelector(`tr[data-key="${r.key}"]`);
          for (const f of Object.keys(v || {})) {
            const map = { qty: 'qty', price: 'price', mrp: 'mrp', disc_pct: 'disc', gst_rate: 'gst', part_id: 'part' };
            const cell = map[f] && $(`[data-f="${map[f]}"]`, tr)?.closest('td');
            if (cell) cell.classList.add('cell-invalid');
            marked = true;
          }
        }
        toastError(err);
        if (!marked && err.fields?.supplier_id) $('#f-supplier', ctx.el).classList.add('invalid');
      }
    });
  });

  if (old) {
    // Start from the bill being corrected: same supplier (fixed), its lines at the prices it was entered with.
    setSupplier((await api.get('/suppliers/' + old.supplier_id)).item);
    if (!ctx.alive()) return;
    supInput.disabled = true;
    $('[data-act="new-supplier"]', ctx.el).disabled = true;
    $('#pur-bill', ctx.el).value = old.bill_no;
    $('#pur-date', ctx.el).value = old.bill_date;
    $('#pur-mode', ctx.el).value = old.payment_mode;
    $('#pur-notes', ctx.el).value = old.notes || '';
    otherCharges = Number(old.other_charges) ? String(old.other_charges) : '';
    for (const it of old.items) {
      const row = addRow(false);
      const tr = tbody.querySelector(`tr[data-key="${row.key}"]`);
      const mrp = Number(it.mrp) ? String(Number(it.mrp)) : '';
      Object.assign(row, { part: { id: it.part_id, part_no: it.part_no, name_en: it.name_en, name_mr: it.name_mr, unit: it.unit }, qty: String(Number(it.qty)), mrp, price: String(Number(it.price)), disc: Number(it.disc_pct) ? String(Number(it.disc_pct)) : '', gst: String(Number(it.gst_rate)) });
      row.follow = st.priceMode === 'mrp' && row.price === mrp;
      $('[data-f="part"]', tr).value = partLabel(row.part);
      for (const f of ['qty', 'mrp', 'price', 'disc', 'gst']) $(`[data-f="${f}"]`, tr).value = row[f];
    }
    refresh();
    $('#pur-bill', ctx.el).focus();
  } else {
    addRow(false);
  }
  if (old) {
    /* supplier already set */
  } else if (ctx.query.supplier) {
    try {
      setSupplier((await api.get('/suppliers/' + Number(ctx.query.supplier))).item);
      $('#pur-bill', ctx.el).focus();
    } catch {
      supInput.focus();
    }
  } else {
    supInput.focus();
  }

  return () => document.removeEventListener('keydown', keyHandler);
}
