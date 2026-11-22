/*
 * The shop's logo: a grey gear with a red ring and spanner (Trimurti Rambhau Auto Spares and Garage). Drawn as SVG
 * in a 100 × 100 box. The same drawing is in assets/img/icon.svg, the bills (logo_svg() in api/lib/util.php), the
 * phone app (mobile/src/components/brand.tsx) and the Android icons (tools/make-app-icons.mjs).
 */
const GREY = '#58595B';
const RED = '#C1272D';

/** The logo's shapes; colours can be replaced (all black for a thermal printer). */
export function logoShapes(grey = GREY, red = RED) {
  const teeth = [0, 45, 90, 135, 180, 225, 270, 315]
    .map((a) => `<rect x="43.5" y="3" width="13" height="13" rx="2.5" transform="rotate(${a} 50 50)"/>`)
    .join('');
  return `<g fill="${grey}">${teeth}</g>`
    + `<circle cx="50" cy="50" r="37" fill="none" stroke="${grey}" stroke-width="8"/>`
    + `<path d="M30.08 61.5A23 23 0 1 1 50 73" fill="none" stroke="${red}" stroke-width="8"/>`
    + `<path fill="${red}" d="M52.75 37.02A7.5 7.5 0 1 1 47.25 37.02V43h5.5z"/>`
    + `<rect x="46.75" y="47" width="6.5" height="30" fill="${red}"/>`;
}

/** The logo as an inline SVG (for .brand-mark, which gives it a white tile). */
export function logoSvg() {
  return `<svg viewBox="0 0 100 100" role="img" aria-label="Trimurti Rambhau Auto">${logoShapes()}</svg>`;
}
