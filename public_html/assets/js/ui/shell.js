import { html, el, $, $$, on } from '../dom.js';
import { t, getLang, setLang } from '../i18n.js';
import { session, hasRole, can, ROLES, clearSession } from '../store.js';
import { icon } from './icons.js';
import { initials } from '../format.js';
import { api } from '../api.js';
import { openPalette } from './palette.js';
import { toggleNotificationPanel } from './notifications.js';

const { OWNER, INVENTORY, DESK, MECHANIC } = ROLES;
const ALL = [OWNER, INVENTORY, DESK, MECHANIC];

/** Highest build phase whose screens are live. Nav items above it are hidden. */
export const BUILT_PHASE = 5;

/** Sidebar navigation, grouped. `phase` = build phase that delivers the screen. */
export const NAV = [
  { key: 'dashboard', href: '#/', ic: 'layout-dashboard', roles: ALL, phase: 1 },
  { section: 'workshop' },
  { key: 'jobs', href: '#/jobs', ic: 'clipboard-list', roles: [OWNER, DESK, MECHANIC], phase: 3 },
  { key: 'new_job', href: '#/jobs/new', ic: 'plus', perm: 'jobs', phase: 3 },
  { key: 'requests', href: '#/requests', ic: 'package-search', roles: ALL, phase: 3, badge: 'requests' },
  { key: 'customers', href: '#/customers', ic: 'users', perm: 'customers', phase: 3 },
  { key: 'reminders', href: '#/reminders', ic: 'message-circle', perm: 'customers', phase: 5 },
  { section: 'inventory' },
  { key: 'parts', href: '#/parts', ic: 'package', roles: ALL, phase: 1 },
  { key: 'stock_count', href: '#/stock-count', ic: 'list-checks', perm: 'edit_parts', phase: 1 },
  { key: 'reorder', href: '#/reorder', ic: 'shopping-cart', perm: 'purchases', phase: 2 },
  { key: 'purchases', href: '#/purchases', ic: 'truck', perm: 'purchases', phase: 2 },
  { key: 'suppliers', href: '#/suppliers', ic: 'store', perm: 'purchases', phase: 2 },
  { section: 'money' },
  { key: 'billing', href: '#/invoices', ic: 'receipt', perm: 'make_bills', phase: 4 },
  { key: 'counter_sale', href: '#/invoices/counter', ic: 'shopping-cart', perm: 'make_bills', phase: 4 },
  { key: 'mechanics', href: '#/mechanics', ic: 'hand-coins', roles: [OWNER], phase: 5 },
  { key: 'reports', href: '#/reports', ic: 'chart-column', perm: 'reports', phase: 5 },
  { section: 'admin' },
  { key: 'settings', href: '#/settings', ic: 'settings', roles: [OWNER], phase: 1 },
  { key: 'users', href: '#/users', ic: 'user-cog', roles: [OWNER], phase: 1 },
];

/** Bottom bar on phones: up to five items per role. */
const BOTTOM = {
  owner: ['dashboard', 'jobs', 'parts', 'billing', 'settings'],
  inventory: ['dashboard', 'requests', 'parts', 'purchases', 'stock_count'],
  front_desk: ['dashboard', 'jobs', 'new_job', 'billing', 'customers'],
  mechanic: ['dashboard', 'jobs', 'requests', 'parts'],
};

function visibleNav() {
  const out = [];
  let pendingSection = null;
  for (const item of NAV) {
    if (item.section) {
      pendingSection = item;
      continue;
    }
    if (item.phase > BUILT_PHASE || (item.perm ? !can(item.perm) : !hasRole(...item.roles))) continue;
    if (pendingSection) {
      out.push(pendingSection);
      pendingSection = null;
    }
    out.push(item);
  }
  return out;
}

function readCollapsed() {
  try { return localStorage.getItem('gm.sidebar') === 'collapsed'; } catch { return false; }
}

export function themeChoice() {
  try { return localStorage.getItem('gm.theme') || 'system'; } catch { return 'system'; }
}

