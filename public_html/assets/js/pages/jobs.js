import { html, setHTML, $, on, debounce, replaceQuery } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { hasRole, can } from '../store.js';
import { icon } from '../ui/icons.js';
import { datetime, parseDT } from '../format.js';
import { dataTable, bindTable, statusChip, emptyState, skeletonRows } from '../ui/table.js';
import { toastError } from '../ui/toast.js';

const COLUMNS = ['pending', 'estimate_sent', 'approved', 'in_progress', 'waiting_parts', 'ready', 'delivered'];
const REFRESH_MS = 30000;

function promisedBadge(j) {
  if (!j.promised_at || j.status === 'delivered') return '';
  const late = parseDT(j.promised_at) < new Date();
  return html`<span class="small ${late ? 'badge-low' : 'muted'}">${icon('clock', 13)} ${datetime(j.promised_at).slice(0, 16)}</span>`;
}

function flags(j) {
  return html`${j.approval_lines ? html`<span class="chip warning">${t('jobs.waiting_approval', { n: j.approval_lines })}</span>` : ''}
    ${j.open_lines ? html`<span class="chip info">${t('jobs.parts_pending', { n: j.open_lines })}</span>` : ''}`;
}

export default async function jobs(ctx) {
  const mech = hasRole('mechanic');
  ctx.setTitle(mech ? t('jobs.my_jobs') : t('jobs.title'));
  const st = { view: ctx.query.view || (mech ? 'list' : 'board'), q: ctx.query.q || '', mechanic: ctx.query.mechanic || '', status: ctx.query.status || '' };
  const mechanics = mech ? [] : (await api.get('/users/mechanics')).items;
  if (!ctx.alive()) return;

  setHTML(ctx.el, html`
    <div class="page-head">
      <h1>${mech ? t('jobs.my_jobs') : t('jobs.title')}</h1>
      <div class="seg" role="group">
        <button data-view="board" aria-pressed="${st.view === 'board'}">${icon('layers', 16)} ${t('jobs.board')}</button>
        <button data-view="list" aria-pressed="${st.view === 'list'}">${icon('list-checks', 16)} ${t('jobs.list')}</button>
      </div>
      ${can('jobs') ? html`<a class="btn btn-primary" href="#/jobs/new">${icon('plus')}${t('jobs.new')}</a>` : ''}
    </div>
    <div class="toolbar card" style="margin-bottom:16px;border-bottom:1px solid var(--border)">
      <div class="input-group">${icon('search')}<input class="input" type="search" name="q" value="${st.q}" placeholder="${t('customers.search_placeholder')}" aria-label="${t('common.search')}"></div>
      ${mech ? '' : html`<select class="select" name="mechanic" style="width:auto" aria-label="${t('jobs.mechanic')}">
        <option value="">${t('jobs.all_mechanics')}</option>
        ${mechanics.map((m) => html`<option value="${m.id}" ${String(m.id) === st.mechanic ? 'selected' : ''}>${m.name}</option>`)}
      </select>`}
      ${st.status ? html`<button class="filter-chip" data-clear-status aria-pressed="true">${t('status.' + st.status)} ${icon('x', 14)}</button>` : ''}
    </div>
    <div id="jobs-body">${skeletonRows(5)}</div>`);
  const body = $('#jobs-body', ctx.el);

  const load = async () => {
    replaceQuery({ view: st.view, q: st.q, mechanic: st.mechanic, status: st.status });
    let data;
    try {
      data = await api.get('/jobs', { board: !st.status, status: st.status, q: st.q, mechanic: st.mechanic, per_page: 300 });
    } catch (e) {
      toastError(e);
      return;
    }
    if (!ctx.alive()) return;
    if (st.view === 'board' && !st.status) {
      if (!data.items.length) {
        setHTML(body, html`<div class="card">${emptyState({ ic: 'bike', title: t('jobs.empty_board') })}</div>`);
        return;
      }
      setHTML(body, html`<div class="kanban">${COLUMNS.map((s) => {
        const items = data.items.filter((j) => j.status === s);
        return html`<section class="kanban-col ${items.length ? '' : 'is-empty'}" aria-label="${t('status.' + s)}">
          <h3>${statusChip(s, s === 'delivered' ? t('jobs.delivered_today') : null)}<span class="n">${items.length}</span></h3>
          ${items.map((j) => html`<a class="kanban-card" href="#/jobs/${j.id}">
            <div class="row" style="justify-content:space-between"><span class="reg">${j.reg_no}</span><span class="small muted">${j.job_no}</span></div>
            <div class="small muted ellipsis">${[j.make, j.model].filter(Boolean).join(' ')} · ${j.customer_name}</div>
            ${j.complaint ? html`<div class="small ellipsis" style="margin-top:4px">${j.complaint}</div>` : ''}
            <div class="row-wrap" style="margin-top:8px">${promisedBadge(j)}<span class="small muted">${icon('wrench', 13)} ${j.mechanic_name || t('jobs.no_mechanic')}</span></div>
            <div class="row-wrap" style="margin-top:6px">${flags(j)}</div>
          </a>`)}
        </section>`;
      })}</div>`);
    } else {
      setHTML(body, html`<div class="card">${dataTable({
        columns: [
          { key: 'reg', label: t('jobs.bike'), primary: true, render: (j) => html`<div class="t-title">${j.reg_no} <span class="muted small">${j.job_no}</span></div><div class="t-sub">${[j.make, j.model].filter(Boolean).join(' ')} · ${j.customer_name}</div>` },
          { key: 'status', label: t('common.status'), render: (j) => html`<div class="row-wrap">${statusChip(j.status)}${flags(j)}</div>` },
          { key: 'mechanic', label: t('jobs.mechanic'), render: (j) => j.mechanic_name || '—' },
          { key: 'promised', label: t('jobs.promised'), render: (j) => promisedBadge(j) || '—' },
        ],
        rows: data.items,
        rowHref: (j) => '#/jobs/' + j.id,
        empty: emptyState({ ic: 'bike', title: t('jobs.empty_board') }),
      })}</div>`);
    }
  };

  bindTable(body);
  on(ctx.el, 'click', '[data-view]', (e, b) => {
    st.view = b.dataset.view;
    ctx.el.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    load();
  });
  on(ctx.el, 'input', 'input[name=q]', debounce((e) => { st.q = e.target.value.trim(); load(); }, 250));
  on(ctx.el, 'change', 'select[name=mechanic]', (e, s) => { st.mechanic = s.value; load(); });
  on(ctx.el, 'click', '[data-clear-status]', (e, b) => { st.status = ''; b.remove(); load(); });

  await load();
  const timer = setInterval(() => document.visibilityState === 'visible' && load(), REFRESH_MS);
  return () => clearInterval(timer);
}
