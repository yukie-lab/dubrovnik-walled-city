// ============================================================================
// _grain.mjs — 「情報量」を距離で分けて測る(6巡目レビュー用)。
//   node tools/_grain.mjs shots/s01_stradun_w.png ...
// shots/_depth/<name>.bin(tools/_depth.mjs が書く 400x250 の距離[m])を使う。
//
// 情報量 = log 輝度の勾配 |∇log L| の 4x4 平均。log を取るので
// 「日向か日陰か」ではなく「面の中の模様の濃さ」を測る(露出不変)。
// 平坦率 = そのブロックの情報量が 0.010 未満(≒ コントラスト 1%)の割合。
// ============================================================================
import zlib from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';

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

// sRGB -> CIE Lab -> LCh
function lab(r, g, b) {
  const R = s2l(r), G = s2l(g), B = s2l(b);
  let X = R * 0.4124 + G * 0.3576 + B * 0.1805;
  let Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let Z = R * 0.0193 + G * 0.1192 + B * 0.9505;
  X /= 0.95047; Z /= 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  const L = 116 * fy - 16, A = 500 * (fx - fy), Bb = 200 * (fy - fz);
  return [L, Math.hypot(A, Bb), (Math.atan2(Bb, A) * 180 / Math.PI + 360) % 360];
}

const NEAR = 6, MID = 25, SKY = 1500;   // m
const HDR = process.argv.includes('--head');
if (HDR) console.log('name                 |  近景<6m         |  中景6-25m       |  遠景>25m        | 空 | 平坦率(全体)');

for (const path of process.argv.slice(2).filter(a => a.endsWith('.png'))) {
  const name = path.split('/').pop().replace('.png', '');
  const dpath = new URL(`../shots/_depth/${name}.bin`, import.meta.url).pathname;
  if (!existsSync(dpath)) { console.log(`${name}: 深度なし`); continue; }
  const db = readFileSync(dpath);
  const dep = new Float32Array(db.buffer, db.byteOffset, db.length / 4);
  const DW = 400, DH = 250;

  const { w, h, ch, px } = readPNG(path);
  // フル解像度の log 輝度
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * ch;
    const l = 0.2126 * s2l(px[o] / 255) + 0.7152 * s2l(px[o + 1] / 255) + 0.0722 * s2l(px[o + 2] / 255);
    L[i] = Math.log(l + 0.0035);
  }
  // sRGB 輝度(グレインのノイズ床を見積もるため)
  const S = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * ch;
    S[i] = (0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) / 255;
  }
  // main.js の GradeShader: c.rgb += (hash-0.5)*0.020*gw, gw = 4*lum*(1-lum)
  // 独立2標本の差の平均 = (2/3)*振幅。sRGB→リニアの微分で log 輝度の床に直す。
  const noiseFloor = (s) => {
    const gw = 4 * s * (1 - s);
    const dS = (2 / 3) * 0.010 * gw;
    const dLin = 2.4 * Math.pow((Math.max(s, 0.04) + 0.055) / 1.055, 1.4) / 1.055 * dS;
    const lin = s2l(Math.max(s, 0.02));
    return dLin / (lin + 0.0035);
  };

  const sx = w / DW, sy = h / DH;   // 4, 4
  const bins = { near: [], mid: [], far: [] };
  let flatAll = 0, nAll = 0;
  // 色相(彩度重み)。L* の三分位で暗部/中間/明部に分ける。
  const Ls = [], hueW = new Float64Array(12), hueByTier = [new Float64Array(12), new Float64Array(12), new Float64Array(12)];
  const chromaTier = [0, 0, 0], nTier = [0, 0, 0];
  for (let by = 0; by < DH; by++) {
    for (let bx = 0; bx < DW; bx++) {
      const d = dep[(DH - 1 - by) * DW + bx];   // 深度は下から上
      let sum = 0, n = 0, sSum = 0;
      const y0 = (by * sy) | 0, x0 = (bx * sx) | 0;
      for (let y = y0; y < y0 + sy && y < h - 1; y++) {
        for (let x = x0; x < x0 + sx && x < w - 1; x++) {
          const i = y * w + x;
          sum += Math.abs(L[i + 1] - L[i]) + Math.abs(L[i + w] - L[i]);
          sSum += S[i];
          n += 2;
        }
      }
      const raw = n ? sum / n : 0;
      const nf = noiseFloor(sSum / (n / 2));
      const e = Math.sqrt(Math.max(0, raw * raw - nf * nf));   // グレインを二乗で差し引く
      if (d > SKY || d <= 0) continue;
      nAll++; if (e < 0.010) flatAll++;
      (d < NEAR ? bins.near : d < MID ? bins.mid : bins.far).push(e);
    }
  }
  // 色
  for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) {
    const o = (y * w + x) * ch;
    const [Lv, C, H] = lab(px[o] / 255, px[o + 1] / 255, px[o + 2] / 255);
    Ls.push([Lv, C, H]);
  }
  Ls.sort((a, b) => a[0] - b[0]);
  const t1 = Ls[(Ls.length / 3) | 0][0], t2 = Ls[((Ls.length * 2) / 3) | 0][0];
  for (const [Lv, C, H] of Ls) {
    const b = Math.min(11, Math.floor(H / 30));
    hueW[b] += C;
    const t = Lv < t1 ? 0 : Lv < t2 ? 1 : 2;
    hueByTier[t][b] += C; chromaTier[t] += C; nTier[t]++;
  }
  const med = (a) => (a.length ? a.slice().sort((p, q) => p - q)[a.length >> 1] : 0);
  const pctFlat = (a) => (a.length ? 100 * a.filter(v => v < 0.010).length / a.length : 0);
  const f = (a, lbl) => `${lbl} ${med(a).toFixed(4)}(平${pctFlat(a).toFixed(0)}%,${(100 * a.length / nAll).toFixed(0)}%)`;
  const domHue = (arr) => { let bi = 0; for (let i = 1; i < 12; i++) if (arr[i] > arr[bi]) bi = i; return `${bi * 30}-${bi * 30 + 30}`; };
  console.log(`${name.padEnd(20)} ${f(bins.near, '近')} ${f(bins.mid, '中')} ${f(bins.far, '遠')} | L*三分位 ${t1.toFixed(0)}/${t2.toFixed(0)} 平均C 暗${(chromaTier[0] / nTier[0]).toFixed(1)} 中${(chromaTier[1] / nTier[1]).toFixed(1)} 明${(chromaTier[2] / nTier[2]).toFixed(1)} 主色相 暗${domHue(hueByTier[0])} 中${domHue(hueByTier[1])} 明${domHue(hueByTier[2])}`);
}
