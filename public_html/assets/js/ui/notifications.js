// Notification bell: polls every 20 s while the tab is visible, shows the unread count,
// and a panel with the latest notifications. Also keeps the "Parts requests" badge fresh.
import { html, el, $ } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { hasRole } from '../store.js';
import { icon } from './icons.js';
import { datetime } from '../format.js';
import { setBadge } from './shell.js';

const POLL_MS = 20000;
let timer = null;
let lastUnread = -1;

function setDot(n) {
  const dot = document.querySelector('.bell .dot');
  if (!dot) return;
  dot.textContent = n > 99 ? '99+' : String(n);
  dot.classList.toggle('hidden', !n);
  if (n > lastUnread && lastUnread >= 0 && navigator.vibrate) navigator.vibrate(30);
  lastUnread = n;
}

async function poll() {
  if (document.visibilityState !== 'visible' || !document.querySelector('.app')) return;
  try {
    const n = await api.get('/notifications', { unread: 1 });
    setDot(n.unread);
    if (hasRole('owner', 'inventory')) {
      const r = await api.get('/requests', { status: 'open', per_page: 1 });
      setBadge('requests', r.counts.open);
    }
  } catch {
    /* offline: keep the old numbers */
  }
}

export function startNotifications() {
  stopNotifications();
  lastUnread = -1;
  poll();
  timer = setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', poll);
}

export function stopNotifications() {
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener('visibilitychange', poll);
}

export async function toggleNotificationPanel(anchor) {
  const existing = document.querySelector('.notif-panel');
  if (existing) {
    existing.remove();
    return;
  }
  const panel = el(html`<div class="menu notif-panel" role="dialog" aria-label="${t('notifications.title')}"><div class="card-body muted">${t('common.loading')}</div></div>`);
  anchor.parentElement.appendChild(panel);
  const close = (e) => {
    if (e && panel.contains(e.target) && !e.target.closest('a')) return;
    panel.remove();
    document.removeEventListener('click', close, true);
  };
  setTimeout(() => document.addEventListener('click', close, true));
  let data;
  try {
    data = await api.get('/notifications');
  } catch {
    panel.remove();
    return;
  }
  panel.innerHTML = String(html`
    <div class="row" style="padding:12px 16px;border-bottom:1px solid var(--border)">
      <strong style="flex:1">${t('notifications.title')}</strong>
      ${data.unread ? html`<button class="btn btn-ghost btn-sm" data-read-all>${t('notifications.mark_all')}</button>` : ''}
    </div>
    ${data.items.length
      ? data.items.map((n) => html`<a class="notif ${n.read_at ? '' : 'unread'}" href="${n.link || '#/'}" data-nid="${n.id}">
          <span class="kpi-icon">${icon(n.type.includes('approval') ? 'shield-check' : n.type.includes('issued') ? 'package' : n.type.includes('ready') ? 'bike' : n.type.includes('call') ? 'phone' : 'bell', 16)}</span>
          <div style="min-width:0"><div class="t">${n.title}</div><div class="small muted">${n.body || ''}</div><div class="small muted">${datetime(n.created_at)}</div></div>
        </a>`)
      : html`<div class="card-body muted">${t('notifications.empty')}</div>`}`);
  panel.addEventListener('click', async (e) => {
    if (e.target.closest('[data-read-all]')) {
      e.preventDefault();
      const r = await api.post('/notifications/read', { all: true });
      setDot(r.unread);
      panel.querySelectorAll('.notif.unread').forEach((x) => x.classList.remove('unread'));
      $('[data-read-all]', panel)?.remove();
      return;
    }
    const a = e.target.closest('[data-nid]');
    if (a && a.classList.contains('unread')) {
      api.post('/notifications/read', { ids: [Number(a.dataset.nid)] }).then((r) => setDot(r.unread)).catch(() => {});
    }
  });
}
