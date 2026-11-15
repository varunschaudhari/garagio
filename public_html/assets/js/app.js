// Boot: theme → translations → API detection → session → shell + router.

import { html, setHTML } from './dom.js';
import { loadI18n, t, setLang, onLangChange, errorText } from './i18n.js';
import { api, detectApi, onUnauthorized } from './api.js';
import { session, getToken, clearSession, hasRole } from './store.js';
import { route, startRouter, render, setLeaveGuard } from './router.js';
import { renderShell, setTitle, highlightNav, applyTheme, NAV, BUILT_PHASE } from './ui/shell.js';
import { setPaletteSource } from './ui/palette.js';
import { startNotifications, stopNotifications } from './ui/notifications.js';
import { emptyState } from './ui/table.js';
import { toast } from './ui/toast.js';
import { icon } from './ui/icons.js';

const root = document.getElementById('app');
const ALL = ['owner', 'inventory', 'front_desk', 'mechanic'];
const OI = ['owner', 'inventory'];

/* ------------------------------------------------------------------ routes */
route('/', () => import('./pages/dashboard.js'));
route('/parts', () => import('./pages/parts.js'));
route('/parts/:id', () => import('./pages/part.js'));
route('/stock-count', () => import('./pages/stock-count.js'), { perm: 'edit_parts' });
route('/reorder', () => import('./pages/reorder.js'), { perm: 'purchases' });
route('/suppliers', () => import('./pages/suppliers.js'), { perm: 'purchases' });
route('/suppliers/:id', () => import('./pages/supplier.js'), { perm: 'purchases' });
route('/purchases', () => import('./pages/purchases.js'), { perm: 'purchases' });
route('/purchases/new', () => import('./pages/purchase-new.js'), { perm: 'purchases' });
route('/purchases/:id', () => import('./pages/purchase.js'), { perm: 'purchases' });
route('/settings', () => import('./pages/settings.js'), { roles: ['owner'] });
route('/users', () => import('./pages/users.js'), { roles: ['owner'] });
route('/audit', () => import('./pages/audit.js'), { roles: ['owner'] });
route('/jobs', () => import('./pages/jobs.js'), { roles: ['owner', 'front_desk', 'mechanic'] });
route('/jobs/new', () => import('./pages/job-new.js'), { perm: 'jobs' });
route('/jobs/:id', () => import('./pages/job.js'), { roles: ALL });
route('/requests', () => import('./pages/requests.js'), { roles: ALL });
route('/customers', () => import('./pages/customers.js'), { perm: 'customers' });
route('/customers/:id', () => import('./pages/customer.js'), { perm: ['customers', 'jobs', 'make_bills'] });
route('/invoices', () => import('./pages/invoices.js'), { perm: 'make_bills' });
route('/invoices/counter', () => import('./pages/counter-sale.js'), { perm: 'make_bills' });
route('/invoices/:id', () => import('./pages/invoice.js'), { perm: 'make_bills' });
route('/mechanics', () => import('./pages/mechanics.js'), { roles: ['owner'] });
route('/reports', () => import('./pages/reports.js'), { perm: 'reports' });
route('/reminders', () => import('./pages/reminders.js'), { perm: 'customers' });
route('/profile', () => import('./pages/profile.js'), { roles: ALL });

/* ------------------------------------------------------------------ boot */

async function boot() {
  applyTheme();
  try {
    await loadI18n();
  } catch {
    /* strings fall back to keys; keep going */
  }
  try {
    session.info = await detectApi();
  } catch (e) {
    return showFatal(e);
  }
  onUnauthorized(() => {
    if (!session.user) return;
    clearSession();
    toast(t('errors.unauthorized'), 'error');
    showLogin();
  });
  if (!getToken()) return showLogin();
  try {
    const me = await api.get('/auth/me');
    session.user = me.user;
    session.canSeeCost = me.can_see_cost;
    setLang(me.user.language);
  } catch {
    clearSession();
    return showLogin();
  }
  if (session.user.must_change_password) return showForcedPassword();
  await startApp();
}

function showFatal(err) {
  setHTML(root, html`<div class="auth-wrap"><div class="card auth-card stack" style="text-align:center">
    <div class="empty-art" style="margin:0 auto">${icon('triangle-alert', 32)}</div>
    <h2>${t('errors.network')}</h2>
    <p class="muted">${errorText(err)}</p>
    <button class="btn btn-primary" onclick="location.reload()">${t('common.retry')}</button>
  </div></div>`);
}

async function showLogin() {
  const mod = await import('./pages/login.js');
  mod.default(root, {
    onDone: async (user) => {
      session.user = user;
      setLang(user.language);
      const me = await api.get('/auth/me');
      session.canSeeCost = me.can_see_cost;
      if (user.must_change_password) return showForcedPassword();
      await startApp();
    },
  });
}

async function showForcedPassword() {
  const mod = await import('./pages/profile.js');
  mod.forcedChange(root, { onDone: () => startApp() });
}

let started = false;
let pageSeq = 0;

async function startApp() {
  try {
    session.settings = (await api.get('/settings')).settings;
  } catch {
    session.settings = {};
  }
  mountShell();
  startNotifications();
  setPaletteSource(() =>
    NAV.filter((n) => !n.section && n.phase <= BUILT_PHASE && hasRole(...n.roles)).map((n) => ({ title: t('nav.' + n.key), href: n.href }))
  );
  if (!started) {
    started = true;
    onLangChange(() => {
      if (!session.user || !document.querySelector('.app')) return;
      mountShell();
      render();
    });
    // Nav highlight is updated in makeCtx, i.e. only when a page really renders
    // (a blocked navigation, e.g. unsaved bill, must not move the highlight).
    await startRouter(makeCtx);
  } else {
    await render();
  }
}

function mountShell() {
  renderShell(root, { onLogout: () => { stopNotifications(); location.hash = '#/'; showLogin(); } });
}

/** Context passed to every page module. */
function makeCtx({ path, query, params }) {
  // A fresh element per page, so listeners from the previous page are dropped.
  const old = document.getElementById('content');
  const el = old.cloneNode(false);
  old.replaceWith(el);
  const seq = ++pageSeq;
  el.scrollTop = 0;
  window.scrollTo(0, 0);
  highlightNav();
  return {
    el,
    path,
    query,
    params,
    session,
    /** true while this page is still the one on screen */
    alive: () => seq === pageSeq,
    setTitle,
    setLeaveGuard,
    notFound() {
      setTitle(t('errors.not_found'));
      setHTML(el, emptyState({ ic: 'circle-x', title: t('errors.page_not_found'), action: html`<a class="btn btn-primary" href="#/">${t('nav.dashboard')}</a>` }));
    },
    forbidden() {
      setTitle(t('errors.forbidden'));
      setHTML(el, emptyState({ ic: 'lock', title: t('errors.forbidden'), action: html`<a class="btn btn-primary" href="#/">${t('nav.dashboard')}</a>` }));
    },
    fail(err) {
      console.error(err);
      setHTML(el, emptyState({ ic: 'triangle-alert', title: errorText(err), action: html`<button class="btn btn-primary" onclick="location.reload()">${t('common.retry')}</button>` }));
    },
  };
}

boot();
