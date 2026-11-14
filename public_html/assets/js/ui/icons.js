import { ICONS } from './icons-data.js';
import { raw } from '../dom.js';

/** Inline Lucide SVG icon. */
export function icon(name, size = 18, cls = '') {
  const inner = ICONS[name] || ICONS['circle-dot'];
  return raw(
    `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`
  );
}
