import { html, setHTML, $, on } from '../dom.js';
import { t, nm, nmAlt } from '../i18n.js';
import { api } from '../api.js';
import { hasRole, session } from '../store.js';
import { icon } from '../ui/icons.js';
import { money, qty, datetime } from '../format.js';
import { dataTable, pager, emptyState, skeletonRows } from '../ui/table.js';
import { openDrawer } from '../ui/drawer.js';
import { field } from '../ui/form.js';
import { toast } from '../ui/toast.js';
import { openPartForm } from './part-form.js';
import { printPartLabel } from './parts.js';

const PER_PAGE = 50;

const REF_LINK = {
  job: (id) => '#/jobs/' + id,
  purchase: (id) => '#/purchases/' + id,
  invoice: (id) => '#/invoices/' + id,
};

export default async function partPage(ctx) {
  const id = Number(ctx.params.id);
  const canEdit = hasRole('owner', 'inventory');
  let page = 1;
  let part;

  setHTML(ctx.el, skeletonRows(5));

  const drawHeader = () => {
    ctx.setTitle(nm(part));
    const low = part.is_low;
    setHTML($('#part-head', ctx.el), html`
      <div class="page-head">
        <div style="flex:1;min-width:240px">
          <a href="#/parts" class="small muted">${icon('arrow-left', 14)} ${t('parts.catalogue')}</a>
          <h1 style="margin-top:6px">${nm(part)}</h1>
          <div class="sub">${part.part_no}${nmAlt(part) ? ' · ' + nmAlt(part) : ''}${part.brand ? ' · ' + part.brand : ''}
            ${!part.active ? html` <span class="chip">${t('parts.inactive_part')}</span>` : ''}</div>
        </div>
        <button class="btn btn-secondary" data-act="label">${icon('qr-code')}${t('parts.print_label')}</button>
        ${canEdit ? html`
          <button class="btn btn-secondary" data-act="adjust">${icon('arrow-up-down')}${t('parts.adjust')}</button>
          <button class="btn btn-primary" data-act="edit">${icon('pencil')}${t('common.edit')}</button>` : ''}
      </div>
      <div class="kpis" style="margin-bottom:20px">
        <div class="card kpi">
          <div class="kpi-label"><span class="kpi-icon ${low ? 'danger' : 'success'}">${icon('boxes', 18)}</span>${t('parts.current_stock')}</div>
          <div class="kpi-value ${low ? 'badge-low' : ''}">${qty(part.current_stock)} <span class="small muted">${part.unit}</span></div>
          <div class="kpi-sub">${t('parts.min_stock')}: ${qty(part.min_stock)}${part.open_request_qty ? ' · ' + t('parts.open_requests') + ': ' + qty(part.open_request_qty) : ''}</div>
        </div>
        <div class="card kpi">
          <div class="kpi-label"><span class="kpi-icon">${icon('map-pin', 18)}</span>${t('parts.location')}</div>
          <div class="kpi-value" style="font-size:20px">${nm(part, 'location') || '—'}</div>
          <div class="kpi-sub">${t('parts.rack')}: <span class="strong">${part.rack || '—'}</span></div>
        </div>
        <div class="card kpi">
          <div class="kpi-label"><span class="kpi-icon info">${icon('tag', 18)}</span>${t('parts.mrp')}</div>
          <div class="kpi-value">${money(part.selling_price)}</div>
          <div class="kpi-sub">GST ${qty(part.gst_rate)}% · HSN ${part.hsn || '—'}</div>
        </div>
        ${session.canSeeCost ? html`
        <div class="card kpi">
          <div class="kpi-label"><span class="kpi-icon warning">${icon('indian-rupee', 18)}</span>${t('parts.avg_cost')}</div>
          <div class="kpi-value">${money(part.avg_cost)}</div>
          <div class="kpi-sub">${t('parts.last_purchase_price')}: ${money(part.last_purchase_price)} − ${qty(part.last_purchase_disc_pct)}% · ${t('parts.stock_value')}: ${money(part.stock_value)}</div>
        </div>` : ''}
      </div>
      <div class="card card-pad" style="margin-bottom:20px">
        <dl class="dl">
          <dt>${t('parts.category')}</dt><dd>${nm(part, 'category') || '—'}</dd>
          <dt>${t('parts.compatible_models')}</dt><dd>${part.compatible_models || '—'}</dd>
          <dt>${t('parts.unit')}</dt><dd>${part.unit}</dd>
        </dl>
      </div>`);
  };

  const loadLedger = async () => {
    const box = $('#ledger', ctx.el);
    const data = await api.get(`/parts/${id}/ledger`, { page, per_page: PER_PAGE });
    if (!ctx.alive()) return;
    part = { ...part, ...data.part };
    drawHeader();
    const columns = [
      { key: 'date', label: t('common.date'), render: (m) => html`<span class="nowrap">${datetime(m.created_at)}</span>` },
      { key: 'type', label: t('common.type'), primary: true, render: (m) => html`<div class="t-title">${t('movement.' + m.mtype)}</div>${m.note ? html`<div class="t-sub">${m.note}</div>` : ''}` },
      { key: 'ref', label: t('common.reference'), render: (m) => m.ref_label && REF_LINK[m.ref_type] ? html`<a href="${REF_LINK[m.ref_type](m.ref_id)}">${m.ref_label}</a>` : m.ref_label || '—' },
      { key: 'qty', label: t('common.qty'), num: true, render: (m) => html`<span class="strong" style="color:${m.qty > 0 ? 'var(--success-text)' : 'var(--danger-text)'}">${m.qty > 0 ? '+' : ''}${qty(m.qty)}</span>` },
      { key: 'balance', label: t('common.balance'), num: true, render: (m) => qty(m.balance_after) },
    ];
    if (session.canSeeCost) columns.push({ key: 'unit_cost', label: t('parts.avg_cost'), num: true, render: (m) => money(m.unit_cost) });
    columns.push({ key: 'user', label: t('common.user'), render: (m) => m.user_name || '—' });
    setHTML(box, html`
      <div class="card-head">
        <h3>${t('parts.ledger')}</h3>
        ${data.balanced ? html`<span class="chip success">${t('parts.balanced')}</span>` : html`<span class="chip danger">Σ ${qty(data.ledger_sum)}</span>`}
      </div>
      ${dataTable({ columns, rows: data.items, empty: emptyState({ ic: 'history', title: t('parts.ledger_empty') }) })}
      ${pager(data.total, page, PER_PAGE)}`);
  };

  const first = await api.get('/parts/' + id);
  if (!ctx.alive()) return;
  part = first.item;
  setHTML(ctx.el, html`<div id="part-head"></div><div class="card" id="ledger">${skeletonRows(4)}</div>`);
  drawHeader();
  await loadLedger();

  on(ctx.el, 'click', '[data-page]', (e, b) => { page = Number(b.dataset.page); loadLedger(); });
  on(ctx.el, 'click', '[data-act="label"]', () => printPartLabel(part));
  on(ctx.el, 'click', '[data-act="edit"]', async () => {
    const saved = await openPartForm(part);
    if (saved) { part = saved; page = 1; loadLedger(); }
  });
  on(ctx.el, 'click', '[data-act="adjust"]', async () => {
    const res = await openDrawer({
      title: t('parts.adjust') + ' · ' + nm(part),
      body: html`<div class="stack">
        <div class="banner">${icon('info')}<span>${t('parts.current_stock')}: <strong>${qty(part.current_stock)} ${part.unit}</strong></span></div>
        ${field({ name: 'qty', label: t('parts.adjust_qty'), type: 'number', required: true, hint: t('parts.adjust_hint'), inputmode: 'text' })}
        ${field({ name: 'reason', label: t('common.reason'), required: true, placeholder: t('parts.adjust_reason_placeholder') })}
      </div>`,
      onSubmit: (data) => api.post(`/parts/${id}/adjust`, data),
    });
    if (res) {
      toast(t('parts.adjusted'));
      page = 1;
      loadLedger();
    }
  });
}
