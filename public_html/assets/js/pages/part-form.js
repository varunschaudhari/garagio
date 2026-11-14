import { html } from '../dom.js';
import { t, nm } from '../i18n.js';
import { api } from '../api.js';
import { session, setting } from '../store.js';
import { field } from '../ui/form.js';
import { openDrawer } from '../ui/drawer.js';
import { toast } from '../ui/toast.js';

const GST_RATES = [0, 5, 12, 18, 28, 40];

let masters = null;
export async function loadMasters(force = false) {
  if (!masters || force) {
    const [cats, locs] = await Promise.all([api.get('/categories'), api.get('/locations')]);
    masters = { categories: cats.items, locations: locs.items };
  }
  return masters;
}

/** Create (part = null) or edit a part in a drawer. Resolves with the saved part or null. */
export async function openPartForm(part = null) {
  const { categories, locations } = await loadMasters();
  const p = part || {};
  const isNew = !part;
  const showCost = session.canSeeCost;
  const body = html`
    <div class="form-grid">
      ${field({ name: 'part_no', label: t('parts.part_no'), value: p.part_no, required: true, placeholder: 'SP-CPR7EA9' })}
      ${field({ name: 'brand', label: t('parts.brand'), value: p.brand })}
      ${field({ name: 'name_en', label: t('common.name_en'), value: p.name_en, required: true })}
      ${field({ name: 'name_mr', label: t('common.name_mr'), value: p.name_mr, cls: 'mr-text' })}
      ${field({ name: 'category_id', label: t('parts.category'), type: 'select', dtype: 'int', value: p.category_id, options: [{ value: '', label: '—' }, ...categories.map((c) => ({ value: c.id, label: nm(c) }))] })}
      ${field({ name: 'compatible_models', label: t('parts.compatible_models'), value: p.compatible_models, placeholder: t('parts.compatible_hint') })}

      <div class="form-section">${t('parts.location')}</div>
      ${field({ name: 'location_id', label: t('parts.location'), type: 'select', dtype: 'int', value: p.location_id, options: [{ value: '', label: '—' }, ...locations.map((l) => ({ value: l.id, label: nm(l) }))] })}
      ${field({ name: 'rack', label: t('parts.rack'), value: p.rack, placeholder: 'A1' })}

      <div class="form-section">${t('common.price')} & GST</div>
      ${field({ name: 'selling_price', label: t('parts.selling_price'), type: 'number', value: p.selling_price, required: true })}
      ${field({ name: 'unit', label: t('parts.unit'), value: p.unit || 'pcs' })}
      ${field({ name: 'hsn', label: t('parts.hsn'), value: p.hsn, inputmode: 'numeric' })}
      ${field({ name: 'gst_rate', label: t('parts.gst_rate'), type: 'select', dtype: 'num', value: p.gst_rate ?? Number(setting('default_part_gst_rate', 18)), options: GST_RATES.map((r) => ({ value: r, label: r + '%' })) })}
      ${showCost ? html`
        ${field({ name: 'last_purchase_price', label: t('parts.last_purchase_price'), type: 'number', value: p.last_purchase_price })}
        ${field({ name: 'last_purchase_disc_pct', label: t('parts.last_purchase_disc'), type: 'number', value: p.last_purchase_disc_pct })}` : ''}

      <div class="form-section">${t('parts.stock')}</div>
      ${field({ name: 'min_stock', label: t('parts.min_stock'), type: 'number', value: p.min_stock ?? 0 })}
      ${isNew
        ? html`${field({ name: 'opening_stock', label: t('parts.opening_stock'), type: 'number', value: 0 })}
          ${showCost ? field({ name: 'opening_cost', label: t('parts.opening_cost'), type: 'number', hint: t('parts.opening_cost_hint'), span2: true }) : ''}`
        : field({ name: 'active', label: t('common.active'), type: 'switch', value: p.active ?? 1 })}
    </div>`;

  return openDrawer({
    title: isNew ? t('parts.new') : t('parts.edit'),
    body,
    wide: true,
    onSubmit: async (data) => {
      const res = isNew ? await api.post('/parts', data) : await api.put('/parts/' + part.id, data);
      toast(isNew ? t('common.created') : t('common.saved'));
      return res.item;
    },
  });
}
