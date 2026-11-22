import { html, $ } from '../dom.js';
import { t, errorText } from '../i18n.js';
import { api, request } from '../api.js';
import { openModal } from '../ui/modal.js';
import { hasRole } from '../store.js';
import { toast } from '../ui/toast.js';
import { busy } from '../ui/form.js';

let xlsxLoading = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  xlsxLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'assets/vendor/xlsx/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return xlsxLoading;
}

/**
 * The first sheet of an Excel / CSV file as rows of cells (text as shown in Excel). The server finds the heading row
 * (a supplier's name and address above the table are fine) and matches the headings.
 */
export async function readSheetTable(file) {
  const XLSX = await loadXlsx();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils
    .sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false })
    .map((r) => r.map((v) => String(v ?? '').trim()))
    .filter((r) => r.some((v) => v !== ''));
}

/** The sample Excel file (made by the server, with a "How to fill" sheet). */
async function downloadTemplate() {
  try {
    const res = await request('GET', '/parts/import-sample', { raw: true });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = 'parts-import-sample.xlsx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (err) {
    toast(errorText(err), 'error');
  }
}

/** Resolves true when something was imported. */
export function openImport() {
  let rows = [];
  let imported = false;
  return openModal({
    title: t('parts.import_title'),
    wide: true,
    body: html`
      <p class="muted small">${t('parts.import_help')}</p>
      <div class="row-wrap">
        <label class="btn btn-secondary"><input type="file" id="imp-file" accept=".xlsx,.xls,.csv" class="sr-only">${t('parts.import_file')}</label>
        <button type="button" class="btn btn-ghost" id="imp-tpl">${t('parts.import_template')}</button>
        <span id="imp-count" class="muted"></span>
      </div>
      <label class="row" style="gap:8px;margin-top:12px;align-items:flex-start"><input type="checkbox" id="imp-stock" checked><span>${t('parts.import_set_stock')}</span></label>
      ${hasRole('owner') ? html`<label class="row" style="gap:8px;margin-top:8px;align-items:flex-start"><input type="checkbox" id="imp-replace"><span><strong>${t('parts.import_replace')}</strong><br><span class="small muted">${t('parts.import_replace_note')}</span></span></label>` : ''}
      <div id="imp-result"></div>`,
    actions: [
      { label: t('common.close'), value: 'close' },
      { label: t('parts.import_run'), kind: 'primary', value: null },
    ],
    onOpen(root, close) {
      const runBtn = root.querySelector('.btn-primary');
      runBtn.disabled = true;
      $('#imp-tpl', root).addEventListener('click', downloadTemplate);
      $('#imp-file', root).addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          rows = await readSheetTable(file);
          const n = Math.max(0, rows.length - 1);
          $('#imp-count', root).textContent = n ? t('parts.import_rows', { n, file: file.name }) : t('parts.import_empty');
          runBtn.disabled = !n;
        } catch {
          $('#imp-count', root).textContent = t('errors.file_read');
        }
      });
      runBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await busy(runBtn, async () => {
          try {
            const replace = !!$('#imp-replace', root)?.checked;
            if (replace && !window.confirm(t('parts.import_replace_q') + '\n\n' + t('parts.import_replace_note'))) return;
            const res = await api.post('/parts/import', { table: rows, set_stock: $('#imp-stock', root).checked, replace });
            imported = imported || res.created + res.updated > 0;
            toast(t('parts.import_done', res));
            const box = $('#imp-result', root);
            box.innerHTML = String(html`
              <div class="banner ${res.aborted ? 'danger' : res.errors.length ? 'warning' : 'success'}">${res.aborted ? t('parts.import_aborted') : t('parts.import_done', res)}${res.errors.length ? ' · ' + t('parts.import_errors', { n: res.errors.length }) : ''}</div>
              ${res.stock_set ? html`<p class="small" style="margin-top:8px">${t('parts.import_stock_set', { n: res.stock_set })}</p>` : ''}
              ${res.replaced ? html`<p class="small" style="margin-top:8px">${t('parts.import_replaced', res)}</p>` : ''}
              ${res.auto_numbered ? html`<p class="small muted" style="margin-top:8px">${t('parts.import_auto', { n: res.auto_numbered })}</p>` : ''}
              ${res.unused_columns?.length ? html`<p class="small" style="margin-top:8px">${t('parts.import_unused', { list: res.unused_columns.join(', ') })}</p>` : ''}
              ${res.errors.length ? html`<div class="table-wrap" style="max-height:240px;margin-top:12px"><table class="table"><thead><tr><th>${t('parts.row')}</th><th>${t('parts.part_no')}</th><th>${t('common.details')}</th></tr></thead>
                <tbody>${res.errors.map((er) => html`<tr><td>${er.row}</td><td>${er.part_no || '—'}</td><td>${er.error}${er.fields ? ' (' + Object.keys(er.fields).join(', ') + ')' : ''}</td></tr>`)}</tbody></table></div>` : ''}`);
            rows = [];
            runBtn.disabled = true;
          } catch (err) {
            toast(errorText(err), 'error');
          }
        });
      }, true);
    },
  }).then(() => imported);
}
