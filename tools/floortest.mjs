// ============================================================================
// floortest.mjs — 「描かれた床」と「体が立つ床」の食い違いを測る。
//
//   node tools/floortest.mjs [--all]
//
// plan.groundAt(x,z) は当たり判定の面 = 足が乗る高さ。
// 実三角形の一番上の床は、実際に目に見える高さ。
// この二つがずれていると、人も player も「石に埋まる / 浮く」。
// 部位ごと・街路ごとに束ねて、どの作り方がずれているかを言う。
// ============================================================================
import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import { collectObjects, buildTriangles, Grid, castDown } from './structure/geom.mjs';

const TOL = 0.010;      // 許容(FLOAT_MAX と同じ)
const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const plan = w.plan;
const objects = collectObjects(w.root);
const { tris, owner } = buildTriangles(objects, { filter: (o) => !o.backdrop && !o.isPoints });
const grid = new Grid(tris, 4);
// 床として数えるもの。人・飾り・建具は床ではない。
const FLOOR = /^(ground\.|steps$|wall\.curtain|surround\.(quayKerb|pileBridge|arsenal)|monument\.stone)/;
const isFloor = (oi) => FLOOR.test(objects[oi]?.tag || '');

const rows = [];
// groundAt は「今どの高さに居るか(curY)」を渡さないと、層の解決が全て
// tier 0 に落ちて **最初の候補** を返す。渡さずに測ったせいで、広場と街路が
// 重なる所を「石畳が 0.47m 高い」と誤報した。
// 正しい問い: 「見えている床の上に立っている体に対して groundAt は何を返すか」。
// だから先に実三角形で見えている床を取り、それを curY として渡す。
const sample = (x, z, where) => {
  const top = castDown(grid, owner, x, z, 120, isFloor);
  if (!top) { rows.push({ d: Infinity, x, z, where, on: '床が無い' }); return; }
  const g = plan.groundAt(x, z, top.y);
  if (!g || g.y === undefined) return;
  rows.push({ d: top.y - g.y, x, z, where, on: objects[top.obj]?.tag || '?' });
};

// 街路・路地は中心線に沿って、幅方向にも振って測る
for (const s of plan.streets) {
  const pts = s.pts;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(2, Math.ceil(L / 3));
    for (let k = 0; k <= n; k++) {
      const t = k / n, cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
      const ux = (bx - ax) / (L || 1), uz = (bz - az) / (L || 1);
      for (const off of [0, -0.3, 0.3]) sample(cx - uz * off * s.w, cz + ux * off * s.w, `street:${s.id}`);
    }
  }
}
// 広場
for (const p of plan.PLAZAS) {
  for (let i = 1; i < 5; i++) for (let j = 1; j < 5; j++) {
    sample(p.x0 + (p.x1 - p.x0) * (i / 5), p.z0 + (p.z1 - p.z0) * (j / 5), `plaza:${p.id}`);
  }
}
// 城壁の歩廊
for (let i = 1; i < plan.wallPts.length; i++) {
  const [ax, , az] = plan.wallPts[i - 1], [bx, , bz] = plan.wallPts[i];
  const L = Math.hypot(bx - ax, bz - az);
  const n = Math.max(2, Math.ceil(L / 4));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    sample(ax + (bx - ax) * t, az + (bz - az) * t, 'wallWalk');
  }
}

// |差| が 0.5m を超える標本は「街路の外に落ちた標本」— 壁や記念建築の上を
// 測っている。床の作り方の話ではないので、別に数える。
const off = rows.filter((r) => Math.abs(r.d) > 0.5);
const bad = rows.filter((r) => Math.abs(r.d) > TOL && Math.abs(r.d) <= 0.5);
{
  const by2 = new Map();
  for (const r of rows) {
    if (Math.abs(r.d) > 0.5) continue;
    if (!by2.has(r.on)) by2.set(r.on, []);
    by2.get(r.on).push(r.d);
  }
  console.log('\n部位ごと(標本が街路の外に落ちた分は除く)');
  for (const [k, v] of [...by2.entries()].sort((a, b) => b[1].length - a[1].length)) {
    v.sort((a, b) => a - b);
    const mid = v[v.length >> 1], p95 = v[Math.min(v.length - 1, Math.floor(v.length * 0.95))];
    const mn = v[0], mx = v[v.length - 1];
    console.log(`  ${String(v.length).padStart(5)} 点  ${k.padEnd(18)}`
      + ` 中央 ${(mid >= 0 ? '+' : '') + mid.toFixed(3)}  95% ${(p95 >= 0 ? '+' : '') + p95.toFixed(3)}`
      + `  範囲 ${mn.toFixed(3)} … ${mx.toFixed(3)}`);
  }
  console.log(`  ${off.length} 点は標本が街路の外(壁・記念建築の上)`);
}
const by = new Map();
for (const r of bad) {
  const k = `${r.where} → ${r.on}`;
  if (!by.has(k)) by.set(k, { k, n: 0, max: 0, worst: r, sum: 0 });
  const c = by.get(k);
  c.n++; c.sum += r.d;
  if (Math.abs(r.d) > Math.abs(c.max)) { c.max = r.d; c.worst = r; }
}
const list = [...by.values()].sort((a, b) => Math.abs(b.max) - Math.abs(a.max));
const C = { red: '\x1b[31m', yel: '\x1b[33m', grn: '\x1b[32m', dim: '\x1b[2m', off: '\x1b[0m' };
console.log(`\n標本 ${rows.length} 点 — 食い違い ${bad.length} 点  ${C.dim}(許容 ±${TOL}m。+ = 描かれた床のほうが高い = 足が埋まる)${C.off}`);
const show = process.argv.includes('--all') ? list : list.slice(0, 16);
for (const c of show) {
  const col = Math.abs(c.max) > 0.05 ? C.red : C.yel;
  console.log(`  ${col}${(c.max >= 0 ? '+' : '') + c.max.toFixed(3)}m${C.off}`
    + ` 平均 ${(c.sum / c.n >= 0 ? '+' : '') + (c.sum / c.n).toFixed(3)}  ${String(c.n).padStart(4)} 点  ${c.k}`
    + `  ${C.dim}@(${c.worst.x.toFixed(1)}, ${c.worst.z.toFixed(1)})${C.off}`);
}
if (list.length > show.length) console.log(`  ${C.dim}… ほか ${list.length - show.length} 群${C.off}`);
console.log(bad.length ? `${C.red}床が食い違う ${bad.length} / ${rows.length} 点${C.off}`
  : `${C.grn}ALL CLEAN${C.off}`);
process.exit(bad.length ? 1 : 0);
