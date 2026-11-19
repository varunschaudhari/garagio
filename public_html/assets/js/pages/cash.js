import { html, setHTML, $, on, replaceQuery } from '../dom.js';
import { t, nm } from '../i18n.js';
import { api } from '../api.js';
import { hasRole } from '../store.js';
import { icon } from '../ui/icons.js';
import { money, date, datetime, todayISO } from '../format.js';
import { skeletonRows } from '../ui/table.js';
import { field, busy } from '../ui/form.js';
import { openDrawer } from '../ui/drawer.js';
import { confirmDialog } from '../ui/modal.js';
import { toast, toastError } from '../ui/toast.js';
import { uploadBillPhoto, viewBillPhoto, billPhotoInput } from '../ui/bill-photo.js';

const MODES = ['cash', 'upi', 'bank'];

export function diffText(d) {
  const v = Math.round(Number(d) * 100) / 100;
  if (Math.abs(v) < 0.005) return { text: t('cash.exact'), color: 'var(--success-text)' };
  return v < 0 ? { text: t('cash.short', { amount: money(-v) }), color: 'var(--danger-text)' } : { text: t('cash.extra', { amount: money(v) }), color: 'var(--warning-text)' };
}

/** Cash book: what should be in the drawer today, the expenses, and the count at closing. */
export default async function cashPage(ctx) {
  ctx.setTitle(t('cash.title'));
  const owner = hasRole('owner');
  let day = ctx.query.date || todayISO();
  let d = null;

  setHTML(ctx.el, html`
    <div class="page-head">
      <div style="flex:1;min-width:240px"><h1>${t('cash.title')}</h1><div class="sub">${t('cash.sub')}</div></div>
      <input class="input" type="date" id="cash-date" value="${day}" max="${todayISO()}" style="width:auto" aria-label="${t('cash.date')}">
      <button class="btn btn-primary" data-act="expense">${icon('plus')}${t('cash.add_expense')}</button>
    </div>
    <div id="cash-body">${skeletonRows(6)}</div>`);
  const body = $('#cash-body', ctx.el);

  const line = (label, value, strong = false) => html`<dt class="${strong ? 'strong' : ''}">${label}</dt><dd class="num ${strong ? 'strong' : ''}">${value}</dd>`;

  const draw = () => {
    const c = d.close;
    const other = Object.entries(d.other_modes || {}).map(([m, v]) => `${t('pay.' + m)} ${money(v)}`).join(' · ');
    const diff = c ? diffText(c.difference) : null;
    setHTML(body, html`
      <div class="grid-2" style="align-items:start">
        <div class="card card-pad">
          <h3 style="margin-bottom:12px">${t('cash.drawer')} · ${date(d.date)}</h3>
          <dl class="dl" style="grid-template-columns:1fr auto">
            <dt>${t('cash.opening')}<div class="small muted">${c ? '' : d.opening_from ? t('cash.opening_from', { date: date(d.opening_from) }) : t('cash.opening_first')}</div></dt><dd class="num">${money(c ? c.opening : d.opening)}</dd>
            ${line(t('cash.in_customer_payments'), money(d.in.customer_payments))}
            ${['refunds', 'supplier_payments', 'expenses', 'mechanic_payments'].map((k) => line(t('cash.out_' + k), money(d.out[k])))}
            <dt class="strong" style="font-size:18px;color:var(--text)">${t('cash.expected')}</dt><dd class="num strong" style="font-size:22px" id="cash-expected">${money(c ? c.expected : d.expected)}</dd>
          </dl>
          ${other ? html`<div class="small muted" style="margin-top:12px">${t('cash.other_modes', { list: other })}</div>` : ''}
        </div>
        ${c ? html`<div class="card card-pad stack">
          <h3>${t('cash.close')}</h3>
          <dl class="dl" style="grid-template-columns:1fr auto">
            ${line(t('cash.counted'), money(c.counted), true)}
            <dt>${t('cash.difference')}</dt><dd class="num strong" style="color:${diff.color}">${diff.text}</dd>
            ${line(t('cash.taken_out'), money(c.taken_out))}
            ${line(t('cash.kept'), money(c.counted - c.taken_out))}
          </dl>
          ${c.note ? html`<div class="small">${c.note}</div>` : ''}
          <div class="small muted">${t('cash.closed_by', { name: c.user_name || '—', time: datetime(c.created_at) })}</div>
          ${owner ? html`<div><button class="btn btn-ghost btn-sm" data-act="reopen">${icon('undo-2', 16)}${t('cash.reopen')}</button></div>` : ''}
        </div>` : html`<form class="card card-pad stack" id="close-form" novalidate>
          <h3>${t('cash.close')}</h3>
          <div class="small muted">${t('cash.close_hint')}</div>
          ${d.opening_from ? '' : field({ name: 'opening', label: t('cash.opening'), type: 'number', hint: t('cash.opening_first') })}
          ${field({ name: 'counted', label: t('cash.counted') + ' (₹)', type: 'number', required: true })}
          <div class="strong" id="close-diff"></div>
          ${field({ name: 'taken_out', label: t('cash.taken_out') + ' (₹)', type: 'number' })}
          ${field({ name: 'note', label: t('common.notes') })}
          <button class="btn btn-primary" type="submit">${icon('check')}${t('cash.save_close')}</button>
        </form>`}
      </div>
      <div class="card" style="margin-top:20px">
        <div class="card-head"><h3>${t('cash.expenses')}</h3><span class="strong num">${money(d.expenses_total)}</span></div>
        ${d.expenses.length ? html`<div class="list">${d.expenses.map((e) => html`<div class="list-item">
          <div style="flex:1"><div class="strong">${nm(e, 'category')}${e.note ? ' · ' + e.note : ''}</div><div class="small muted">${t('pay.' + e.mode)} · ${e.user_name || ''}</div></div>
          <div class="num strong">${money(e.amount)}</div>
          ${e.photo
            ? html`<button class="btn btn-ghost btn-icon btn-sm" data-photo-view="${e.id}" aria-label="${t('bills.view_photo')}" title="${t('bills.view_photo')}">${icon('image', 16)}</button>`
            : html`<label class="btn btn-ghost btn-icon btn-sm" aria-label="${t('bills.add_photo')}" title="${t('bills.add_photo')}">${icon('camera', 16)}${billPhotoInput(`data-photo-add="${e.id}"`)}</label>`}
          ${c ? '' : html`<button class="btn btn-ghost btn-icon btn-sm" data-del="${e.id}" aria-label="${t('common.delete')}">${icon('trash-2', 16)}</button>`}
        </div>`)}</div>` : html`<div class="card-body muted">${t('cash.no_expenses')}</div>`}
      </div>
      <div class="card" style="margin-top:20px" id="cash-history"></div>`);
    loadHistory();
  };

  const loadHistory = async () => {
    const h = (await api.get('/cash/closes')).items;
    if (!ctx.alive()) return;
    setHTML($('#cash-history', ctx.el), html`<div class="card-head"><h3>${t('cash.history')}</h3></div>
      ${h.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>${t('cash.date')}</th><th class="num">${t('cash.expected')}</th><th class="num">${t('cash.counted')}</th><th class="num">${t('cash.difference')}</th></tr></thead>
        <tbody>${h.map((r) => { const df = diffText(r.difference); return html`<tr><td><a href="#/cash?date=${r.close_date}">${date(r.close_date)}</a></td><td class="num">${money(r.expected)}</td><td class="num">${money(r.counted)}</td><td class="num strong" style="color:${df.color}">${df.text}</td></tr>`; })}</tbody></table></div>`
        : html`<div class="card-body muted">${t('cash.none')}</div>`}`);
  };

  const load = async () => {
    replaceQuery({ date: day === todayISO() ? '' : day });
    try {
      d = await api.get('/cash/day', { date: day });
    } catch (e) {
      toastError(e);
      return;
    }
    if (ctx.alive()) draw();
  };

  on(ctx.el, 'change', '#cash-date', (e, inp) => {
    day = inp.value || todayISO();
    load();
  });
  on(ctx.el, 'input', '#close-form [name=counted], #close-form [name=opening]', () => {
    const f = $('#close-form', ctx.el);
    const counted = $('[name=counted]', f).value;
    const openIn = $('[name=opening]', f);
    const expected = d.expected + (openIn ? Number(openIn.value.replace(',', '.')) || 0 : 0);
    if (openIn) $('#cash-expected', ctx.el).textContent = money(expected);
    const out = $('#close-diff', f);
    if (counted === '') {
      out.textContent = '';
      return;
    }
    const df = diffText(Number(counted.replace(',', '.')) - expected);
    out.textContent = `${t('cash.difference')}: ${df.text}`;
    out.style.color = df.color;
  });
  on(ctx.el, 'submit', '#close-form', async (e, f) => {
    e.preventDefault();
    const counted = $('[name=counted]', f).value.trim();
    if (counted === '') {
      $('[name=counted]', f).closest('.field').classList.add('invalid');
      return;
    }
    const num = (n) => Number(($(`[name=${n}]`, f)?.value || '').replace(',', '.')) || 0;
    await busy($('button[type=submit]', f), async () => {
      try {
        d = await api.post('/cash/close', { date: day, counted: num('counted'), taken_out: num('taken_out'), note: $('[name=note]', f).value.trim(), ...($('[name=opening]', f) ? { opening: num('opening') } : {}) });
        toast(t('cash.closed_ok'));
        draw();
      } catch (err) {
        toastError(err);
      }
    });
  });
  on(ctx.el, 'click', '[data-act="reopen"]', async () => {
    if (!(await confirmDialog({ title: t('cash.reopen'), message: t('cash.reopen_q'), danger: true }))) return;
    try {
      d = await api.del('/cash/close/' + day);
      toast(t('cash.reopened'));
      draw();
    } catch (err) {
      toastError(err);
    }
  });
  on(ctx.el, 'click', '[data-del]', async (e, b) => {
    if (!(await confirmDialog({ title: t('cash.delete_q'), danger: true, confirmLabel: t('common.delete') }))) return;
    try {
      await api.del('/expenses/' + b.dataset.del);
      load();
    } catch (err) {
      toastError(err);
    }
  });
  on(ctx.el, 'click', '[data-photo-view]', (e, b) => viewBillPhoto(`/expenses/${b.dataset.photoView}/photo`));
  on(ctx.el, 'change', '[data-photo-add]', async (e, inp) => {
    const file = inp.files[0];
    if (!file) return;
    try {
      await uploadBillPhoto(`/expenses/${inp.dataset.photoAdd}/photo`, file);
      toast(t('bills.photo_saved'));
      load();
    } catch (err) {
      toastError(err);
    }
  });
  on(ctx.el, 'click', '[data-act="expense"]', async () => {
    let cats;
    try {
      cats = (await api.get('/expense-categories')).items;
    } catch (err) {
      return toastError(err);
    }
    const res = await openDrawer({
      title: t('cash.add_expense'),
      body: html`<div class="stack">
        ${field({ name: 'spent_on', label: t('cash.date'), type: 'date', value: day, required: true })}
        ${field({ name: 'category_id', label: t('cash.category'), type: 'select', dtype: 'int', value: cats[0]?.id, options: cats.map((c) => ({ value: c.id, label: nm(c) })), required: true })}
        ${owner ? html`<a class="small" href="#/settings?tab=expense_categories">${t('cash.edit_categories')}</a>` : ''}
        ${field({ name: 'amount', label: t('common.amount') + ' (₹)', type: 'number', required: true })}
        ${field({ name: 'mode', label: t('suppliers.mode'), type: 'select', value: 'cash', options: MODES.map((m) => ({ value: m, label: t('pay.' + m) })) })}
        ${field({ name: 'note', label: t('common.notes') })}
        <div class="field"><label for="exp-photo">${t('bills.photo')}</label><input id="exp-photo" class="input" type="file" accept="image/*"></div>
      </div>`,
      onSubmit: async (data, form) => {
        const saved = await api.post('/expenses', data);
        const photo = $('#exp-photo', form).files[0];
        if (photo) await uploadBillPhoto(`/expenses/${saved.item.id}/photo`, photo).catch(toastError);
        return saved;
      },
    });
    if (res) {
      toast(t('cash.expense_saved'));
      day = res.item.spent_on;
      $('#cash-date', ctx.el).value = day;
      load();
    }
  });

  await load();
}
