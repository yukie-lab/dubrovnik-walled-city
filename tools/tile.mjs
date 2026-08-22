// テクスチャの反復(タイリング)が「読める」かを測る。
//
// 目視では「なんとなく繰り返して見える」以上のことが言えない。
// 壁面を矩形で切り出し、列平均・行平均の自己相関を取る。低周波(照明の
// 傾斜)を差し引いてから相関を取るので、残るピークは反復そのもの。
//
//   node tools/tile.mjs shots/s04_prijeko.png x0 y0 x1 y1
//
// 出力: 横方向・縦方向それぞれの副ピーク(ラグ px と相関 r)。
// 目安: r < 0.15 なら反復は読めない。r > 0.25 は「同じ石がまた出た」と判る。
import fs from 'node:fs';
import zlib from 'node:zlib';

function readPNG(file) {
  const buf = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, bd = 0, ct = 0; const idat = [];
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

// 低周波(照明の傾斜)を移動平均で引く。引かないと相関が全部 0.9 になる。
function detrend(a, win) {
  const n = a.length, out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - win); k <= Math.min(n - 1, i + win); k++) { s += a[k]; c++; }
    out[i] = a[i] - s / c;
  }
  return out;
}

function peak(sig, minLag, maxLag, label) {
  const n = sig.length;
  let m = 0; for (let i = 0; i < n; i++) m += sig[i]; m /= n;
  let v0 = 0; for (let i = 0; i < n; i++) v0 += (sig[i] - m) ** 2;
  if (v0 < 1e-9) return `${label}: 変化なし`;
  let best = { lag: 0, r: 0 };
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += (sig[i] - m) * (sig[i + lag] - m);
    const r = s / v0 * (n / (n - lag));
    if (r > best.r) best = { lag, r };
  }
  const v = best.r < 0.15 ? '✅ 読めない' : best.r < 0.25 ? '⚠️ 気づく' : '❌ 反復が読める';
  return `${label}: ラグ ${best.lag}px  r=${best.r.toFixed(3)}  ${v}`;
}

const [file, sx0, sy0, sx1, sy1] = process.argv.slice(2);
if (!file || sx1 === undefined) { console.error('使い方: node tools/tile.mjs shots/xxx.png x0 y0 x1 y1'); process.exit(1); }
const img = readPNG(file);
const x0 = Math.max(0, +sx0), y0 = Math.max(0, +sy0);
const x1 = Math.min(img.w, +sx1), y1 = Math.min(img.h, +sy1);
const W = x1 - x0, H = y1 - y0;

const cols = new Float64Array(W), rows = new Float64Array(H);
for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
  const i = (y * img.w + x) * img.ch;
  const l = 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
  cols[x - x0] += l / H; rows[y - y0] += l / W;
}
console.log(`${file} [${x0},${y0}]-[${x1},${y1}]  ${W}x${H}`);
// 小さいラグは「隣の画素は似ている」だけで反復ではない。実物の目地の
// 最小間隔(切石 1 個ぶん)より広いラグから探す。
console.log('  ' + peak(detrend(cols, Math.round(W * 0.18)), Math.max(14, Math.round(W * 0.07)), Math.floor(W * 0.34), '横'));
console.log('  ' + peak(detrend(rows, Math.round(H * 0.18)), Math.max(14, Math.round(H * 0.07)), Math.floor(H * 0.34), '縦'));
