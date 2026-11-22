import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as XLSX from 'xlsx';

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
