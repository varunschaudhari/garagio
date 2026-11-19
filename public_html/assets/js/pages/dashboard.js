import { html, setHTML, $ } from '../dom.js';
import { t, nm } from '../i18n.js';
import { api } from '../api.js';
import { session, hasRole, can } from '../store.js';
import { icon } from '../ui/icons.js';
import { rupees, money, qty, date, todayISO } from '../format.js';
import { skeletonRows } from '../ui/table.js';
import { BUILT_PHASE } from '../ui/shell.js';

function greeting() {
  const h = new Date().getHours();
  return t(h < 12 ? 'dashboard.greeting_morning' : h < 17 ? 'dashboard.greeting_afternoon' : 'dashboard.greeting_evening');
}

function kpi({ label, value, sub, ic, tone = '', href }) {
  const body = html`
    <div class="kpi-label"><span class="kpi-icon ${tone}">${icon(ic, 18)}</span>${label}</div>
    <div class="kpi-value">${value}</div>
    ${sub ? html`<div class="kpi-sub">${sub}</div>` : ''}`;
  return href ? html`<a class="card kpi" href="${href}">${body}</a>` : html`<div class="card kpi">${body}</div>`;
}

let chartLoading = null;
function loadChart() {
  if (window.Chart) return Promise.resolve(window.Chart);
  chartLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'assets/vendor/chartjs/chart.umd.min.js';
    s.onload = () => resolve(window.Chart);
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return chartLoading;
}

/** 30-day sales: one series → bars in one validated hue, no legend, one ₹ axis, hover tooltip. */
async function drawSalesChart(canvas, series) {
  const Chart = await loadChart();
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  const font = { family: v('--font') || 'Inter, sans-serif', size: 12 };
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: series.map((p) => p.date),
      datasets: [{ data: series.map((p) => p.total), backgroundColor: v('--chart-1'), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', barPercentage: 0.82, categoryPercentage: 1 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 300 },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          backgroundColor: v('--text'),
          titleColor: v('--bg'),
          bodyColor: v('--bg'),
          titleFont: font,
          bodyFont: { ...font, weight: '600' },
          callbacks: { title: (items) => date(items[0].label), label: (item) => money(item.parsed.y) },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { color: v('--border') }, ticks: { color: v('--text-muted'), font, maxRotation: 0, autoSkip: true, maxTicksLimit: 8, callback(val) { return date(this.getLabelForValue(val)).slice(0, 5); } } },
        y: { beginAtZero: true, grid: { color: v('--chart-grid') }, border: { display: false }, ticks: { color: v('--text-muted'), font, maxTicksLimit: 5, callback: (val) => rupees(val) } },
      },
    },
  });
}

/** The shop's eight big buttons, each shown to people who may use it. */
const TILES = [
  { key: 'purchase', ic: 'truck', href: '#/purchases/new', perm: 'purchases', tone: 'info' },
  { key: 'sale', ic: 'receipt', href: '#/invoices/counter', perm: 'make_bills', tone: 'success' },
  { key: 'stock', ic: 'boxes', href: '#/parts' },
  { key: 'job', ic: 'clipboard-list', href: '#/jobs/new', perm: 'jobs' },
  { key: 'payables', ic: 'hand-coins', href: '#/suppliers?due=1', perm: 'purchases', tone: 'warning' },
  { key: 'expenses', ic: 'wallet', href: '#/cash', perm: 'cash_book', tone: 'danger' },
  { key: 'reports', ic: 'chart-column', href: '#/reports', perm: 'reports', tone: 'info' },
  { key: 'suppliers', ic: 'store', href: '#/suppliers', perm: 'purchases' },
];

function tiles(subs) {
  const shown = TILES.filter((x) => !x.perm || can(x.perm));
  if (shown.length < 2) return '';
  return html`<nav class="tiles" aria-label="${t('dashboard.tiles')}">${shown.map((x) => html`
    <a class="card tile" href="${x.href}" data-tile="${x.key}">
      <span class="kpi-icon ${x.tone || ''}">${icon(x.ic, 24)}</span>
      <span class="tile-label">${t('dashboard.tile_' + x.key)}</span>
      ${subs[x.key] ? html`<span class="tile-sub">${subs[x.key]}</span>` : ''}
    </a>`)}</nav>`;
}

