// ============================================================================
// trees.js — ダルマチアの木を「成長」から作る。
//
// この海岸の植生には固有の署名がある。屋根の次に、来たことのある人が必ず
// 見るのがここ。1 個の形を回して並べた瞬間に、島ごと既製品に見える。
//
// アレッポ松(Pinus halepensis):
//   幹は傾き、ねじれる。高さの 2/3 までは枝が無く、淡い灰黄土色。枝は上の
//   1/3 にだけ、ほぼ水平に広がって、平頂の傘になる。葉は疎らで青緑、枝の先に
//   固まり、空の隙間が残る。**濃緑の左右対称な円錐は失敗**。
// 糸杉(Cupressus sempervirens):
//   細く暗い縦の柱。松の水平と海の水平に対する垂直の対位法。梢だけがわずかに
//   揺れる(松はもっと自由に動く)。
// マキ(maquis / garrigue):
//   スルジは森ではない。風に刈られた腰から胸の高さの丸い低木と、剥き出しの
//   白い石灰岩。緑の森にしたら地理的に誤り。
//
// 作り方の原則:
//   ・幹と一次枝は**本物の幾何**。テーパーがあり、枝の角度は個体ごとに違う。
//   ・葉は枝の**実際の先端**に置く。樹冠の形が枝の構造から出る。
//   ・葉の板は樹冠の面に寝かせる。カメラを向く板は失敗(幹が見える距離では特に)。
//   ・輪郭が realism を運ぶ。逆光の海を背にしたとき、樹冠は「空が透けるレース」
//     でなければならない。閉じた輪郭は失敗。
//
// 頂点属性 aSway(根元 0 → 枝先 1)と aPhase(個体・枝ごとの位相)を持たせ、
// 風はシェーダで揺らす。インスタンスではなく地形に焼き付けた大メッシュでも
// 個体ごとに違う位相で揺れる。
// ============================================================================
import * as THREE from 'three';
import { TAU, clamp, lerp } from './util.js';

/** 生成中の頂点を溜める袋。位置・法線・色・揺れ・位相を並行して持つ。 */
export class TreeBuf {
  constructor(opaqueUV = 0.04, opaqueSize = 0.085) {
    this.P = []; this.N = []; this.C = []; this.S = []; this.H = []; this.U = [];
    this.op = opaqueUV; this.opSize = opaqueSize; this.uv = null; this.tris = 0; }

  vert(p, n, c, sway, phase) {
    this.P.push(p[0], p[1], p[2]);
    this.N.push(n[0], n[1], n[2]);
    this.C.push(c[0], c[1], c[2]);
    this.S.push(sway); this.H.push(phase);
    // uv を明示していない間は「不透明の隅」を指す = 幹と枝。
    if (this.uv) this.U.push(this.uv[0], this.uv[1]);
    else this.U.push(this.op, this.op);
  }

  tri(a, b, c, n, col, sway, phase) {
    this.vert(a, n, col, sway[0], phase);
    this.vert(b, n, col, sway[1], phase);
    this.vert(c, n, col, sway[2], phase);
    this.tris++;
  }

  quad(a, b, c, d, n, col, sway, phase) {
    this.tri(a, b, c, n, col, [sway[0], sway[1], sway[2]], phase);
    this.tri(a, c, d, n, col, [sway[0], sway[2], sway[3]], phase);
  }

  /** uv を指定して四角を張る(葉の房)。 */
  quadUV(a, b, c, d, n, col, sway, phase, uvs) {
    this.uv = uvs[0]; this.vert(a, n, col, sway[0], phase);
    this.uv = uvs[1]; this.vert(b, n, col, sway[1], phase);
    this.uv = uvs[2]; this.vert(c, n, col, sway[2], phase);
    this.uv = uvs[0]; this.vert(a, n, col, sway[0], phase);
    this.uv = uvs[2]; this.vert(c, n, col, sway[2], phase);
    this.uv = uvs[3]; this.vert(d, n, col, sway[3], phase);
    this.uv = null; this.tris += 2;
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.S, 1));
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(this.H, 1));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2));
    return g;
  }
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * 折れ線に沿ってテーパーする管を張る。幹も枝もこれ一本で作る。
 * 断面の枚数は根元だけ多くする — 遠くの小枝に 6 角形は要らない。
 * @param {TreeBuf} B
 * @param {number[][]} path  ワールドではなく木のローカル座標
 * @param {number[]} rad     各節の半径
 * @param {number[]} sway    各節の揺れ重み
 */
