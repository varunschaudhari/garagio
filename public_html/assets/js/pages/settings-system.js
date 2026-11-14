import { html, setHTML, $ } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../ui/icons.js';
import { date, datetime } from '../format.js';
import { field, readForm, showFieldErrors, busy, checkRequired } from '../ui/form.js';
import { confirmDialog } from '../ui/modal.js';
import { toast, toastError } from '../ui/toast.js';

const STATUS_CHIP = { ok: 'success', warn: 'warning', fail: 'danger' };
const STATUS_ICON = { ok: 'circle-check', warn: 'triangle-alert', fail: 'circle-x' };
const DATETIME_KEYS = ['last_backup', 'cron_reminders_at', 'cron_backup_at'];

const checkValue = (c) => {
  if (c.value === null || c.value === undefined || c.value === '') return '';
  if (DATETIME_KEYS.includes(c.key)) return datetime(c.value);
  if (c.key === 'live_since') return date(c.value);
  return String(c.value);
};

const radio = (name, value, label, checked) => html`
  <label class="choice"><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;

/**
 * Settings → System (owner): health check of the server and the one-time go-live reset.
 * `isCurrent()` tells whether the System tab is still showing after an await.
 */
export async function drawSystem(body, ctx, isCurrent) {
  const [health, gl] = await Promise.all([api.get('/admin/health'), api.get('/admin/go-live')]);
  if (!ctx.alive() || !isCurrent()) return;
  const c = gl.counts;

  setHTML(body, html`
    <div class="stack" style="max-width:860px">
      <div class="card">
        <div class="card-head">
          <h3>${t('system.check_title')}</h3>
          <span class="chip ${STATUS_CHIP[health.status]}">${t('system.status_' + health.status)}</span>
          <button class="btn btn-secondary btn-sm" data-health>${icon('refresh-cw', 16)}${t('system.check_again')}</button>
        </div>
        <div class="list">
          ${health.checks.map((ch) => html`
            <div class="list-item health-${ch.status}">
              <span class="health-icon">${icon(STATUS_ICON[ch.status], 18)}</span>
              <div style="flex:1;min-width:0">
                <div class="strong">${t('system.check.' + ch.key)}</div>
                ${ch.status !== 'ok' && t('system.fix.' + ch.key) ? html`<div class="small muted">${t('system.fix.' + ch.key)}</div>` : ''}
              </div>
              <div class="small muted num" style="text-align:right">${checkValue(ch)}</div>
            </div>`)}
        </div>
        <div class="card-foot small muted">${t('system.server_time', { time: datetime(health.server_time) })}</div>
      </div>

      <form class="card danger-zone" data-golive novalidate>
        <div class="card-head">
          <h3>${t('system.golive_title')}</h3>
          ${gl.live_since ? html`<span class="chip success">${t('system.golive_live_since', { date: date(gl.live_since) })}</span>` : ''}
        </div>
        <div class="card-body stack">
          <p class="muted" style="margin:0">${t('system.golive_intro')}</p>
          <div class="banner danger">${icon('triangle-alert')}<span><strong>${t('system.golive_removes')}:</strong> ${t('system.golive_counts', c)}</span></div>
          <p class="small muted" style="margin:0">${t('system.golive_keeps')}</p>
          <fieldset class="choices">
            <legend>${t('system.golive_parts')}</legend>
            ${radio('parts', 'keep', t('system.golive_parts_keep'), true)}
            ${radio('parts', 'zero', t('system.golive_parts_zero'), false)}
            ${radio('parts', 'delete', t('system.golive_parts_delete'), false)}
          </fieldset>
          <fieldset class="choices">
            <legend>${t('system.golive_contacts')}</legend>
            ${radio('contacts', 'demo', t('system.golive_contacts_demo', { c: c.customers_demo, s: c.suppliers_demo }), true)}
            ${radio('contacts', 'all', t('system.golive_contacts_all', { c: c.customers, s: c.suppliers }), false)}
            ${radio('contacts', 'keep', t('system.golive_contacts_keep'), false)}
          </fieldset>
          <div class="form-grid">
            ${field({ name: 'confirm', label: t('system.golive_confirm_label'), required: true, placeholder: 'RESET', autocomplete: 'off' })}
            ${field({ name: 'password', label: t('system.golive_password'), type: 'password', required: true, autocomplete: 'current-password' })}
          </div>
        </div>
        <div class="card-foot"><button class="btn btn-danger" type="submit">${icon('trash-2', 16)}${t('system.golive_button')}</button></div>
      </form>
    </div>`);

  body.onclick = async (e) => {
    const b = e.target.closest('[data-health]');
    if (!b) return;
    await busy(b, () => drawSystem(body, ctx, isCurrent).catch(toastError));
  };

  body.onsubmit = async (e) => {
    const form = e.target.closest('form[data-golive]');
    if (!form) return;
    e.preventDefault();
    if (!checkRequired(form)) return;
    const data = readForm(form);
    const ok = await confirmDialog({ title: t('system.golive_sure_title'), message: t('system.golive_sure'), confirmLabel: t('system.golive_button'), danger: true });
    if (!ok) return;
    await busy($('button[type=submit]', form), async () => {
      try {
        const res = await api.post('/admin/go-live', data);
        toast(t('system.golive_done', { file: res.backup }));
        if (ctx.alive() && isCurrent()) await drawSystem(body, ctx, isCurrent);
      } catch (err) {
        if (!(err.fields && showFieldErrors(form, err.fields))) toastError(err);
      }
    });
  };
}
