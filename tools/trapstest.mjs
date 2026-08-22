// ============================================================================
// trapstest.mjs — 「入れるのに戻れない場所」を探す。
//
//   node tools/trapstest.mjs [--step 1.5] [--all]
//
// 街を格子に切り、ゲームと同じ規則(plan.collide + plan.groundAt + 登れる段差)
// で **有向グラフ** を作る。落下は一方通行なので、行ける先から戻れるとは限らない。
// 出発点から到達できるが出発点へ戻れない格子 = 袋小路 = 閉じ込められる場所。
//
// 「どこにも行けない」より「入れてしまうのに出られない」ほうが致命的で、
// しかも歩行網スキャン(街路の上だけを見る)では絶対に見つからない。
// ============================================================================
import { installDomShim } from './structure/domshim.mjs';
installDomShim();

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : Number(argv[i + 1]); };
const STEP = flag('--step', 1.5);
const CLIMB = 0.55;      // 登れる段差(ゲームと同じ)
const PUSH = 0.42;       // collide がこれ以上押し戻すなら「入れない」

const { buildWorld } = await import('../src/world.js');
const plan = buildWorld({}).plan;

const X0 = -190, X1 = 235, Z0 = -105, Z1 = 115;
const NX = Math.ceil((X1 - X0) / STEP), NZ = Math.ceil((Z1 - Z0) / STEP);
const px = (i) => X0 + i * STEP, pz = (j) => Z0 + j * STEP;
const id = (i, j) => j * NX + i;

// 出発点(ゲームと同じピレ門の内側)
const SEED = [-150, 3];
const seedG = plan.groundAt(SEED[0], SEED[1], 3.0);
const yOf = new Float64Array(NX * NZ).fill(NaN);

// A(高さ ya)から B へ移れるか。移れるなら B の床の高さを返す。
// 格子の一歩は実際の移動より粗い。段差の上限をそのまま当てると、
// 勾配のある地面が「下れるが登れない」と誤判定される(2m 格子で 15 箇所出た)。
// 実際は細かく刻んで歩くので、坂は勾配で効く。段差 0.55m か勾配 0.75 の
// 大きいほうを許す — 崖(0.8m で 5m 落ちる)は依然として捕まる。
const stepTo = (bx, bz, ya, dist) => {
  const c = plan.collide(bx, bz, 0.4, ya + 1.0);
  if (Math.hypot(c.x - bx, c.z - bz) > PUSH) return null;   // 石に阻まれる
  // 床は「押し返された先」で問う。要求した点で問うと、collide が押し出して
  // 安全な所へ戻しているのに「危険な床に立てる」と数えてしまう。
  const g = plan.groundAt(c.x, c.z, ya);
  if (!g || g.y === undefined) return null;
  if (g.y - ya > Math.max(CLIMB, 0.75 * dist)) return null; // 登れない
  return g.y;
};

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const fwd = new Uint8Array(NX * NZ);
const start = id(Math.round((SEED[0] - X0) / STEP), Math.round((SEED[1] - Z0) / STEP));
yOf[start] = seedG.y; fwd[start] = 1;
const edges = [];             // [from, to] — 逆向き探索に使う
let queue = [start];
while (queue.length) {
  const next = [];
  for (const a of queue) {
    const i = a % NX, j = (a - i) / NX, ya = yOf[a];
    for (const [di, dj] of DIRS) {
      const i2 = i + di, j2 = j + dj;
      if (i2 < 0 || i2 >= NX || j2 < 0 || j2 >= NZ) continue;
      const b = id(i2, j2);
      const yb = stepTo(px(i2), pz(j2), ya, Math.hypot(di, dj) * STEP);
      if (yb === null) continue;
      edges.push(a, b);
      if (fwd[b]) continue;
      fwd[b] = 1; yOf[b] = yb; next.push(b);
    }
  }
  queue = next;
}

// 逆向き到達(出発点へ帰れるか)
const rev = new Map();
for (let k = 0; k < edges.length; k += 2) {
  const a = edges[k], b = edges[k + 1];
  if (!rev.has(b)) rev.set(b, []);
  rev.get(b).push(a);
}
const back = new Uint8Array(NX * NZ);
back[start] = 1;
queue = [start];
while (queue.length) {
  const next = [];
  for (const b of queue) for (const a of rev.get(b) || []) {
    if (back[a]) continue; back[a] = 1; next.push(a);
  }
  queue = next;
}

// 閉じ込められる格子を塊にまとめる
const trap = [];
for (let k = 0; k < NX * NZ; k++) if (fwd[k] && !back[k]) trap.push(k);
const seen = new Set(), blobs = [];
for (const k of trap) {
  if (seen.has(k)) continue;
  const st = [k]; seen.add(k);
  const cells = [];
  while (st.length) {
    const c = st.pop(); cells.push(c);
    const i = c % NX, j = (c - i) / NX;
    for (const [di, dj] of DIRS) {
      const i2 = i + di, j2 = j + dj;
      if (i2 < 0 || i2 >= NX || j2 < 0 || j2 >= NZ) continue;
      const b = id(i2, j2);
      if (fwd[b] && !back[b] && !seen.has(b)) { seen.add(b); st.push(b); }
    }
  }
  // 入口 — 「帰れる場所」から罠へ渡る辺。ここに欄干を立てれば閉じない。
  const inSet = new Set(cells);
  let door = null;
  for (let e = 0; e < edges.length; e += 2) {
    const a = edges[e], b = edges[e + 1];
    if (!back[a] || !inSet.has(b)) continue;
    door = { fx: px(a % NX), fz: pz((a - a % NX) / NX), fy: yOf[a],
      tx: px(b % NX), tz: pz((b - b % NX) / NX), ty: yOf[b] };
    break;
  }
  const ys = cells.map((c) => yOf[c]);
  blobs.push({ door,
    n: cells.length,
    x: cells.reduce((s, c) => s + px(c % NX), 0) / cells.length,
    z: cells.reduce((s, c) => s + pz((c - c % NX) / NX), 0) / cells.length,
    yMin: Math.min(...ys), yMax: Math.max(...ys) });
}
blobs.sort((a, b) => b.n - a.n);

const C = { red: '\x1b[31m', grn: '\x1b[32m', dim: '\x1b[2m', off: '\x1b[0m' };
const reach = trap.length + [...fwd].filter(Boolean).length - trap.length;
console.log(`\n格子 ${STEP}m — 到達 ${[...fwd].filter(Boolean).length} マス / 帰れない ${trap.length} マス`);
const show = argv.includes('--all') ? blobs : blobs.slice(0, 12);
for (const b of show) {
  console.log(`  ${C.red}${String(b.n).padStart(4)} マス${C.off}`
    + ` @(${b.x.toFixed(1)}, ${b.z.toFixed(1)})  高さ ${b.yMin.toFixed(1)}〜${b.yMax.toFixed(1)}m`
    + (b.door ? `\n       入口 (${b.door.fx.toFixed(0)}, ${b.door.fz.toFixed(0)}) y${b.door.fy.toFixed(1)}`
      + ` → (${b.door.tx.toFixed(0)}, ${b.door.tz.toFixed(0)}) y${b.door.ty.toFixed(1)}` : ''));
}
if (blobs.length > show.length) console.log(`  ${C.dim}… ほか ${blobs.length - show.length} 塊${C.off}`);
console.log(trap.length ? `${C.red}閉じ込められる場所 ${blobs.length} 箇所 / ${trap.length} マス${C.off}`
  : `${C.grn}ALL CLEAN — 入れる所からは必ず帰れる${C.off}`);
process.exit(trap.length ? 1 : 0);