function tube(B, path, rad, sway, sides, col, phase) {
  if (path.length < 2) return;
  // 断面の基準ベクトル。経路が真上を向くので、Z を上げて退化を避ける。
  let up = [0, 0, 1];
  const rings = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    const dir = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    let u = cross(up, dir);
    if (Math.hypot(u[0], u[1], u[2]) < 1e-4) { up = [1, 0, 0]; u = cross(up, dir); }
    u = norm(u);
    const v = norm(cross(dir, u));
    up = v;
    const ring = [];
    for (let k = 0; k < sides; k++) {
      const a2 = (k / sides) * TAU;
      const off = add(mul(u, Math.cos(a2) * rad[i]), mul(v, Math.sin(a2) * rad[i]));
      ring.push({ p: add(path[i], off), n: norm(off) });
    }
    rings.push(ring);
  }
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      const A = rings[i][k], Bv = rings[i][k2], Cv = rings[i + 1][k2], D = rings[i + 1][k];
      // 樹皮の色むら。一様な円柱は「棒」に見える。
      const t = i / (rings.length - 1);
      // 樹皮は割れて板になる。明暗の幅が狭いと、滑らかなコンクリートの柱に見える。
      // 幅を 0.62〜1.38(2.2 倍)から 0.55〜1.10(2.0 倍)へ。上限を下げないと、
      // 最も明るい面が砂(L* 54)と見分けが付かない白い棒になる。
      const sh = 0.55 + 0.55 * (0.5 + 0.5 * Math.sin(k * 2.7 + i * 1.9 + phase * 9.0))
        * (0.6 + 0.4 * (0.5 + 0.5 * Math.sin(k * 5.3 - i * 3.1 + phase * 17.0)));
      // 根元ほど暗い。アレッポ松の樹皮は上が淡く、下は割れて濃い板になる。
      const dk = 0.58 + 0.42 * t;
      const c2 = [col[0] * sh * dk, col[1] * sh * dk, col[2] * sh * dk * (1 - t * 0.06)];
      // 隅の中を舐める UV。1 テクセル固定だと樹皮の筋が一本も読めない。
      const os = B.opSize ?? 0.085;
      const u0 = os * (0.10 + 0.80 * (k / sides)), u1 = os * (0.10 + 0.80 * ((k + 1) / sides));
      const v0 = os * (0.08 + 0.84 * (i / Math.max(1, rings.length - 1)));
      const v1 = os * (0.08 + 0.84 * ((i + 1) / Math.max(1, rings.length - 1)));
      B.quadUV(A.p, Bv.p, Cv.p, D.p, A.n, c2, [sway[i], sway[i], sway[i + 1], sway[i + 1]], phase,
        [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    }
  }
}

/**
 * 葉の房。**樹冠の面に寝かせた**小さな板を数枚、少しずつずらして重ねる。
 * カメラを向けない — 幹が見える距離でビルボードにすると必ず破綻する。
 * 板ごとに大きさと向きを散らし、房の縁を欠けさせる(空が透ける)。
 */