export default async function dashboard(ctx) {
  ctx.setTitle(t('dashboard.title'));
  setHTML(ctx.el, skeletonRows(4));
  const showReminders = BUILT_PHASE >= 5 && can('customers');
  const [d, due] = await Promise.all([api.get('/dashboard'), showReminders ? api.get('/messages/due').catch(() => null) : null]);
  if (!ctx.alive()) return;
  const u = session.user;
  const s = d.stock || {};
  const m = d.money;
  const inShop = Object.values(d.jobs_by_status || {}).reduce((a, b) => a + b, 0);

  const moneyCards = m ? [
    kpi({ label: t('dashboard.sales_today'), value: rupees(m.sales_today), sub: t('dashboard.by_mode', { cash: rupees(m.by_mode.cash), upi: rupees(m.by_mode.upi), card: rupees(m.by_mode.card) }), ic: 'indian-rupee', tone: 'success', href: '#/invoices?from=' + todayISO() }),
    kpi({ label: t('dashboard.credit_today'), value: rupees(m.credit_today), ic: 'hand-coins', tone: m.credit_today ? 'warning' : '' }),
    kpi({ label: t('dashboard.customer_dues'), value: rupees(m.customer_dues), ic: 'users', tone: m.customer_dues ? 'danger' : '', href: '#/reports?tab=dues' }),
    kpi({ label: t('dashboard.supplier_payables'), value: rupees(m.supplier_payables), ic: 'truck', tone: 'info', href: '#/reports?tab=payables' }),
  ] : [];

  // Sale and purchase bills: counts and totals (sales: owner; purchases: owner + inventory manager).
  const bills = d.sales || d.purchases;
  const billCards = [];
  if (d.sales) {
    billCards.push(kpi({ label: t('dashboard.sales_bills_today'), value: rupees(d.sales.today.total), sub: t('dashboard.bills_count', { n: d.sales.today.count }), ic: 'receipt', tone: 'success', href: '#/invoices?from=' + todayISO() }));
    billCards.push(kpi({ label: t('dashboard.sales_month'), value: rupees(d.sales.month.total), sub: t('dashboard.bills_count', { n: d.sales.month.count }), ic: 'calendar', tone: 'success', href: '#/invoices' }));
  }
  if (d.purchases) {
    billCards.push(kpi({ label: t('dashboard.purchases_today'), value: rupees(d.purchases.today.total), sub: t('dashboard.bills_count', { n: d.purchases.today.count }), ic: 'truck', tone: 'info', href: '#/purchases' }));
    billCards.push(kpi({ label: t('dashboard.purchases_month'), value: rupees(d.purchases.month.total), sub: t('dashboard.bills_count', { n: d.purchases.month.count }), ic: 'calendar', tone: 'info', href: '#/purchases' }));
  }
  const saleRow = (b) => html`
    <a class="list-item" href="#/invoices/${b.id}">
      <div style="flex:1;min-width:0"><div class="strong ellipsis">${b.invoice_no} · ${b.customer_name || t('inv.walk_in')}</div><div class="small muted">${date(b.invoice_date)}${b.reg_no ? ' · ' + b.reg_no : ''}</div></div>
      <div class="num"><div class="strong">${money(b.grand_total)}</div>${Number(b.balance) > 0 ? html`<span class="chip warning">${t('billing.due')} ${money(b.balance)}</span>` : html`<span class="chip success">${t('billing.paid')}</span>`}</div>
    </a>`;
  const purchaseRow = (p) => html`
    <a class="list-item" href="#/purchases/${p.id}">
      <div style="flex:1;min-width:0"><div class="strong ellipsis">${p.bill_no} · ${p.supplier_name}</div><div class="small muted">${date(p.bill_date)}</div></div>
      <div class="num"><div class="strong">${money(p.total)}</div>${Number(p.due) > 0.004 ? html`<span class="chip warning">${t('billing.due')} ${money(p.due)}</span>` : html`<span class="chip success">${t('billing.paid')}</span>`}</div>
    </a>`;
  const billList = (title, href, items, row) => html`
    <div class="card">
      <div class="card-head"><h3>${title}</h3><a class="btn btn-ghost btn-sm" href="${href}">${t('dashboard.view_all')}${icon('chevron-right', 16)}</a></div>
      ${items.length ? html`<div class="list">${items.map(row)}</div>` : html`<div class="card-body muted">${t('dashboard.no_bills')}</div>`}
    </div>`;

  const cards = [];
  if (BUILT_PHASE >= 3) {
    cards.push(kpi({ label: t('dashboard.jobs_in_shop'), value: inShop, sub: d.delivered_today ? `${t('dashboard.delivered_today')}: ${d.delivered_today}` : '', ic: 'bike', href: '#/jobs' }));
    if (can('issue_parts')) cards.push(kpi({ label: t('dashboard.approvals_waiting'), value: d.approvals_waiting, ic: 'shield-check', tone: d.approvals_waiting ? 'warning' : '', href: '#/requests?tab=approvals' }));
    cards.push(kpi({ label: t('dashboard.open_requests'), value: d.open_requests, ic: 'package-search', tone: 'info', href: '#/requests' }));
  }
  if (due) cards.push(kpi({ label: t('reminders.title'), value: due.service.length + due.payment.length, sub: `${t('reminders.service')}: ${due.service.length} · ${t('reminders.payment')}: ${due.payment.length}`, ic: 'message-circle', tone: 'primary', href: '#/reminders' }));
  cards.push(kpi({ label: t('dashboard.low_stock'), value: s.low_stock_count, ic: 'triangle-alert', tone: s.low_stock_count ? 'danger' : 'success', href: '#/parts?low=1' }));
  if (s.stock_value !== undefined) cards.push(kpi({ label: t('dashboard.stock_value'), value: rupees(s.stock_value), sub: `${t('dashboard.parts_count')}: ${s.parts}`, ic: 'warehouse', tone: 'info', href: can('reports') ? '#/reports?tab=stock' : null }));

  setHTML(ctx.el, html`
    <div class="page-head">
      <div style="flex:1"><h1>${greeting()}, ${u.name.split(' ')[0]}</h1><div class="sub">${t('roles.' + u.role)} · ${date(todayISO())}</div></div>
      ${can('jobs') ? html`<a class="btn btn-primary" href="#/jobs/new">${icon('plus')}${t('jobs.new')}</a>` : ''}
    </div>
    <div class="stack-lg">
      ${tiles({ payables: m ? rupees(m.supplier_payables) : '', stock: s.low_stock_count ? t('dashboard.low_stock') + ': ' + s.low_stock_count : '' })}
      ${moneyCards.length ? html`<div class="kpis">${moneyCards}</div>` : ''}
      ${billCards.length ? html`<div class="kpis">${billCards}</div>` : ''}
      <div class="kpis">${cards}</div>
      ${m ? html`
        <section class="card" aria-labelledby="h-sales">
          <div class="card-head"><h3 id="h-sales">${t('dashboard.sales_30d')}</h3><span class="muted small">${rupees(m.sales_30d.reduce((a, p) => a + p.total, 0))}</span></div>
          <div class="card-body"><div style="position:relative;height:240px"><canvas id="sales-chart" role="img" aria-label="${t('dashboard.sales_30d')}"></canvas></div>
            <details style="margin-top:8px"><summary class="small muted" style="cursor:pointer">${t('common.view')} · ${t('common.details')}</summary>
              <div class="table-wrap" style="max-height:260px;margin-top:8px"><table class="table"><thead><tr><th>${t('common.date')}</th><th class="num">${t('common.amount')}</th></tr></thead>
              <tbody>${m.sales_30d.filter((p) => p.total).reverse().map((p) => html`<tr><td>${date(p.date)}</td><td class="num">${money(p.total)}</td></tr>`)}</tbody></table></div>
            </details>
          </div>
        </section>` : ''}
      ${bills ? html`<div class="grid-2" style="align-items:start">
        ${d.sales ? billList(t('dashboard.latest_sales'), '#/invoices', d.sales.latest, saleRow) : ''}
        ${d.purchases ? billList(t('dashboard.latest_purchases'), '#/purchases', d.purchases.latest, purchaseRow) : ''}
      </div>` : ''}
      <div class="grid-2" style="align-items:start">
        <div class="card">
          <div class="card-head"><h3>${t('dashboard.low_stock_list')}</h3><a class="btn btn-ghost btn-sm" href="#/parts?low=1">${t('dashboard.view_all')}${icon('chevron-right', 16)}</a></div>
          ${d.low_stock.length
            ? html`<div class="list">${d.low_stock.map((p) => html`
                <a class="list-item" href="#/parts/${p.id}">
                  <div style="flex:1;min-width:0"><div class="strong ellipsis">${nm(p)}</div><div class="small muted">${p.part_no} · ${nm(p, 'location') || ''} ${p.rack ? '· ' + t('parts.rack') + ' ' + p.rack : ''}</div></div>
                  <div class="num"><div class="strong ${Number(p.current_stock) <= 0 ? 'badge-low' : ''}">${qty(p.current_stock)}</div><div class="small muted">min ${qty(p.min_stock)}</div></div>
                </a>`)}</div>`
            : html`<div class="empty" style="padding:32px">${icon('circle-check', 28)}<p>${t('dashboard.low_stock_empty')}</p></div>`}
        </div>
        ${BUILT_PHASE >= 3 ? html`
        <div class="card">
          <div class="card-head"><h3>${t('dashboard.jobs_by_status')}</h3><a class="btn btn-ghost btn-sm" href="#/jobs">${t('dashboard.view_all')}${icon('chevron-right', 16)}</a></div>
          <div class="card-body">${inShop ? html`<div class="row-wrap">${Object.entries(d.jobs_by_status).map(([st, n]) => html`<a class="chip" href="#/jobs?status=${st}&view=list">${t('status.' + st)}: ${n}</a>`)}</div>` : html`<p class="muted">${t('dashboard.no_jobs')}</p>`}</div>
        </div>` : ''}
      </div>
    </div>`);

  let chart = null;
  const canvas = $('#sales-chart', ctx.el);
  if (canvas && m) chart = await drawSalesChart(canvas, m.sales_30d).catch(() => null);
  return () => chart?.destroy();
}
