import { html, $ } from '../dom.js';
import { t, errorText } from '../i18n.js';
import { api, request } from '../api.js';
import { openModal } from '../ui/modal.js';
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

async function parseFile(file) {
  const XLSX = await loadXlsx();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  // Every filled cell under its own heading; the server matches the headings (Part No, MRP, Rate, Qty …).
  return raw
    .map((r) => {
      const o = {};
      for (const [k, v] of Object.entries(r)) {
        if (!String(k).startsWith('__EMPTY') && String(v).trim() !== '') o[String(k).trim()] = String(v).trim();
      }
      return o;
    })
    .filter((o) => Object.keys(o).length);
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
          rows = await parseFile(file);
          $('#imp-count', root).textContent = rows.length ? t('parts.import_rows', { n: rows.length, file: file.name }) : t('parts.import_empty');
          runBtn.disabled = !rows.length;
        } catch {
          $('#imp-count', root).textContent = t('errors.file_read');
        }
      });
      runBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await busy(runBtn, async () => {
          try {
            const res = await api.post('/parts/import', { rows });
            imported = imported || res.created + res.updated > 0;
            toast(t('parts.import_done', res));
            const box = $('#imp-result', root);
            box.innerHTML = String(html`
              <div class="banner ${res.errors.length ? 'warning' : 'success'}">${t('parts.import_done', res)}${res.errors.length ? ' · ' + t('parts.import_errors', { n: res.errors.length }) : ''}</div>
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