function tuft(B, at, size, flat, rnd, col, sway, phase) {
  const nCard = 2 + (rnd() < 0.55 ? 1 : 0);
  for (let c = 0; c < nCard; c++) {
    const a = rnd() * TAU;
    // tilt = 0 で板は立ち、π/2 で寝る。flat=1(松)は寝かせ、0(糸杉)は立てる。
    // ここを取り違えると、平頂の傘が縦に伸びたブロッコリーになる。
    const tilt = flat * (Math.PI / 2) * (0.80 + rnd() * 0.28) + (rnd() - 0.5) * 0.38;
    const ux = [Math.cos(a), 0, Math.sin(a)];
    const vy = norm([-Math.sin(a) * Math.sin(tilt), Math.cos(tilt), Math.cos(a) * Math.sin(tilt)]);
    const w = size * (0.6 + rnd() * 0.75), h = size * (0.34 + rnd() * 0.5);
    const o = [at[0] + (rnd() - 0.5) * size * 0.9,
      at[1] + (rnd() - 0.5) * size * 0.5,
      at[2] + (rnd() - 0.5) * size * 0.9];
    // 四隅を別々に縮めて矩形を崩す。長方形のままだと、樹冠が
    // 「白い付箋を貼った」ように見える(実測でそうなった)。
    const q = () => 0.55 + rnd() * 0.55;
    const p0 = add(o, add(mul(ux, -w * q()), mul(vy, -h * q())));
    const p1 = add(o, add(mul(ux, w * q()), mul(vy, -h * q())));
    const p2 = add(o, add(mul(ux, w * 0.70 * q()), mul(vy, h * q())));
    const p3 = add(o, add(mul(ux, -w * 0.84 * q()), mul(vy, h * q())));
    const n = norm(cross([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]],
      [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]]));
    // 房ごとに明度を散らす。均一だと樹冠が一枚の塊になる。
    const k = 0.78 + rnd() * 0.44;
    // 房の絵。左右を反転させ、上下も少し切り取って、同じ絵の繰り返しを隠す。
    const fx = rnd() < 0.5, u0 = 0.06 + rnd() * 0.10, u1 = 0.94 - rnd() * 0.10;
    const v0 = 0.04 + rnd() * 0.08, v1 = 0.96 - rnd() * 0.10;
    const A = fx ? u1 : u0, Bx = fx ? u0 : u1;
    const uvs = [[A, v0], [Bx, v0], [Bx, v1], [A, v1]];
    B.quadUV(p0, p1, p2, p3, n, [col[0] * k, col[1] * k, col[2] * k],
      [sway, sway, sway, sway], phase, uvs);
  }
}

/**
 * アレッポ松。
 * @param {function} rnd  0..1
 * @param {object} o  { h: 高さ, lean: 傾き, detail: 0..1, exposure: 0..1 }
 */
