import { html, setHTML, $, on, debounce, replaceQuery } from '../dom.js';
import { t, nm, nmAlt } from '../i18n.js';
import { api, openApiHtml } from '../api.js';
import { hasRole, session, can } from '../store.js';
import { icon } from '../ui/icons.js';
import { money, qty } from '../format.js';
import { dataTable, bindTable, pager, emptyState, skeletonRows } from '../ui/table.js';
import { openModal } from '../ui/modal.js';
import { toast, toastError } from '../ui/toast.js';
import { openPartForm, loadMasters } from './part-form.js';

const PER_PAGE = 50;

export default async function parts(ctx) {
  ctx.setTitle(t('parts.title'));
  const canEdit = can('edit_parts');
  const { categories, locations } = await loadMasters(true);
  const st = {
    q: ctx.query.q || '',
    category: ctx.query.category || '',
    location: ctx.query.location || '',
    low: ctx.query.low === '1',
    in_stock: ctx.query.in_stock === '1',
    all: ctx.query.all === '1',
    sort: ctx.query.sort || 'name',
    page: Number(ctx.query.page || 1),
  };

  setHTML(ctx.el, html`
    <div class="page-head">
      <h1>${t('parts.catalogue')}</h1>
      ${canEdit ? html`
        <button class="btn btn-secondary" data-act="labels">${icon('qr-code')}${t('parts.labels')}</button>
        <button class="btn btn-secondary" data-act="import">${icon('upload')}${t('parts.import')}</button>
        <button class="btn btn-primary" data-act="new">${icon('plus')}${t('parts.new')}</button>` : ''}
    </div>
    <div class="card">
      <div class="toolbar">
        <div class="input-group">${icon('search')}<input class="input" type="search" name="q" value="${st.q}" placeholder="${t('parts.search_placeholder')}" aria-label="${t('common.search')}"></div>
        <select class="select" name="category" style="width:auto" aria-label="${t('parts.category')}">
          <option value="">${t('parts.all_categories')}</option>
          ${categories.map((c) => html`<option value="${c.id}" ${String(c.id) === st.category ? 'selected' : ''}>${nm(c)}</option>`)}
        </select>
        <select class="select" name="location" style="width:auto" aria-label="${t('parts.location')}">
          <option value="">${t('parts.all_locations')}</option>
          ${locations.map((l) => html`<option value="${l.id}" ${String(l.id) === st.location ? 'selected' : ''}>${nm(l)}</option>`)}
        </select>
        <div class="filter-chips">
          <button class="filter-chip" data-chip="low" aria-pressed="${st.low}">${icon('triangle-alert', 16)}${t('parts.low_only')}</button>
          <button class="filter-chip" data-chip="in_stock" aria-pressed="${st.in_stock}">${t('parts.in_stock_only')}</button>
          ${canEdit ? html`<button class="filter-chip" data-chip="all" aria-pressed="${st.all}">${t('parts.show_inactive')}</button>` : ''}
        </div>
      </div>
      <div id="parts-list">${skeletonRows()}</div>
    </div>`);

  const list = $('#parts-list', ctx.el);
  let seq = 0;

  const load = async () => {
    const mine = ++seq;
    replaceQuery({ q: st.q, category: st.category, location: st.location, low: st.low ? 1 : '', in_stock: st.in_stock ? 1 : '', all: st.all ? 1 : '', sort: st.sort !== 'name' ? st.sort : '', page: st.page > 1 ? st.page : '' });
    let data;
    try {
      data = await api.get('/parts', { q: st.q, category: st.category, location: st.location, low: st.low, in_stock: st.in_stock, all: st.all, sort: st.sort, page: st.page, per_page: PER_PAGE });
    } catch (e) {
      if (mine === seq) toastError(e);
      return;
    }
    if (mine !== seq || !ctx.alive()) return;
    const columns = [
      { key: 'name', label: t('parts.part'), primary: true, sort: 'name', render: (p) => html`
          <div class="t-title">${nm(p)} ${!p.active ? html`<span class="chip plain">${t('common.inactive')}</span>` : ''}</div>
          <div class="t-sub">${p.part_no}${nmAlt(p) ? ' · ' + nmAlt(p) : ''}${p.brand ? ' · ' + p.brand : ''}</div>` },
      { key: 'location', label: t('parts.location'), sort: 'rack', render: (p) => html`${nm(p, 'location') || '—'}${p.rack ? html` · <span class="strong">${p.rack}</span>` : ''}` },
      { key: 'category', label: t('parts.category'), render: (p) => nm(p, 'category') || '—' },
      { key: 'selling_price', label: t('parts.mrp'), num: true, sort: 'price', render: (p) => money(p.selling_price) },
      { key: 'stock', label: t('parts.stock'), num: true, sort: 'stock', render: (p) => html`<span class="${p.is_low ? 'badge-low' : 'strong'}">${qty(p.current_stock)}</span> <span class="muted small">${p.unit}</span>${p.is_low ? html` <span class="chip danger">${t('parts.low')}</span>` : ''}` },
    ];
    if (session.canSeeCost) columns.push({ key: 'stock_value', label: t('parts.stock_value'), num: true, render: (p) => money(p.stock_value) });

    const empty = st.q || st.category || st.location || st.low
      ? emptyState({ ic: 'package-search', title: t('parts.not_found', { q: st.q || '…' }) })
      : emptyState({ ic: 'package', title: t('parts.empty_title'), text: t('parts.empty_text'), action: canEdit ? html`<button class="btn btn-primary" data-act="new">${icon('plus')}${t('parts.new')}</button>` : '' });
    setHTML(list, html`${dataTable({ columns, rows: data.items, rowHref: (p) => '#/parts/' + p.id, empty, sort: { key: st.sort, dir: st.sort === 'stock_desc' ? 'desc' : 'asc' } })}${pager(data.total, st.page, PER_PAGE)}`);
  };

  bindTable(list, {
    onSort: (key) => {
      st.sort = key === 'stock' && st.sort === 'stock' ? 'stock_desc' : key;
      st.page = 1;
      load();
    },
  });
  on(list, 'click', '[data-page]', (e, b) => { st.page = Number(b.dataset.page); load(); });
  on(ctx.el, 'input', 'input[name=q]', debounce((e) => { st.q = e.target.value.trim(); st.page = 1; load(); }, 250));
  on(ctx.el, 'change', 'select[name=category], select[name=location]', (e, s) => { st[s.name] = s.value; st.page = 1; load(); });
  on(ctx.el, 'click', '[data-chip]', (e, b) => {
    const k = b.dataset.chip;
    st[k] = !st[k];
    b.setAttribute('aria-pressed', String(st[k]));
    st.page = 1;
    load();
  });
  on(ctx.el, 'click', '[data-act="new"]', async () => {
    const saved = await openPartForm();
    if (saved) location.hash = '#/parts/' + saved.id;
  });
  on(ctx.el, 'click', '[data-act="labels"]', () => labelsDialog(locations, st.location));
  on(ctx.el, 'click', '[data-act="import"]', async () => {
    const mod = await import('./parts-import.js');
    if (await mod.openImport()) load();
  });

  // Hardware barcode / QR scanners type the code and press Enter.
  on(ctx.el, 'keydown', 'input[name=q]', async (e) => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return;
    try {
      const r = await api.get('/parts/by-code/' + encodeURIComponent(e.target.value.trim()));
      location.hash = '#/parts/' + r.item.id;
    } catch {
      /* not an exact code - the list already shows matches */
    }
  });

  await load();
}

