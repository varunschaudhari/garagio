import { html, setHTML, on } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../ui/icons.js';
import { money, date } from '../format.js';
import { emptyState, skeletonRows } from '../ui/table.js';
import { toast, toastError } from '../ui/toast.js';

/** Service and payment reminders: each opens WhatsApp with the bilingual message (click-to-send). */
export default async function reminders(ctx) {
  ctx.setTitle(t('reminders.title'));
  setHTML(ctx.el, skeletonRows(5));
  let due;

  const draw = () => {
    if (!ctx.alive()) return;
    const row = (r, kind, i) => html`<div class="list-item">
      <span class="kpi-icon ${kind === 'payment' ? 'danger' : 'primary'}">${icon(kind === 'payment' ? 'indian-rupee' : 'bike', 18)}</span>
      <div style="flex:1;min-width:0">
        <div class="strong"><a href="#/customers/${r.customer_id}">${r.name}</a> · ${r.phone}</div>
        <div class="small muted">${kind === 'service'
          ? html`${r.reg_no} ${r.model ? '· ' + r.model : ''} · ${t('reminders.days_ago', { n: r.days })}${r.est_km ? ' · ' + t('reminders.est_km', { km: r.est_km }) : ''}`
          : html`${money(r.balance)}${r.oldest ? ' · ' + t('reminders.oldest', { date: date(r.oldest) }) : ''}`}</div>
      </div>
      <button class="btn btn-primary btn-sm" data-send="${kind}:${i}">${icon('message-circle', 16)}${t('reminders.send')}</button>
    </div>`;
    setHTML(ctx.el, html`
      <div class="page-head"><div style="flex:1"><h1>${t('reminders.title')}</h1><div class="sub">${t('reminders.hint')}</div></div></div>
      <div class="grid-2" style="align-items:start">
        <section class="card" aria-labelledby="h-svc">
          <div class="card-head"><h3 id="h-svc">${t('reminders.service')}</h3><span class="chip primary plain">${due.service.length}</span></div>
          ${due.service.length ? html`<div class="list">${due.service.map((r, i) => row(r, 'service', i))}</div>` : emptyState({ ic: 'circle-check', title: t('reminders.empty_service') })}
        </section>
        <section class="card" aria-labelledby="h-pay">
          <div class="card-head"><h3 id="h-pay">${t('reminders.payment')}</h3><span class="chip danger plain">${due.payment.length}</span></div>
          ${due.payment.length ? html`<div class="list">${due.payment.map((r, i) => row(r, 'payment', i))}</div>` : emptyState({ ic: 'circle-check', title: t('reminders.empty_payment') })}
        </section>
      </div>`);
  };

  due = await api.get('/messages/due');
  draw();

  on(ctx.el, 'click', '[data-send]', async (e, b) => {
    const [kind, i] = b.dataset.send.split(':');
    const r = due[kind][Number(i)];
    window.open(r.url, '_blank', 'noopener');
    try {
      await api.post('/messages/log', { ...r.log, payload: r.text });
      due[kind].splice(Number(i), 1);
      toast(t('reminders.sent'));
      draw();
    } catch (err) {
      toastError(err);
    }
  });
}