export function applyTheme(choice = themeChoice()) {
  const root = document.documentElement;
  if (choice === 'light' || choice === 'dark') root.dataset.theme = choice;
  else delete root.dataset.theme;
  try { localStorage.setItem('gm.theme', choice); } catch { /* ignore */ }
}

let titleEl = null;
let contentEl = null;

/** Render the logged-in layout into #app and return the content element. */
export function renderShell(root, { onLogout }) {
  const u = session.user;
  const nav = visibleNav();
  const shopName = session.settings.shop_name || session.info?.shop_name || '';
  const bottomKeys = (BOTTOM[u.role] || []).filter((k) => nav.some((n) => n.key === k));
  root.innerHTML = String(html`
    <div class="app ${readCollapsed() ? 'collapsed' : ''}">
      <aside class="sidebar" aria-label="Main">
        <div class="brand">
          <div class="brand-mark">${icon('wrench', 20)}</div>
          <div class="brand-text" style="min-width:0">
            <div class="brand-name">${getLang() === 'mr' ? session.settings.shop_name_mr || shopName : shopName}</div>
            <div class="brand-sub">${t('app.name')}</div>
          </div>
        </div>
        <nav class="nav">
          ${nav.map((n) => n.section
            ? html`<div class="nav-section">${t('nav.' + n.section)}</div>`
            : html`<a href="${n.href}" data-key="${n.key}" title="${t('nav.' + n.key)}">${icon(n.ic, 20)}<span>${t('nav.' + n.key)}</span>${n.badge ? html`<em class="count hidden" data-badge="${n.badge}"></em>` : ''}</a>`)}
        </nav>
        <div class="sidebar-foot">
          <button class="btn btn-ghost" data-act="collapse" title="${t('common.collapse')}">${icon(readCollapsed() ? 'panel-left-open' : 'panel-left-close', 20)}<span>${t('common.collapse')}</span></button>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <div class="topbar-title" id="page-title" aria-hidden="true"></div>
          <span class="spacer"></span>
          <button class="search-btn" data-act="palette" aria-label="${t('common.search')}">${icon('search', 18)}<span>${t('common.search_placeholder')}</span><kbd>Ctrl K</kbd></button>
          <div class="seg hide-sm" role="group" aria-label="${t('common.language')}">
            <button data-lang="mr" aria-pressed="${getLang() === 'mr'}">मराठी</button>
            <button data-lang="en" aria-pressed="${getLang() === 'en'}">EN</button>
          </div>
          <div style="position:relative">
            <button class="btn btn-ghost btn-icon bell" data-act="bell" aria-label="${t('notifications.title')}">${icon('bell', 20)}<span class="dot hidden"></span></button>
          </div>
          <div style="position:relative">
            <button class="btn btn-ghost btn-icon" data-act="user" aria-haspopup="menu" aria-label="${u.name}"><span class="avatar">${initials(u.name)}</span></button>
          </div>
        </header>
        <div id="offline-banner" class="banner warning hidden" style="margin:12px 24px 0">${icon('triangle-alert')}<span>${t('common.offline')}</span></div>
        <main class="content" id="content" tabindex="-1"></main>
      </div>
      <nav class="bottombar" aria-label="Main">
        ${bottomKeys.map((k) => {
          const n = nav.find((x) => x.key === k);
          return html`<a href="${n.href}" data-key="${n.key}">${icon(n.ic, 22)}<span>${t('nav.' + n.key)}</span></a>`;
        })}
      </nav>
    </div>`);

  titleEl = $('#page-title', root);
  contentEl = $('#content', root);
  const app = $('.app', root);

  on(root, 'click', '[data-act="collapse"]', () => {
    const c = !app.classList.contains('collapsed');
    app.classList.toggle('collapsed', c);
    try { localStorage.setItem('gm.sidebar', c ? 'collapsed' : 'open'); } catch { /* ignore */ }
  });
  on(root, 'click', '[data-act="palette"]', () => openPalette());
  on(root, 'click', '[data-lang]', (e, b) => switchLang(b.dataset.lang));
  on(root, 'click', '[data-act="user"]', (e, b) => toggleUserMenu(b, onLogout));
  on(root, 'click', '[data-act="bell"]', (e, b) => toggleNotificationPanel(b));

  const offline = $('#offline-banner', root);
  const syncOnline = () => offline.classList.toggle('hidden', navigator.onLine);
  window.addEventListener('online', syncOnline);
  window.addEventListener('offline', syncOnline);
  syncOnline();

  highlightNav();
  return contentEl;
}