async function labelsDialog(locations, currentLocation) {
  let mode = 'part';
  const res = await openModal({
    title: t('parts.labels'),
    body: html`
      <div class="seg" role="group" style="align-self:flex-start">
        <button type="button" data-mode="part" aria-pressed="true">${t('parts.labels_by_part')}</button>
        <button type="button" data-mode="rack" aria-pressed="false">${t('parts.labels_by_rack')}</button>
      </div>
      <div class="field"><label for="lb-loc">${t('parts.location')}</label>
        <select id="lb-loc" class="select"><option value="">${t('parts.all_locations')}</option>
          ${locations.map((l) => html`<option value="${l.id}" ${String(l.id) === String(currentLocation) ? 'selected' : ''}>${nm(l)}</option>`)}
        </select></div>
      <div class="field"><label for="lb-rack">${t('parts.rack')}</label><input id="lb-rack" class="input" placeholder="${t('common.all')}"></div>
      <div class="field" id="lb-copies-f"><label for="lb-copies">${t('parts.labels_copies')}</label><input id="lb-copies" class="input num" value="1" inputmode="numeric"></div>`,
    actions: [
      { label: t('common.cancel'), value: null },
      { label: t('common.print'), kind: 'primary', value: 'go' },
    ],
    onOpen(root) {
      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-mode]');
        if (!b) return;
        mode = b.dataset.mode;
        root.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        root.querySelector('#lb-copies-f').classList.toggle('hidden', mode === 'rack');
      });
      root.addEventListener('click', (e) => {
        if (!e.target.closest('.btn-primary')) return;
        root.dataset.loc = root.querySelector('#lb-loc').value;
        root.dataset.rack = root.querySelector('#lb-rack').value.trim();
        root.dataset.copies = root.querySelector('#lb-copies').value.trim();
        labelsDialog.last = { ...root.dataset };
      }, true);
    },
  });
  if (res !== 'go') return;
  const sel = labelsDialog.last || {};
  try {
    await openApiHtml('/parts/labels', { mode, location: sel.loc, rack: sel.rack, copies: mode === 'part' ? sel.copies : '' });
  } catch (e) {
    toastError(e);
  }
}

export function printPartLabel(part) {
  return openApiHtml('/parts/labels', { ids: part.id, copies: 1 }).catch((e) => toast(e.message, 'error'));
}
