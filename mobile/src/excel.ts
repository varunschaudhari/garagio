import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';
import { ApiError, apiUrl } from '@/api/client';
import { useSession } from '@/store/session';

/** One row of the sheet: its cells as shown in Excel. */
export type SheetRow = string[];

/**
 * The first sheet as rows of cells. The server finds the heading row (a supplier's name and address above the
 * table are fine) and matches the headings.
 */
export function readSheetTable(base64: string): SheetRow[] {
  const wb = XLSX.read(base64, { type: 'base64' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils
    .sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false, blankrows: false })
    .map((r) => r.map((v) => String(v ?? '').trim()))
    .filter((r) => r.some((v) => v !== ''));
}

export class SheetReadError extends Error {}

/**
 * Choose an Excel / CSV file; null when cancelled. Throws SheetReadError when it cannot be read. Any file can be
 * chosen: Android labels Excel files from WhatsApp or Drive inconsistently, and a filter would hide them.
 * rows = data rows (all rows but the heading).
 */
export async function pickSheet(): Promise<{ name: string; table: SheetRow[]; rows: number } | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (res.canceled || !res.assets[0]) return null;
  const asset = res.assets[0];
  let table: SheetRow[];
  try {
    table = readSheetTable(await new File(asset.uri).base64());
  } catch {
    throw new SheetReadError(asset.name);
  }
  return { name: asset.name, table, rows: Math.max(0, table.length - 1) };
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Download an Excel file from the API (a report with format=xlsx, or /exports/...) and open Android's share sheet:
 * WhatsApp, Drive, email, or "Save to device". Rejects with an ApiError when the server refuses.
 */
export async function shareExcel(path: string, params: Record<string, string>, fileName: string, title: string): Promise<void> {
  const { server, token } = useSession.getState();
  if (!server) throw new ApiError(0, 'network', 'No server');
  let saved: File;
  try {
    saved = await File.downloadFileAsync(apiUrl(server, path, params), new File(Paths.cache, fileName), {
      headers: { Authorization: `Bearer ${token ?? ''}`, 'X-Auth-Token': token ?? '' },
      idempotent: true,
    });
  } catch (e) {
    // A refused download: "UnableToDownload ... 403" → the same words as other refusals.
    const status = Number(String(e instanceof Error ? e.message : e).match(/\b(401|403|404|5\d\d)\b/)?.[1] ?? 0);
    if (status) throw new ApiError(status, status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 404 ? 'not_found' : 'server_error', String(e));
    throw new ApiError(0, 'network', String(e));
  }
  await Sharing.shareAsync(saved.uri, { mimeType: XLSX_MIME, dialogTitle: title, UTI: 'org.openxmlformats.spreadsheetml.sheet' });
}

/** [first day, last day] of this month (0) or last month (-1), as YYYY-MM-DD in local time. */
export function monthRange(offset: number): [string, string] {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  const p = (x: number) => String(x).padStart(2, '0');
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return [`${d.getFullYear()}-${p(d.getMonth() + 1)}-01`, `${last.getFullYear()}-${p(last.getMonth() + 1)}-${p(last.getDate())}`];
}
