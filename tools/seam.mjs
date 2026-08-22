// 水平線の継ぎ目を測る。
//
// 「海と空の境目に線が見えるか」を目視で判定するのは当てにならない。
// 画像の各行の平均輝度(線形)を取り、隣接行との差が最大の場所を探す。
// 空も海も上下方向には滑らかな階調なので、真の継ぎ目だけが尖った差を出す。
//
//   node tools/seam.mjs shots/q1.png [x0 x1]
//
// 出力: 最大段差の行・段差量(線形輝度比)・その前後の輝度。
// 目安: 比 1.06 未満なら目に見えない。1.15 を超えると「線」として読める。
import fs from 'node:fs';
import zlib from 'node:zlib';

function readPNG(file) {
  const buf = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, bd = 0, ct = 0, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += len + 12;
  }
  if (bd !== 8 || (ct !== 2 && ct !== 6)) throw new Error(`未対応の PNG: bd=${bd} ct=${ct}`);
  const ch = ct === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[o++];
    const line = raw.subarray(o, o + stride); o += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

const srgbToLin = (u) => { const s = u / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };

const [file, ax0, ax1] = process.argv.slice(2);
if (!file) { console.error('使い方: node tools/seam.mjs shots/xxx.png [x0 x1]'); process.exit(1); }
const img = readPNG(file);
const x0 = ax0 ? parseInt(ax0) : Math.round(img.w * 0.10);
const x1 = ax1 ? parseInt(ax1) : Math.round(img.w * 0.90);

const rows = new Float64Array(img.h);
for (let y = 0; y < img.h; y++) {
  let s = 0;
  for (let x = x0; x < x1; x++) {
    const i = (y * img.w + x) * img.ch;
    s += 0.2126 * srgbToLin(img.data[i]) + 0.7152 * srgbToLin(img.data[i + 1]) + 0.0722 * srgbToLin(img.data[i + 2]);
  }
  rows[y] = s / (x1 - x0);
}

// 3 行平均どうしの比が大きい行を上位 5 件。水平線がどれかは行位置で判る
// (胸壁や屋根の縁も段差として出るので、機械的に 1 位を採らない)。
const avg3 = (y) => (rows[y - 1] + rows[y] + rows[y + 1]) / 3;
const cand = [];
for (let y = 4; y < Math.floor(img.h * 0.80) - 4; y++) {
  const a = avg3(y - 2), b = avg3(y + 2);
  cand.push({ y, ratio: Math.max(a, b) / Math.max(Math.min(a, b), 1e-6), above: a, below: b });
}
cand.sort((p, q) => q.ratio - p.ratio);
const picked = [];
for (const c of cand) {
  if (picked.some(p => Math.abs(p.y - c.y) < 12)) continue;
  picked.push(c);
  if (picked.length === 5) break;
}
console.log(file);
for (const c of picked) {
  const v = c.ratio < 1.06 ? '✅' : c.ratio < 1.15 ? '⚠️' : '❌';
  console.log(`  行=${String(c.y).padStart(4)}  比=${c.ratio.toFixed(3)}  上=${c.above.toFixed(4)} 下=${c.below.toFixed(4)}  ${v}`);
}
