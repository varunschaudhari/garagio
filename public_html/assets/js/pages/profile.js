import { html, setHTML, $ } from '../dom.js';
import { t, getLang } from '../i18n.js';
import { api } from '../api.js';
import { session, setToken, clearSession } from '../store.js';
import { icon } from '../ui/icons.js';
import { field, readForm, showFieldErrors, checkRequired, busy } from '../ui/form.js';
import { toast, toastError } from '../ui/toast.js';
import { switchLang } from '../ui/shell.js';

function passwordForm() {
  return html`
    ${field({ name: 'current_password', label: t('auth.current_password'), type: 'password', required: true, autocomplete: 'current-password' })}
    ${field({ name: 'new_password', label: t('auth.new_password'), type: 'password', required: true, hint: t('auth.password_hint'), autocomplete: 'new-password' })}
    ${field({ name: 'confirm_password', label: t('auth.confirm_password'), type: 'password', required: true, autocomplete: 'new-password' })}`;
}

async function submitPassword(form) {
  if (!checkRequired(form)) return null;
  const d = readForm(form);
  if (d.new_password !== d.confirm_password) {
    showFieldErrors(form, { confirm_password: 'passwords_dont_match' });
    $('[name=confirm_password]', form).closest('.field').querySelector('.err').textContent = t('auth.passwords_dont_match');
    return null;
  }
  try {
    const res = await api.post('/auth/password', { current_password: d.current_password, new_password: d.new_password });
    setToken(res.token);
    session.user = res.user;
    toast(t('auth.password_changed'));
    return res;
  } catch (err) {
    if (err.fields && showFieldErrors(form, err.fields)) return null;
    toastError(err);
    return null;
  }
}

/** Full-screen "set your own password" step after first login. */
export function forcedChange(root, { onDone }) {
  document.title = t('auth.must_change_title');
  setHTML(root, html`
    <div class="auth-wrap">
      <form class="card auth-card stack-lg" novalidate>
        <div class="empty-art">${icon('key-round', 32)}</div>
        <div class="stack" style="gap:4px">
          <h1>${t('auth.must_change_title')}</h1>
          <p class="muted">${t('auth.must_change_text')}</p>
        </div>
        <div class="stack">${passwordForm()}</div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">${t('auth.change_password')}</button>
        <button class="btn btn-ghost" type="button" data-logout>${t('auth.logout')}</button>
      </form>
    </div>`);
  const form = $('form', root);
  $('[name=current_password]', form).focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy($('button[type=submit]', form), async () => {
      const res = await submitPassword(form);
      if (res) onDone();
    });
  });
  $('[data-logout]', form).addEventListener('click', () => {
    clearSession();
    location.reload();
  });
}

/** #/profile - change password and language. */
export default function profile(ctx) {
  const u = session.user;
  ctx.setTitle(t('nav.profile'));
  setHTML(ctx.el, html`
    <div class="grid-2" style="align-items:start">
      <div class="card">
        <div class="card-head"><h2>${t('nav.profile')}</h2></div>
        <div class="card-body">
          <dl class="dl">
            <dt>${t('common.name')}</dt><dd>${u.name}</dd>
            <dt>${t('users.username')}</dt><dd>@${u.username}</dd>
            <dt>${t('users.role')}</dt><dd>${t('roles.' + u.role)}</dd>
            <dt>${t('common.language')}</dt>
            <dd><div class="seg" role="group">
              <button type="button" data-lang="mr" aria-pressed="${getLang() === 'mr'}">मराठी</button>
              <button type="button" data-lang="en" aria-pressed="${getLang() === 'en'}">English</button>
            </div></dd>
          </dl>
        </div>
      </div>
      <form class="card" novalidate>
        <div class="card-head"><h2>${t('auth.change_password')}</h2></div>
        <div class="card-body stack">${passwordForm()}</div>
        <div class="card-foot"><button class="btn btn-primary" type="submit">${t('auth.change_password')}</button></div>
      </form>
    </div>`);
  ctx.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]');
    if (b) switchLang(b.dataset.lang);
  });
  const form = $('form', ctx.el);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy($('button[type=submit]', form), async () => {
      if (await submitPassword(form)) form.reset();
    });
  });
}
