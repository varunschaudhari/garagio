import { html, setHTML, $, on } from '../dom.js';
import { t, nm, errorText } from '../i18n.js';
import { api, request } from '../api.js';
import { session, hasRole } from '../store.js';
import { icon } from '../ui/icons.js';
import { money, qty, datetime } from '../format.js';
import { statusChip, skeletonRows } from '../ui/table.js';
import { field, busy } from '../ui/form.js';
import { openDrawer } from '../ui/drawer.js';
import { confirmDialog, promptDialog } from '../ui/modal.js';
import { toast, toastError } from '../ui/toast.js';
import { openEstimateForm } from './estimate-form.js';
import { openRequestForm } from './request-form.js';

const STATUS_BTN = {
  in_progress: { label: 'jobs.to_in_progress', kind: 'primary', ic: 'wrench' },
  waiting_parts: { label: 'jobs.to_waiting_parts', kind: 'secondary', ic: 'hourglass' },
  ready: { label: 'jobs.to_ready', kind: 'primary', ic: 'circle-check' },
  delivered: { label: 'jobs.to_delivered', kind: 'primary', ic: 'bike' },
  cancelled: { label: 'jobs.to_cancelled', kind: 'ghost', ic: 'ban' },
};

/** Open a WhatsApp URL; the window is opened before the await so pop-up blockers allow it. */
async function openWhatsApp(getUrl) {
  const win = window.open('', '_blank');
  try {
    const url = await getUrl();
    if (win) win.location.href = url;
    else window.location.href = url;
    toast(t('estimates.opened_whatsapp'));
  } catch (e) {
    if (win) win.close();
    toastError(e);
  }
}

function timelineLabel(ev) {
  const d = ev.data || {};
  const base = t('jobs.events.' + ev.action);
  if (ev.action === 'job_status') return `${base}: ${t('status.' + d.from)} → ${t('status.' + d.to)}${d.note ? ' · ' + d.note : ''}`;
  if (ev.action === 'estimate_sent' || ev.action === 'estimate_created') return `${base} ${d.est_no || 'v' + (d.version || '')} · ${money(d.total)}`;
  if (ev.action === 'estimate_approved') return `${base} ${d.est_no} · ${t(d.via === 'call' ? 'estimates.via_call' : d.via === 'desk' ? 'estimates.via_desk' : 'estimates.via_link')}`;
  if (ev.action === 'parts_issued') return `${base}: ${d.part} × ${qty(d.qty)}`;
  if (ev.action === 'parts_unavailable') return `${base}: ${d.part}${d.remark ? ' · ' + d.remark : ''}`;
  if (ev.action === 'job_part_return') return `${base} × ${qty(d.qty)}`;
  return base;
}

