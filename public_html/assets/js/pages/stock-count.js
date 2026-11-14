import { html, setHTML, $, $$, on } from '../dom.js';
import { t, nm, nmAlt } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../ui/icons.js';
import { qty, datetime } from '../format.js';
import { emptyState, skeletonRows } from '../ui/table.js';
import { confirmDialog } from '../ui/modal.js';
import { toast, toastError } from '../ui/toast.js';
import { busy } from '../ui/form.js';
import { loadMasters } from './part-form.js';

export default async function stockCount(ctx) {
  ctx.setTitle(t('stock.count_title'));
  const { locations } = await loadMasters(true);
  let locationId = Number(ctx.query.location || locations[0]?.id || 0);
  let parts = [];
  const counted = new Map(); // part_id → number

  ctx.setLeaveGuard(() => (counted.size ? t('stock.unsaved') : null));
  const beforeUnload = (e) => {
    if (counted.size) { e.preventDefault(); e.returnValue = ''; }
  };
  window.addEventListener('beforeunload', beforeUnload);

  setHTML(ctx.el, html`
    <div class="page-head">
      <div style="flex:1"><h1>${t('stock.count_title')}</h1><div class="sub">${t('stock.count_sub')}</div></div>
    </div>
    <div class="card" style="margin-bottom:20px">
      <div class="toolbar">
        <div class="seg" role="group" aria-label="${t('stock.pick_location')}">
          ${locations.map((l) => html`<button type="button" data-loc="${l.id}" aria-pressed="${l.id === locationId}">${nm(l)}</button>`)}
        </div>
        <div class="input-group">${icon('scan-line')}<input class="input" id="sc-find" placeholder="${t('stock.jump_rack')} / ${t('parts.part_no')}" aria-label="${t('stock.jump_rack')}"></div>
      </div>
      <div id="sc-list">${skeletonRows()}</div>
      <div class="card-foot" style="flex-wrap:wrap">
        <input class="input" id="sc-note" placeholder="${t('stock.count_note')}" style="flex:1;min-width:200px">
        <span id="sc-summary" class="muted"></span>
        <button class="btn btn-primary" id="sc-post" disabled>${icon('check')}${t('stock.post_count')}</button>
      </div>
    </div>
    <div class="card" id="sc-history"></div>`);

  const list = $('#sc-list', ctx.el);

  const summary = () => {
    let diffs = 0;
    for (const p of parts) {
      if (counted.has(p.id) && Number(counted.get(p.id)) !== Number(p.current_stock)) diffs++;
    }
    $('#sc-summary', ctx.el).textContent = counted.size ? `${counted.size} ${t('stock.counted').toLowerCase()} · ${t('stock.changed_lines', { n: diffs })}` : '';
    $('#sc-post', ctx.el).disabled = counted.size === 0;
    return diffs;
  };

  const drawList = () => {
    if (!parts.length) {
      setHTML(list, emptyState({ ic: 'package', title: t('parts.empty_title') }));
      return;
    }
    let lastRack = null;
    setHTML(list, html`
      <div class="count-row small muted" style="font-weight:600;text-transform:uppercase">
        <span>${t('parts.part')}</span><span class="sys num">${t('stock.system_qty')}</span><span class="num">${t('stock.counted')}</span>
      </div>
      ${parts.map((p) => {
        const rack = p.rack || '—';
        const head = rack !== lastRack ? html`<div class="rack-head" data-rack="${rack}">${t('parts.rack')} ${rack}</div>` : '';
        lastRack = rack;
        const c = counted.get(p.id);
        const changed = c !== undefined && Number(c) !== Number(p.current_stock);
        return html`${head}
          <div class="count-row ${changed ? 'changed' : ''}" data-row="${p.id}">
            <div style="min-width:0"><div class="strong ellipsis">${nm(p)}</div><div class="small muted ellipsis">${p.part_no}${nmAlt(p) ? ' · ' + nmAlt(p) : ''}</div></div>
            <div class="sys num">${qty(p.current_stock)}</div>
            <input class="input num" data-count="${p.id}" inputmode="decimal" value="${c ?? ''}" placeholder="${qty(p.current_stock)}" aria-label="${t('stock.counted')} ${p.part_no}">
          </div>`;
      })}`);
  };

  const loadParts = async () => {
    setHTML(list, skeletonRows());
    const data = await api.get('/parts', { location: locationId, sort: 'rack', per_page: 1000 });
    if (!ctx.alive()) return;
    parts = data.items;
    drawList();
    summary();
  };

  const loadHistory = async () => {
    const h = await api.get('/stock-counts', { per_page: 10 });
    if (!ctx.alive()) return;
    setHTML($('#sc-history', ctx.el), html`
      <div class="card-head"><h3>${t('stock.history')}</h3></div>
      ${h.items.length ? html`<div class="list">${h.items.map((s) => html`
        <div class="list-item">
          <div style="flex:1"><div class="strong">SC-${s.id} · ${nm(s, 'location') || t('common.all')}</div>
          <div class="small muted">${datetime(s.created_at)} · ${s.user_name || ''}${s.note ? ' · ' + s.note : ''}</div></div>
          <div class="num small"><div>${s.lines_counted} ${t('stock.counted').toLowerCase()}</div><div class="${s.lines_changed ? 'badge-low' : 'muted'}">${t('stock.changed_lines', { n: s.lines_changed })}</div></div>
        </div>`)}</div>` : html`<div class="card-body muted">—</div>`}`);
  };

  on(ctx.el, 'click', '[data-loc]', async (e, b) => {
    if (counted.size && !(await confirmDialog({ title: t('stock.unsaved'), confirmLabel: t('common.confirm'), danger: true }))) return;
    counted.clear();
    locationId = Number(b.dataset.loc);
    $$('[data-loc]', ctx.el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    loadParts();
  });

  on(ctx.el, 'input', '[data-count]', (e, input) => {
    const id = Number(input.dataset.count);
    const v = input.value.trim().replace(',', '.');
    if (v === '' || Number.isNaN(Number(v)) || Number(v) < 0) counted.delete(id);
    else counted.set(id, Number(v));
    const p = parts.find((x) => x.id === id);
    input.closest('.count-row').classList.toggle('changed', counted.has(id) && Number(counted.get(id)) !== Number(p.current_stock));
    summary();
  });

  // Enter moves to the next row, like walking the rack.
  on(ctx.el, 'keydown', '[data-count]', (e, input) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const all = $$('[data-count]', ctx.el);
    const next = all[all.indexOf(input) + 1];
    if (next) { next.focus(); next.select(); }
  });

  // Jump: rack name, part number, or a scanned QR (part no. or RACK|loc|rack).
  on(ctx.el, 'keydown', '#sc-find', (e, input) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    let v = input.value.trim().toUpperCase();
    if (!v) return;
    if (v.startsWith('RACK|')) v = v.split('|')[2] || '';
    const rackHead = $(`[data-rack="${CSS.escape(v)}"]`, ctx.el);
    const part = parts.find((p) => p.part_no === v);
    if (part) {
      const field = $(`[data-count="${part.id}"]`, ctx.el);
      field.scrollIntoView({ block: 'center', behavior: 'smooth' });
      field.focus();
    } else if (rackHead) {
      rackHead.scrollIntoView({ block: 'start', behavior: 'smooth' });
      const firstInput = rackHead.nextElementSibling?.querySelector('[data-count]');
      if (firstInput) firstInput.focus({ preventScroll: true });
    } else {
      toast(t('common.no_results'), 'info');
    }
    input.value = '';
  });

  on(ctx.el, 'click', '#sc-post', async (e, btn) => {
    const diffs = summary();
    if (!diffs) {
      toast(t('stock.no_changes'), 'info');
    } else if (!(await confirmDialog({ title: t('stock.post_count'), message: t('stock.confirm_post', { n: diffs }), confirmLabel: t('stock.post_count') }))) {
      return;
    }
    await busy(btn, async () => {
      try {
        const lines = [...counted.entries()].map(([part_id, c]) => ({ part_id, counted: c }));
        const res = await api.post('/stock-counts', { location_id: locationId, note: $('#sc-note', ctx.el).value.trim(), lines });
        toast(t('stock.posted', { n: res.lines_changed }));
        counted.clear();
        $('#sc-note', ctx.el).value = '';
        await Promise.all([loadParts(), loadHistory()]);
      } catch (err) {
        toastError(err);
      }
    });
  });

  await Promise.all([loadParts(), loadHistory()]);
  return () => window.removeEventListener('beforeunload', beforeUnload);
}
