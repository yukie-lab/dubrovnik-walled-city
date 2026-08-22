// ============================================================================
// geom.mjs — 幾何を「問い合わせられる形」にする。
//
//  collectObjects  シーンを歩き、InstancedMesh は 1 インスタンス = 1 オブジェクト
//                  に展開する。返るのは transform / 世界 AABB / 意味の札。
//  buildTriangles  世界座標の三角形配列(所有者 id つき)。
//  Grid            XZ の一様格子。三角形を格子に入れて、レイと点を秒で引く。
//  meshTopology    頂点を溶接して稜線を数える(閉じているか / 巻きが揃っているか)。
//
// 総当たりは禁止。三角形は 100 万本ある。
// ============================================================================
import * as THREE from 'three';
import { WELD_EPS } from './tolerances.mjs';

// ------------------------------------------------------------- 収集 ------
const _m4 = new THREE.Matrix4();
const _v = new THREE.Vector3();

/** 祖先を辿って由来グループ(world.js が付けた kind)を得る。 */
function kindOf(o) {
  for (let p = o; p; p = p.parent) if (p.userData && p.userData.kind) return p.userData.kind;
  return 'unknown';
}

/**
 * シーンの「置かれた物」を列挙する。
 * InstancedMesh は実インスタンスに展開する(1 本の柱が浮いていても判るように)。
 */
export function collectObjects(root) {
  root.updateMatrixWorld(true);
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh && !o.isPoints) return;
    const geo = o.geometry;
    if (!geo || !geo.attributes.position) return;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const kind = kindOf(o);
    const ud = o.userData || {};
    const base = {
      mesh: o, kind, tag: o.name || '(untagged)',
      solid: !!ud.solid, thin: !!ud.thin, terrain: !!ud.terrain,
      opening: !!ud.opening, noCollide: !!ud.noCollide, backdrop: !!ud.backdrop,
      groundContact: !!ud.groundContact, masonry: !!ud.masonry,
      buriedBase: !!ud.buriedBase, composite: ud.composite || null, standing: ud.standing || null,
      tileOverlap: !!ud.tileOverlap, decal: !!ud.decal,
      isPoints: !!o.isPoints,
    };
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, _m4);
        const world = new THREE.Matrix4().multiplyMatrices(o.matrixWorld, _m4);
        const box = geo.boundingBox.clone().applyMatrix4(world);
        out.push({ ...base, id: `${base.tag}#${i}`, instance: i, matrix: world, box });
      }
    } else {
      const box = geo.boundingBox.clone().applyMatrix4(o.matrixWorld);
      out.push({ ...base, id: base.tag, instance: -1, matrix: o.matrixWorld.clone(), box });
    }
  });
  return out;
}

// --------------------------------------------------------- 三角形 --------
/**
 * 世界座標の三角形。Float64Array に詰めて GC を避ける。
 * owner[i] は objects 配列の添字。
 */
export function buildTriangles(objects, { filter } = {}) {
  const tris = [];
  const owner = [];
  const v = new THREE.Vector3();
  for (let oi = 0; oi < objects.length; oi++) {
    const ob = objects[oi];
    if (ob.isPoints) continue;
    if (filter && !filter(ob)) continue;
    const geo = ob.mesh.geometry;
    const pos = geo.attributes.position;
    const idx = geo.index;
    const n = idx ? idx.count : pos.count;
    const m = ob.matrix;
    for (let i = 0; i + 2 < n; i += 3) {
      const t = new Float64Array(9);
      for (let k = 0; k < 3; k++) {
        const j = idx ? idx.getX(i + k) : i + k;
        v.set(pos.getX(j), pos.getY(j), pos.getZ(j)).applyMatrix4(m);
        t[k * 3] = v.x; t[k * 3 + 1] = v.y; t[k * 3 + 2] = v.z;
      }
      tris.push(t);
      owner.push(oi);
    }
  }
  return { tris, owner };
}