export function aleppoPine(B, base, rnd, o = {}) {
  const H = o.h ?? (7 + rnd() * 6);
  const phase = rnd();
  const detail = o.detail ?? 1;
  const exposure = o.exposure ?? 0.5;
  // 幹は傾く。風から逃げ、光へ寄る — 直立した松はこの海岸には無い。
  const leanA = rnd() * TAU;
  const lean = (o.lean ?? (0.10 + rnd() * 0.26)) * (0.7 + exposure * 0.7);
  // 枝が始まる高さ。低いと「クリスマスツリー」になる。必ず 2/3 より上。
  const clear = 0.58 + rnd() * 0.14;
  const NS = detail > 0.5 ? 7 : 5;
  const path = [], rad = [], sway = [];
  const r0 = H * (0.032 + rnd() * 0.014);
  // ねじれ。二次の曲がりを入れないと、傾いた「棒」にしかならない。
  const twA = rnd() * TAU, twK = (0.3 + rnd() * 0.7) * lean;
  for (let i = 0; i < NS; i++) {
    const t = i / (NS - 1);
    const bend = lean * t * t * H * 0.55;
    const tw = Math.sin(t * 2.6 + twA) * twK * H * 0.09;
    path.push([base[0] + Math.cos(leanA) * bend + Math.cos(twA) * tw,
      base[1] + t * H,
      base[2] + Math.sin(leanA) * bend + Math.sin(twA) * tw]);
    rad.push(r0 * (1 - t * 0.62));
    sway.push(Math.pow(t, 2.2) * 0.45);
  }
  // 樹皮は淡い灰黄土。老木ほど暗い板に割れる。
  const barkAge = rnd();
  // 樹皮は淡い灰黄土。ただし線形空間で 0.44 は白い柱になる。
  const bark = [0.150 - barkAge * 0.052, 0.128 - barkAge * 0.046, 0.096 - barkAge * 0.036];
  tube(B, path, rad, sway, detail > 0.5 ? 5 : 4, bark, phase);

  // 一次枝 — 上の 1/3 にだけ。ほぼ水平に、外へ長く。
  const nb = Math.round((detail > 0.5 ? 5 : 3) + rnd() * (detail > 0.5 ? 4 : 2));
  // 樹冠の非対称。風下側が長い。
  const windA = rnd() * TAU;
  const foliage = o.foliage ?? [0.095, 0.160, 0.118];
  const tips = [];
  for (let b = 0; b < nb; b++) {
    const t = clear + (1 - clear) * (0.12 + 0.88 * Math.pow(rnd(), 0.75));
    const idx = t * (NS - 1);
    const i0 = Math.min(NS - 2, Math.floor(idx)), f = idx - i0;
    const from = [lerp(path[i0][0], path[i0 + 1][0], f), lerp(path[i0][1], path[i0 + 1][1], f),
      lerp(path[i0][2], path[i0 + 1][2], f)];
    const a = (b / nb) * TAU + rnd() * 0.9;
    // 上ほど短く、下の枝ほど遠くへ張る = 平頂の傘
    const asym = 0.72 + 0.55 * (0.5 + 0.5 * Math.cos(a - windA));
    // 枝は長い。アレッポ松の傘は高さの半分ほどの半径まで広がる —
    // 短いと樹冠が重ならず、遠くから見て「疎らな植林地」になる。
    const L = H * (0.50 - (t - clear) * 0.32) * asym * (0.78 + rnd() * 0.48);
    if (L < 0.25) continue;
    // 立ち上がってから寝る。付け根 25°→ 先端 5° 程度。
    const rise0 = 0.42 + rnd() * 0.22, rise1 = 0.02 + rnd() * 0.10;
    const NB = detail > 0.5 ? 4 : 3;
    const bp = [], br = [], bs = [];
    for (let k = 0; k < NB; k++) {
      const u = k / (NB - 1);
      const rise = lerp(rise0, rise1, u) * u;
      const wob = Math.sin(u * 3.1 + b) * 0.06 * L;
      bp.push([from[0] + Math.cos(a) * L * u - Math.sin(a) * wob,
        from[1] + rise * L * 0.8,
        from[2] + Math.sin(a) * L * u + Math.cos(a) * wob]);
      br.push(r0 * 0.42 * (1 - u * 0.82) + 0.008);
      bs.push(0.45 + Math.pow(u, 1.6) * 0.55);
    }
    tube(B, bp, br, bs, 3, bark, phase + b * 0.13);
    tips.push({ p: bp[NB - 1], s: bs[NB - 1], L, a });
    // 二次枝を 1 本(先端の手前から)。房の付き方に不規則を作る。
    if (detail > 0.5 && rnd() < 0.55) {
      const m = bp[NB - 2];
      const a2 = a + (rnd() - 0.5) * 1.5, L2 = L * (0.3 + rnd() * 0.3);
      const sp = [m, [m[0] + Math.cos(a2) * L2, m[1] + L2 * (0.05 + rnd() * 0.2), m[2] + Math.sin(a2) * L2]];
      tube(B, sp, [br[NB - 2], 0.01], [bs[NB - 2], 1.0], 3, bark, phase + b * 0.21);
      tips.push({ p: sp[1], s: 1.0, L: L2, a: a2 });
    }
  }
  // 葉は枝の先にだけ。房と房の間に空を残す — これが逆光のレースになる。
  // 葉は枝の外半分にだけ。房と房の間に空を残す — これが逆光のレースになる。
  // 房が小さすぎると樹冠が紙吹雪に、大きすぎると閉じた塊になる。
  // 枝の長さに対して 0.16H 前後、1 本の枝に 2〜3 房が平頂の傘を作る。
  // 傘の被覆率が約 37% しかなく、枝先に房が点在するだけだった(silK 0.496 =
  // 連結した葉の塊の平均直径が 8 画素 = 紙吹雪)。芯を埋める。**外周のレースは閉じない。**
  const fs = H * 0.200;
  for (const tp of tips) {
    const n = detail > 0.5 ? 3 : 1;   // 遠景の木は 1 のまま(費用を増やさない)
    for (let k = 0; k < n; k++) {
      const back = 0.04 + k * (0.20 + rnd() * 0.16);
      const at = [tp.p[0] - Math.cos(tp.a) * tp.L * back,
        tp.p[1] + fs * 0.10 - back * tp.L * 0.10,
        tp.p[2] - Math.sin(tp.a) * tp.L * back];
      tuft(B, at, fs * (0.80 + rnd() * 0.55), 0.88, rnd, foliage, tp.s, phase + k * 0.37);
      // 樹冠には厚みがある。枝の面より少し下にも房を落とさないと、
      // 傘ではなく「皿」に見える(下から覗くと 1 枚の板)。
      if (detail > 0.5 && rnd() < 0.55) {
        tuft(B, [at[0], at[1] - fs * (0.35 + rnd() * 0.45), at[2]],
          fs * (0.5 + rnd() * 0.4), 0.80, rnd,
          [foliage[0] * 0.78, foliage[1] * 0.78, foliage[2] * 0.78], tp.s, phase + k * 0.53);
      }
    }
  }
  return H;
}

