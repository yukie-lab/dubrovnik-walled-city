// ============================================================================
// clothtest.mjs — 洗濯物どうしが突き抜けていないかを、実三角形で数える。
//
//   node tools/clothtest.mjs [--samples 48] [--period 24] [--near x z r]
//
// 布は InstancedMesh + 頂点シェーダで揺れる。**撮影モードは elapsed 固定**
// なので、静止画では揺れによる貫通が出ない。ここではシェーダと同じ式を
// CPU で回し、時間を掃きながら隣の布との交差を数える。
//
// 出す数字:
//   ・静止時の食い込み — ロープに沿った中心間距離 と 幅の和/2 の差
//   ・揺れを含めた交差 — 時間標本のうち三角形が実際に交差した割合
// ============================================================================
import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import * as THREE from 'three';
import { rayTri } from './structure/geom.mjs';

const argN = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
};
const SAMPLES = argN('--samples', 48);
const PERIOD = argN('--period', 24);      // 秒。位相がばらけるので長めに掃く
const ni = process.argv.indexOf('--near');
const NEAR = ni >= 0
  ? { x: Number(process.argv[ni + 1]), z: Number(process.argv[ni + 2]), r: Number(process.argv[ni + 3] || 20) }
  : null;
const WORST = argN('--worst', 12);

const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
let mesh = null;
w.root.traverse((o) => { if (o.name === 'life.laundryCloth') mesh = o; });
if (!mesh) { console.error('life.laundryCloth が無い'); process.exit(1); }

const geo = mesh.geometry;
const pos = geo.attributes.position, idx = geo.index;
const phaseAttr = geo.attributes.aPhase;
const N = mesh.count;
const mats = [];
const _m = new THREE.Matrix4();
for (let i = 0; i < N; i++) { mesh.getMatrixAt(i, _m); mats.push(_m.clone()); }

// 布 1 枚の世界三角形。シェーダ(life.js の onBeforeCompile)と同じ式。
const _v = new THREE.Vector3();
function trisOf(i, t) {
  const ph = phaseAttr.getX(i);
  const sway = Math.sin(t * (1.1 + (ph - Math.floor(ph)) * 0.8) + ph * 7.0);
  const m = mats[i];
  const vs = [];
  for (let k = 0; k < pos.count; k++) {
    const y = pos.getY(k), hang = -y;
    _v.set(pos.getX(k) + sway * hang * 0.05, y, pos.getZ(k) + sway * hang * 0.16);
    _v.applyMatrix4(m);
    vs.push(_v.x, _v.y, _v.z);
  }
  const out = [];
  const n = idx ? idx.count : pos.count;
  for (let k = 0; k + 2 < n; k += 3) {
    const a = idx ? idx.getX(k) : k, b = idx ? idx.getX(k + 1) : k + 1, c = idx ? idx.getX(k + 2) : k + 2;
    out.push(new Float64Array([vs[a * 3], vs[a * 3 + 1], vs[a * 3 + 2],
      vs[b * 3], vs[b * 3 + 1], vs[b * 3 + 2], vs[c * 3], vs[c * 3 + 1], vs[c * 3 + 2]]));
  }
  return out;
}

/** 辺が三角形を貫くか(両向きに見る)。布は薄い面なので辺 × 面で足りる。 */
function crosses(A, B) {
  for (const [P, Q] of [[A, B], [B, A]]) {
    for (const t of P) {
      for (let e = 0; e < 3; e++) {
        const ox = t[e * 3], oy = t[e * 3 + 1], oz = t[e * 3 + 2];
        const f = (e + 1) % 3;
        let dx = t[f * 3] - ox, dy = t[f * 3 + 1] - oy, dz = t[f * 3 + 2] - oz;
        const L = Math.hypot(dx, dy, dz); if (L < 1e-9) continue;
        dx /= L; dy /= L; dz /= L;
        for (const u of Q) {
          const d = rayTri(ox, oy, oz, dx, dy, dz, u);
          if (d > 1e-6 && d < L - 1e-6) return true;
        }
      }
    }
  }
  return false;
}

