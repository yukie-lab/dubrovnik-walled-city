// ============================================================================
// curbtest.mjs — 「舗装の帯の外に素地形が見えている」量を測る。
//
//   node tools/curbtest.mjs [--worst N]
//
// 街路の舗装は中心線から (w+0.9)/2 までしか張られない。立面がそれより外に
// 立つと、帯と壁の間に **素地形** が残る。市内の素地形は舗装より
// 0.16m 低く沈めてある(plan.landHeight: streetY − 0.16)ので、そこは必ず
// 段になり、帯は「宙に浮いた板」に見える。目で探さず、上から射線を落として
// 「見えている一番上の面」が地形か舗装かで数える。
//
// 出力: 露出面積(㎡)、段の分布、悪い場所の座標(そのまま shot.mjs に渡せる)。
// ============================================================================
import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import { collectObjects, buildTriangles, Grid, castDown, castRay } from './structure/geom.mjs';

const argN = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
};
const WORST = argN('--worst', 12);
const DS = 1.0;      // 中心線に沿う刻み
const DL = 0.15;     // 横方向の刻み
const OUT = argN('--out', 2.0);   // 帯の縁からどこまで外を見るか

const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const plan = w.plan;
const objects = collectObjects(w.root);
const { tris, owner } = buildTriangles(objects, { filter: (o) => !o.backdrop && !o.isPoints });
const grid = new Grid(tris, 4);
const FLOOR = /^(ground\.|steps$|wall\.curtain|surround\.|monument\.stone)/;
const isFloor = (oi) => FLOOR.test(objects[oi]?.tag || '');
const tagOf = (oi) => objects[oi]?.tag || '?';

// 家の footprint。屋根の下は見えないので数から外す。
const inHouse = (x, z) => {
  for (const h of plan.houses) {
    if (Math.abs(x - h.x) < h.w / 2 + 0.05 && Math.abs(z - h.z) < h.d / 2 + 0.05) return true;
  }
  return false;
};

/** (x, z) の 0.6m 以内に舗装の縦面(= 縁石)があるか。 */
function hasCurb(x, z) {
  for (const ti of grid.range(x - 0.6, z - 0.6, x + 0.6, z + 0.6)) {
    if (!/^ground\.(paving|stradun)$/.test(tagOf(owner[ti]))) continue;
    const t = grid.tris[ti];
    const ax = t[3] - t[0], ay = t[4] - t[1], az = t[5] - t[2];
    const bx = t[6] - t[0], by = t[7] - t[1], bz = t[8] - t[2];
    const ny = az * bx - ax * bz;
    const nl = Math.hypot(ay * bz - az * by, ny, ax * by - ay * bx) || 1;
    if (Math.abs(ny / nl) >= 0.5) continue;                 // 天端は縁石ではない
    const cxx = (t[0] + t[3] + t[6]) / 3, czz = (t[2] + t[5] + t[8]) / 3;
    if (Math.hypot(cxx - x, czz - z) < 0.6) return true;
  }
  return false;
}

const runs = [];          // 露出の帯(1 station × 1 側)
let areaExposed = 0, areaPaved = 0, hangLen = 0, hangDrop = 0, edgeLen = 0, openLen = 0, openDrop = 0;
for (const s of plan.streets) {
  const pts = s.pts;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const L = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / (L || 1), uz = (bz - az) / (L || 1);
    const nx = -uz, nz = ux;
    const n = Math.max(1, Math.round(L / DS));
    for (let k = 0; k <= n; k++) {
      const t = (k / n) * L;
      const cx = ax + ux * t, cz = az + uz * t;
      const yTop = plan.streetY(s, cx, cz) + 1.2;   // 庇・バルコニーの下から撃つ
      for (const sgn of [-1, 1]) {
        edgeLen += DS;
        // 帯の半幅は plan が唯一の真実。計器が自前に (w+0.9)/2 を決め打ちすると、
        // 帯を広げた瞬間に計器だけが古い縁を見る。
        // 中心線から少しだけ外した点で引く(側と弧長を plan に決めさせる)。
        const half = plan.paveHalfXZ
          ? plan.paveHalfXZ(s, cx + nx * 0.5 * sgn, cz + nz * 0.5 * sgn, null)
          : (s.w + 0.9) / 2;            // 帯を広げる前の版でも回せるように
        let len = 0, drop = 0, dropMax = 0, firstD = null, edgeHangs = false, first = true;
        // 立面までの実距離。家の footprint だけでは庭塀も記念建造物の張り出しも
        // 拾えない。腰の高さの射線で「最初に立っている面」まで測る。
        const hy = plan.streetY(s, cx, cz) + 0.8;
        const hit = castRay(grid, owner, cx, hy, cz, nx * sgn, 0, nz * sgn, 12,
          (oi) => !/^(life\.|ground\.|steps$)/.test(tagOf(oi)));
        const wallD = hit ? hit.dist : Infinity;
        // 縁石があるか。**射線では測らない** — 0.7m の射線は格子 1 セルしか
        // 辿らないので、縁がセル境界を跨いだ所で「縁石なし」と嘘をつく
        // (実測: 実際には在る縁石を 82 箇所ぶん見落とした)。
        // 縁の近くに舗装の **縦面** があるかを直接引く。
        const ex = cx + nx * half * sgn, ez = cz + nz * half * sgn;
        const curb = hasCurb(ex, ez);
        for (let d = half; d <= half + OUT + 1e-6; d += DL) {
          const px = cx + nx * d * sgn, pz = cz + nz * d * sgn;
          if (d > wallD) break;                       // 立面より外は見えない
          if (inHouse(px, pz)) break;                 // ここから外は屋根の下
          const top = castDown(grid, owner, px, pz, yTop, isFloor);
          if (!top) break;
          const tag = tagOf(top.obj);
          const cell = DS * DL;
          if (tag === 'ground.near') {
            const dy = plan.streetY(s, cx, cz) - top.y;
            if (first && dy >= 0.02) edgeHangs = true;   // 帯の縁そのものが宙に浮いている
            first = false;
            if (dy < 0.02) continue;                  // 段が無いなら板には見えない
            areaExposed += cell;
            len += DL; drop += dy * DL; dropMax = Math.max(dropMax, dy);
            if (firstD === null) firstD = d;
          } else {
            first = false;
            areaPaved += cell;
          }
        }
        if (len > 0.2) {
          runs.push({ id: s.id, kind: s.kind, x: cx + nx * (firstD + len / 2) * sgn,
            z: cz + nz * (firstD + len / 2) * sgn, cx, cz, len, drop: drop / len, dropMax,
            edgeHangs, wallD, curb: !!curb, score: len * (drop / len) });
        }
        if (edgeHangs) {
          hangLen += DS; hangDrop += DS * dropMax;
          if (!curb) { openLen += DS; openDrop += DS * dropMax; }
        }
      }
    }
  }
}