export async function switchLang(l) {
  setLang(l);
  if (session.user) {
    session.user.language = l;
    api.post('/auth/language', { language: l }).catch(() => {});
  }
}

function toggleUserMenu(anchor, onLogout) {
  const existing = document.querySelector('.menu.user-menu');
  if (existing) {
    existing.remove();
    return;
  }
  const u = session.user;
  const theme = themeChoice();
  const menu = el(html`
    <div class="menu user-menu" role="menu" style="right:0;top:calc(100% + 6px)">
      <div class="menu-head"><div class="strong">${u.name}</div><div class="small muted">${t('roles.' + u.role)} · @${u.username}</div></div>
      <hr>
      <a href="#/profile" role="menuitem">${icon('key-round')}${t('auth.change_password')}</a>
      <button role="menuitem" data-lang-m="${getLang() === 'mr' ? 'en' : 'mr'}">${icon('languages')}${getLang() === 'mr' ? 'English' : 'मराठी'}</button>
      <hr>
      <div class="menu-head small muted">${t('common.theme')}</div>
      <div style="padding:0 8px 8px"><div class="seg" role="group">
        <button data-theme-c="light" aria-pressed="${theme === 'light'}">${icon('sun', 16)}</button>
        <button data-theme-c="system" aria-pressed="${theme === 'system'}">${icon('monitor', 16)}</button>
        <button data-theme-c="dark" aria-pressed="${theme === 'dark'}">${icon('moon', 16)}</button>
      </div></div>
      <hr>
      <button role="menuitem" data-logout>${icon('log-out')}${t('auth.logout')}</button>
    </div>`);
  anchor.parentElement.appendChild(menu);
  const close = (e) => {
    if (e && menu.contains(e.target) && !e.target.closest('a, [data-logout], [data-lang-m]')) return;
    menu.remove();
    document.removeEventListener('click', close, true);
  };
  setTimeout(() => document.addEventListener('click', close, true));
  menu.addEventListener('click', (e) => {
    const th = e.target.closest('[data-theme-c]');
    if (th) {
      applyTheme(th.dataset.themeC);
      $$('[data-theme-c]', menu).forEach((b) => b.setAttribute('aria-pressed', b === th));
    }
    const lm = e.target.closest('[data-lang-m]');
    if (lm) switchLang(lm.dataset.langM);
    if (e.target.closest('[data-logout]')) {
      clearSession();
      onLogout();
    }
  });
}

export function setTitle(title) {
  if (titleEl) titleEl.textContent = title;
  document.title = title + ' · ' + (session.settings.shop_name || 'Garage Manager');
}

export function highlightNav() {
  const hash = location.hash || '#/';
  const path = hash.split('?')[0];
  let best = null;
  for (const a of $$('.nav a[data-key], .bottombar a[data-key]')) {
    const href = a.getAttribute('href');
    const match = href === '#/' ? path === '#/' || path === '#' : path === href || path.startsWith(href + '/');
    a.classList.toggle('active', false);
    if (match && (!best || href.length >= best.getAttribute('href').length)) best = a;
  }
  if (best) {
    const key = best.dataset.key;
    $$(`[data-key="${key}"]`).forEach((a) => a.classList.add('active'));
  }
}

/** Update a sidebar count badge (e.g. open requests). */
export function setBadge(name, n) {
  $$(`[data-badge="${name}"]`).forEach((b) => {
    b.textContent = n > 99 ? '99+' : String(n);
    b.classList.toggle('hidden', !n);
  });
}

export function content() {
  return document.getElementById('content');
}