// 世界中心と、静止時(t=0 の位相ゼロ相当)の寸法・向き
const info = [];
for (let i = 0; i < N; i++) {
  const m = mats[i].elements;
  const cx = m[12], cy = m[13], cz = m[14];
  if (cx === 0 && cy === 0 && cz === 0) continue;                 // 潰されたインスタンス
  const sx = Math.hypot(m[0], m[1], m[2]);                        // 幅
  const sy = Math.hypot(m[4], m[5], m[6]);                        // 丈
  // 幅方向の世界ベクトル(ロープに沿う向き)
  const ux = m[0] / sx, uz = m[2] / sx;
  info.push({ i, x: cx, y: cy, z: cz, w: sx, h: sy, ux, uz });
}

// 近い組だけ見る(布は 6.5cm 角の格子に散らばっている)
const CELL = 2.0;
const grid = new Map();
const key = (a, b, c) => `${a}:${b}:${c}`;
for (const q of info) {
  const k = key(Math.floor(q.x / CELL), Math.floor(q.y / CELL), Math.floor(q.z / CELL));
  (grid.get(k) || grid.set(k, []).get(k)).push(q);
}
const pairs = [];
const seen = new Set();
for (const q of info) {
  const gx = Math.floor(q.x / CELL), gy = Math.floor(q.y / CELL), gz = Math.floor(q.z / CELL);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    for (const r of grid.get(key(gx + a, gy + b, gz + c)) || []) {
      if (r.i <= q.i) continue;
      const d = Math.hypot(r.x - q.x, r.y - q.y, r.z - q.z);
      if (d > 1.8) continue;
      const kk = q.i + ',' + r.i;
      if (seen.has(kk)) continue;
      seen.add(kk);
      pairs.push([q, r]);
    }
  }
}

if (NEAR) {
  for (let i = pairs.length - 1; i >= 0; i--) {
    const [q] = pairs[i];
    if (Math.hypot(q.x - NEAR.x, q.z - NEAR.z) > NEAR.r) pairs.splice(i, 1);
  }
}

const rows = [];
let hitPairs = 0, hitSamples = 0, totalSamples = 0, staticOverlap = 0;
for (const [q, r] of pairs) {
  // 静止の食い込み: ロープに沿った中心間距離 と 幅の和/2
  const along = Math.abs((r.x - q.x) * q.ux + (r.z - q.z) * q.uz);
  const need = (q.w + r.w) / 2;
  const gap = along - need;
  if (gap < 0) staticOverlap++;
  let hits = 0;
  for (let s = 0; s < SAMPLES; s++) {
    const t = (s / SAMPLES) * PERIOD;
    totalSamples++;
    if (crosses(trisOf(q.i, t), trisOf(r.i, t))) { hits++; hitSamples++; }
  }
  if (hits) hitPairs++;
  if (hits || gap < 0) {
    rows.push({ x: q.x, y: q.y, z: q.z, gap, hits, frac: hits / SAMPLES,
      a: q.i, b: r.i, wq: q.w, wr: r.w, along });
  }
}

rows.sort((a, b) => b.frac - a.frac || a.gap - b.gap);
console.log(`布 ${info.length} 枚 / 隣り合う組 ${pairs.length}`);
console.log(`**揺れて突き抜ける組: ${hitPairs} / ${pairs.length} (${(100 * hitPairs / Math.max(1, pairs.length)).toFixed(1)}%)**`
  + `  時間標本での交差率 ${(100 * hitSamples / Math.max(1, totalSamples)).toFixed(1)}%`);
console.log(`静止でも重なっている組: ${staticOverlap} (${(100 * staticOverlap / Math.max(1, pairs.length)).toFixed(1)}%)`);
console.log('\n悪い順(位置 / 隙間 / 交差した時間の割合):');
for (const r of rows.slice(0, WORST)) {
  console.log(`  @(${r.x.toFixed(1)}, ${r.y.toFixed(1)}, ${r.z.toFixed(1)})  `
    + `幅 ${r.wq.toFixed(2)}+${r.wr.toFixed(2)}  中心間 ${r.along.toFixed(2)}m  隙間 ${r.gap.toFixed(2)}m  `
    + `交差 ${(100 * r.frac).toFixed(0)}%`);
}
