// 汎用: シード乱数・数学ヘルパー。街は毎回同じでなければならない(シード固定)。
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 座標→決定的ハッシュ(0..1)。インスタンス色のばらつき等に使う。
export function hash2(x, y) {
  let h = Math.imul(x * 374761393 + y * 668265263, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 972663749);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

// 多角形の内外判定
export function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// 値ノイズ(地形の揺らぎ用)
export const vnoise = (x, z) => {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = x - xi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  return lerp(
    lerp(hash2(xi, zi), hash2(xi + 1, zi), sx),
    lerp(hash2(xi, zi + 1), hash2(xi + 1, zi + 1), sx), sz);
};
export const fbm2 = (x, z) => vnoise(x, z) * 0.6 + vnoise(x * 2.3 + 5, z * 2.3 + 9) * 0.4;

// 折れ線ユーティリティ(城壁回廊・街路で多用)
export function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

// 折れ線上の弧長 s の点と接線を返す(pts: [x,z,(y)])
export function samplePolyline(pts, s) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1];
    const seg = Math.hypot(dx, dz);
    if (acc + seg >= s || i === pts.length - 1) {
      const t = clamp((s - acc) / seg, 0, 1);
      const x = pts[i - 1][0] + dx * t, z = pts[i - 1][1] + dz * t;
      const y = pts[i - 1][2] !== undefined ? lerp(pts[i - 1][2], pts[i][2], t) : 0;
      return { x, z, y, tx: dx / seg, tz: dz / seg, i };
    }
    acc += seg;
  }
  return null;
}

// 点から折れ線への最近接(距離・弧長・補間y・接線)
export function nearestOnPolyline(pts, px, pz) {
  let best = { d2: Infinity, s: 0, x: 0, z: 0, y: 0, tx: 1, tz: 0, i: 0 };
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0], az = pts[i - 1][1];
    const dx = pts[i][0] - ax, dz = pts[i][1] - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / len2, 0, 1) : 0;
    const x = ax + dx * t, z = az + dz * t;
    const d2 = (px - x) * (px - x) + (pz - z) * (pz - z);
    const seg = Math.sqrt(len2);
    if (d2 < best.d2) {
      const y = pts[i - 1][2] !== undefined ? lerp(pts[i - 1][2], pts[i][2], t) : 0;
      best = { d2, s: acc + seg * t, x, z, y, tx: dx / seg, tz: dz / seg, i };
    }
    acc += seg;
  }
  best.d = Math.sqrt(best.d2);
  return best;
}

// ---- 意味の札 ------------------------------------------------------------
// 検証(tools/structure)は「これは何か」を推測してはいけない。生成した側が
// 宣言する。solid = 閉じた立体であるべき石、thin = 本当に薄い面(布・葉)、
// ground = 地形そのもの、opening = 開口(ここからは空が見えてよい)。
export function tagMesh(obj, name, data = {}) {
  obj.name = name;
  Object.assign(obj.userData, data);
  return obj;
}
