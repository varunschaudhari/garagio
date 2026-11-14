import { html, setHTML, on } from '../dom.js';
import { t, nm, getLang } from '../i18n.js';
import { api } from '../api.js';
import { session } from '../store.js';
import { icon } from '../ui/icons.js';
import { money, qty, date } from '../format.js';
import { emptyState, skeletonRows } from '../ui/table.js';
import { toast } from '../ui/toast.js';

/** Build the order text for one supplier (part no., both names, quantity). */
function orderText(group, qtys) {
  const shop = getLang() === 'mr' ? session.settings.shop_name_mr || session.settings.shop_name : session.settings.shop_name;
  const lines = group.items.map((it, i) => {
    const names = [it.name_en, it.name_mr].filter(Boolean).join(' / ');
    return `${i + 1}. ${it.part_no} – ${names} – ${qtys[it.part_id] ?? it.suggested_qty} ${it.unit}`;
  });
  return `${t('reorder.message_head', { shop })}\n\n${lines.join('\n')}\n\n${t('reorder.message_foot')}`;
}

export default async function reorder(ctx) {
  ctx.setTitle(t('reorder.title'));
  setHTML(ctx.el, skeletonRows(5));
  const data = await api.get('/reorder');
  if (!ctx.alive()) return;
  const qtys = {};

  const groupCard = (g, gi) => html`
    <div class="card" data-group="${gi}">
      <div class="card-head" style="flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <h3>${g.supplier ? html`<a href="#/suppliers/${g.supplier.id}">${g.supplier.name}</a>` : t('reorder.no_supplier')}</h3>
          ${g.supplier?.phone ? html`<div class="small muted">${g.supplier.phone}</div>` : ''}
        </div>
        <button class="btn btn-secondary btn-sm" data-copy="${gi}">${icon('copy', 16)}${t('reorder.copy')}</button>
        ${g.supplier?.phone ? html`<button class="btn btn-primary btn-sm" data-share="${gi}">${icon('message-circle', 16)}${t('reorder.share')}</button>` : ''}
      </div>
      <div class="table-wrap"><table class="table responsive">
        <thead><tr><th>${t('parts.part')}</th><th class="num">${t('parts.stock')}</th><th>${t('common.reason')}</th><th class="num">${t('reorder.last_bought')}</th><th class="num" style="width:120px">${t('reorder.suggested')}</th></tr></thead>
        <tbody>${g.items.map((it) => html`<tr>
          <td class="primary-cell" data-label="${t('parts.part')}"><a class="t-title" href="#/parts/${it.part_id}">${nm(it)}</a><div class="t-sub">${it.part_no}${it.rack ? ' · ' + t('parts.rack') + ' ' + it.rack : ''}</div></td>
          <td class="num" data-label="${t('parts.stock')}"><span class="badge-low">${qty(it.current_stock)}</span> <span class="muted small">/ min ${qty(it.min_stock)}</span></td>
          <td data-label="${t('common.reason')}"><div class="row-wrap">${it.reasons.map((r) => html`<span class="chip ${r === 'low' ? 'danger' : 'warning'}">${t(r === 'low' ? 'reorder.reason_low' : 'reorder.reason_unavailable')}${r === 'unavailable' && it.qty_short ? ' · ' + qty(it.qty_short) : ''}</span>`)}</div></td>
          <td class="num small" data-label="${t('reorder.last_bought')}">${it.last_bought ? html`${date(it.last_bought)}<div class="muted">${money(it.last_purchase_price)}</div>` : '—'}</td>
          <td class="num" data-label="${t('reorder.suggested')}"><input class="input num" data-qty="${it.part_id}" value="${qty(it.suggested_qty)}" inputmode="decimal" aria-label="${t('reorder.suggested')} ${it.part_no}" style="max-width:100px;margin-left:auto"></td>
        </tr>`)}</tbody>
      </table></div>
    </div>`;

  setHTML(ctx.el, html`
    <div class="page-head">
      <div style="flex:1"><h1>${t('reorder.title')}</h1><div class="sub">${t('reorder.sub')}</div></div>
      <a class="btn btn-primary" href="#/purchases/new">${icon('truck')}${t('purchases.new')}</a>
    </div>
    ${data.groups.length
      ? html`<div class="stack-lg">${data.groups.map(groupCard)}</div>`
      : html`<div class="card">${emptyState({ ic: 'circle-check', title: t('reorder.empty') })}</div>`}
    ${data.unlinked.length ? html`
      <div class="card" style="margin-top:24px">
        <div class="card-head"><h3>${t('reorder.unlinked')}</h3></div>
        <div class="list">${data.unlinked.map((u) => html`<div class="list-item"><div style="flex:1" class="strong">${u.custom_name}</div><div class="num">${qty(u.qty)}</div></div>`)}</div>
      </div>` : ''}`);

  on(ctx.el, 'input', '[data-qty]', (e, inp) => {
    const v = Number(inp.value.replace(',', '.'));
    if (Number.isFinite(v) && v > 0) qtys[Number(inp.dataset.qty)] = v;
  });
  on(ctx.el, 'click', '[data-copy]', async (e, b) => {
    const text = orderText(data.groups[Number(b.dataset.copy)], qtys);
    try {
      await navigator.clipboard.writeText(text);
      toast(t('reorder.copied'));
    } catch {
      window.prompt(t('reorder.copy'), text);
    }
  });
  on(ctx.el, 'click', '[data-share]', (e, b) => {
    const g = data.groups[Number(b.dataset.share)];
    const phone = String(g.supplier.phone).replace(/\D/g, '').slice(-10);
    window.open(`https://wa.me/91${phone}?text=${encodeURIComponent(orderText(g, qtys))}`, '_blank', 'noopener');
  });
}
