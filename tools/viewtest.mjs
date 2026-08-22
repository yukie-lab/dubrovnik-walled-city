// ============================================================================
// viewtest.mjs — 「高い所から海を眺められる場所」を実測で探す。
//
//   node tools/viewtest.mjs [--minY 12] [--step 2.5] [--top 12]
//
// 目の高さから水平まわりに射線を撃ち、**最初に当たるのが海(または何にも
// 当たらず水平線の先)** の割合を数える。石に当たったら遮られている。
//
// 「眺めがいい」を主観で言わないための計器。ミンチェタの天板のように、
// 高くても自分の胸壁と塔体が視界の大半を塞ぐ場所がある。
//
// 行ける場所しか候補にしない — trapstest と同じ規則で到達可能性を確かめる。
// ============================================================================
import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import { collectObjects, buildTriangles, Grid, castRay } from './structure/geom.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : Number(argv[i + 1]); };
const MINY = flag('--minY', 12);
const STEP = flag('--step', 2.5);
const TOP = flag('--top', 12);
const EYE = 1.62;
const CLIMB = 0.55, PUSH = 0.42;

const { buildWorld } = await import('../src/world.js');
const world = buildWorld({});
const plan = world.plan;
const objects = collectObjects(world.root);
// 遠景(対岸の山・ロヴリイェナツ・ロクルム)も視界を塞ぐ。backdrop を
// 除いて測ると、そちらを向いた場所の海率を過大評価する
// (北西の歩廊で 19.4% → 実際は 7.6% だった)。見えるものは全部当てる。
const { tris, owner } = buildTriangles(objects, { filter: (o) => !o.isPoints });
const grid = new Grid(tris, 4);
// 射線は海にも当たらないといけない。accept で海を弾くと、海を突き抜けて
// 「何にも当たらなかった = 空」になり、海率が全点 0 になる(実測でそうなった)。
// 当てる対象には海を含め、当たった物の名前で分類する。
const HIT = (oi) => {
  const t = objects[oi]?.tag || '';
  return !/^(sky\.|life\.(swift|gull|bird|pigeon)|.*Pool$|.*Ripple$|.*shadow.*)/.test(t);
};
const isSea = (oi) => /^sea\./.test(objects[oi]?.tag || '');

// ---- 到達できる場所(trapstest と同じ規則) --------------------------------
const X0 = -190, X1 = 235, Z0 = -105, Z1 = 115;
const NX = Math.ceil((X1 - X0) / STEP), NZ = Math.ceil((Z1 - Z0) / STEP);
const px = (i) => X0 + i * STEP, pz = (j) => Z0 + j * STEP;
const id = (i, j) => j * NX + i;
const SEED = [-150, 3];
const yOf = new Float64Array(NX * NZ).fill(NaN);
const seen = new Uint8Array(NX * NZ);
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const stepTo = (bx, bz, ya, dist) => {
  const c = plan.collide(bx, bz, 0.4, ya + 1.0);
  if (Math.hypot(c.x - bx, c.z - bz) > PUSH) return null;
  const g = plan.groundAt(c.x, c.z, ya);
  if (!g || g.y === undefined) return null;
  if (g.y - ya > Math.max(CLIMB, 0.75 * dist)) return null;
  return g.y;
};
{
  // 種は門の内側だけでは足りない。格子の一歩(2〜3m)は階段の踏面より粗く、
  // 城壁の歩廊まで登れないまま終わる(実測 高さ 12m 以上が 681 点しか出ず、
  // 歩廊が 1 点も入っていなかった)。歩廊は walktest が到達を証明済みなので、
  // 折れ線の節からも種を蒔く。
  let q = [];
  const seed = (x, z, y) => {
    const i = Math.round((x - X0) / STEP), j = Math.round((z - Z0) / STEP);
    if (i < 0 || i >= NX || j < 0 || j >= NZ) return;
    const k = id(i, j);
    // 同じ (x,z) に床が二層あるとき(要塞の天端 14.6m とその上の砲座 17.4m)、
    // 先に低い方を塗ると高い方へ二度と来られない。種は高い方を優先する。
    if (seen[k] && !(y > yOf[k] + 0.2)) return;
    seen[k] = 1; yOf[k] = y; q.push(k);
  };
  seed(SEED[0], SEED[1], plan.groundAt(SEED[0], SEED[1], 3).y);
  for (const p2 of plan.wallPts) {
    const e = plan.deckEdgeAt(p2[0], p2[1]);
    seed(p2[0], p2[1], plan.wallWalkYAt(e.nw));
  }
  for (const [nm, t] of Object.entries(plan.TOWERS)) seed(t.x, t.z, t.topY);
  // 多層の床は (x,z) だけの既訪では拾えない。要塞の天端(14.6m)を先に塗って
  // しまうと、その上の砲座(17.4m)へ二度目に来られない。上層からも種を蒔く。
  if (plan.CAVALIER) seed(plan.CAVALIER.x, plan.CAVALIER.z, plan.CAVALIER.y);
  while (q.length) {
    const nx2 = [];
    for (const a of q) {
      const i = a % NX, j = (a - i) / NX, ya = yOf[a];
      for (const [di, dj] of DIRS) {
        const i2 = i + di, j2 = j + dj;
        if (i2 < 0 || i2 >= NX || j2 < 0 || j2 >= NZ) continue;
        const b = id(i2, j2);
        if (seen[b]) continue;
        const yb = stepTo(px(i2), pz(j2), ya, Math.hypot(di, dj) * STEP);
        if (yb === null) continue;
        seen[b] = 1; yOf[b] = yb; nx2.push(b);
      }
    }
    q = nx2;
  }
}

