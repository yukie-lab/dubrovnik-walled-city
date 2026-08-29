// 路地の画から、露出後に **目に届いた** 情報量を測る。
//   潰れ  = L* < 5 の画素の割合(そこには何も無い)
//   飛び  = L* > 95
//   sd8/sd32 = 8px / 32px 窓の局所標準偏差の中央値(= 影の中に階調があるか)
//   帯    = 画面上端 30% にある「空」画素の水平方向の張り(リボンの太さ)
// 使い方: node tools/alleyimg.mjs shots/p6_deep_790.png ...
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


const f = x => x > 0.008856 ? Math.cbrt(x) : (7.787 * x + 16 / 116);
function toL(r, g, b) {                       // sRGB 0..255 → L*
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const R = lin(r), G = lin(g), B = lin(b);
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  return 116 * f(Y) - 16;
}
// 積分画像で任意窓の局所 SD
function localSD(L, W, H, k) {
  const s = new Float64Array((W + 1) * (H + 1)), s2 = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = L[y * W + x], i = (y + 1) * (W + 1) + (x + 1);
    s[i] = v + s[i - 1] + s[i - (W + 1)] - s[i - (W + 1) - 1];
    s2[i] = v * v + s2[i - 1] + s2[i - (W + 1)] - s2[i - (W + 1) - 1];
  }
  const out = [];
  const r = k >> 1;
  for (let y = r; y < H - r; y += 4) for (let x = r; x < W - r; x += 4) {
    const x0 = x - r, y0 = y - r, x1 = x + r, y1 = y + r, n = (x1 - x0) * (y1 - y0);
    const A = y0 * (W + 1) + x0, B = y0 * (W + 1) + x1, C = y1 * (W + 1) + x0, D = y1 * (W + 1) + x1;
    const m = (s[D] - s[B] - s[C] + s[A]) / n;
    const v = (s2[D] - s2[B] - s2[C] + s2[A]) / n - m * m;
    out.push(Math.sqrt(Math.max(0, v)));
  }
  out.sort((a, b) => a - b);
  return out[out.length >> 1];
}
// 画面中央値では路地の明暗は測れない。ストラドゥンに立った時点で画面の大半が
// すでに路地の壁だから。同じ材質・同じ向きの面を比べる必要がある —
// **足元の床(画面下 10%)** を測る。第1パスで lightprobe が IBL を数えて
// いなかったのと同じ種類の誤りを、ここで繰り返していた。
// sd8 は画面全体の中央値なので「壁に物があるか」を測れない — 縦樋が 6 本
// 写っている画(0.70)と無地の板(0.58)がほとんど同じ値になる。動くのは
// 日向の面積で、物の数ではない。手前の壁だけを見る二つの指標を足す:
//   壁sd8 = 画面の左右 22%(路地では手の届く壁)に限った局所 SD
//   輪郭  = 勾配 > 3 L*/px の画素の割合(= そこに縁のある物がどれだけあるか)
console.log('画                     潰れ%  L*中央  sd8   壁sd8  輪郭%   帯%   足元L*   足元Y');
for (const p of process.argv.slice(2)) {
  const png = readPNG(p);
  const W = png.w, H = png.h, L = new Float32Array(W * H);
  let dark = 0, blow = 0;
  const all = [];
  for (let i = 0; i < W * H; i++) {
    const l = toL(png.px[i * png.ch], png.px[i * png.ch + 1], png.px[i * png.ch + 2]);
    L[i] = l; all.push(l);
    if (l < 5) dark++; if (l > 95) blow++;
  }
  all.sort((a, b) => a - b);
  // 帯: 上端 30% の各行で「その行の最大 L* の 0.75 倍以上」が連続する幅の中央値
  const rib = [];
  for (let y = 0; y < H * 0.30; y += 4) {
    let mx = 0; for (let x = 0; x < W; x++) mx = Math.max(mx, L[y * W + x]);
    if (mx < 12) continue;
    let run = 0, best = 0;
    for (let x = 0; x < W; x++) { if (L[y * W + x] > mx * 0.75) { if (++run > best) best = run; } else run = 0; }
    rib.push(best / W);
  }
  rib.sort((a, b) => a - b);
  // 足元帯: 画面下 10% の中央値
  const foot = [];
  for (let y = Math.floor(H * 0.90); y < H; y++) for (let x = 0; x < W; x++) foot.push(L[y * W + x]);
  foot.sort((a, b) => a - b);
  const fL = foot[foot.length >> 1];
  const fY = fL > 8 ? Math.pow((fL + 16) / 116, 3) : fL / 903.3;   // L* → 相対輝度
  // 手前の壁(左右 22%)だけの局所 SD
  const wW = Math.floor(W * 0.22);
  const sub = new Float32Array(wW * 2 * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < wW; x++) sub[y * wW * 2 + x] = L[y * W + x];
    for (let x = 0; x < wW; x++) sub[y * wW * 2 + wW + x] = L[y * W + (W - wW + x)];
  }
  const wallSD = localSD(sub, wW * 2, H, 8);
  // 輪郭: 隣接画素の勾配が 3 L*/px を超える割合
  let edge = 0;
  for (let y = 1; y < H; y++) for (let x = 1; x < W; x++) {
    const i = y * W + x;
    if (Math.abs(L[i] - L[i - 1]) > 3 || Math.abs(L[i] - L[i - W]) > 3) edge++;
  }
  const name = p.split('/').pop().replace('.png', '');
  console.log(`${name.padEnd(20)} ${(dark / (W * H) * 100).toFixed(1).padStart(6)} ` +
    `${all[all.length >> 1].toFixed(1).padStart(6)} ${localSD(L, W, H, 8).toFixed(2).padStart(6)} ${wallSD.toFixed(2).padStart(6)} ${(edge / (W * H) * 100).toFixed(2).padStart(6)} ` +
    `${rib.length ? (rib[rib.length >> 1] * 100).toFixed(1).padStart(6) : '   —  '} ${fL.toFixed(1).padStart(7)} ${fY.toFixed(4).padStart(7)}`);
}
