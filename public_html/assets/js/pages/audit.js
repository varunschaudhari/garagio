import { html, setHTML, on, $ } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../ui/icons.js';
import { datetime } from '../format.js';
import { skeletonRows } from '../ui/table.js';
import { toastError } from '../ui/toast.js';

/** Where an entry points to, by entity. */
const LINK = {
  invoice: (id) => `#/invoices/${id}`,
  job: (id) => `#/jobs/${id}`,
  part: (id) => `#/parts/${id}`,
  customer: (id) => `#/customers/${id}`,
  supplier: (id) => `#/suppliers/${id}`,
  purchase: (id) => `#/purchases/${id}`,
  user: () => '#/users',
  settings: () => '#/settings',
};

export function auditLabel(action) {
  for (const key of [`audit.actions.${action}`, `jobs.events.${action}`]) {
    const v = t(key);
    if (v !== key) return v;
  }
  return action.replace(/_/g, ' ');
}

const show = (v) => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80);
  return String(v);
};

/** "field: before → after" for what changed; permission maps list only the ticks that changed. */
export function auditDetails(it) {
  const a = it.after && typeof it.after === 'object' ? it.after : {};
  const b = it.before && typeof it.before === 'object' ? it.before : {};
  const parts = [];
  for (const k of [...new Set([...Object.keys(b), ...Object.keys(a)])].slice(0, 8)) {
    if (k === 'perms' && a.perms && b.perms) {
      for (const p of Object.keys(a.perms)) {
        if (!!a.perms[p] !== !!b.perms[p]) parts.push(`${t('users.perms.' + p)}: ${a.perms[p] ? '✓' : '✗'}`);
      }
      continue;
    }
    parts.push(k in a && k in b ? `${k}: ${show(b[k])} → ${show(a[k])}` : `${k}: ${show(k in a ? a[k] : b[k])}`);
  }
  return parts.join(' · ');
}

export default async function auditPage(ctx) {
  ctx.setTitle(t('audit.title'));
  const f = { kind: 'important', from: '', to: '', action: '', user_id: '', page: 1 };
  let items = [];
  let total = 0;

  setHTML(ctx.el, html`
    <div class="page-head"><h1>${t('audit.title')}</h1></div>
    <div class="card" style="margin-bottom:16px"><div class="card-body row-wrap" id="audit-filters"></div></div>
    <div class="card" id="audit-list">${skeletonRows(6)}</div>`);

  const drawFilters = (meta) => {
    setHTML($('#audit-filters', ctx.el), html`
      <div class="seg" role="group" aria-label="${t('audit.title')}">
        <button data-kind="important" aria-pressed="${f.kind === 'important'}">${t('audit.important')}</button>
        <button data-kind="all" aria-pressed="${f.kind === 'all'}">${t('audit.everything')}</button>
      </div>
      <label class="small">${t('common.from')} <input class="input" type="date" data-f="from" value="${f.from}" style="width:auto"></label>
      <label class="small">${t('common.to')} <input class="input" type="date" data-f="to" value="${f.to}" style="width:auto"></label>
      <select class="select" data-f="action" style="width:auto" aria-label="${t('audit.what')}">
        <option value="">${t('audit.any_action')}</option>
        ${meta.actions.map((a) => html`<option value="${a}" ${a === f.action ? 'selected' : ''}>${auditLabel(a)}</option>`)}
      </select>
      <select class="select" data-f="user_id" style="width:auto" aria-label="${t('audit.who')}">
        <option value="">${t('audit.any_user')}</option>
        ${meta.users.map((u) => html`<option value="${u.id}" ${String(u.id) === f.user_id ? 'selected' : ''}>${u.name}</option>`)}
      </select>`);
  };

  const drawList = () => {
    setHTML($('#audit-list', ctx.el), items.length
      ? html`<div class="list">${items.map((it) => {
          const href = LINK[it.entity] && it.entity_id !== null ? LINK[it.entity](it.entity_id) : LINK[it.entity]?.() || null;
          return html`<div class="list-item" style="align-items:flex-start">
            <span class="kpi-icon">${icon(it.entity === 'job' ? 'clipboard-list' : 'shield-check', 16)}</span>
            <div style="flex:1;min-width:0">
              <div class="strong">${auditLabel(it.action)}${href ? html` · <a href="${href}">${it.entity} #${it.entity_id ?? ''}</a>` : ''}</div>
              <div class="small muted">${datetime(it.created_at)} · ${it.user_name || t('audit.system')}${it.ip && it.ip !== 'cli' ? ' · ' + it.ip : ''}</div>
              ${auditDetails(it) ? html`<div class="small" style="margin-top:2px;overflow-wrap:anywhere">${auditDetails(it)}</div>` : ''}
            </div>
          </div>`;
        })}</div>
        ${items.length < total ? html`<div class="card-foot"><button class="btn btn-secondary" data-more>${t('audit.more')} (${items.length}/${total})</button></div>` : ''}`
      : html`<div class="card-body muted">${t('audit.none')}</div>`);
  };

  const load = async (append = false) => {
    try {
      const params = { kind: f.kind, page: f.page, per_page: 50 };
      for (const k of ['from', 'to', 'action', 'user_id']) if (f[k]) params[k] = f[k];
      const res = await api.get('/audit', params);
      if (!ctx.alive()) return;
      items = append ? items.concat(res.items) : res.items;
      total = res.total;
      drawFilters(res);
      drawList();
    } catch (e) {
      toastError(e);
    }
  };

  on(ctx.el, 'click', '[data-kind]', (e, b) => { f.kind = b.dataset.kind; f.page = 1; load(); });
  on(ctx.el, 'change', '[data-f]', (e, el) => { f[el.dataset.f] = el.value; f.page = 1; load(); });
  on(ctx.el, 'click', '[data-more]', () => { f.page += 1; load(true); });
  await load();
}
