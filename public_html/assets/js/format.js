// Number and date formatting. Western digits in both languages; dates DD-MM-YYYY.

/** ₹1,23,456.00 (Indian grouping). */
export function money(n, { symbol = true, decimals = 2 } = {}) {
  const v = Number(n || 0);
  const neg = v < 0;
  const s = Math.abs(v).toFixed(decimals);
  let [i, d] = s.split('.');
  if (i.length > 3) {
    const last3 = i.slice(-3);
    const rest = i.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    i = rest + ',' + last3;
  }
  return (neg ? '-' : '') + (symbol ? '₹' : '') + i + (d ? '.' + d : '');
}

/** Whole rupees, for KPI tiles: ₹1,23,456 */
export const rupees = (n) => money(Math.round(Number(n || 0)), { decimals: 0 });

/** Quantity without trailing zeros: 2, 2.5, 0.75 */
export function qty(n) {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
}

/** 2026-11-13 → 13-11-2026 */
export function date(s) {
  if (!s) return '';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

/** 2026-11-13 14:05:00 → 13-11-2026 14:05 */
export function datetime(s) {
  if (!s) return '';
  return date(s) + ' ' + String(s).slice(11, 16);
}

export function todayISO() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Parse "YYYY-MM-DD HH:MM:SS" as local time. */
export function parseDT(s) {
  if (!s) return null;
  const [d, t = '00:00:00'] = String(s).split(' ');
  const [y, m, day] = d.split('-').map(Number);
  const [h, mi, se] = t.split(':').map(Number);
  return new Date(y, m - 1, day, h, mi, se || 0);
}

/** Initials for an avatar. */
export function initials(name) {
  const letters = String(name || '')
    .split(/\s+/)
    .map((w) => (w.match(/\p{L}/u) || [''])[0])
    .filter(Boolean);
  return (letters.slice(0, 2).join('') || '?').toUpperCase();
}
