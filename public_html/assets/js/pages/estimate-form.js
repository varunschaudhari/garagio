import { html, el, $, on } from '../dom.js';
import { t, nm } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../ui/icons.js';
import { money, qty } from '../format.js';
import { combo } from '../ui/combo.js';
import { openDrawer } from '../ui/drawer.js';
import { toast } from '../ui/toast.js';

let seq = 0;
let ratesCache = null;
async function labourRates() {
  if (!ratesCache) ratesCache = (await api.get('/labour-rates')).items;
  return ratesCache;
}

/**
 * Estimate builder. Prefills from what the job already has (labour added at inspection,
 * and for a revision the parts already issued). Resolves with the saved estimate or null.
 */
export async function openEstimateForm(job) {
  const rates = await labourRates();
  const lines = [];
  for (const p of job.parts || []) {
    const left = Number(p.qty) - Number(p.returned_qty);
    if (left > 0) lines.push({ key: ++seq, type: 'part', part: p, part_id: p.part_id, label: `${p.part_no} · ${nm(p)}`, qty: left, price: Number(p.unit_price) });
  }
  for (const l of job.labour || []) {
    lines.push({ key: ++seq, type: 'labour', rate_id: l.labour_rate_id, label: l.description, amount: Number(l.amount) });
  }

  const lineRow = (l) => html`<div class="list-item" data-line="${l.key}" style="padding:10px 0;gap:8px;flex-wrap:wrap">
    <span class="chip ${l.type === 'part' ? 'info' : 'primary'} plain">${l.type === 'part' ? t('jobs.parts_total') : t('jobs.labour')}</span>
    <div style="flex:1;min-width:160px" class="strong">${l.label}</div>
    ${l.type === 'part'
      ? html`<input class="input num" data-qty value="${qty(l.qty)}" inputmode="decimal" style="width:70px" aria-label="${t('common.qty')}">
             <span class="num muted" style="width:90px">× ${money(l.price)}</span>`
      : html`<input class="input num" data-amount value="${l.amount}" inputmode="decimal" style="width:110px" aria-label="${t('common.amount')}">`}
    <span class="num strong" data-line-total style="width:100px"></span>
    <button type="button" class="btn btn-ghost btn-icon btn-sm" data-remove aria-label="${t('common.delete')}">${icon('trash-2', 16)}</button>
  </div>`;

  const body = html`
    <div class="stack">
      <div class="row-wrap">
        <div style="position:relative;flex:1;min-width:220px"><input class="input" id="est-part" placeholder="${t('purchases.search_part')}" aria-label="${t('estimates.add_part')}"></div>
        <select class="select" id="est-labour" style="width:auto;flex:1;min-width:200px" aria-label="${t('estimates.add_labour')}">
          <option value="">+ ${t('estimates.add_labour')}</option>
          ${rates.map((r) => html`<option value="${r.id}">${nm(r)} · ${money(r.amount)}</option>`)}
          <option value="custom">${t('estimates.description')}…</option>
        </select>
      </div>
      <details><summary class="small muted" style="cursor:pointer">${t('estimates.custom_part')}</summary>
        <div class="row-wrap" style="margin-top:8px">
          <input class="input" id="cp-desc" placeholder="${t('estimates.description')}" style="flex:2;min-width:180px">
          <input class="input num" id="cp-qty" placeholder="${t('common.qty')}" value="1" inputmode="decimal" style="width:70px">
          <input class="input num" id="cp-price" placeholder="${t('estimates.price')}" inputmode="decimal" style="width:110px">
          <button type="button" class="btn btn-secondary btn-sm" id="cp-add">${icon('plus', 16)}${t('common.add')}</button>
        </div>
      </details>
      <div id="est-lines" class="list"></div>
      <div class="row" style="justify-content:space-between;border-top:1px solid var(--border);padding-top:12px">
        <span class="muted small">${t('estimates.gst_incl')}</span>
        <span><span class="muted">${t('estimates.total')}:</span> <strong id="est-total" style="font-size:20px"></strong></span>
      </div>
      <div class="field"><label for="est-note">${t('estimates.note')}</label><input id="est-note" class="input" name="note"></div>
    </div>`;

  return openDrawer({
    title: job.estimates?.some((e) => e.status === 'approved') ? t('estimates.revise') : t('estimates.new'),
    body,
    wide: true,
    submitLabel: t('common.save'),
    onOpen(root) {
      const box = $('#est-lines', root);
      const recalc = () => {
        let total = 0;
        for (const l of lines) {
          const v = l.type === 'part' ? Number(l.qty) * Number(l.price) : Number(l.amount);
          total += Number.isFinite(v) ? v : 0;
          const cell = $(`[data-line="${l.key}"] [data-line-total]`, box);
          if (cell) cell.textContent = money(v);
        }
        $('#est-total', root).textContent = money(total);
      };
      const add = (l) => {
        lines.push(l);
        box.appendChild(el(lineRow(l)));
        recalc();
      };
      lines.forEach((l) => box.appendChild(el(lineRow(l))));
      recalc();

      combo($('#est-part', root), {
        fetch: async (q) => (await api.get('/parts', { q, per_page: 8 })).items,
        render: (p) => html`<div style="flex:1;min-width:0"><div class="strong ellipsis">${p.part_no} · ${nm(p)}</div><div class="small muted">${t('purchases.in_stock')} ${qty(p.current_stock)}</div></div><div class="num">${money(p.selling_price)}</div>`,
        onSelect: (p) => {
          add({ key: ++seq, type: 'part', part_id: p.id, label: `${p.part_no} · ${nm(p)}`, qty: 1, price: Number(p.selling_price) });
          $('#est-part', root).value = '';
          $('#est-part', root).focus();
        },
      });
      on(root, 'change', '#est-labour', (e, s) => {
        if (s.value === 'custom') {
          add({ key: ++seq, type: 'labour', rate_id: null, label: t('jobs.labour'), amount: 0, custom: true });
          const last = box.lastElementChild;
          last.querySelector('.strong').innerHTML = `<input class="input" data-desc placeholder="${t('estimates.description')}">`;
          last.querySelector('[data-desc]').focus();
        } else if (s.value) {
          const r = rates.find((x) => x.id === Number(s.value));
          add({ key: ++seq, type: 'labour', rate_id: r.id, label: nm(r), amount: Number(r.amount) });
        }
        s.value = '';
      });
      on(root, 'click', '#cp-add', () => {
        const desc = $('#cp-desc', root).value.trim();
        const price = Number($('#cp-price', root).value.replace(',', '.'));
        const q = Number($('#cp-qty', root).value.replace(',', '.')) || 1;
        if (!desc || !Number.isFinite(price)) return;
        add({ key: ++seq, type: 'part', part_id: null, label: desc, desc, qty: q, price });
        $('#cp-desc', root).value = '';
        $('#cp-price', root).value = '';
      });
      on(box, 'input', 'input', (e, inp) => {
        const l = lines.find((x) => x.key === Number(inp.closest('[data-line]').dataset.line));
        const v = inp.value.replace(',', '.');
        if (inp.hasAttribute('data-qty')) l.qty = Number(v);
        if (inp.hasAttribute('data-amount')) l.amount = Number(v);
        if (inp.hasAttribute('data-desc')) l.label = inp.value;
        recalc();
      });
      on(box, 'click', '[data-remove]', (e, b) => {
        const row = b.closest('[data-line]');
        const i = lines.findIndex((x) => x.key === Number(row.dataset.line));
        lines.splice(i, 1);
        row.remove();
        recalc();
      });
    },
    onSubmit: async (d) => {
      if (!lines.length) {
        toast(t('estimates.items_needed'), 'error');
        return false;
      }
      const items = lines.map((l) =>
        l.type === 'part'
          ? l.part_id
            ? { item_type: 'part', part_id: l.part_id, qty: l.qty }
            : { item_type: 'part', description: l.desc || l.label, qty: l.qty, unit_price: l.price }
          : { item_type: 'labour', labour_rate_id: l.rate_id || '', description: l.label, amount: l.amount }
      );
      const res = await api.post(`/jobs/${job.id}/estimates`, { items, note: d.note });
      return res.item;
    },
  });
}
