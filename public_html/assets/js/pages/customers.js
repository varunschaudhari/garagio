import { html, setHTML, $, on, debounce, replaceQuery } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { hasRole } from '../store.js';
import { icon } from '../ui/icons.js';
import { money } from '../format.js';
import { dataTable, bindTable, pager, emptyState, skeletonRows } from '../ui/table.js';
import { field } from '../ui/form.js';
import { openDrawer } from '../ui/drawer.js';
import { toast, toastError } from '../ui/toast.js';

const PER_PAGE = 50;
const LANGS = () => [{ value: 'mr', label: 'मराठी' }, { value: 'en', label: 'English' }];

/** Create or edit a customer. New customers may get their first bike in the same form. */
export function openCustomerForm(c = null) {
  const isNew = !c;
  const v = c || {};
  return openDrawer({
    title: isNew ? t('customers.new') : t('customers.edit'),
    body: html`<div class="form-grid">
      ${field({ name: 'name', label: t('common.name'), value: v.name, required: true, span2: true })}
      ${field({ name: 'phone', label: t('common.phone'), value: v.phone, type: 'tel', inputmode: 'tel', required: true })}
      ${field({ name: 'alt_phone', label: t('customers.alt_phone'), value: v.alt_phone, type: 'tel', inputmode: 'tel' })}
      ${field({ name: 'language', label: t('customers.language'), type: 'select', value: v.language || 'mr', options: LANGS() })}
      ${field({ name: 'gstin', label: t('customers.gstin'), value: v.gstin, placeholder: '27ABCDE1234F1Z5' })}
      ${field({ name: 'address', label: t('common.address'), type: 'textarea', value: v.address, rows: 2, span2: true })}
      ${hasRole('owner') ? field({ name: 'opening_balance', label: t('customers.opening_balance'), type: 'number', value: v.opening_balance ?? 0, inputmode: 'text' }) : ''}
      ${isNew ? html`
        <div class="form-section">${t('jobs.new_bike')}</div>
        ${field({ name: 'reg_no', label: t('jobs.reg_no'), placeholder: 'MH12AB1234' })}
        ${field({ name: 'make', label: t('jobs.make'), placeholder: 'Hero' })}
        ${field({ name: 'model', label: t('jobs.model'), placeholder: 'Splendor Plus' })}
        ${field({ name: 'year', label: t('jobs.year'), type: 'number', dtype: 'int' })}` : ''}
    </div>`,
    onSubmit: async (d) => {
      const { reg_no, make, model, year, ...cust } = d;
      if (isNew && reg_no) cust.vehicles = [{ reg_no, make, model, year }];
      const res = isNew ? await api.post('/customers', cust) : await api.put('/customers/' + c.id, cust);
      toast(isNew ? t('common.created') : t('common.saved'));
      return res.item;
    },
  });
}

export function openVehicleForm(customerId, v = null) {
  const isNew = !v;
  const x = v || {};
  return openDrawer({
    title: isNew ? t('customers.add_bike') : x.reg_no,
    body: html`<div class="form-grid">
      ${field({ name: 'reg_no', label: t('jobs.reg_no'), value: x.reg_no, required: true, placeholder: 'MH12AB1234' })}
      ${field({ name: 'make', label: t('jobs.make'), value: x.make })}
      ${field({ name: 'model', label: t('jobs.model'), value: x.model })}
      ${field({ name: 'year', label: t('jobs.year'), type: 'number', dtype: 'int', value: x.year })}
      ${field({ name: 'last_odometer', label: t('jobs.odometer'), type: 'number', dtype: 'int', value: x.last_odometer })}
    </div>`,
    onSubmit: async (d) => {
      const res = isNew ? await api.post(`/customers/${customerId}/vehicles`, d) : await api.put('/vehicles/' + v.id, d);
      toast(t('common.saved'));
      return res.item;
    },
  });
}

export default async function customers(ctx) {
  ctx.setTitle(t('customers.title'));
  const st = { q: ctx.query.q || '', due: ctx.query.due === '1', trusted: ctx.query.trusted === '1', page: Number(ctx.query.page || 1) };
  setHTML(ctx.el, html`
    <div class="page-head">
      <h1>${t('customers.title')}</h1>
      <button class="btn btn-primary" data-act="new">${icon('plus')}${t('customers.new')}</button>
    </div>
    <div class="card">
      <div class="toolbar">
        <div class="input-group">${icon('search')}<input class="input" type="search" name="q" value="${st.q}" placeholder="${t('customers.search_placeholder')}" aria-label="${t('common.search')}"></div>
        <div class="filter-chips">
          <button class="filter-chip" data-chip="due" aria-pressed="${st.due}">${icon('indian-rupee', 16)}${t('customers.due_only')}</button>
          <button class="filter-chip" data-chip="trusted" aria-pressed="${st.trusted}">${icon('shield-check', 16)}${t('customers.trusted_only')}</button>
        </div>
      </div>
      <div id="cust-list">${skeletonRows()}</div>
    </div>`);
  const list = $('#cust-list', ctx.el);

  const load = async () => {
    replaceQuery({ q: st.q, due: st.due ? 1 : '', trusted: st.trusted ? 1 : '', page: st.page > 1 ? st.page : '' });
    let data;
    try {
      data = await api.get('/customers', { q: st.q, due: st.due, trusted: st.trusted, page: st.page, per_page: PER_PAGE });
    } catch (e) {
      toastError(e);
      return;
    }
    if (!ctx.alive()) return;
    setHTML(list, html`${dataTable({
      columns: [
        { key: 'name', label: t('common.name'), primary: true, render: (c) => html`<div class="t-title">${c.name} ${c.is_trusted ? html`<span class="chip success plain">${t('customers.trusted_only')}</span>` : ''}</div><div class="t-sub">${c.phone}</div>` },
        { key: 'bikes', label: t('customers.bikes'), render: (c) => c.reg_nos || '—' },
        { key: 'balance', label: t('customers.balance'), num: true, render: (c) => html`<span class="strong" style="${c.balance > 0 ? 'color:var(--danger-text)' : ''}">${money(c.balance)}</span>` },
      ],
      rows: data.items,
      rowHref: (c) => '#/customers/' + c.id,
      empty: emptyState({ ic: 'users', title: t('customers.empty_title'), text: t('customers.empty_text') }),
    })}${pager(data.total, st.page, PER_PAGE)}`);
  };

  bindTable(list);
  on(list, 'click', '[data-page]', (e, b) => { st.page = Number(b.dataset.page); load(); });
  on(ctx.el, 'input', 'input[name=q]', debounce((e) => { st.q = e.target.value.trim(); st.page = 1; load(); }, 250));
  on(ctx.el, 'click', '[data-chip]', (e, b) => {
    const k = b.dataset.chip;
    st[k] = !st[k];
    b.setAttribute('aria-pressed', String(st[k]));
    st.page = 1;
    load();
  });
  on(ctx.el, 'click', '[data-act="new"]', async () => {
    const c = await openCustomerForm();
    if (c) location.hash = '#/customers/' + c.id;
  });
  await load();
}