// ------------------------------------------------------------ 索引 ------
/** XZ の一様格子。三角形の AABB が跨る全セルに登録する。 */
export class Grid {
  constructor(tris, cell = 4) {
    this.cell = cell;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const x = t[k * 3], z = t[k * 3 + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
    }
    this.x0 = x0; this.z0 = z0;
    this.nx = Math.max(1, Math.ceil((x1 - x0) / cell) + 1);
    this.nz = Math.max(1, Math.ceil((z1 - z0) / cell) + 1);
    this.buckets = new Array(this.nx * this.nz);
    this.tris = tris;
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      const ax = Math.min(t[0], t[3], t[6]), bx = Math.max(t[0], t[3], t[6]);
      const az = Math.min(t[2], t[5], t[8]), bz = Math.max(t[2], t[5], t[8]);
      const i0 = this._ix(ax), i1 = this._ix(bx), j0 = this._iz(az), j1 = this._iz(bz);
      // 巨大な三角形(遠景の山・海)は数百セルに跨る。セル数で足切りすると
      // 索引から落ちて「床が無い」と誤判定するので、跨らせたまま入れる。
      for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
        const k = j * this.nx + ii;
        (this.buckets[k] || (this.buckets[k] = [])).push(i);
      }
    }
  }
  _ix(x) { return Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.x0) / this.cell))); }
  _iz(z) { return Math.max(0, Math.min(this.nz - 1, Math.floor((z - this.z0) / this.cell))); }
  at(x, z) { return this.buckets[this._iz(z) * this.nx + this._ix(x)] || EMPTY; }
  /** 矩形範囲の三角形添字(重複あり) */
  range(x0, z0, x1, z1) {
    const out = [];
    const a = this._ix(x0), b = this._ix(x1), c = this._iz(z0), d = this._iz(z1);
    for (let j = c; j <= d; j++) for (let i = a; i <= b; i++) {
      const k = this.buckets[j * this.nx + i];
      if (k) out.push(...k);
    }
    return out;
  }
}
const EMPTY = [];