/** 糸杉。細く、暗く、まっすぐ。梢だけが揺れる。 */
export function cypress(B, base, rnd, o = {}) {
  const H = o.h ?? (8 + rnd() * 7);
  const phase = rnd();
  const detail = o.detail ?? 1;
  // 縦横比 9.1〜13.3 では、642m 先のロクルムで幅が 1.0〜2.9 画素にしかならず、
  // 全樹木の 18%(114 本)を占める糸杉が画面に一本も読めない。
  // 実物の Cupressus sempervirens 'Stricta' は 15m で幅 1.5〜3m(比 5〜10)。
  const W = H * (0.115 + rnd() * 0.045);
  const NS = detail > 0.5 ? 8 : 5;
  const lean = (rnd() - 0.5) * 0.05;
  const leanA = rnd() * TAU;
  const path = [], rad = [], sway = [];
  const col = o.foliage ?? [0.030, 0.058, 0.038];
  for (let i = 0; i < NS; i++) {
    const t = i / (NS - 1);
    // 紡錘。裾はすぼまり、上 3/4 で最大、梢で尖る。
    const w = W * Math.sin(Math.min(1, 0.18 + t * 1.02) * Math.PI * 0.92) ** 0.6;
    path.push([base[0] + Math.cos(leanA) * lean * t * t * H,
      base[1] + t * H,
      base[2] + Math.sin(leanA) * lean * t * t * H]);
    rad.push(Math.max(0.02, w * (0.86 + 0.28 * Math.sin(t * 7.3 + phase * 6))));
    // 梢だけがわずかに動く。松のように全体が振れてはいけない。
    sway.push(Math.pow(t, 4.0) * 0.30);
  }
  tube(B, path, rad, sway, detail > 0.5 ? 6 : 5, col, phase);
  // 縁を毛羽立たせる小さな房。輪郭が定規で引いた線にならないように。
  if (detail > 0.5) {
    const n = 5 + ((rnd() * 5) | 0);
    for (let k = 0; k < n; k++) {
      const t = 0.25 + rnd() * 0.72;
      const i = Math.min(NS - 1, Math.round(t * (NS - 1)));
      const a = rnd() * TAU;
      const at = [path[i][0] + Math.cos(a) * rad[i] * 0.9, path[i][1], path[i][2] + Math.sin(a) * rad[i] * 0.9];
      tuft(B, at, W * 0.5, 0.25, rnd, col, Math.pow(t, 4.0) * 0.30, phase + k * 0.29);
    }
  }
  return H;
}

/** オリーブ / 古い広葉。低く、二股に割れた幹。 */
export function olive(B, base, rnd, o = {}) {
  const H = o.h ?? (3.2 + rnd() * 2.2);
  const phase = rnd();
  const bark = [0.130, 0.118, 0.090];
  const col = o.foliage ?? [0.105, 0.125, 0.078];
  const nStem = 2 + (rnd() < 0.4 ? 1 : 0);
  for (let s = 0; s < nStem; s++) {
    const a = (s / nStem) * TAU + rnd() * 0.8;
    const tilt = 0.14 + rnd() * 0.22;
    const L = H * (0.42 + rnd() * 0.2);
    const p = [base, [base[0] + Math.cos(a) * L * tilt, base[1] + L, base[2] + Math.sin(a) * L * tilt]];
    tube(B, p, [H * 0.055, H * 0.030], [0, 0.2], 5, bark, phase + s * 0.3);
    const nT = 3 + ((rnd() * 3) | 0);
    for (let k = 0; k < nT; k++) {
      const at = [p[1][0] + (rnd() - 0.5) * H * 0.5, p[1][1] + rnd() * H * 0.42, p[1][2] + (rnd() - 0.5) * H * 0.5];
      tuft(B, at, H * 0.19, 0.55, rnd, col, 0.35 + rnd() * 0.4, phase + k * 0.4);
    }
  }
  return H;
}

