// ============================================================================
// imgstat.mjs — 画の客観計測。「黒が無い/白が無い/影が青くない」を数字で見る。
//   node tools/imgstat.mjs shots/av01_stradun.png [...]
//   node tools/imgstat.mjs shots/av*.png
// ============================================================================
import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';

function readPNG(path) {
  const d = readFileSync(path);
  let i = 8, w = 0, h = 0, bd = 0, ct = 0, idat = [];
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

const srgb2lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

for (const path of process.argv.slice(2)) {
  const { w, h, ch, px } = readPNG(path);
  const lum = [], hist = new Array(10).fill(0);
  let n = 0, satSum = 0;
  let skyR = 0, skyB = 0, skyN = 0, shR = 0, shB = 0, shN = 0;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    const o = (y * w + x) * ch;
    const r = px[o] / 255, g = px[o + 1] / 255, b = px[o + 2] / 255;
    const L = 0.2126 * srgb2lin(r) + 0.7152 * srgb2lin(g) + 0.0722 * srgb2lin(b);
    lum.push(L); n++;
    hist[Math.min(9, Math.floor(L * 10))]++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    satSum += mx > 0 ? (mx - mn) / mx : 0;
    // 空 = 画面上部の青い画素 / 影 = 暗い側の画素(いずれも色相の傾きを見る)
    if (y < h * 0.35 && b > r * 1.05 && L > 0.10) { skyR += r; skyB += b; skyN++; }
    if (L < 0.10 && L > 0.005) { shR += r; shB += b; shN++; }
  }
  lum.sort((a, b) => a - b);
  const q = (t) => lum[Math.min(lum.length - 1, Math.floor(t * lum.length))];
  const pct = (f) => (100 * lum.filter(f).length / n);
  const name = path.split('/').pop().replace('.png', '');
  console.log(
    `${name.padEnd(18)} 中央値 ${q(0.5).toFixed(3)}  p1 ${q(0.01).toFixed(3)}  p99 ${q(0.99).toFixed(3)}  ` +
    `暗部<0.02 ${pct(v => v < 0.02).toFixed(1)}%  明部>0.90 ${pct(v => v > 0.90).toFixed(2)}%  ` +
    `彩度 ${(satSum / n).toFixed(3)}  空B/R ${skyN ? (skyB / skyR).toFixed(2) : '—'}  影B/R ${shN ? (shB / shR).toFixed(2) : '—'}`,
  );
}
