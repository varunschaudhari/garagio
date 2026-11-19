import { html, setHTML, $, on } from '../dom.js';
import { t, nm } from '../i18n.js';
import { api } from '../api.js';
import { hasRole, can } from '../store.js';
import { icon } from '../ui/icons.js';
import { money, qty, datetime } from '../format.js';
import { statusChip, emptyState, skeletonRows } from '../ui/table.js';
import { combo } from '../ui/combo.js';
import { openModal, promptDialog } from '../ui/modal.js';
import { setBadge } from '../ui/shell.js';
import { toast, toastError } from '../ui/toast.js';

const REFRESH_MS = 20000;

/** Parts requests. Inventory / owner: queue + approvals. Mechanic / desk: their requests. */
export default async function requests(ctx) {
  ctx.setTitle(t('requests.title'));
  const staff = can('issue_parts');
  const tabs = staff ? ['queue', 'approvals', 'done'] : ['queue', 'done'];
  let tab = tabs.includes(ctx.query.tab) ? ctx.query.tab : 'queue';
  let data = null;

  setHTML(ctx.el, html`
    <div class="page-head"><div style="flex:1"><h1>${t('requests.title')}</h1><div class="sub">${t('requests.auto_refresh')}</div></div></div>
    <div class="tabs" role="tablist" id="rq-tabs"></div>
    <div id="rq-body">${skeletonRows(4)}</div>`);
  const body = $('#rq-body', ctx.el);

  const drawTabs = () => {
    const counts = data?.counts || {};
    setHTML($('#rq-tabs', ctx.el), html`${tabs.map((k) => html`<button role="tab" data-tab="${k}" aria-selected="${k === tab}">${t('requests.' + k)}${k === 'queue' && staff && counts.open ? html` <span class="chip info plain">${counts.open}</span>` : ''}${k === 'approvals' && counts.approvals ? html` <span class="chip warning plain">${counts.approvals}</span>` : ''}</button>`)}`);
  };

  const lineActions = (r, it) => {
    if (!staff || r.status !== 'open') return '';
    const remaining = Number(it.qty) - Number(it.issued_qty);
    if (it.status === 'needs_approval') {
      return html`<button class="btn btn-primary btn-sm" data-approve="${it.id}" data-req="${r.id}">${icon('check', 16)}${t('requests.approve')}</button>
        <button class="btn btn-ghost btn-sm" data-reject="${it.id}" data-req="${r.id}">${t('requests.reject')}</button>`;
    }
    if (!['requested', 'approved'].includes(it.status)) return '';
    if (!it.part_id) {
      return html`<button class="btn btn-primary btn-sm" data-link="${it.id}" data-req="${r.id}" data-name="${it.custom_name}">${icon('link', 16)}${t('requests.link')}</button>
        <button class="btn btn-ghost btn-sm" data-unavail="${it.id}" data-req="${r.id}">${t('requests.unavailable')}</button>`;
    }
    const short = Number(it.current_stock) < remaining;
    return html`<button class="btn btn-primary btn-sm" data-issue="${it.id}" data-req="${r.id}" data-left="${remaining}" ${Number(it.current_stock) <= 0 ? 'disabled' : ''}>${icon('package', 16)}${t('requests.issue')}${short ? ' ' + qty(it.current_stock) : ''}</button>
      <button class="btn btn-ghost btn-sm" data-unavail="${it.id}" data-req="${r.id}">${t('requests.unavailable')}</button>`;
  };

  const card = (r) => html`
    <section class="card" aria-label="${r.job_no}">
      <div class="card-head" style="flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <h3><a href="#/jobs/${r.job_card_id}" class="plate">${r.reg_no}</a> <span class="muted" style="font-weight:500">${r.job_no}</span></h3>
          <div class="small muted">${[r.make, r.model].filter(Boolean).join(' ')} · ${t('requests.requested_by')} ${r.requested_by_name} · ${datetime(r.created_at)}${r.mechanic_name && r.mechanic_name !== r.requested_by_name ? html` · ${icon('wrench', 12)} ${r.mechanic_name}` : ''}</div>
          ${r.note ? html`<div class="small" style="margin-top:4px">${icon('info', 13)} ${r.note}</div>` : ''}
        </div>
        ${statusChip(r.status)}
        ${staff && r.status === 'open' && r.items.some((i) => ['requested', 'approved'].includes(i.status) && i.part_id) ? html`<button class="btn btn-secondary btn-sm" data-issue-all="${r.id}">${icon('list-checks', 16)}${t('requests.issue_all')}</button>` : ''}
        ${!staff && r.status === 'open' ? html`<button class="btn btn-ghost btn-sm" data-cancel="${r.id}">${t('requests.cancel')}</button>` : ''}
      </div>
      <div class="table-wrap"><table class="table responsive">
        <thead><tr><th>${t('parts.part')}</th><th>${t('requests.where')}</th><th class="num">${t('requests.in_stock')}</th><th class="num">${t('common.qty')}</th><th class="num">${t('requests.value')}</th><th>${t('common.status')}</th><th></th></tr></thead>
        <tbody>${r.items.map((it) => html`<tr>
          <td class="primary-cell" data-label="${t('parts.part')}">${it.part_id ? html`<div class="t-title">${nm(it)}</div><div class="t-sub">${it.part_no}</div>` : html`<div class="t-title"><em>${it.custom_name}</em></div><div class="t-sub">${t('requests.free_text')}</div>`}${it.remark ? html`<div class="t-sub">${it.remark}</div>` : ''}</td>
          <td data-label="${t('requests.where')}">${it.part_id ? html`${nm(it, 'location') || '—'}${it.rack ? html` · <strong>${it.rack}</strong>` : ''}` : '—'}</td>
          <td class="num" data-label="${t('requests.in_stock')}">${it.part_id ? html`<span class="${Number(it.current_stock) < Number(it.qty) - Number(it.issued_qty) ? 'badge-low' : ''}">${qty(it.current_stock)}</span>` : '—'}</td>
          <td class="num" data-label="${t('common.qty')}">${qty(it.qty)}${Number(it.issued_qty) && it.status !== 'issued' ? html`<div class="t-sub">${t('requests.issued_of', { issued: qty(it.issued_qty), qty: qty(it.qty) })}</div>` : ''}</td>
          <td class="num" data-label="${t('requests.value')}">${it.part_id ? money(it.line_value) : '—'}</td>
          <td data-label="${t('common.status')}">${statusChip(it.status)}${it.approved_by_name && it.status !== 'needs_approval' ? html`<div class="t-sub">${it.approved_by_name}</div>` : ''}</td>
          <td class="actions">${lineActions(r, it)}</td>
        </tr>`)}</tbody>
      </table></div>
    </section>`;

  const load = async () => {
    const params = tab === 'done' ? { status: 'closed' } : { status: 'open', tab: tab === 'approvals' ? 'approvals' : '' };
    if (!staff) params.mine = 1;
    try {
      data = await api.get('/requests', { ...params, per_page: 100 });
    } catch (e) {
      toastError(e);
      return;
    }
    if (!ctx.alive()) return;
    history.replaceState(null, '', '#/requests' + (tab !== 'queue' ? '?tab=' + tab : ''));
    if (staff) setBadge('requests', data.counts.open);
    drawTabs();
    const emptyKey = tab === 'approvals' ? 'requests.empty_approvals' : tab === 'done' ? 'requests.empty_done' : 'requests.empty_queue';
    setHTML(body, data.items.length
      ? html`<div class="stack-lg">${tab === 'approvals' ? html`<div class="banner">${icon('info')}<span>${t('requests.approval_hint', { limit: money(data.approval_limit) })}</span></div>` : ''}${data.items.map(card)}</div>`
      : html`<div class="card">${emptyState({ ic: 'circle-check', title: t(emptyKey) })}</div>`);
  };

  const run = async (btn, fn, okMsg) => {
    if (btn) btn.disabled = true;
    try {
      const res = await fn();
      if (okMsg) toast(okMsg);
      if (res?.skipped?.length) toast(t('requests.skipped', { n: res.skipped.length }), 'info');
    } catch (e) {
      toastError(e);
    }
    await load();
  };

  on(ctx.el, 'click', '[data-tab]', (e, b) => {
    tab = b.dataset.tab;
    setHTML(body, skeletonRows(4));
    load();
  });
  on(body, 'click', '[data-approve]', (e, b) => run(b, () => api.post(`/requests/${b.dataset.req}/items/${b.dataset.approve}/approve`), t('requests.approved_ok')));
  on(body, 'click', '[data-reject]', async (e, b) => {
    const reason = await promptDialog({ title: t('requests.reject'), label: t('requests.reject_reason') });
    if (reason !== null) run(b, () => api.post(`/requests/${b.dataset.req}/items/${b.dataset.reject}/reject`, { reason }), t('requests.rejected_ok'));
  });
  on(body, 'click', '[data-issue]', async (e, b) => {
    const left = Number(b.dataset.left);
    let q = left;
    if (left > 1) {
      const v = await promptDialog({ title: t('requests.issue'), label: t('requests.issue_qty'), value: qty(left) });
      if (v === null) return;
      q = Number(v.replace(',', '.'));
    }
    run(b, () => api.post(`/requests/${b.dataset.req}/items/${b.dataset.issue}/issue`, { qty: q }), t('requests.issued_ok'));
  });
  on(body, 'click', '[data-unavail]', async (e, b) => {
    const remark = await promptDialog({ title: t('requests.unavailable'), label: t('requests.remark'), required: false });
    if (remark !== null) run(b, () => api.post(`/requests/${b.dataset.req}/items/${b.dataset.unavail}/unavailable`, { remark }), t('requests.unavailable_ok'));
  });
  on(body, 'click', '[data-issue-all]', (e, b) => run(b, () => api.post(`/requests/${b.dataset.issueAll}/issue-all`), t('requests.issued_ok')));
  on(body, 'click', '[data-cancel]', (e, b) => run(b, () => api.post(`/requests/${b.dataset.cancel}/cancel`), t('common.saved')));
  on(body, 'click', '[data-link]', async (e, b) => {
    let picked = null;
    await openModal({
      title: t('requests.link_title', { name: b.dataset.name }),
      body: html`<div style="position:relative"><input class="input" id="link-part" placeholder="${t('parts.search_placeholder')}" aria-label="${t('requests.link')}"></div>`,
      actions: [{ label: t('common.cancel'), value: null }],
      onOpen(root, close) {
        combo($('#link-part', root), {
          fetch: async (q) => (await api.get('/parts', { q, per_page: 8 })).items,
          render: (p) => html`<div style="flex:1;min-width:0"><div class="strong ellipsis">${p.part_no} · ${nm(p)}</div><div class="small muted">${t('requests.in_stock')} ${qty(p.current_stock)}</div></div><div class="num">${money(p.selling_price)}</div>`,
          onSelect: (p) => {
            picked = p;
            close('ok');
          },
        });
      },
    });
    if (picked) run(b, () => api.post(`/requests/${b.dataset.req}/items/${b.dataset.link}/link`, { part_id: picked.id }), t('requests.linked_ok'));
  });

  await load();
  const timer = setInterval(() => document.visibilityState === 'visible' && !document.querySelector('.modal, .drawer') && load(), REFRESH_MS);
  return () => clearInterval(timer);
}
