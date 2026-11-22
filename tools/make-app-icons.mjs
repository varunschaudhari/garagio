// Generates the Android app icon, adaptive icon (foreground + background) and splash image from the shop's logo:
// a grey gear with a red ring and spanner on white (same drawing as assets/img/icon.svg and assets/js/ui/logo.js).
//   node tools/make-app-icons.mjs
// No dependencies: shapes are rasterised with 4×4 supersampling and written as PNG via zlib.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GREY = [0x58, 0x59, 0x5b];
const RED = [0xc1, 0x27, 0x2d];
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

function inRoundRect(x, y, rx, ry, w, h, r) {
  if (x < rx || y < ry || x > rx + w || y > ry + h) return false;
  const qx = Math.max(Math.abs(x - (rx + w / 2)) - (w / 2 - r), 0);
  const qy = Math.max(Math.abs(y - (ry + h / 2)) - (h / 2 - r), 0);
  return qx * qx + qy * qy <= r * r;
}

/* The logo in the 100 × 100 grid of icon.svg / logo.js. Returns its colour at (x, y), or null outside it. */
const TEETH = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => (a * Math.PI) / 180);
function logo(x, y) {
  const dx = x - 50;
  const dy = y - 50;
  const d = Math.hypot(dx, dy);
  // Red: spanner handle, spanner head (disc with a slot cut from the top), ring open at the bottom left.
  if (x >= 46.75 && x <= 53.25 && y >= 47 && y <= 77) return RED;
  if (Math.hypot(x - 50, y - 44) <= 7.5 && !(x >= 47.25 && x <= 52.75 && y <= 43)) return RED;
  if (Math.abs(d - 23) <= 4) {
    const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    if (!(deg > 90 && deg < 150)) return RED;
  }
  // Grey: the gear's ring and eight teeth.
  if (Math.abs(d - 37) <= 4) return GREY;
  for (const a of TEETH) {
    // Turn the point back by the tooth's angle and test the upright tooth.
    const rx = 50 + dx * Math.cos(-a) - dy * Math.sin(-a);
    const ry = 50 + dx * Math.sin(-a) + dy * Math.cos(-a);
    if (inRoundRect(rx, ry, 43.5, 3, 13, 13, 2.5)) return GREY;
  }
  return null;
}

/**
 * tile: 'full' (white square, the launcher masks it), 'round' (white rounded tile with transparent corners),
 * 'none' (logo on transparent: adaptive foreground) or 'bg' (white only: adaptive background). scale shrinks the logo.
 */
function render(size, { tile, scale }) {
  const S = 4;
  return png(size, (px, py) => {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) {
      for (let sx = 0; sx < S; sx++) {
        const u = (px + (sx + 0.5) / S) / size;
        const v = (py + (sy + 0.5) / S) / size;
        const inTile = tile === 'full' || tile === 'bg' || (tile === 'round' && inRoundRect(u * 100, v * 100, 0, 0, 100, 100, 24));
        const mark = tile === 'bg' ? null : logo(((u - 0.5) / scale + 0.5) * 100, ((v - 0.5) / scale + 0.5) * 100);
        let col;
        if (tile === 'none') {
          if (!mark) continue;
          col = mark;
        } else if (inTile) {
          col = mark ?? WHITE;
        } else {
          continue;
        }
        r += col[0]; g += col[1]; b += col[2]; a += 1;
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
writeFileSync(join(out, 'icon.png'), render(1024, { tile: 'full', scale: 0.84 }));
// Adaptive icons: the launcher shows the middle 66 of 108 dp, so the logo (95 % of its box) stays within 0.6.
writeFileSync(join(out, 'adaptive-icon.png'), render(1024, { tile: 'none', scale: 0.6 }));
writeFileSync(join(out, 'adaptive-background.png'), render(512, { tile: 'bg', scale: 1 }));
writeFileSync(join(out, 'splash-icon.png'), render(512, { tile: 'round', scale: 0.84 }));
console.log('Wrote mobile/assets/icon.png, adaptive-icon.png, adaptive-background.png, splash-icon.png');
