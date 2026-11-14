// Generates the Android app icon, adaptive icon and splash image (orange tile, dark spanner).
//   node tools/make-app-icons.mjs
// No dependencies: shapes are rasterised with 4×4 supersampling and written as PNG via zlib.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORANGE = [0xf9, 0x73, 0x16];
const INK = [0x11, 0x18, 0x27];

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

// Spanner in unit coordinates (0..1): a handle capsule plus an open ring head.
function inSpanner(u, v) {
  const ax = 0.27, ay = 0.73, bx = 0.516, by = 0.484, r = 0.075;
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy)));
  const hx = ax + t * dx - u, hy = ay + t * dy - v;
  if (hx * hx + hy * hy <= r * r) return true;
  const cx = 0.64, cy = 0.36;
  const d = Math.hypot(u - cx, v - cy);
  if (d < 0.095 || d > 0.2) return false;
  const ang = Math.atan2(-(v - cy), u - cx); // opening faces up-right
  return !(ang > Math.PI / 4 - 0.42 && ang < Math.PI / 4 + 0.42);
}
function inRoundRect(u, v, radius) {
  const qx = Math.max(Math.abs(u - 0.5) - (0.5 - radius), 0);
  const qy = Math.max(Math.abs(v - 0.5) - (0.5 - radius), 0);
  return qx * qx + qy * qy <= radius * radius;
}

function render(size, { tile, scale }) {
  const S = 4;
  return png(size, (x, y) => {
    let tileHits = 0, inkHits = 0;
    for (let sy = 0; sy < S; sy++) {
      for (let sx = 0; sx < S; sx++) {
        const u = (x + (sx + 0.5) / S) / size;
        const v = (y + (sy + 0.5) / S) / size;
        const su = (u - 0.5) / scale + 0.5, sv = (v - 0.5) / scale + 0.5;
        if (inSpanner(su, sv)) inkHits++;
        else if (tile === 'full' || (tile === 'round' && inRoundRect(u, v, 0.22))) tileHits++;
      }
    }
    const n = S * S;
    if (tile === 'none') return [...INK, Math.round((inkHits / n) * 255)];
    const a = (tileHits + inkHits) / n;
    if (a === 0) return [0, 0, 0, 0];
    const k = inkHits / (tileHits + inkHits);
    return [0, 1, 2].map((i) => Math.round(ORANGE[i] * (1 - k) + INK[i] * k)).concat(Math.round(a * 255));
  });
}

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'mobile', 'assets');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'icon.png'), render(1024, { tile: 'full', scale: 0.9 }));
writeFileSync(join(out, 'adaptive-icon.png'), render(1024, { tile: 'none', scale: 0.62 }));
writeFileSync(join(out, 'splash-icon.png'), render(512, { tile: 'round', scale: 0.85 }));
console.log('Wrote mobile/assets/icon.png, adaptive-icon.png, splash-icon.png');
