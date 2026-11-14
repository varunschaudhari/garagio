import { html, setHTML, $, on } from '../dom.js';
import { t, getLang, setLang, errorText } from '../i18n.js';
import { api } from '../api.js';
import { session, setToken } from '../store.js';
import { icon } from '../ui/icons.js';
import { busy } from '../ui/form.js';

export default function login(appRoot, { onDone }) {
  // Own host element so these listeners disappear with the login screen.
  setHTML(appRoot, '<div class="login-host"></div>');
  const root = appRoot.firstElementChild;
  const draw = () => {
    const info = session.info || {};
    const shop = getLang() === 'mr' ? info.shop_name_mr || info.shop_name : info.shop_name;
    document.title = t('auth.login_title') + ' · ' + (info.shop_name || 'Garage Manager');
    setHTML(root, html`
      <div class="auth-wrap">
        <form class="card auth-card stack-lg" novalidate>
          <div class="row" style="justify-content:space-between;align-items:flex-start">
            <div class="row" style="gap:12px">
              <div class="brand-mark">${icon('wrench', 24)}</div>
              <div><div class="strong" style="font-size:18px">${shop || ''}</div><div class="small muted">${t('app.name')}</div></div>
            </div>
            <div class="seg" role="group" aria-label="${t('common.language')}">
              <button type="button" data-lang="mr" aria-pressed="${getLang() === 'mr'}">मराठी</button>
              <button type="button" data-lang="en" aria-pressed="${getLang() === 'en'}">EN</button>
            </div>
          </div>
          <div class="stack" style="gap:4px">
            <h1>${t('auth.login_title')}</h1>
            <p class="muted">${t('auth.login_sub')}</p>
          </div>
          <div id="login-error" class="banner danger hidden" role="alert"></div>
          <div class="stack">
            <div class="field">
              <label for="lg-user">${t('auth.username')}</label>
              <input id="lg-user" class="input" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>
            </div>
            <div class="field">
              <label for="lg-pass">${t('auth.password')}</label>
              <div class="input-group">
                ${icon('lock', 18)}
                <input id="lg-pass" class="input" type="password" name="password" autocomplete="current-password" required style="padding-right:48px">
                <button type="button" class="btn btn-ghost btn-icon btn-sm input-end" data-toggle aria-label="${t('auth.show_password')}" aria-pressed="false">${icon('eye', 18)}</button>
              </div>
            </div>
          </div>
          <button class="btn btn-primary btn-lg btn-block" type="submit">${t('auth.sign_in')}</button>
        </form>
      </div>`);
    $('#lg-user', root).focus();
  };
  draw();

  on(root, 'click', '[data-lang]', (e, b) => {
    const user = $('#lg-user', root)?.value || '';
    setLang(b.dataset.lang);
    draw();
    $('#lg-user', root).value = user;
  });
  on(root, 'click', '[data-toggle]', (e, b) => {
    const input = $('#lg-pass', root);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.setAttribute('aria-pressed', String(show));
    b.setAttribute('aria-label', t(show ? 'auth.hide_password' : 'auth.show_password'));
    b.innerHTML = String(icon(show ? 'eye-off' : 'eye', 18));
  });
  on(root, 'submit', 'form', async (e, form) => {
    e.preventDefault();
    const username = $('#lg-user', form).value.trim();
    const password = $('#lg-pass', form).value;
    const errBox = $('#login-error', form);
    errBox.classList.add('hidden');
    if (!username || !password) {
      errBox.textContent = t('errors.bad_credentials');
      errBox.classList.remove('hidden');
      return;
    }
    await busy($('button[type=submit]', form), async () => {
      try {
        const res = await api.post('/auth/login', { username, password });
        setToken(res.token);
        await onDone(res.user);
      } catch (err) {
        errBox.textContent = errorText(err);
        errBox.classList.remove('hidden');
        $('#lg-pass', form).select();
      }
    });
  });
}