/**
 * マキの低木。風に刈られた丸い塊。腰から胸の高さ。
 * スルジは森ではない — ここが緑の森になったら地理的に誤り。
 */
export function maquis(B, base, rnd, o = {}) {
  const H = o.h ?? (0.65 + rnd() * 1.05);
  const phase = rnd();
  const col = o.foliage ?? [0.088, 0.100, 0.062];
  // 房は小さく多く。大きな板を数枚置くと、乾いたマキではなく羊歯に見える。
  const n = 5 + ((rnd() * 5) | 0);
  for (let k = 0; k < n; k++) {
    const a = rnd() * TAU, r = rnd() * H * 0.62;
    const at = [base[0] + Math.cos(a) * r, base[1] + H * (0.22 + rnd() * 0.60), base[2] + Math.sin(a) * r];
    // 風に刈られた上面 — 板を寝かせ気味にすると、上が平らな塊になる。
    tuft(B, at, H * (0.30 + rnd() * 0.22), 0.80, rnd, col, 0.25 + rnd() * 0.3, phase + k * 0.31);
  }
  return H;
}

/**
 * 風。幹の根元は動かず、枝先ほど大きく、個体ごとに位相が違う。
 * 露出した島の木は町の木より速く大きく動く(uWind に差を付ける)。
 */
export function patchTreeWind(mat, { wind = 1.0, time = null } = {}) {
  const uT = time || { value: 0 };
  const uW = { value: wind };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uTreeT = uT;
    sh.uniforms.uTreeW = uW;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aSway; attribute float aPhase;
        uniform float uTreeT; uniform float uTreeW;
        varying float vLeaf;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLeaf = smoothstep(0.55, 0.95, aSway);
        {
          float ph = aPhase * 6.2831;
          // 二つの周期を重ねる。単一の正弦だと群れが一斉に振れて水面に見える。
          float s = sin(uTreeT * 0.85 + ph) * 0.65 + sin(uTreeT * 1.93 + ph * 2.7) * 0.35;
          float c = cos(uTreeT * 0.71 + ph * 1.4) * 0.7 + cos(uTreeT * 2.21 + ph * 0.6) * 0.3;
          float w = aSway * aSway * uTreeW;
          transformed.x += s * w;
          transformed.z += c * w * 0.8;
          transformed.y -= (abs(s) + abs(c)) * w * 0.12;   // 振れたぶんだけ縮む
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLeaf;')
      // 逆光の薄い葉は光を透かして暖かく光る。輪郭のレースはこれで生きる。
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // 葉の板は水平に寝ているので、空の環境光をまともに受ける。
        // 量を落とすだけでは足りなかった — 実測で **樹冠そのものの色相が 254°**
        // (空 257°・海 265°)、つまり「明るい水を背にした暗い木」ではなく
        // 「水の色を少し暗くした斑」になっていた。
        // 落とすと同時に、残った間接光から空の青を抜いて葉自身の色に染め直す。
        // (0.62, 1.00, 0.72) は松の葉の色比そのもの。
        {
          vec3 li = reflectedLight.indirectDiffuse;
          float lum = dot(li, vec3(0.2126, 0.7152, 0.0722));
          reflectedLight.indirectDiffuse =
            mix(li, vec3(lum) * vec3(0.62, 1.00, 0.72), vLeaf * 0.75) * mix(1.0, 0.30, vLeaf);
        }
        #if NUM_DIR_LIGHTS > 0
        {
          vec3 vd = normalize(-vViewPosition);
          float back = max(0.0, dot(vd, directionalLights[0].direction));
          // 透過は「薄い葉の縁がほのかに暖かく光る」程度。強くすると樹冠が
          // 白い紙吹雪になり、松ではなく桜に見える(実測で島が白く飛んだ)。
          // 房のアルベドを 2.4 倍にしたので、透過も同じだけ出る。係数を下げないと
          // t3gold で島が白く飛ぶ(コメントが記録している既知の失敗)。
          float tr = pow(back, 4.5) * vLeaf;
          reflectedLight.directDiffuse += directionalLights[0].color * tr * 0.20
            * mix(diffuseColor.rgb, vec3(0.46, 0.52, 0.26), 0.35);
        }
        #endif`);
  };
  mat.userData.treeTime = uT;
  mat.userData.treeWind = uW;
  return mat;
}
