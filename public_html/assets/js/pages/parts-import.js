import { html, $ } from '../dom.js';
import { t, errorText } from '../i18n.js';
import { api } from '../api.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { busy } from '../ui/form.js';

const COLUMNS = ['part_no', 'name_en', 'name_mr', 'category', 'brand', 'compatible_models', 'unit', 'hsn', 'gst_rate', 'selling_price', 'last_purchase_price', 'last_purchase_disc_pct', 'location', 'rack', 'min_stock', 'opening_stock'];

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

function normaliseKey(k) {
  return String(k).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

async function parseFile(file) {
  const XLSX = await loadXlsx();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  return raw
    .map((r) => {
      const o = {};
      for (const [k, v] of Object.entries(r)) {
        const key = normaliseKey(k);
        if (COLUMNS.includes(key) && String(v).trim() !== '') o[key] = String(v).trim();
      }
      return o;
    })
    .filter((o) => Object.keys(o).length);
}

function downloadTemplate() {
  const sample = ['SP-CPR7EA9', 'Spark plug', 'स्पार्क प्लग', 'Engine', 'NGK', 'Splendor, Activa', 'pcs', '85111000', '18', '150', '85', '5', 'Counter', 'A1', '10', '40'];
  const csv = '﻿' + COLUMNS.join(',') + '\n' + sample.map((v) => (v.includes(',') ? `"${v}"` : v)).join(',') + '\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'parts-template.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
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
          $('#imp-count', root).textContent = file.name + ' · ' + t('parts.import_rows', { n: rows.length });
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
