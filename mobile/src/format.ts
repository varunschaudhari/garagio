// Same formatting as the web app: Indian grouping, Western digits, DD-MM-YYYY.

export function money(n: number | null | undefined, decimals = 2): string {
  const v = Number(n || 0);
  const neg = v < 0;
  const [intPart, dec] = Math.abs(v).toFixed(decimals).split('.');
  let i = intPart;
  if (i.length > 3) {
    const last3 = i.slice(-3);
    const rest = i.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    i = rest + ',' + last3;
  }
  return (neg ? '-' : '') + '₹' + i + (dec ? '.' + dec : '');
}

export const rupees = (n: number | null | undefined) => money(Math.round(Number(n || 0)), 0);

export function qty(n: number | null | undefined): string {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
}

export function date(s: string | null | undefined): string {
  if (!s) return '';
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

export function datetime(s: string | null | undefined): string {
  if (!s) return '';
  return `${date(s)} ${s.slice(11, 16)}`;
}

/** "1.2.10" < "1.10.0" aware comparison. */
export function versionLess(a: string, b: string): boolean {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}
