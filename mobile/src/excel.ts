import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as XLSX from 'xlsx';

export type SheetRow = Record<string, string>;

const TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'text/comma-separated-values',
  'application/octet-stream',
];

/** Every filled cell of the first sheet under its own heading (the server matches the headings). */
export function readSheetRows(base64: string): SheetRow[] {
  const wb = XLSX.read(base64, { type: 'base64' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
  return raw
    .map((r) => {
      const o: SheetRow = {};
      for (const [k, v] of Object.entries(r)) {
        if (!k.startsWith('__EMPTY') && String(v).trim() !== '') o[k.trim()] = String(v).trim();
      }
      return o;
    })
    .filter((o) => Object.keys(o).length > 0);
}

export class SheetReadError extends Error {}

/** Choose an Excel / CSV file; null when cancelled. Throws SheetReadError when it cannot be read. */
export async function pickSheet(): Promise<{ name: string; rows: SheetRow[] } | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: TYPES, copyToCacheDirectory: true });
  if (res.canceled || !res.assets[0]) return null;
  const asset = res.assets[0];
  try {
    return { name: asset.name, rows: readSheetRows(await new File(asset.uri).base64()) };
  } catch {
    throw new SheetReadError(asset.name);
  }
}
