import { useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { FileDown, FileSpreadsheet, Upload } from 'lucide-react-native';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import * as XLSX from 'xlsx';
import { api, apiUrl } from '@/api/client';
import { toast, toastError } from '@/components/toast';
import { Banner, Button, Card, Divider, OfflineBanner, Txt } from '@/components/ui';
import { useSession } from '@/store/session';
import { space } from '@/theme';

type Row = Record<string, string>;
interface ImportResult {
  created: number;
  updated: number;
  auto_numbered: number;
  errors: { row: number; part_no: string | null; error: string; fields?: Record<string, unknown> }[];
  unused_columns: string[];
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Field names in an import error → the words the shop knows. */
const FIELD_LABEL: Record<string, string> = {
  part_no: 'parts.part_no',
  name_en: 'common.name_en',
  name_mr: 'common.name_mr',
  selling_price: 'parts.selling_price',
  gst_rate: 'parts.gst_rate',
  last_purchase_price: 'parts.last_purchase_price',
  last_purchase_disc_pct: 'parts.last_purchase_disc',
  min_stock: 'parts.min_stock',
  opening_stock: 'parts.opening_stock',
  hsn: 'parts.hsn',
  unit: 'parts.unit',
  rack: 'parts.rack',
};

/** Every filled cell of the first sheet under its own heading; the server matches the headings. */
function readRows(base64: string): Row[] {
  const wb = XLSX.read(base64, { type: 'base64' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
  return raw
    .map((r) => {
      const o: Row = {};
      for (const [k, v] of Object.entries(r)) {
        if (!k.startsWith('__EMPTY') && String(v).trim() !== '') o[k.trim()] = String(v).trim();
      }
      return o;
    })
    .filter((o) => Object.keys(o).length > 0);
}

/** Parts from the shop's Excel sheet (owner / inventory manager), with a sample file to start from. */
export default function PartsImport() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const server = useSession((s) => s.server);
  const token = useSession((s) => s.token);
  const [file, setFile] = useState<{ name: string; rows: Row[] } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<'' | 'sample' | 'pick' | 'import'>('');

  const getSample = async () => {
    if (!server) return;
    setBusy('sample');
    try {
      const target = new File(Paths.cache, 'parts-import-sample.xlsx');
      const saved = await File.downloadFileAsync(apiUrl(server, '/parts/import-sample'), target, {
        headers: { Authorization: `Bearer ${token}`, 'X-Auth-Token': token ?? '' },
        idempotent: true,
      });
      await Sharing.shareAsync(saved.uri, { mimeType: XLSX_MIME, dialogTitle: t('parts.import_sample_share') });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy('');
    }
  };

  const pick = async () => {
    setBusy('pick');
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: [XLSX_MIME, 'application/vnd.ms-excel', 'text/csv', 'text/comma-separated-values', 'application/octet-stream'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets[0]) return;
      const asset = res.assets[0];
      let rows: Row[];
      try {
        rows = readRows(await new File(asset.uri).base64());
      } catch {
        toast(t('parts.import_read_error'), 'error');
        return;
      }
      setResult(null);
      setFile({ name: asset.name, rows });
      if (!rows.length) toast(t('parts.import_empty'), 'error');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy('');
    }
  };

  const run = async () => {
    if (!file?.rows.length) return;
    setBusy('import');
    try {
      const res = await api.post<ImportResult>('/parts/import', { rows: file.rows });
      setResult(res);
      setFile(null);
      void qc.invalidateQueries({ queryKey: ['parts'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast(t('parts.import_done', { created: res.created, updated: res.updated }));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy('');
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}>
        <Card style={{ gap: space[3] }}>
          <Txt>{t('parts.import_help')}</Txt>
          <Txt size="sm" muted>{t('parts.sample.headings')}</Txt>
          <Button title={t('parts.import_sample_share')} icon={FileDown} variant="secondary" onPress={() => void getSample()} loading={busy === 'sample'} needsOnline />
        </Card>

        <Button title={t('parts.import_file')} icon={FileSpreadsheet} variant="secondary" onPress={() => void pick()} loading={busy === 'pick'} />

        {file ? (
          <Card style={{ gap: space[3] }}>
            <Txt weight="semibold">{file.rows.length ? t('parts.import_rows', { n: file.rows.length, file: file.name }) : t('parts.import_empty')}</Txt>
            {file.rows.slice(0, 3).map((r, i) => (
              <Txt key={i} size="sm" muted numberOfLines={2}>
                {Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(' · ')}
              </Txt>
            ))}
            {file.rows.length ? <Button title={t('parts.import_run')} icon={Upload} onPress={() => void run()} loading={busy === 'import'} needsOnline /> : null}
          </Card>
        ) : null}

        {result ? (
          <Card style={{ gap: space[2] }}>
            <Banner tone={result.errors.length ? 'warning' : 'success'} text={`${t('parts.import_done', { created: result.created, updated: result.updated })}${result.errors.length ? ' · ' + t('parts.import_errors', { n: result.errors.length }) : ''}`} />
            {result.auto_numbered ? <Txt size="sm" muted>{t('parts.import_auto', { n: result.auto_numbered })}</Txt> : null}
            {result.unused_columns.length ? <Txt size="sm">{t('parts.import_unused', { list: result.unused_columns.join(', ') })}</Txt> : null}
            {result.errors.map((er) => (
              <View key={er.row} style={{ gap: 2 }}>
                <Divider />
                <Txt size="sm" weight="semibold">
                  {t('parts.row')} {er.row}
                  {er.part_no ? ` · ${er.part_no}` : ''}
                </Txt>
                <Txt size="sm" color="dangerText">
                  {er.fields && Object.keys(er.fields).length
                    ? Object.entries(er.fields)
                        .map(([k, v]) => `${FIELD_LABEL[k] ? t(FIELD_LABEL[k]) : k}: ${typeof v === 'string' ? t(`fields.${v}`) : er.error}`)
                        .join(' · ')
                    : er.error}
                </Txt>
              </View>
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}
