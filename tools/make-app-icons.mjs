// Generates the Android app icon, adaptive icon (foreground + background) and splash image from the shop's logo:
// a white "TA" monogram over a road line on the orange brand gradient (same drawing as assets/img/icon.svg).
//   node tools/make-app-icons.mjs
// No dependencies: shapes are rasterised with 4×4 supersampling and written as PNG via zlib.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Gradient stops (top-left → bottom-right), as in the web / phone brand gradient.
const STOPS = [
  [0, [0xc2, 0x41, 0x0c]],
  [0.6, [0xea, 0x58, 0x0c]],
  [1, [0xf9, 0x73, 0x16]],
];
const WHITE = [255, 255, 255];

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function gradient(t) {
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    const [t0, c0] = STOPS[i - 1];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
    }
  }
  return STOPS[STOPS.length - 1][1];
}

/* Logo glyph in the 64 × 64 grid of icon.svg. */
function inRoundRect(x, y, rx, ry, w, h, r) {
  if (x < rx || y < ry || x > rx + w || y > ry + h) return false;
  const qx = Math.max(Math.abs(x - (rx + w / 2)) - (w / 2 - r), 0);
  const qy = Math.max(Math.abs(y - (ry + h / 2)) - (h / 2 - r), 0);
  return qx * qx + qy * qy <= r * r;
}
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const A_OUTER = [[33, 42], [41.5, 14], [46.5, 14], [55, 42], [49.5, 42], [47.6, 35.5], [40.4, 35.5], [38.5, 42]];
const A_HOLE = [[41.8, 30.8], [46.2, 30.8], [44, 23.2]];
/** 1 inside the letters, 0.6 on the road line, 0 outside. */
function glyph(x, y) {
  if (inRoundRect(x, y, 9, 14, 20, 6, 1.5) || inRoundRect(x, y, 16, 14, 6, 28, 1.5)) return 1;
  if (inPoly(x, y, A_OUTER) && !inPoly(x, y, A_HOLE)) return 1;
  if (inRoundRect(x, y, 9, 47, 46, 3, 1.5)) return 0.6;
  return 0;
}

/**
 * tile: 'full' (square, the launcher masks it), 'round' (rounded tile with transparent corners), 'none' (white glyph
 * on transparent: adaptive foreground) or 'bg' (gradient only: adaptive background). scale shrinks the glyph.
 */
function render(size, { tile, scale }) {
  const S = 4;
  return png(size, (px, py) => {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) {
      for (let sx = 0; sx < S; sx++) {
        const u = (px + (sx + 0.5) / S) / size;
        const v = (py + (sy + 0.5) / S) / size;
        const inTile = tile === 'full' || tile === 'bg' || (tile === 'round' && inRoundRect(u * 64, v * 64, 0, 0, 64, 64, 18));
        const gu = ((u - 0.5) / scale + 0.5) * 64;
        const gv = ((v - 0.5) / scale + 0.5) * 64;
        const k = tile === 'bg' ? 0 : glyph(gu, gv);
        let col;
        let alpha;
        if (tile === 'none') {
          col = WHITE;
          alpha = k;
        } else if (inTile) {
          const base = gradient((u + v) / 2);
          col = base.map((c, i) => c + (WHITE[i] - c) * k);
          alpha = 1;
        } else {
          continue;
        }
        r += col[0] * alpha; g += col[1] * alpha; b += col[2] * alpha; a += alpha;
      }
    }
    const n = S * S;
    if (a === 0) return [0, 0, 0, 0];
    return [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round((a / n) * 255)];
  });
}

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'mobile', 'assets');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'icon.png'), render(1024, { tile: 'full', scale: 0.9 }));
writeFileSync(join(out, 'adaptive-icon.png'), render(1024, { tile: 'none', scale: 0.58 }));
writeFileSync(join(out, 'adaptive-background.png'), render(512, { tile: 'bg', scale: 1 }));
writeFileSync(join(out, 'splash-icon.png'), render(512, { tile: 'round', scale: 0.85 }));
console.log('Wrote mobile/assets/icon.png, adaptive-icon.png, adaptive-background.png, splash-icon.png');