// --near x z r で場所を絞る(報告された視点の周りだけ見る)
const ni = process.argv.indexOf('--near');
const NEAR = ni >= 0 ? { x: Number(process.argv[ni + 1]), z: Number(process.argv[ni + 2]), r: Number(process.argv[ni + 3] || 20) } : null;
if (NEAR) {
  for (let i = runs.length - 1; i >= 0; i--) {
    if (Math.hypot(runs[i].x - NEAR.x, runs[i].z - NEAR.z) > NEAR.r) runs.splice(i, 1);
  }
}
runs.sort((a, b) => b.score - a.score);
const sum = (f) => runs.reduce((a, r) => a + f(r), 0);
console.log(`舗装の帯の外の素地形: ${areaExposed.toFixed(0)}㎡ (舗装で覆われた外側 ${areaPaved.toFixed(0)}㎡)`);
console.log(`**縁石の無い板の縁: ${openLen.toFixed(0)}m** (平均の段 ${(openDrop / Math.max(1e-6, openLen)).toFixed(3)}m)`);
console.log(`帯の縁が宙に浮いている長さ: ${hangLen.toFixed(0)}m / ${edgeLen.toFixed(0)}m (${(hangLen/edgeLen*100).toFixed(1)}%)  平均の段 ${(hangDrop/Math.max(1e-6,hangLen)).toFixed(3)}m`);
console.log(`露出した縁: ${runs.length} 箇所  平均の段 ${(sum(r => r.drop * r.len) / Math.max(1e-6, sum(r => r.len))).toFixed(3)}m  最大 ${Math.max(0, ...runs.map(r => r.dropMax)).toFixed(3)}m`);
const byKind = new Map();
for (const r of runs) {
  const q = byKind.get(r.kind) || { n: 0, area: 0, drop: 0 };
  q.n++; q.area += r.len * DS; q.drop = Math.max(q.drop, r.dropMax); byKind.set(r.kind, q);
}
for (const [kind, q] of [...byKind].sort((a, b) => b[1].area - a[1].area)) {
  console.log(`  ${kind.padEnd(8)} ${q.area.toFixed(0)}㎡  ${q.n} 箇所  最大の段 ${q.drop.toFixed(2)}m`);
}
const opens = runs.filter((r) => r.edgeHangs && !r.curb);
console.log(`\n縁石の無い縁 ${opens.length} 箇所(悪い順):`);
for (const r of opens.sort((a, b) => b.dropMax - a.dropMax).slice(0, WORST)) {
  console.log(`  ${r.id.padEnd(10)} @(${r.cx.toFixed(1)}, ${r.cz.toFixed(1)}) 縁 (${r.x.toFixed(1)}, ${r.z.toFixed(1)})  段 ${r.dropMax.toFixed(2)}m  立面まで ${Number.isFinite(r.wallD) ? r.wallD.toFixed(2) : '—'}`);
}
console.log('\n悪い順(x z 幅 段):');
for (const r of runs.slice(0, WORST)) {
  console.log(`  ${r.id.padEnd(10)} @(${r.x.toFixed(1)}, ${r.z.toFixed(1)})  ${r.curb ? '縁石あり' : '縁石なし'}  露出幅 ${r.len.toFixed(2)}m  段 ${r.drop.toFixed(2)}m (最大 ${r.dropMax.toFixed(2)})  立面まで ${Number.isFinite(r.wallD) ? r.wallD.toFixed(2) + 'm' : '12m 以内に無し'}`);
}
