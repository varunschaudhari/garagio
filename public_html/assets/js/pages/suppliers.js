import { html, setHTML, $, on, debounce, replaceQuery } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../ui/icons.js';
import { money } from '../format.js';
import { dataTable, bindTable, pager, emptyState, skeletonRows } from '../ui/table.js';
import { field } from '../ui/form.js';
import { openDrawer } from '../ui/drawer.js';
import { toast, toastError } from '../ui/toast.js';

const PER_PAGE = 100;

let statesCache = null;
async function states() {
  if (!statesCache) statesCache = (await api.get('/settings')).states;
  return statesCache;
}

/** Create or edit a supplier. Resolves with the saved supplier or null. */
export async function openSupplierForm(s = null) {
  const st = await states();
  const isNew = !s;
  const v = s || {};
  return openDrawer({
    title: isNew ? t('suppliers.new') : t('suppliers.edit'),
    body: html`<div class="form-grid">
      ${field({ name: 'name', label: t('suppliers.name'), value: v.name, required: true, span2: true })}
      ${field({ name: 'contact_person', label: t('suppliers.contact_person'), value: v.contact_person })}
      ${field({ name: 'phone', label: t('common.phone'), value: v.phone, type: 'tel', inputmode: 'tel' })}
      ${field({ name: 'gstin', label: t('suppliers.gstin'), value: v.gstin, placeholder: '27ABCDE1234F1Z5' })}
      ${field({ name: 'state_code', label: t('suppliers.state'), type: 'select', value: v.state_code || '27', options: Object.entries(st).map(([c, n]) => ({ value: c, label: `${c} · ${n}` })) })}
      ${field({ name: 'opening_balance', label: t('suppliers.opening_balance'), type: 'number', value: v.opening_balance ?? 0, hint: t('suppliers.opening_hint'), inputmode: 'text' })}
      ${field({ name: 'address', label: t('common.address'), type: 'textarea', value: v.address, rows: 2, span2: true })}
      ${isNew ? '' : field({ name: 'active', label: t('common.active'), type: 'switch', value: v.active })}
    </div>`,
    onSubmit: async (d) => {
      const res = isNew ? await api.post('/suppliers', d) : await api.put('/suppliers/' + s.id, d);
      toast(isNew ? t('common.created') : t('common.saved'));
      return res.item;
    },
  });
}

export default async function suppliers(ctx) {
  ctx.setTitle(t('suppliers.title'));
  const st = { q: ctx.query.q || '', due: ctx.query.due === '1', page: Number(ctx.query.page || 1) };

  setHTML(ctx.el, html`
    <div class="page-head">
      <div style="flex:1"><h1>${t('suppliers.title')}</h1><div class="sub" id="sup-payable"></div></div>
      <a class="btn btn-secondary" href="#/purchases/new">${icon('truck')}${t('suppliers.new_purchase')}</a>
      <button class="btn btn-primary" data-act="new">${icon('plus')}${t('suppliers.new')}</button>
    </div>
    <div class="card">
      <div class="toolbar">
        <div class="input-group">${icon('search')}<input class="input" type="search" name="q" value="${st.q}" placeholder="${t('common.search_placeholder')}" aria-label="${t('common.search')}"></div>
        <button class="filter-chip" data-chip="due" aria-pressed="${st.due}">${icon('indian-rupee', 16)}${t('suppliers.due_only')}</button>
      </div>
      <div id="sup-list">${skeletonRows()}</div>
    </div>`);
  const list = $('#sup-list', ctx.el);

  const load = async () => {
    replaceQuery({ q: st.q, due: st.due ? 1 : '', page: st.page > 1 ? st.page : '' });
    let data;
    try {
      data = await api.get('/suppliers', { q: st.q, due: st.due, page: st.page, per_page: PER_PAGE });
    } catch (e) {
      toastError(e);
      return;
    }
    if (!ctx.alive()) return;
    $('#sup-payable', ctx.el).textContent = `${t('suppliers.payable_total')}: ${money(data.payable_total)}`;
    setHTML(list, html`${dataTable({
      columns: [
        { key: 'name', label: t('suppliers.name'), primary: true, render: (s) => html`<div class="t-title">${s.name}</div><div class="t-sub">${[s.contact_person, s.phone, s.gstin].filter(Boolean).join(' · ')}</div>` },
        { key: 'state', label: t('suppliers.state'), render: (s) => s.state_code },
        { key: 'balance', label: t('suppliers.balance'), num: true, render: (s) => html`<span class="strong" style="${s.balance > 0 ? 'color:var(--danger-text)' : ''}">${money(s.balance)}</span>` },
      ],
      rows: data.items,
      rowHref: (s) => '#/suppliers/' + s.id,
      empty: emptyState({ ic: 'store', title: t('suppliers.empty_title'), text: t('suppliers.empty_text'), action: html`<button class="btn btn-primary" data-act="new">${icon('plus')}${t('suppliers.new')}</button>` }),
    })}${pager(data.total, st.page, PER_PAGE)}`);
  };

  bindTable(list);
  on(list, 'click', '[data-page]', (e, b) => { st.page = Number(b.dataset.page); load(); });
  on(ctx.el, 'input', 'input[name=q]', debounce((e) => { st.q = e.target.value.trim(); st.page = 1; load(); }, 250));
  on(ctx.el, 'click', '[data-chip="due"]', (e, b) => { st.due = !st.due; b.setAttribute('aria-pressed', String(st.due)); st.page = 1; load(); });
  on(ctx.el, 'click', '[data-act="new"]', async () => {
    const s = await openSupplierForm();
    if (s) location.hash = '#/suppliers/' + s.id;
  });
  await load();
}
