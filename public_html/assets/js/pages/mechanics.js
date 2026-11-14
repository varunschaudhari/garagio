import { html, setHTML, $, on } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../ui/icons.js';
import { money, todayISO } from '../format.js';
import { dataTable, skeletonRows, emptyState } from '../ui/table.js';
import { busy } from '../ui/form.js';
import { toast, toastError } from '../ui/toast.js';

/** Owner: what each mechanic did on a day, and what the owner pays them (his decision). */
export default async function mechanicsPage(ctx) {
  ctx.setTitle(t('mechanics.title'));
  let tab = ctx.query.tab === 'totals' ? 'totals' : 'daily';
  let day = ctx.query.date || todayISO();
  let from = ctx.query.from || todayISO().slice(0, 8) + '01';
  let to = ctx.query.to || todayISO();

  setHTML(ctx.el, html`
    <div class="page-head"><div style="flex:1"><h1>${t('mechanics.title')}</h1><div class="sub">${t('mechanics.your_decision')}</div></div></div>
    <div class="tabs" role="tablist">
      <button role="tab" data-tab="daily" aria-selected="${tab === 'daily'}">${t('mechanics.daily')}</button>
      <button role="tab" data-tab="totals" aria-selected="${tab === 'totals'}">${t('mechanics.totals')}</button>
    </div>
    <div id="m-body"></div>`);
  const body = $('#m-body', ctx.el);

  const drawDaily = async () => {
    setHTML(body, skeletonRows(4));
    const d = await api.get('/mechanics/daily', { date: day });
    if (!ctx.alive()) return;
    history.replaceState(null, '', `#/mechanics?date=${day}`);
    setHTML(body, html`
      <div class="row" style="margin-bottom:16px"><label for="m-date" class="strong">${t('mechanics.date')}</label><input id="m-date" class="input" type="date" value="${day}" max="${todayISO()}" style="width:auto"></div>
      <div class="stack-lg">${d.items.map((m) => html`
        <section class="card" aria-label="${m.name}">
          <div class="card-head" style="flex-wrap:wrap">
            <h3>${m.name}</h3>
            <span class="chip info plain">${t('mechanics.jobs')}: ${m.jobs_count}</span>
            <span class="chip plain">${t('mechanics.labour')}: ${money(m.labour_billed)}</span>
            <span class="chip plain">${t('mechanics.parts')}: ${money(m.parts_value)}</span>
          </div>
          ${m.jobs.length ? dataTable({
            columns: [
              { key: 'reg', label: t('jobs.bike'), primary: true, render: (j) => html`<a href="#/jobs/${j.job_id}" class="t-title">${j.reg_no}</a><div class="t-sub">${j.job_no} · ${j.invoice_no}</div>` },
              { key: 'labour', label: t('mechanics.labour'), num: true, render: (j) => money(j.labour) },
              { key: 'parts', label: t('mechanics.parts'), num: true, render: (j) => money(j.parts) },
            ],
            rows: m.jobs,
          }) : html`<div class="card-body muted">${t('mechanics.none')}</div>`}
          <form class="card-foot" data-pay="${m.id}" style="flex-wrap:wrap;justify-content:flex-start;align-items:flex-end">
            <div class="field" style="width:140px"><label for="amt-${m.id}">${t('mechanics.amount')}</label><input id="amt-${m.id}" class="input num" name="amount" inputmode="decimal" required></div>
            <div class="field" style="width:140px"><label for="kind-${m.id}">${t('mechanics.kind')}</label>
              <select id="kind-${m.id}" class="select" name="kind"><option value="daily">${t('mechanics.kind_daily')}</option><option value="advance">${t('mechanics.kind_advance')}</option></select></div>
            <div class="field" style="flex:1;min-width:160px"><label for="note-${m.id}">${t('mechanics.note')}</label><input id="note-${m.id}" class="input" name="note"></div>
            <button class="btn btn-primary" type="submit">${icon('hand-coins')}${t('mechanics.pay')}</button>
            <span class="spacer"></span>
            <span class="muted">${t('mechanics.paid')}: <strong>${money(m.paid_daily)}</strong>${m.paid_advance ? html` · ${t('mechanics.advance')}: <strong>${money(m.paid_advance)}</strong>` : ''}</span>
          </form>
        </section>`)}</div>`);
  };

  const drawTotals = async () => {
    setHTML(body, skeletonRows(4));
    const s = await api.get('/mechanics/summary', { from, to });
    if (!ctx.alive()) return;
    history.replaceState(null, '', `#/mechanics?tab=totals&from=${from}&to=${to}`);
    setHTML(body, html`
      <div class="row-wrap" style="margin-bottom:16px">
        <input class="input" type="date" name="from" value="${from}" style="width:auto" aria-label="${t('common.from')}">
        <input class="input" type="date" name="to" value="${to}" style="width:auto" aria-label="${t('common.to')}">
      </div>
      <div class="card">${dataTable({
        columns: [
          { key: 'name', label: t('jobs.mechanic'), primary: true, render: (m) => html`<span class="t-title">${m.name}</span>` },
          { key: 'jobs', label: t('mechanics.jobs'), num: true, render: (m) => m.jobs_count },
          { key: 'labour', label: t('mechanics.labour'), num: true, render: (m) => money(m.labour_billed) },
          { key: 'parts', label: t('mechanics.parts'), num: true, render: (m) => money(m.parts_value) },
          { key: 'daily', label: t('mechanics.kind_daily'), num: true, render: (m) => money(m.paid_daily) },
          { key: 'adv', label: t('mechanics.advance'), num: true, render: (m) => money(m.paid_advance) },
          { key: 'total', label: t('mechanics.paid_total'), num: true, render: (m) => html`<strong>${money(m.paid_total)}</strong>` },
        ],
        rows: s.items,
        empty: emptyState({ ic: 'users', title: t('common.no_results') }),
      })}</div>`);
  };

  const draw = () => (tab === 'daily' ? drawDaily() : drawTotals()).catch(toastError);

  on(ctx.el, 'click', '[data-tab]', (e, b) => {
    tab = b.dataset.tab;
    ctx.el.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    draw();
  });
  on(ctx.el, 'change', '#m-date', (e, inp) => { day = inp.value || todayISO(); draw(); });
  on(ctx.el, 'change', 'input[name=from], input[name=to]', (e, inp) => {
    if (inp.name === 'from') from = inp.value;
    else to = inp.value;
    draw();
  });
  on(ctx.el, 'submit', 'form[data-pay]', async (e, form) => {
    e.preventDefault();
    const amount = Number(form.amount.value.replace(',', '.'));
    if (!(amount > 0)) {
      form.amount.focus();
      return;
    }
    await busy($('button[type=submit]', form), async () => {
      try {
        await api.post(`/mechanics/${form.dataset.pay}/payments`, { work_date: day, amount, kind: form.kind.value, note: form.note.value.trim() });
        toast(t('mechanics.saved'));
        draw();
      } catch (err) {
        toastError(err);
      }
    });
  });
  await draw();
}
