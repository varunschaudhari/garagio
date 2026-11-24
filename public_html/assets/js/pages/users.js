import { html, setHTML, on } from '../dom.js';
import { t, getLang } from '../i18n.js';
import { api } from '../api.js';
import { session } from '../store.js';
import { icon } from '../ui/icons.js';
import { datetime, initials } from '../format.js';
import { dataTable, skeletonRows } from '../ui/table.js';
import { field } from '../ui/form.js';
import { openDrawer } from '../ui/drawer.js';
import { confirmDialog } from '../ui/modal.js';
import { toast, toastError } from '../ui/toast.js';

/** Show the username / password fields only while "Uses the app" is on (mechanics may have no login). */
export function wireLoginSwitch(root) {
  const sw = root.querySelector('[name=login]');
  if (!sw) return;
  const sync = () => ['username', 'password', 'reset_password'].forEach((n) => {
    const wrap = root.querySelector(`[name=${n}]`)?.closest('.field');
    if (wrap) wrap.classList.toggle('hidden', !sw.checked);
  });
  sw.addEventListener('change', sync);
  sync();
}

/** Remove someone: deleted when nothing points at them, else hidden. Resolves true when something changed. */
export async function removePerson(u) {
  const yes = await confirmDialog({ title: t('users.remove_q', { name: u.name }), message: t('users.remove_hint'), confirmLabel: t('users.remove'), danger: true });
  if (!yes) return false;
  try {
    const r = await api.del('/users/' + u.id);
    toast(r.deleted ? t('users.removed') : t('users.hidden_done'));
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

const ROLES = ['owner', 'inventory', 'front_desk', 'mechanic'];

export default async function usersPage(ctx) {
  ctx.setTitle(t('users.title'));
  setHTML(ctx.el, html`
    <div class="page-head"><h1>${t('users.title')}</h1><button class="btn btn-primary" data-new>${icon('plus')}${t('users.new')}</button></div>
    <div class="card" id="users-list">${skeletonRows()}</div>`);
  let users = [];
  let permKeys = [];
  let roleDefaults = {};
  /** Does this person have ticks that differ from their role's defaults? */
  const custom = (u) => u.role !== 'owner' && permKeys.some((k) => !!u.perms?.[k] !== !!roleDefaults[u.role]?.[k]);

  const load = async () => {
    const res = await api.get('/users');
    users = res.items;
    permKeys = res.permissions || [];
    roleDefaults = res.role_defaults || {};
    if (!ctx.alive()) return;
    setHTML(ctx.el.querySelector('#users-list'), dataTable({
      columns: [
        { key: 'name', label: t('common.name'), primary: true, render: (u) => html`<div class="row"><span class="avatar">${initials(u.name)}</span><div><div class="t-title">${u.name}${u.id === session.user.id ? html` <span class="chip primary plain">${t('users.you')}</span>` : ''}</div><div class="t-sub">${u.username ? '@' + u.username : t('users.no_login')}${u.phone ? ' · ' + u.phone : ''}</div></div></div>` },
        { key: 'role', label: t('users.role'), render: (u) => html`${t('roles.' + u.role)}${custom(u) ? html` <span class="chip warning plain">${t('users.perm_custom')}</span>` : ''}` },
        { key: 'language', label: t('common.language'), render: (u) => (u.language === 'mr' ? 'मराठी' : 'English') },
        { key: 'last_login', label: t('users.last_login'), render: (u) => (u.last_login_at ? datetime(u.last_login_at) : t('users.never')) },
        { key: 'active', label: t('common.status'), render: (u) => html`<span class="chip ${u.active ? 'success' : ''}">${t(u.active ? 'common.active' : 'common.inactive')}</span>` },
        { key: 'actions', label: '', render: (u) => html`<div class="row" style="gap:4px;justify-content:flex-end"><button class="btn btn-ghost btn-sm" data-edit="${u.id}">${icon('pencil', 16)}${t('common.edit')}</button>${u.id === session.user.id ? '' : html`<button class="btn btn-ghost btn-sm" data-remove="${u.id}" aria-label="${t('users.remove')} · ${u.name}">${icon('trash-2', 16)}</button>`}</div>` },
      ],
      rows: users,
    }));
  };

  const roleOptions = ROLES.map((r) => ({ value: r, label: t('roles.' + r) }));
  const langOptions = [{ value: 'mr', label: 'मराठी' }, { value: 'en', label: 'English' }];

  on(ctx.el, 'click', '[data-new]', async () => {
    const saved = await openDrawer({
      title: t('users.new'),
      body: html`<div class="stack">
        ${field({ name: 'name', label: t('common.name'), required: true })}
        ${field({ name: 'username', label: t('users.username'), required: true, hint: t('fields.invalid_username') })}
        ${field({ name: 'phone', label: t('common.phone'), type: 'tel', inputmode: 'tel' })}
        ${field({ name: 'role', label: t('users.role'), type: 'select', value: 'mechanic', options: roleOptions, required: true })}
        ${field({ name: 'language', label: t('common.language'), type: 'select', value: getLang(), options: langOptions })}
        ${field({ name: 'password', label: t('users.temp_password'), required: true, hint: t('users.temp_password_hint') })}
      </div>`,
      onSubmit: (d) => api.post('/users', d),
    });
    if (saved) { toast(t('common.created')); load(); }
  });

  on(ctx.el, 'click', '[data-edit]', async (e, b) => {
    const u = users.find((x) => x.id === Number(b.dataset.edit));
    const self = u.id === session.user.id;
    const saved = await openDrawer({
      title: t('users.edit') + ' · ' + u.name,
      body: html`<div class="stack">
        ${field({ name: 'name', label: t('common.name'), value: u.name, required: true })}
        ${u.role === 'mechanic' && !self ? field({ name: 'login', label: t('users.uses_app'), type: 'switch', value: u.login, hint: t('users.uses_app_hint') }) : ''}
        ${field({ name: 'username', label: t('users.username'), value: u.username || '', autocomplete: 'off', hint: t('users.username_hint') })}
        ${field({ name: 'phone', label: t('common.phone'), value: u.phone, type: 'tel', inputmode: 'tel' })}
        ${field({ name: 'role', label: t('users.role'), type: 'select', value: u.role, options: roleOptions, disabled: self })}
        ${field({ name: 'language', label: t('common.language'), type: 'select', value: u.language, options: langOptions })}
        ${self ? '' : field({ name: 'active', label: t('common.active'), type: 'switch', value: u.active })}
        ${field({ name: 'reset_password', label: u.login ? t('users.reset_password') : t('users.temp_password'), hint: u.login ? t('users.reset_password_hint') : t('users.temp_password_hint') })}
        <fieldset class="choices">
          <legend>${t('users.perm_title')}</legend>
          ${u.role === 'owner'
            ? html`<p class="small muted" style="margin:0">${t('users.perm_owner')}</p>`
            : html`<p class="small muted" style="margin:0">${t('users.perm_hint')}</p>
              ${permKeys.map((k) => field({
                name: 'perm_' + k,
                type: 'check',
                label: t('users.perms.' + k),
                value: !!u.perms?.[k],
                hint: !!u.perms?.[k] !== !!roleDefaults[u.role]?.[k] ? t('users.perm_changed') : '',
              }))}`}
        </fieldset>
      </div>`,
      onOpen: wireLoginSwitch,
      onSubmit: (d) => {
        if (!d.reset_password) delete d.reset_password;
        if (d.login === false) {
          delete d.username;
          delete d.reset_password;
        }
        if (u.role !== 'owner') {
          d.permissions = {};
          for (const k of permKeys) d.permissions[k] = !!d['perm_' + k];
        }
        for (const k of permKeys) delete d['perm_' + k];
        return api.put('/users/' + u.id, d);
      },
    });
    if (saved) { toast(t('common.saved')); load(); }
  });

  on(ctx.el, 'click', '[data-remove]', async (e, b) => {
    const u = users.find((x) => x.id === Number(b.dataset.remove));
    if (await removePerson(u)) load();
  });

  await load();
}
