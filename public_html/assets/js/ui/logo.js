/*
 * The shop's logo: a white "TA" (Trimurti Auto) monogram over a road line. It sits on the orange gradient of
 * .brand-mark (CSS), so it follows light / dark mode. The same drawing is in assets/img/icon.svg, the bills
 * (api/templates) and the phone app (mobile/src/components/logo.tsx).
 */
export const LOGO_GLYPH = `<rect x="9" y="14" width="20" height="6" rx="1.5"/><rect x="16" y="14" width="6" height="28" rx="1.5"/><path fill-rule="evenodd" d="M33 42 41.5 14h5L55 42h-5.5l-1.9-6.5h-7.2L38.5 42zm8.8-11.2h4.4L44 23.2z"/><rect x="9" y="47" width="46" height="3" rx="1.5" opacity=".6"/>`;

/** The monogram alone (white), for inside a .brand-mark badge. */
export function logoGlyph() {
  return `<svg viewBox="0 0 64 64" fill="#fff" aria-hidden="true" focusable="false">${LOGO_GLYPH}</svg>`;
}
