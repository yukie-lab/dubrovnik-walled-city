// 画面の矩形の平均色を Lab/LCh で出す。 node tools/_rect.mjs shots/x.png x0,y0,x1,y1 [...]
import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';
function readPNG(path) {
  const d = readFileSync(path);
  let i = 8, w = 0, h = 0, bd = 0, ct = 0; const idat = [];
  while (i < d.length) {
    const ln = d.readUInt32BE(i), typ = d.toString('ascii', i + 4, i + 8);
    const data = d.subarray(i + 8, i + 8 + ln); i += 12 + ln;
    if (typ === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (typ === 'IDAT') idat.push(data);
    else if (typ === 'IEND') break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  const bpp = ch * (bd / 8), stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride), p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p]; p++;
    const line = Buffer.from(raw.subarray(p, p + stride)); p += stride;
    if (f === 1) for (let x = bpp; x < stride; x++) line[x] = (line[x] + line[x - bpp]) & 255;
    else if (f === 2) for (let x = 0; x < stride; x++) line[x] = (line[x] + prev[x]) & 255;
    else if (f === 3) for (let x = 0; x < stride; x++) line[x] = (line[x] + (((x >= bpp ? line[x - bpp] : 0) + prev[x]) >> 1)) & 255;
    else if (f === 4) for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
      line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
    line.copy(out, y * stride); prev = line;
  }
  return { w, h, ch, px: out };
}
const s2l = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
function lab(r, g, b) {
  const R = s2l(r), G = s2l(g), B = s2l(b);
  let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  const L = 116 * fy - 16, A = 500 * (fx - fy), Bb = 200 * (fy - fz);
  return [L, A, Bb, Math.hypot(A, Bb), (Math.atan2(Bb, A) * 180 / Math.PI + 360) % 360, Y];
}
const path = process.argv[2];
const { w, h, ch, px } = readPNG(path);
for (const spec of process.argv.slice(3)) {
  const [x0, y0, x1, y1] = spec.split(',').map(Number);
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const o = (y * w + x) * ch; r += px[o]; g += px[o + 1]; b += px[o + 2]; n++;
  }
  r /= n * 255; g /= n * 255; b /= n * 255;
  const [L, A, B, C, H, Y] = lab(r, g, b);
  console.log(`${spec.padEnd(20)} sRGB ${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0}  L* ${L.toFixed(1)}  C* ${C.toFixed(1)}  h ${H.toFixed(0)}°  リニアY ${Y.toFixed(4)}  B/R ${(b / r).toFixed(2)}`);
}