// ------------------------------------------------------- レイ判定 -------
/** Möller–Trumbore。両面で当てる(裏向きの面も「そこに在る」)。 */
export function rayTri(ox, oy, oz, dx, dy, dz, t) {
  const e1x = t[3] - t[0], e1y = t[4] - t[1], e1z = t[5] - t[2];
  const e2x = t[6] - t[0], e2y = t[7] - t[1], e2z = t[8] - t[2];
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det;
  const tx = ox - t[0], ty = oy - t[1], tz = oz - t[2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const vv = (dx * qx + dy * qy + dz * qz) * inv;
  if (vv < -1e-9 || u + vv > 1 + 1e-9) return -1;
  const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return d > 1e-7 ? d : -1;
}

/** 真下へ撃つ。fromY より下でいちばん高い交点を返す。 */
export function castDown(grid, owner, x, z, fromY, accept) {
  const list = grid.at(x, z);
  let bestY = -Infinity, bestTri = -1;
  for (let k = 0; k < list.length; k++) {
    const ti = list[k];
    if (accept && !accept(owner[ti])) continue;
    const d = rayTri(x, fromY, z, 0, -1, 0, grid.tris[ti]);
    if (d < 0) continue;
    const y = fromY - d;
    if (y > bestY) { bestY = y; bestTri = ti; }
  }
  return bestTri < 0 ? null : { y: bestY, tri: bestTri, obj: owner[bestTri] };
}

/** 任意方向。最も近い交点。 */
export function castRay(grid, owner, ox, oy, oz, dx, dy, dz, maxDist, accept) {
  // 格子を DDA で辿る。XZ 平面上の進行だけを見る(高さは三角形側で処理)。
  const cell = grid.cell;
  let t = 0;
  let best = Infinity, bestTri = -1;
  const seen = new Set();
  const stepLen = cell * 0.5;
  const horiz = Math.hypot(dx, dz);
  const advance = horiz > 1e-6 ? stepLen / horiz : maxDist;
  while (t <= maxDist) {
    const x = ox + dx * t, z = oz + dz * t;
    const list = grid.at(x, z);
    for (let k = 0; k < list.length; k++) {
      const ti = list[k];
      if (seen.has(ti)) continue;
      seen.add(ti);
      if (accept && !accept(owner[ti])) continue;
      const d = rayTri(ox, oy, oz, dx, dy, dz, grid.tris[ti]);
      if (d >= 0 && d < best && d <= maxDist) { best = d; bestTri = ti; }
    }
    if (bestTri >= 0 && best < t) break;   // これ以上先に近い交点は無い
    t += advance;
  }
  return bestTri < 0 ? null : { dist: best, tri: bestTri, obj: owner[bestTri] };
}

// ---------------------------------------------------------- 位相 --------
/**
 * 頂点を溶接して稜線を数える。
 * 返り値: 稜線の使用回数分布・境界稜線(穴)・非多様体稜線・巻きの不一致・符号付き体積。
 */
/**
 * 位相の集計。ranges を渡すと、その三角形範囲だけを 1 つの立体として測る。
 * 「城壁が閉じていない」ではなく「城壁のどの作り方の塊が閉じていないか」を
 * 言えないと、人間は 1 万三角の中から穴を目で探すことになる。
 */
export function meshTopology(geo, matrix, ranges = null) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const nAll = idx ? idx.count : pos.count;
  const keepTri = ranges
    ? (f) => { for (const r of ranges) if (f >= r.from && f < r.to) return true; return false; }
    : null;
  const n = nAll;
  const q = 1 / WELD_EPS;
  const key = new Map();          // 量子化座標 → 代表 id
  const rep = new Int32Array(n);
  const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n);
  const v = new THREE.Vector3();
  let nRep = 0;
  const repPos = [];
  for (let i = 0; i < n; i++) {
    const j = idx ? idx.getX(i) : i;
    v.set(pos.getX(j), pos.getY(j), pos.getZ(j));
    if (matrix) v.applyMatrix4(matrix);
    px[i] = v.x; py[i] = v.y; pz[i] = v.z;
    const k = `${Math.round(v.x * q)},${Math.round(v.y * q)},${Math.round(v.z * q)}`;
    let r = key.get(k);
    if (r === undefined) { r = nRep++; key.set(k, r); repPos.push([v.x, v.y, v.z]); }
    rep[i] = r;
  }
  // 稜線を「向き付き」で数える。閉じた立体では、各無向稜線が
  // 正逆 1 回ずつ現れる。同じ向きが 2 回出たら巻きが裏返っている。
  const dir = new Map();          // "a,b" → 回数
  const und = new Map();          // "min,max" → 回数
  let degenerate = 0;
  let vol = 0;
  const triCount = Math.floor(n / 3);
  let triUsed = 0;
  for (let f = 0; f < triCount; f++) {
    if (keepTri && !keepTri(f)) continue;
    triUsed++;
    const a = rep[f * 3], b = rep[f * 3 + 1], c = rep[f * 3 + 2];
    if (a === b || b === c || c === a) { degenerate++; continue; }
    for (const [u, w] of [[a, b], [b, c], [c, a]]) {
      dir.set(`${u},${w}`, (dir.get(`${u},${w}`) || 0) + 1);
      const lo = Math.min(u, w), hi = Math.max(u, w);
      und.set(`${lo},${hi}`, (und.get(`${lo},${hi}`) || 0) + 1);
    }
    // 符号付き体積(原点との四面体の総和)
    const ax = px[f * 3], ay = py[f * 3], az = pz[f * 3];
    const bx = px[f * 3 + 1], by = py[f * 3 + 1], bz = pz[f * 3 + 1];
    const cx = px[f * 3 + 2], cy = py[f * 3 + 2], cz = pz[f * 3 + 2];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  const boundary = [];            // 1 面しか使っていない稜線 = 穴
  const nonManifold = [];         // 3 面以上
  for (const [k, c] of und) {
    if (c === 1) boundary.push(k);
    else if (c > 2) nonManifold.push(k);
  }
  // 巻きの裏返りは「同じ向きが 2 回」ではなく「正逆の数が釣り合わない」こと。
  // 閉じた立体を二つ重ねると各稜線は正逆 2 回ずつ出る — これは重複であって
  // 裏返りではない。前者で数えていたので、塔の胴と王冠が接する所の 944 本が
  // 「面の巻きが裏返っている」と報告され、直しようのない指摘になっていた。
  // 境界稜線(1 面しか使っていない)は必ず不釣り合いになる。既に「穴」として
  // 報告しているものを「裏返り」としても数えると、同じ 1 件が二重に鳴る。
  let flipped = 0;
  for (const [k, c] of und) {
    if (c < 2) continue;
    const [lo, hi] = k.split(',');
    if ((dir.get(`${lo},${hi}`) || 0) !== (dir.get(`${hi},${lo}`) || 0)) flipped++;
  }
  const posOf = (k) => {
    const [a, b] = k.split(',').map(Number);
    const p = repPos[a], q2 = repPos[b];
    return [(p[0] + q2[0]) / 2, (p[1] + q2[1]) / 2, (p[2] + q2[2]) / 2];
  };
  return {
    triCount: ranges ? triUsed : triCount, vertCount: nRep, degenerate,
    boundaryEdges: boundary.length, nonManifoldEdges: nonManifold.length,
    flippedEdges: flipped, volume: vol,
    boundarySample: boundary.slice(0, 24).map(posOf),
    nonManifoldSample: nonManifold.slice(0, 12).map(posOf),
  };
}

/** 三角形の面法線(正規化済み) */
export function triNormal(t) {
  const ax = t[3] - t[0], ay = t[4] - t[1], az = t[5] - t[2];
  const bx = t[6] - t[0], by = t[7] - t[1], bz = t[8] - t[2];
  const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const L = Math.hypot(nx, ny, nz) || 1;
  return [nx / L, ny / L, nz / L];
}

export function triCentroid(t) {
  return [(t[0] + t[3] + t[6]) / 3, (t[1] + t[4] + t[7]) / 3, (t[2] + t[5] + t[8]) / 3];
}

export function boxOverlap(a, b, eps = 0) {
  return a.min.x - eps < b.max.x && a.max.x + eps > b.min.x
    && a.min.y - eps < b.max.y && a.max.y + eps > b.min.y
    && a.min.z - eps < b.max.z && a.max.z + eps > b.min.z;
}
