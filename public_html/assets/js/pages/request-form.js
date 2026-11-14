import { html, el, $, on } from '../dom.js';
import { t, nm } from '../i18n.js';
import { api } from '../api.js';
import { session } from '../store.js';
import { icon } from '../ui/icons.js';
import { money, qty } from '../format.js';
import { combo } from '../ui/combo.js';
import { openDrawer } from '../ui/drawer.js';
import { toast } from '../ui/toast.js';

let seq = 0;

/** Raise a parts request for a job (replaces the paper slip). Resolves with the request or null. */
export function openRequestForm(job) {
  const lines = [];
  const limit = Number(session.settings.approval_limit || 1000);

  const lineRow = (l) => html`<div class="list-item" data-line="${l.key}" style="padding:10px 0;gap:8px;flex-wrap:wrap">
    <div style="flex:1;min-width:180px">
      <div class="strong">${l.label}</div>
      <div class="small muted">${l.part ? `${t('requests.in_stock')} ${qty(l.part.current_stock)} · ${nm(l.part, 'location') || ''} ${l.part.rack ? '· ' + t('parts.rack') + ' ' + l.part.rack : ''}` : t('requests.free_text')}</div>
    </div>
    <div class="stepper">
      <button type="button" data-step="-1" aria-label="−">${icon('minus', 16)}</button>
      <input data-qty value="${qty(l.qty)}" inputmode="decimal" aria-label="${t('common.qty')}">
      <button type="button" data-step="1" aria-label="+">${icon('plus', 16)}</button>
    </div>
    <span class="chip warning hidden" data-needs>${t('status.needs_approval')}</span>
    <button type="button" class="btn btn-ghost btn-icon btn-sm" data-remove aria-label="${t('common.delete')}">${icon('trash-2', 16)}</button>
  </div>`;

  return openDrawer({
    title: `${t('requests.new')} · ${job.job_no} · ${job.reg_no}`,
    body: html`<div class="stack">
      <div class="small muted">${t('requests.approval_hint', { limit: money(limit) })}</div>
      <div style="position:relative"><div class="input-group">${icon('search')}<input class="input" id="rq-part" placeholder="${t('parts.search_placeholder')}" aria-label="${t('requests.add_line')}"></div></div>
      <div class="row-wrap">
        <input class="input" id="rq-free" placeholder="${t('requests.free_text_name')}" style="flex:1;min-width:200px" aria-label="${t('requests.free_text')}">
        <button type="button" class="btn btn-secondary btn-sm" id="rq-free-add">${icon('plus', 16)}${t('requests.free_text')}</button>
      </div>
      <div id="rq-lines" class="list"></div>
      <div class="field"><label for="rq-note">${t('common.note')}</label><input id="rq-note" class="input" name="note"></div>
    </div>`,
    submitLabel: t('requests.send'),
    onOpen(root) {
      const box = $('#rq-lines', root);
      const refreshNeeds = (l) => {
        const chip = $(`[data-line="${l.key}"] [data-needs]`, box);
        if (chip) chip.classList.toggle('hidden', !(l.part && Number(l.qty) * Number(l.part.selling_price) >= limit));
      };
      const add = (l) => {
        lines.push(l);
        box.appendChild(el(lineRow(l)));
        refreshNeeds(l);
      };
      combo($('#rq-part', root), {
        fetch: async (q) => (await api.get('/parts', { q, per_page: 8 })).items,
        render: (p) => html`<div style="flex:1;min-width:0"><div class="strong ellipsis">${nm(p)}</div><div class="small muted">${p.part_no} · ${p.rack || ''} · ${t('requests.in_stock')} ${qty(p.current_stock)}</div></div><div class="num">${money(p.selling_price)}</div>`,
        onSelect: (p) => {
          const existing = lines.find((x) => x.part?.id === p.id);
          if (existing) {
            existing.qty = Number(existing.qty) + 1;
            $(`[data-line="${existing.key}"] [data-qty]`, box).value = qty(existing.qty);
            refreshNeeds(existing);
          } else {
            add({ key: ++seq, part: p, label: nm(p), qty: 1 });
          }
          $('#rq-part', root).value = '';
          $('#rq-part', root).focus();
        },
      });
      on(root, 'click', '#rq-free-add', () => {
        const name = $('#rq-free', root).value.trim();
        if (!name) return;
        add({ key: ++seq, part: null, label: name, custom: name, qty: 1 });
        $('#rq-free', root).value = '';
      });
      on(box, 'click', '[data-step]', (e, b) => {
        const l = lines.find((x) => x.key === Number(b.closest('[data-line]').dataset.line));
        l.qty = Math.max(1, Number(l.qty) + Number(b.dataset.step));
        b.parentElement.querySelector('[data-qty]').value = qty(l.qty);
        refreshNeeds(l);
      });
      on(box, 'input', '[data-qty]', (e, inp) => {
        const l = lines.find((x) => x.key === Number(inp.closest('[data-line]').dataset.line));
        l.qty = Number(inp.value.replace(',', '.')) || 0;
        refreshNeeds(l);
      });
      on(box, 'click', '[data-remove]', (e, b) => {
        const row = b.closest('[data-line]');
        lines.splice(lines.findIndex((x) => x.key === Number(row.dataset.line)), 1);
        row.remove();
      });
    },
    onSubmit: async (d) => {
      const items = lines.filter((l) => Number(l.qty) > 0).map((l) => (l.part ? { part_id: l.part.id, qty: l.qty } : { custom_name: l.custom, qty: l.qty }));
      if (!items.length) {
        toast(t('purchases.no_lines'), 'error');
        return false;
      }
      const res = await api.post('/requests', { job_card_id: job.id, note: d.note, items });
      toast(t('requests.sent'));
      return res.item;
    },
  });
}