// ---- 眺めを測る ------------------------------------------------------------
const AZ = 36, ELS = [-0.14, -0.06, 0.02, 0.10];   // 方位 36 本 × 仰角 4 段
const FAR = 900;
function viewAt(x, y, z) {
  let sea = 0, sky = 0, near = 0;
  const seaA = new Array(AZ).fill(0), nearA = new Array(AZ).fill(0);
  for (let a = 0; a < AZ; a++) {
    const th = (a / AZ) * Math.PI * 2;
    for (const el of ELS) {
      const dx = Math.cos(th) * Math.cos(el), dy = Math.sin(el), dz = Math.sin(th) * Math.cos(el);
      const h = castRay(grid, owner, x, y, z, dx, dy, dz, FAR, HIT);
      if (!h) { sky++; seaA[a]++; continue; }            // 何にも当たらない = 空/水平線
      if (isSea(h.obj)) { sea++; seaA[a]++; continue; }
      if (h.dist < 22) { near++; nearA[a]++; }           // 目の前を塞ぐ物
    }
  }
  const tot = AZ * ELS.length;
  // 「海を眺める」ときに効くのは正面 180° だけ。背後の要塞や山を減点すると、
  // 実際には申し分ない場所が沈む(岩の天端がそうだった)。
  // 海がいちばん見える半円を探して、その中の遮りを別に数える。
  const HALF = AZ / 2;
  let bestA = 0, bestSea = -1;
  for (let a = 0; a < AZ; a++) {
    let s2 = 0;
    for (let k = -HALF / 2; k < HALF / 2; k++) s2 += seaA[(a + k + AZ) % AZ];
    if (s2 > bestSea) { bestSea = s2; bestA = a; }
  }
  let nf = 0;
  for (let k = -HALF / 2; k < HALF / 2; k++) nf += nearA[(bestA + k + AZ) % AZ];
  return { open: (sea + sky) / tot, sea: sea / tot, near: near / tot,
    seaFront: bestSea / (HALF * ELS.length), nearFront: nf / (HALF * ELS.length),
    facing: (bestA / AZ) * 360 };
}

const cands = [];
for (let k = 0; k < NX * NZ; k++) {
  if (!seen[k] || !(yOf[k] >= MINY)) continue;
  const i = k % NX, j = (k - i) / NX;
  cands.push({ x: px(i), z: pz(j), y: yOf[k] });
}
for (const c of cands) Object.assign(c, viewAt(c.x, c.y + EYE, c.z));

// 並べ替え。既定は「海がよく見える順」。--clear を付けると
// 「手前を塞ぐ物が少ない順」— 「視界を邪魔する物がない場所」を探すとき用。
if (argv.includes('--clear')) cands.sort((a, b) => (a.near - b.near) || (b.sea - a.sea) || (b.y - a.y));
else cands.sort((a, b) => (b.sea - a.sea) || (b.open - a.open) || (b.y - a.y));

// 近い点は同じ場所。8m 以内はまとめる。
const picked = [];
for (const c of cands) {
  if (picked.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 9)) continue;
  picked.push(c);
  if (picked.length >= TOP) break;
}

const zoneOf = (c) => (plan.groundAt(c.x, c.z, c.y).zone || '?');
const C = { grn: '\x1b[32m', dim: '\x1b[2m', off: '\x1b[0m', bold: '\x1b[1m' };
console.log(`\n${C.bold}高さ ${MINY}m 以上で行ける ${cands.length} 点を測った${C.off}`
  + `  ${C.dim}(方位 ${AZ} × 仰角 ${ELS.length} = ${AZ * ELS.length} 射線/点)${C.off}`);
console.log(`${C.dim}海率 = 射線の先が海だった割合。空率は水平線の先(遠景の空)も含む。`
  + `\n手前 = 22m 以内の石に当たった割合 = 視界のすぐ前を塞ぐ物${C.off}\n`);
console.log('   海率  正面海  正面手前  手前  高さ    位置             層');
for (const c of picked) {
  console.log(`  ${(c.sea * 100).toFixed(1).padStart(5)}%  ${(c.seaFront * 100).toFixed(0).padStart(4)}%`
    + `   ${(c.nearFront * 100).toFixed(0).padStart(5)}%  ${(c.near * 100).toFixed(0).padStart(4)}%`
    + `  ${c.y.toFixed(1).padStart(5)}m  (${c.x.toFixed(0).padStart(5)}, ${c.z.toFixed(0).padStart(5)})  ${zoneOf(c)}`);
}
// 比較のために名指しの場所も出す
const named = [
  ['見晴らしの砲座', 177, 57],
  ['ロヴリイェナツの岩', -248, 95],
  ['ミンチェタ天板', -122, -82],
  ['ミンチェタ胸壁ぎわ', -116.5, -76],
  ['ボカール', -122, 80],
  ['聖イヴァン', 172, 54],
  ['北東の塔', 148, -62],
];
console.log(`\n${C.dim}名前のある高所(比較)${C.off}`);
for (const [nm, x, z] of named) {
  const g = plan.groundAt(x, z, 40);
  const v = viewAt(x, g.y + EYE, z);
  console.log(`  ${(v.sea * 100).toFixed(1).padStart(5)}%  ${(v.seaFront * 100).toFixed(0).padStart(4)}%`
    + `   ${(v.nearFront * 100).toFixed(0).padStart(5)}%  ${(v.near * 100).toFixed(0).padStart(4)}%`
    + `  ${g.y.toFixed(1).padStart(5)}m  ${nm}`);
}
