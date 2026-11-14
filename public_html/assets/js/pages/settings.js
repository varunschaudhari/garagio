import { html, setHTML, $, on } from '../dom.js';
import { t, nm } from '../i18n.js';
import { api, downloadApiFile } from '../api.js';
import { session } from '../store.js';
import { icon } from '../ui/icons.js';
import { money } from '../format.js';
import { field, readForm, showFieldErrors, busy, clearErrors } from '../ui/form.js';
import { dataTable } from '../ui/table.js';
import { openDrawer } from '../ui/drawer.js';
import { toast, toastError } from '../ui/toast.js';
import { drawSystem } from './settings-system.js';

const TABS = ['shop', 'billing', 'numbering', 'workflow', 'labour_rates', 'locations', 'categories', 'app', 'backup', 'system'];

export default async function settingsPage(ctx) {
  ctx.setTitle(t('settings.title'));
  let tab = TABS.includes(ctx.query.tab) ? ctx.query.tab : 'shop';
  const data = await api.get('/settings');
  if (!ctx.alive()) return;
  let s = data.settings;
  const states = data.states;

  setHTML(ctx.el, html`
    <div class="page-head"><h1>${t('settings.title')}</h1></div>
    <div class="tabs" role="tablist">
      ${TABS.map((k) => html`<button role="tab" data-tab="${k}" aria-selected="${k === tab}">${t('settings.' + k)}</button>`)}
    </div>
    <div id="tab-body"></div>`);
  const body = $('#tab-body', ctx.el);

  const settingsForm = (fields, note) => html`
    <form class="card" data-settings novalidate style="max-width:860px">
      <div class="card-body">
        ${note ? html`<div class="banner warning" style="margin-bottom:16px">${icon('info')}<span>${note}</span></div>` : ''}
        <div class="form-grid">${fields}</div>
      </div>
      <div class="card-foot"><button class="btn btn-primary" type="submit">${t('common.save_changes')}</button></div>
    </form>`;

  const invoicePreview = () => `${s.invoice_prefix || 'INV'}/26-27/00001`;

  const draw = async () => {
    history.replaceState(null, '', '#/settings?tab=' + tab);
    if (tab === 'shop') {
      setHTML(body, settingsForm(html`
        ${field({ name: 'shop_name', label: t('settings.shop_name'), value: s.shop_name, required: true })}
        ${field({ name: 'shop_name_mr', label: t('settings.shop_name_mr'), value: s.shop_name_mr, cls: 'mr-text' })}
        ${field({ name: 'shop_address', label: t('settings.shop_address'), type: 'textarea', value: s.shop_address, rows: 2 })}
        ${field({ name: 'shop_address_mr', label: t('settings.shop_address_mr'), type: 'textarea', value: s.shop_address_mr, rows: 2 })}
        ${field({ name: 'shop_phone', label: t('settings.shop_phone'), value: s.shop_phone, type: 'tel' })}
        ${field({ name: 'shop_email', label: t('settings.shop_email'), value: s.shop_email, type: 'email' })}
        ${field({ name: 'shop_gstin', label: t('settings.shop_gstin'), value: s.shop_gstin, placeholder: '27ABCDE1234F1Z5' })}
        ${field({ name: 'shop_state_code', label: t('settings.shop_state_code'), type: 'select', value: s.shop_state_code, options: Object.entries(states).map(([c, n]) => ({ value: c, label: `${c} · ${n}` })) })}
      `));
    } else if (tab === 'billing') {
      setHTML(body, settingsForm(html`
        ${field({ name: 'prices_include_gst', label: t('settings.prices_include_gst'), type: 'switch', value: s.prices_include_gst, span2: true })}
        ${field({ name: 'default_part_gst_rate', label: t('settings.default_part_gst_rate'), type: 'number', value: s.default_part_gst_rate })}
        ${field({ name: 'labour_gst_rate', label: t('settings.labour_gst_rate'), type: 'number', value: s.labour_gst_rate })}
        ${field({ name: 'labour_sac', label: t('settings.labour_sac'), value: s.labour_sac })}
        ${field({ name: 'upi_id', label: t('settings.upi_id'), value: s.upi_id, placeholder: 'shopname@upi' })}
        ${field({ name: 'receipt_width', label: t('settings.receipt_width'), type: 'select', value: s.receipt_width || '58', options: [{ value: '58', label: t('settings.receipt_58') }, { value: '80', label: t('settings.receipt_80') }] })}
        ${field({ name: 'invoice_terms_en', label: t('settings.invoice_terms_en'), type: 'textarea', value: s.invoice_terms_en, span2: true })}
        ${field({ name: 'invoice_terms_mr', label: t('settings.invoice_terms_mr'), type: 'textarea', value: s.invoice_terms_mr, span2: true })}
      `, t('settings.ca_note')));
    } else if (tab === 'numbering') {
      setHTML(body, settingsForm(html`
        ${field({ name: 'job_prefix', label: t('settings.job_prefix'), value: s.job_prefix })}
        ${field({ name: 'estimate_prefix', label: t('settings.estimate_prefix'), value: s.estimate_prefix })}
        ${field({ name: 'invoice_prefix', label: t('settings.invoice_prefix'), value: s.invoice_prefix, hint: t('settings.invoice_preview', { no: invoicePreview() }) })}
      `));
    } else if (tab === 'workflow') {
      setHTML(body, settingsForm(html`
        ${field({ name: 'approval_limit', label: t('settings.approval_limit'), type: 'number', value: s.approval_limit, hint: t('settings.approval_limit_hint'), span2: true })}
        ${field({ name: 'service_reminder_days', label: t('settings.service_reminder_days'), type: 'number', dtype: 'int', value: s.service_reminder_days })}
        ${field({ name: 'service_reminder_km', label: t('settings.service_reminder_km'), type: 'number', dtype: 'int', value: s.service_reminder_km })}
        ${field({ name: 'payment_reminder_days', label: t('settings.payment_reminder_days'), type: 'number', dtype: 'int', value: s.payment_reminder_days })}
        ${field({ name: 'estimate_link_days', label: t('settings.estimate_link_days'), type: 'number', dtype: 'int', value: s.estimate_link_days })}
      `));
    } else if (tab === 'app') {
      setHTML(body, settingsForm(html`
        ${field({ name: 'min_app_version', label: t('settings.min_app_version'), value: s.min_app_version, placeholder: '1.0.0' })}
        ${field({ name: 'latest_app_url', label: t('settings.latest_app_url'), value: s.latest_app_url, placeholder: 'https://…/garage.apk' })}
      `));
    } else if (tab === 'backup') {
      const b = await api.get('/backups');
      if (!ctx.alive() || tab !== 'backup') return;
      setHTML(body, html`<div class="card" style="max-width:860px">
        <div class="card-head"><h3>${t('settings.backup')}</h3>
          <button class="btn btn-secondary btn-sm" data-backup-now>${icon('refresh-cw', 16)}${t('settings.backup_now')}</button>
          ${b.items.length ? html`<button class="btn btn-primary btn-sm" data-backup-dl>${icon('download', 16)}${t('settings.backup_download')}</button>` : ''}
        </div>
        ${b.dir_outside_web ? '' : html`<div class="banner danger" style="margin:16px">${icon('triangle-alert')}<span>${t('settings.backup_warning')}</span></div>`}
        ${b.items.length ? html`<div class="list">${b.items.map((f) => html`<div class="list-item"><span class="kpi-icon">${icon('file-text', 16)}</span><div style="flex:1"><div class="strong">${f.name}</div><div class="small muted">${f.created_at} · ${Math.round(f.size / 1024)} KB</div></div></div>`)}</div>`
          : html`<div class="card-body muted">${t('settings.backup_none')}</div>`}
      </div>`);
    } else if (tab === 'system') {
      await drawSystem(body, ctx, () => tab === 'system');
    } else {
      await drawMaster(tab);
    }
  };

  const MASTER = {
    labour_rates: { path: '/labour-rates', newKey: 'settings.new_rate', amount: true },
    locations: { path: '/locations', newKey: 'settings.new_location', sort: true },
    categories: { path: '/categories', newKey: 'settings.new_category' },
  };

  const drawMaster = async (key) => {
    const m = MASTER[key];
    const res = await api.get(m.path, { all: 1 });
    if (!ctx.alive() || tab !== key) return;
    const columns = [
      { key: 'name', label: t('common.name'), primary: true, render: (r) => html`<div class="t-title">${r.name_en}</div><div class="t-sub mr-text">${r.name_mr || ''}</div>` },
    ];
    if (m.amount) columns.push({ key: 'amount', label: t('common.amount'), num: true, render: (r) => money(r.amount) });
    if (m.sort) columns.push({ key: 'sort_order', label: t('common.sort_order'), num: true });
    columns.push({ key: 'active', label: t('common.status'), render: (r) => html`<span class="chip ${r.active ? 'success' : ''}">${t(r.active ? 'common.active' : 'common.inactive')}</span>` });
    columns.push({ key: 'actions', label: '', render: (r) => html`<button class="btn btn-ghost btn-sm" data-edit="${r.id}">${icon('pencil', 16)}${t('common.edit')}</button>` });
    setHTML(body, html`
      <div class="card" style="max-width:860px">
        <div class="card-head"><h3>${t('settings.' + key)}</h3><button class="btn btn-primary btn-sm" data-new>${icon('plus', 16)}${t(m.newKey)}</button></div>
        ${dataTable({ columns, rows: res.items })}
      </div>`);
    body.onclick = async (e) => {
      const editBtn = e.target.closest('[data-edit]');
      const newBtn = e.target.closest('[data-new]');
      if (!editBtn && !newBtn) return;
      const row = editBtn ? res.items.find((r) => r.id === Number(editBtn.dataset.edit)) : {};
      const saved = await openDrawer({
        title: editBtn ? nm(row) : t(m.newKey),
        body: html`<div class="stack">
          ${field({ name: 'name_en', label: t('common.name_en'), value: row.name_en, required: true })}
          ${field({ name: 'name_mr', label: t('common.name_mr'), value: row.name_mr, cls: 'mr-text' })}
          ${m.amount ? field({ name: 'amount', label: t('common.amount') + ' (₹)', type: 'number', value: row.amount, required: true }) : ''}
          ${m.sort ? field({ name: 'sort_order', label: t('common.sort_order'), type: 'number', dtype: 'int', value: row.sort_order ?? 0 }) : ''}
          ${editBtn ? field({ name: 'active', label: t('common.active'), type: 'switch', value: row.active }) : ''}
        </div>`,
        onSubmit: (d) => (editBtn ? api.put(`${m.path}/${row.id}`, d) : api.post(m.path, d)),
      });
      if (saved) {
        toast(t('common.saved'));
        drawMaster(key);
      }
    };
  };

  on(ctx.el, 'click', '[data-tab]', (e, b) => {
    tab = b.dataset.tab;
    ctx.el.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    body.onclick = null;
    body.onsubmit = null;
    draw();
  });

  on(ctx.el, 'click', '[data-backup-now]', async (e, b) => {
    await busy(b, async () => {
      try {
        await api.post('/backups');
        toast(t('settings.backup_done'));
        draw();
      } catch (err) {
        toastError(err);
      }
    });
  });
  on(ctx.el, 'click', '[data-backup-dl]', () => downloadApiFile('/backups/latest', {}, 'garage-backup.sql.gz').catch(toastError));

  on(ctx.el, 'submit', 'form[data-settings]', async (e, form) => {
    e.preventDefault();
    clearErrors(form);
    await busy($('button[type=submit]', form), async () => {
      try {
        const res = await api.put('/settings', readForm(form));
        s = res.settings;
        session.settings = s;
        toast(t('common.saved'));
        draw();
      } catch (err) {
        if (!(err.fields && showFieldErrors(form, err.fields))) toastError(err);
      }
    });
  });

  await draw();
}