export default async function jobPage(ctx) {
  const id = Number(ctx.params.id);
  const role = session.user.role;
  const canEdit = hasRole('owner', 'front_desk');
  const isMech = role === 'mechanic';
  const canStock = hasRole('owner', 'inventory');
  let job;
  const photoUrls = new Map();

  setHTML(ctx.el, skeletonRows(6));

  const loadPhotos = async () => {
    for (const p of job.photos) {
      if (photoUrls.has(p.id)) continue;
      try {
        const res = await request('GET', `/jobs/${id}/photos/${p.id}`, { raw: true });
        photoUrls.set(p.id, URL.createObjectURL(await res.blob()));
      } catch {
        /* skip broken photo */
      }
    }
    for (const img of ctx.el.querySelectorAll('img[data-photo]')) {
      const u = photoUrls.get(Number(img.dataset.photo));
      if (u) img.src = u;
    }
  };

  const draw = (j) => {
    job = j;
    if (!ctx.alive()) return;
    ctx.setTitle(`${j.reg_no} · ${j.job_no}`);
    const m = j.money;
    const latest = j.estimates[0];
    const requestable = ['approved', 'in_progress', 'waiting_parts'].includes(j.status);
    const statusButtons = j.allowed_status.filter((s) => !(isMech && (s === 'cancelled' || s === 'delivered')) && role !== 'inventory');
    const est = (e) => html`
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div><strong>${e.est_no}</strong> <span class="muted">v${e.version}</span> ${statusChip(e.status)}
          ${e.approved_at ? html`<span class="small muted">${datetime(e.approved_at)} · ${t(e.approved_via === 'call' ? 'estimates.via_call' : e.approved_via === 'desk' ? 'estimates.via_desk' : 'estimates.via_link')}</span>` : e.sent_at ? html`<span class="small muted">${t('estimates.sent')} ${datetime(e.sent_at)}</span>` : ''}</div>
        <strong style="font-size:18px">${money(e.grand_total)}</strong>
      </div>`;

    setHTML(ctx.el, html`
      <div class="page-head">
        <div style="flex:1;min-width:260px">
          <a href="#/jobs" class="small muted">${icon('arrow-left', 14)} ${isMech ? t('jobs.my_jobs') : t('jobs.title')}</a>
          <h1 style="margin-top:6px">${j.reg_no} <span class="muted" style="font-weight:500">${j.job_no}</span> ${statusChip(j.status)}</h1>
          <div class="sub">${[j.make, j.model, j.year].filter(Boolean).join(' ')} ·
            ${canEdit ? html`<a href="#/customers/${j.customer_id}">${j.customer_name}</a>` : j.customer_name}
            ${canEdit ? html` · <a href="tel:${j.customer_phone}">${j.customer_phone}</a>` : ''}
            · ${icon('wrench', 13)} ${j.mechanic_name || t('jobs.no_mechanic')}
            ${j.promised_at ? html` · ${icon('clock', 13)} ${datetime(j.promised_at)}` : ''}</div>
        </div>
        <div class="row-wrap">
          ${canEdit && j.can_approve ? html`<button class="btn btn-primary" data-act="approve">${icon('circle-check')}${t('jobs.approve')}</button>` : ''}
          ${statusButtons.map((s) => {
            const b = STATUS_BTN[s];
            const label = s === 'in_progress' && j.status === 'ready' ? 'jobs.back_in_progress' : b.label;
            return html`<button class="btn btn-${b.kind}" data-status="${s}">${icon(b.ic)}${t(label)}</button>`;
          })}
          ${j.status === 'ready' && canEdit ? html`<button class="btn btn-secondary" data-act="ready-wa">${icon('message-circle')}${t('jobs.ready_whatsapp')}</button>` : ''}
          ${canEdit && j.invoice ? html`<a class="btn btn-secondary" href="#/invoices/${j.invoice.id}">${icon('receipt')}${j.invoice.invoice_no || t('billing.draft')}</a>` : ''}
          ${canEdit && !j.invoice && ['approved', 'in_progress', 'waiting_parts', 'ready'].includes(j.status) ? html`<button class="btn btn-secondary" data-act="bill">${icon('receipt')}${t('billing.create_bill')}</button>` : ''}
        </div>
      </div>

      ${m.revised_needed && !m.revision_pending ? html`<div class="banner warning" style="margin-bottom:16px">${icon('triangle-alert')}<span style="flex:1">${t('jobs.revised_needed')}</span>${canEdit ? html`<button class="btn btn-secondary btn-sm" data-act="estimate">${t('estimates.revise')}</button>` : ''}</div>` : ''}
      ${m.revision_pending ? html`<div class="banner" style="margin-bottom:16px">${icon('info')}<span>${t('jobs.revision_pending')}</span></div>` : ''}

      <div class="grid-2" style="grid-template-columns:minmax(0,3fr) minmax(0,2fr);align-items:start">
        <div class="stack-lg">
          <section class="card" aria-labelledby="h-est">
            <div class="card-head"><h3 id="h-est">${t('estimates.title')}</h3>
              ${canEdit && !['delivered', 'cancelled'].includes(j.status) ? html`<button class="btn btn-secondary btn-sm" data-act="estimate">${icon('file-text', 16)}${j.approved_estimate_id ? t('estimates.revise') : t('estimates.new')}</button>` : ''}
            </div>
            <div class="card-body stack">
              ${latest ? html`
                ${est(latest)}
                <table class="table"><tbody>${latest.items.map((it) => html`<tr><td>${it.description}${it.description_mr ? html`<div class="t-sub">${it.description_mr}</div>` : ''}</td><td class="num">${qty(it.qty)}</td><td class="num">${money(it.amount)}</td></tr>`)}</tbody></table>
                ${canEdit && ['draft', 'sent'].includes(latest.status) ? html`<div class="row-wrap">
                  <button class="btn btn-primary" data-send="${latest.id}">${icon('send')}${latest.status === 'sent' ? t('estimates.resend') : t('estimates.send')}</button>
                  <button class="btn btn-secondary" data-call="${latest.id}">${icon('phone')}${t('estimates.approve_call')}</button>
                </div>` : ''}
                ${j.estimates.length > 1 ? html`<details><summary class="small muted" style="cursor:pointer">${j.estimates.length - 1} ×</summary><div class="stack" style="margin-top:8px">${j.estimates.slice(1).map(est)}</div></details>` : ''}`
              : html`<p class="muted">${t('estimates.empty')}</p>`}
            </div>
          </section>

          <section class="card" aria-labelledby="h-parts">
            <div class="card-head"><h3 id="h-parts">${t('jobs.parts_used')}</h3>
              ${requestable && (canEdit || isMech) ? html`<button class="btn btn-primary btn-sm" data-act="request">${icon('package-search', 16)}${t('requests.new')}</button>` : ''}
            </div>
            ${j.parts.length ? html`<div class="table-wrap"><table class="table responsive"><thead><tr><th>${t('parts.part')}</th><th class="num">${t('common.qty')}</th><th class="num">${t('common.amount')}</th><th></th></tr></thead><tbody>
              ${j.parts.map((p) => {
                const left = Number(p.qty) - Number(p.returned_qty);
                return html`<tr>
                  <td class="primary-cell" data-label="${t('parts.part')}"><div class="t-title">${nm(p)}</div><div class="t-sub">${p.part_no}${Number(p.issued) ? html` · ${datetime(p.issued_at)} · ${p.issued_by_name || ''}` : ''}</div>${Number(p.issued) ? '' : html`<span class="chip info" style="margin-top:4px">${t('jobs.part_planned')}</span>`}</td>
                  <td class="num" data-label="${t('common.qty')}">${qty(left)} ${p.unit}${Number(p.returned_qty) ? html`<div class="t-sub">${qty(p.returned_qty)} ${t('jobs.returned')}</div>` : ''}</td>
                  <td class="num" data-label="${t('common.amount')}">${money(left * p.unit_price)}</td>
                  <td class="actions">${Number(p.issued) && canStock && left > 0 && !j.invoice ? html`<button class="btn btn-ghost btn-sm" data-return="${p.id}">${icon('undo-2', 16)}${t('jobs.return')}</button>` : ''}${!Number(p.issued) && canEdit && j.invoice?.status !== 'final' ? html`<button class="btn btn-ghost btn-sm" data-unplan="${p.id}">${icon('x', 16)}${t('jobs.remove_part')}</button>` : ''}</td>
                </tr>`;
              })}</tbody></table></div>` : ''}
            ${j.requests.length ? html`<div class="card-body stack" style="border-top:1px solid var(--border)">
              <div class="small muted strong">${t('jobs.requests')}</div>
              ${j.requests.map((r) => html`<div class="stack" style="gap:4px">
                <div class="small muted">#${r.id} · ${datetime(r.created_at)} · ${r.requested_by_name} ${statusChip(r.status)}</div>
                ${r.items.map((it) => html`<div class="row" style="justify-content:space-between"><span>${it.part_id ? nm(it) : it.custom_name} × ${qty(it.qty)}${Number(it.issued_qty) && it.status !== 'issued' ? html` <span class="small muted">(${t('requests.issued_of', { issued: qty(it.issued_qty), qty: qty(it.qty) })})</span>` : ''}${it.remark ? html` <span class="small muted">· ${it.remark}</span>` : ''}</span>${statusChip(it.status)}</div>`)}
              </div>`)}
              ${canStock ? html`<a href="#/requests" class="small">${t('requests.title')} →</a>` : ''}
            </div>` : !j.parts.length ? html`<div class="card-body muted">—</div>` : ''}
          </section>

          <section class="card" aria-labelledby="h-labour">
            <div class="card-head"><h3 id="h-labour">${t('jobs.labour')}</h3>
              ${(canEdit || isMech) && !j.invoice && !['delivered', 'cancelled'].includes(j.status) ? html`<button class="btn btn-secondary btn-sm" data-act="labour">${icon('plus', 16)}${t('jobs.add_labour')}</button>` : ''}
            </div>
            ${j.labour.length ? html`<div class="list">${j.labour.map((l) => html`<div class="list-item">
              <div style="flex:1"><div class="strong">${l.description}</div>${l.description_mr ? html`<div class="small muted">${l.description_mr}</div>` : ''}</div>
              <div class="num strong">${money(l.amount)}</div>
              ${(canEdit || (isMech && l.user_id === session.user.id)) && !j.invoice ? html`<button class="btn btn-ghost btn-icon btn-sm" data-del-labour="${l.id}" aria-label="${t('common.delete')}">${icon('trash-2', 16)}</button>` : ''}
            </div>`)}</div>` : html`<div class="card-body muted">—</div>`}
          </section>
        </div>

        <div class="stack-lg">
          <section class="card card-pad stack" aria-label="${t('jobs.money')}">
            <h3>${t('jobs.money')}</h3>
            <dl class="dl" style="grid-template-columns:1fr auto">
              <dt>${t('jobs.parts_total')}</dt><dd class="num">${money(m.parts_total)}</dd>
              <dt>${t('jobs.labour_total')}</dt><dd class="num">${money(m.labour_total)}</dd>
              <dt class="strong">${t('jobs.current_total')}</dt><dd class="num strong">${money(m.current_total)}</dd>
              ${m.approved_total !== null ? html`<dt>${t('jobs.approved_total')}</dt><dd class="num">${money(m.approved_total)}</dd>` : ''}
            </dl>
          </section>

          <section class="card card-pad stack" aria-label="${t('common.details')}">
            <div class="row"><h3 style="flex:1">${t('common.details')}</h3>${canEdit && !['delivered', 'cancelled'].includes(j.status) ? html`<button class="btn btn-ghost btn-sm" data-act="edit">${icon('pencil', 16)}${t('common.edit')}</button>` : ''}</div>
            <dl class="dl">
              <dt>${t('jobs.complaint')}</dt><dd>${j.complaint || '—'}</dd>
              <dt>${t('jobs.odometer')}</dt><dd>${j.odometer ? j.odometer + ' km' : '—'}</dd>
              <dt>${t('jobs.fuel')}</dt><dd>${j.fuel_level || '—'}</dd>
              <dt>${t('jobs.opened')}</dt><dd>${datetime(j.created_at)}</dd>
            </dl>
            <form id="insp-form" class="field">
              <label for="insp">${t('jobs.inspection')}</label>
              <textarea id="insp" class="input" name="inspection_notes" rows="3" ${canEdit || isMech ? '' : 'readonly'}>${j.inspection_notes || ''}</textarea>
              ${canEdit || isMech ? html`<div><button class="btn btn-secondary btn-sm" type="submit" style="margin-top:6px">${t('common.save')}</button></div>` : ''}
            </form>
          </section>

          <section class="card card-pad stack" aria-label="${t('jobs.photos')}">
            <div class="row"><h3 style="flex:1">${t('jobs.photos')}</h3>
              ${(canEdit || isMech) && j.photos.length < 4 ? html`<label class="btn btn-secondary btn-sm">${icon('camera', 16)}${t('jobs.add_photo')}<input type="file" accept="image/*" capture="environment" class="sr-only" id="photo-in"></label>` : ''}
            </div>
            ${j.photos.length ? html`<div class="grid-2" style="grid-template-columns:repeat(2,1fr);gap:8px">${j.photos.map((p) => html`
              <div style="position:relative"><img data-photo="${p.id}" alt="${t('jobs.photos')}" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;background:var(--surface-2)">
              ${canEdit || isMech ? html`<button class="btn btn-secondary btn-icon btn-sm" data-del-photo="${p.id}" style="position:absolute;top:6px;right:6px" aria-label="${t('common.delete')}">${icon('x', 14)}</button>` : ''}</div>`)}</div>`
              : html`<p class="small muted">${t('jobs.photo_limit')}</p>`}
          </section>

          <section class="card card-pad stack" aria-label="${t('jobs.timeline')}">
            <h3>${t('jobs.timeline')}</h3>
            <ol class="timeline">${j.timeline.map((ev) => html`<li><div>${timelineLabel(ev)}</div><div class="small muted">${datetime(ev.created_at)} · ${ev.user_name || '—'}</div></li>`)}</ol>
          </section>
        </div>
      </div>`);
    loadPhotos();
  };

  const reload = async () => draw((await api.get('/jobs/' + id)).item);
  const act = async (fn) => {
    try {
      const res = await fn();
      if (res?.item?.timeline) draw(res.item);
      else await reload();
    } catch (e) {
      toastError(e);
    }
  };

  await reload();

  on(ctx.el, 'click', '[data-status]', async (e, b) => {
    const s = b.dataset.status;
    let note = null;
    if (s === 'cancelled') {
      note = await promptDialog({ title: t('jobs.to_cancelled'), label: t('jobs.cancel_reason') });
      if (note === null) return;
    }
    await busy(b, () => act(() => api.post(`/jobs/${id}/status`, { status: s, note })));
    toast(t('status.' + s));
  });
  on(ctx.el, 'click', '[data-act="estimate"]', async () => {
    if (await openEstimateForm(job)) reload();
  });
  on(ctx.el, 'click', '[data-send]', (e, b) =>
    openWhatsApp(async () => {
      const res = await api.post(`/estimates/${b.dataset.send}/send`);
      draw(res.item);
      return res.url;
    })
  );
  on(ctx.el, 'click', '[data-call]', async (e, b) => {
    const note = await promptDialog({ title: t('estimates.approve_call'), label: t('estimates.approve_note') });
    if (note === null) return;
    await act(() => api.post(`/estimates/${b.dataset.call}/approve-call`, { note }));
    toast(t('status.approved'));
  });
  on(ctx.el, 'click', '[data-act="approve"]', async (e, b) => {
    const est = job.estimates[0] && ['draft', 'sent'].includes(job.estimates[0].status) ? job.estimates[0] : null;
    const ok = await confirmDialog({
      title: t('jobs.approve'),
      message: est ? t('jobs.approve_confirm_est', { no: est.est_no, total: money(est.grand_total) }) : t('jobs.approve_confirm'),
      confirmLabel: t('jobs.approve'),
    });
    if (!ok) return;
    await busy(b, () => act(() => api.post(`/jobs/${id}/approve`)));
    toast(t('jobs.approved_ok'));
  });
  on(ctx.el, 'click', '[data-unplan]', async (e, b) => {
    const p = job.parts.find((x) => x.id === Number(b.dataset.unplan));
    if (!(await confirmDialog({ title: t('jobs.remove_part'), message: t('jobs.remove_part_confirm', { part: nm(p) }), danger: true, confirmLabel: t('jobs.remove_part') }))) return;
    await act(() => api.del(`/jobs/${id}/parts/${p.id}`));
  });
  on(ctx.el, 'click', '[data-act="bill"]', async (e, b) => {
    await busy(b, async () => {
      try {
        const res = await api.post('/invoices', { job_card_id: id });
        location.hash = '#/invoices/' + res.item.id;
      } catch (err) {
        toastError(err);
      }
    });
  });
  on(ctx.el, 'click', '[data-act="ready-wa"]', () => openWhatsApp(async () => (await api.post(`/jobs/${id}/whatsapp`, { template: 'ready' })).url));
  on(ctx.el, 'click', '[data-act="request"]', async () => {
    if (await openRequestForm(job)) reload();
  });
  on(ctx.el, 'click', '[data-return]', async (e, b) => {
    const p = job.parts.find((x) => x.id === Number(b.dataset.return));
    const left = Number(p.qty) - Number(p.returned_qty);
    const v = await promptDialog({ title: `${t('jobs.return')} · ${nm(p)}`, label: t('jobs.return_qty'), value: qty(left) });
    if (v === null) return;
    await act(() => api.post(`/jobs/${id}/return`, { job_part_id: p.id, qty: Number(v.replace(',', '.')), reason: 'Returned from job' }));
    toast(t('common.saved'));
  });
  on(ctx.el, 'click', '[data-act="labour"]', async () => {
    const rates = (await api.get('/labour-rates')).items;
    const res = await openDrawer({
      title: t('jobs.add_labour'),
      body: html`<div class="stack">
        ${field({ name: 'labour_rate_id', label: t('jobs.labour'), type: 'select', dtype: 'int', required: isMech, options: [...(isMech ? [] : [{ value: '', label: '—' }]), ...rates.map((r) => ({ value: r.id, label: `${nm(r)} · ${money(r.amount)}` }))] })}
        ${isMech ? '' : html`${field({ name: 'description', label: t('estimates.description'), hint: '—' })}${field({ name: 'amount', label: t('common.amount') + ' (₹)', type: 'number' })}`}
      </div>`,
      onOpen(root) {
        const sel = root.querySelector('[name=labour_rate_id]');
        const amt = root.querySelector('[name=amount]');
        if (sel && amt) sel.addEventListener('change', () => {
          const r = rates.find((x) => x.id === Number(sel.value));
          if (r) amt.value = r.amount;
        });
      },
      onSubmit: (d) => api.post(`/jobs/${id}/labour`, d),
    });
    if (res) draw(res.item);
  });
  on(ctx.el, 'click', '[data-del-labour]', async (e, b) => {
    if (!(await confirmDialog({ title: t('common.delete') + '?', danger: true, confirmLabel: t('common.delete') }))) return;
    await act(() => api.del(`/jobs/${id}/labour/${b.dataset.delLabour}`));
  });
  on(ctx.el, 'submit', '#insp-form', async (e, form) => {
    e.preventDefault();
    await busy($('button[type=submit]', form), () => act(() => api.put('/jobs/' + id, { inspection_notes: form.inspection_notes.value })));
    toast(t('common.saved'));
  });
  on(ctx.el, 'click', '[data-act="edit"]', async () => {
    const mechanics = (await api.get('/users/mechanics')).items;
    const res = await openDrawer({
      title: `${t('common.edit')} · ${job.job_no}`,
      body: html`<div class="form-grid">
        ${field({ name: 'mechanic_id', label: t('jobs.mechanic'), type: 'select', dtype: 'int', value: job.mechanic_id, options: [{ value: '', label: t('jobs.no_mechanic') }, ...mechanics.map((x) => ({ value: x.id, label: x.name }))] })}
        ${field({ name: 'promised_at', label: t('jobs.promised'), type: 'datetime-local', value: job.promised_at ? job.promised_at.slice(0, 16).replace(' ', 'T') : '' })}
        ${field({ name: 'odometer', label: t('jobs.odometer'), type: 'number', dtype: 'int', value: job.odometer })}
        ${field({ name: 'fuel_level', label: t('jobs.fuel'), type: 'select', value: job.fuel_level, options: ['', 'E', '1/4', '1/2', '3/4', 'F'].map((f) => ({ value: f, label: f || '—' })) })}
        ${field({ name: 'complaint', label: t('jobs.complaint'), type: 'textarea', value: job.complaint, span2: true })}
      </div>`,
      onSubmit: (d) => api.put('/jobs/' + id, d),
    });
    if (res) draw(res.item);
  });
  on(ctx.el, 'change', '#photo-in', async (e, inp) => {
    const file = inp.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('photo', file);
    try {
      const res = await api.post(`/jobs/${id}/photos`, fd);
      draw(res.item);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  });
  on(ctx.el, 'click', '[data-del-photo]', async (e, b) => {
    if (!(await confirmDialog({ title: t('common.delete') + '?', danger: true, confirmLabel: t('common.delete') }))) return;
    photoUrls.delete(Number(b.dataset.delPhoto));
    await act(() => api.del(`/jobs/${id}/photos/${b.dataset.delPhoto}`));
  });

  return () => photoUrls.forEach((u) => URL.revokeObjectURL(u));
}

