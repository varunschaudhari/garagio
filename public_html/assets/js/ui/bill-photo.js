import { html, setHTML, $ } from '../dom.js';
import { t } from '../i18n.js';
import { api, request } from '../api.js';
import { icon } from './icons.js';
import { confirmDialog } from './modal.js';
import { toast, toastError } from './toast.js';

/*
 * Photo of a paper bill (expense or purchase bill): path is "/expenses/<id>/photo" or "/purchases/<id>/photo".
 * The photo needs the login token, so it is fetched and shown through a blob URL.
 */

/** Upload a picked file as the bill photo. */
export function uploadBillPhoto(path, file) {
  const fd = new FormData();
  fd.append('photo', file);
  return api.post(path, fd);
}

/** A file input for a bill photo (camera or gallery on a phone browser). */
export function billPhotoInput(attrs = 'data-bill-file') {
  return html`<input type="file" accept="image/*" class="sr-only" ${attrs}>`;
}

async function blobUrl(path) {
  const res = await request('GET', path, { raw: true });
  return URL.createObjectURL(await res.blob());
}

/** Open the photo in a new tab (opened before the await so pop-up blockers allow it). */
export async function viewBillPhoto(path) {
  const win = window.open('', '_blank');
  try {
    const url = await blobUrl(path);
    if (win) win.location.href = url;
    else window.location.href = url;
  } catch (err) {
    if (win) win.close();
    toastError(err);
  }
}

/** Card with the bill photo: picture, add / replace, remove. onChanged() runs after a change. */
export function billPhotoCard(root, { path, photo, canEdit, onChanged }) {
  setHTML(root, html`<div class="card card-pad stack">
    <div class="row" style="gap:8px">
      <h3 style="flex:1">${t('bills.photo')}</h3>
      ${canEdit ? html`<label class="btn btn-secondary btn-sm">${icon('camera', 16)}${photo ? t('bills.replace_photo') : t('bills.add_photo')}${billPhotoInput()}</label>` : ''}
      ${canEdit && photo ? html`<button type="button" class="btn btn-ghost btn-icon btn-sm" data-bill-del aria-label="${t('bills.remove_photo')}">${icon('trash-2', 16)}</button>` : ''}
    </div>
    ${photo
      ? html`<button type="button" class="btn-plain" data-bill-view aria-label="${t('bills.view_photo')}" style="padding:0;border:0;background:none;cursor:zoom-in"><img data-bill-img alt="${t('bills.photo')}" style="display:block;max-width:100%;max-height:420px;object-fit:contain;border-radius:8px;background:var(--surface-2)"></button>`
      : html`<div class="small muted">${t('bills.no_photo')}</div>`}
  </div>`);
  if (photo) {
    blobUrl(path)
      .then((u) => {
        const img = $('[data-bill-img]', root);
        if (img) img.src = u;
      })
      .catch(() => {});
  }
  root.onclick = async (e) => {
    if (e.target.closest('[data-bill-view]')) return viewBillPhoto(path);
    if (!e.target.closest('[data-bill-del]')) return;
    if (!(await confirmDialog({ title: t('bills.remove_photo_q'), danger: true, confirmLabel: t('common.delete') }))) return;
    try {
      await api.del(path);
      onChanged();
    } catch (err) {
      toastError(err);
    }
  };
  root.onchange = async (e) => {
    const inp = e.target.closest('[data-bill-file]');
    const file = inp?.files[0];
    if (!file) return;
    try {
      await uploadBillPhoto(path, file);
      toast(t('bills.photo_saved'));
      onChanged();
    } catch (err) {
      toastError(err);
    }
  };
}
