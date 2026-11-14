import { html, setHTML, $, $$, on, debounce } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../ui/icons.js';
import { money, todayISO } from '../format.js';
import { field, readForm, showFieldErrors, busy, clearErrors } from '../ui/form.js';
import { toast, toastError } from '../ui/toast.js';

const CHIPS = ['general_service', 'brake', 'starting', 'oil_leak', 'noise', 'clutch', 'electrical', 'puncture', 'pickup', 'chain'];
const FUEL = ['E', '1/4', '1/2', '3/4', 'F'];

/** New job card: one search box (phone or bike number), pick or quick-create the customer and bike. */
export default async function jobNew(ctx) {
  ctx.setTitle(t('jobs.new'));
  const mechanics = (await api.get('/users/mechanics')).items;
  if (!ctx.alive()) return;
  // sel.customer: existing customer | null (new);  sel.vehicleId: id | 'new'
  const sel = { customer: null, vehicleId: null, isNew: false };
  let lastLookup = { customers: [], reg_no: null, phone: null };

  setHTML(ctx.el, html`
    <div class="page-head"><div style="flex:1"><a href="#/jobs" class="small muted">${icon('arrow-left', 14)} ${t('jobs.title')}</a><h1 style="margin-top:6px">${t('jobs.new')}</h1></div></div>
    <form id="job-form" class="stack-lg" novalidate style="max-width:960px">
      <div class="card card-pad stack">
        <h3>${t('jobs.lookup_title')}</h3>
        <div class="input-group">${icon('search')}<input class="input" id="lookup" placeholder="${t('jobs.lookup_placeholder')}" autocomplete="off" style="min-height:48px;font-size:16px" aria-label="${t('jobs.lookup_placeholder')}"></div>
        <div class="small muted">${t('jobs.lookup_hint')}</div>
        <div id="lookup-results" class="stack"></div>
        <div><button type="button" class="btn btn-secondary" data-act="new-customer">${icon('plus')}${t('jobs.new_customer')}</button></div>
        <div id="new-customer" class="form-grid hidden"></div>
      </div>

      <div class="card card-pad">
        <div class="form-grid">
          ${field({ name: 'odometer', label: t('jobs.odometer'), type: 'number', dtype: 'int', inputmode: 'numeric' })}
          <div class="field"><span class="field-label">${t('jobs.fuel')}</span>
            <div class="seg" role="group" id="fuel">${FUEL.map((f) => html`<button type="button" data-fuel="${f}" aria-pressed="false">${f}</button>`)}</div>
            <input type="hidden" name="fuel_level"></div>
          <div class="field span-2">
            <label for="complaint">${t('jobs.complaint')}</label>
            <div class="filter-chips" style="margin-bottom:6px">${CHIPS.map((c) => html`<button type="button" class="filter-chip" data-chip="${c}">${t('jobs.chips.' + c)}</button>`)}</div>
            <textarea id="complaint" class="input" name="complaint" rows="3"></textarea>
          </div>
          ${field({ name: 'mechanic_id', label: t('jobs.mechanic'), type: 'select', dtype: 'int', options: [{ value: '', label: t('jobs.no_mechanic') }, ...mechanics.map((m) => ({ value: m.id, label: m.name }))] })}
          ${field({ name: 'promised_at', label: t('jobs.promised'), type: 'datetime-local', value: todayISO() + 'T18:00' })}
        </div>
      </div>
      <div class="row" style="justify-content:flex-end"><button class="btn btn-primary btn-lg" type="submit">${icon('check')}${t('jobs.create')}</button></div>
    </form>`);

  const form = $('#job-form', ctx.el);
  const results = $('#lookup-results', ctx.el);
  const newBox = $('#new-customer', ctx.el);

  const drawNewCustomer = () => {
    const ph = lastLookup.phone || '';
    const reg = lastLookup.reg_no && !ph ? lastLookup.reg_no : '';
    setHTML(newBox, html`
      ${field({ name: 'c_name', label: t('jobs.customer_name'), required: true })}
      ${field({ name: 'c_phone', label: t('common.phone'), type: 'tel', inputmode: 'tel', required: true, value: ph })}
      ${field({ name: 'c_language', label: t('jobs.language_pref'), type: 'select', value: 'mr', options: [{ value: 'mr', label: 'मराठी' }, { value: 'en', label: 'English' }] })}
      <div></div>
      ${field({ name: 'v_reg_no', label: t('jobs.reg_no'), required: true, value: reg, placeholder: 'MH12AB1234' })}
      ${field({ name: 'v_make', label: t('jobs.make'), placeholder: 'Hero' })}
      ${field({ name: 'v_model', label: t('jobs.model'), placeholder: 'Splendor Plus' })}`);
  };

  const newBikeFields = () => html`<div class="form-grid" id="new-bike" style="margin-top:8px">
    ${field({ name: 'v_reg_no', label: t('jobs.reg_no'), required: true, placeholder: 'MH12AB1234', value: lastLookup.reg_no || '' })}
    ${field({ name: 'v_make', label: t('jobs.make') })}
    ${field({ name: 'v_model', label: t('jobs.model') })}</div>`;

  const drawResults = () => {
    if (sel.isNew) {
      setHTML(results, '');
      return;
    }
    setHTML(results, html`${lastLookup.customers.map((c) => {
      const chosen = sel.customer?.id === c.id;
      return html`<div class="card" style="padding:12px 16px;border-color:${chosen ? 'var(--primary)' : 'var(--border)'}">
        <div class="row"><span class="avatar">${icon('user', 16)}</span>
          <div style="flex:1"><div class="strong">${c.name}</div><div class="small muted">${c.phone}${c.balance > 0 ? ' · ' + t('customers.balance') + ' ' + money(c.balance) : ''}</div></div>
          ${c.open_job ? html`<a class="chip warning" href="#/jobs/${c.open_job.id}">${t('jobs.open_job_exists', { job: c.open_job.job_no })}</a>` : ''}
        </div>
        <div class="row-wrap" style="margin-top:10px" role="radiogroup" aria-label="${t('jobs.choose_bike')}">
          ${c.vehicles.map((v) => html`<button type="button" class="filter-chip" data-pick="${c.id}" data-vehicle="${v.id}" aria-pressed="${chosen && sel.vehicleId === v.id}">${icon('bike', 16)} ${v.reg_no} <span class="muted">${v.model || ''}</span></button>`)}
          <button type="button" class="filter-chip" data-pick="${c.id}" data-vehicle="new" aria-pressed="${chosen && sel.vehicleId === 'new'}">${icon('plus', 16)} ${t('jobs.new_bike')}</button>
        </div>
        ${chosen && sel.vehicleId === 'new' ? newBikeFields() : ''}
      </div>`;
    })}`);
  };

  const lookup = debounce(async (q) => {
    if (q.length < 3) {
      lastLookup = { customers: [], reg_no: null, phone: null };
      drawResults();
      return;
    }
    try {
      lastLookup = await api.get('/lookup', { q });
    } catch (e) {
      toastError(e);
      return;
    }
    if (!ctx.alive()) return;
    if (!lastLookup.customers.length && !sel.isNew) {
      sel.isNew = true;
      newBox.classList.remove('hidden');
      drawNewCustomer();
    }
    drawResults();
  }, 300);

  on(ctx.el, 'input', '#lookup', (e, inp) => {
    if (sel.isNew && inp.value.trim().length >= 3) {
      // typing again: search again
      sel.isNew = false;
      newBox.classList.add('hidden');
    }
    lookup(inp.value.trim());
  });
  on(ctx.el, 'click', '[data-pick]', (e, b) => {
    sel.customer = lastLookup.customers.find((c) => c.id === Number(b.dataset.pick));
    sel.vehicleId = b.dataset.vehicle === 'new' ? 'new' : Number(b.dataset.vehicle);
    sel.isNew = false;
    newBox.classList.add('hidden');
    drawResults();
    const odo = $('[name=odometer]', form);
    if (odo && sel.vehicleId !== 'new') odo.focus();
  });
  on(ctx.el, 'click', '[data-act="new-customer"]', () => {
    sel.customer = null;
    sel.vehicleId = null;
    sel.isNew = true;
    newBox.classList.remove('hidden');
    drawNewCustomer();
    drawResults();
    $('[name=c_name]', newBox).focus();
  });
  on(ctx.el, 'click', '[data-fuel]', (e, b) => {
    $$('[data-fuel]', ctx.el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('[name=fuel_level]', form).value = b.dataset.fuel;
  });
  on(ctx.el, 'click', '[data-chip]', (e, b) => {
    const ta = $('#complaint', ctx.el);
    const text = t('jobs.chips.' + b.dataset.chip);
    ta.value = ta.value.trim() ? ta.value.trim() + ', ' + text : text;
    b.setAttribute('aria-pressed', 'true');
    ta.focus();
  });

  // Preselect from a customer page: #/jobs/new?customer=1&vehicle=2
  if (ctx.query.customer) {
    try {
      const c = (await api.get('/customers/' + Number(ctx.query.customer))).item;
      lastLookup = { customers: [c], reg_no: null, phone: null };
      sel.customer = c;
      sel.vehicleId = ctx.query.vehicle ? Number(ctx.query.vehicle) : c.vehicles[0]?.id ?? 'new';
      $('#lookup', ctx.el).value = c.phone;
      drawResults();
    } catch {
      /* ignore */
    }
  } else {
    $('#lookup', ctx.el).focus();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const d = readForm(form);
    const body = { odometer: d.odometer, fuel_level: d.fuel_level, complaint: d.complaint, mechanic_id: d.mechanic_id, promised_at: d.promised_at };
    if (sel.isNew) {
      body.customer = { name: d.c_name, phone: d.c_phone, language: d.c_language };
      body.vehicle = { reg_no: d.v_reg_no, make: d.v_make, model: d.v_model };
    } else if (sel.customer) {
      body.customer_id = sel.customer.id;
      if (sel.vehicleId === 'new') body.vehicle = { reg_no: d.v_reg_no, make: d.v_make, model: d.v_model };
      else body.vehicle_id = sel.vehicleId;
    } else {
      toast(t('jobs.lookup_title'), 'error');
      $('#lookup', ctx.el).focus();
      return;
    }
    await busy($('button[type=submit]', form), async () => {
      try {
        const res = await api.post('/jobs', body);
        toast(t('jobs.created_ok', { no: res.item.job_no }));
        location.hash = '#/jobs/' + res.item.id;
      } catch (err) {
        // Map nested field names back to the form (customer.phone → c_phone, vehicle reg → v_reg_no)
        const f = { ...(err.fields || {}) };
        if (f.phone) f.c_phone = f.phone;
        if (f.name) f.c_name = f.name;
        if (f.reg_no) f.v_reg_no = f.reg_no;
        if (!showFieldErrors(form, f)) toastError(err);
        else toastError(err);
      }
    });
  });
}
