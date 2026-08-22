// ============================================================================
// structure.mjs — 街の構造アサーション一式。
//
//   node tools/structure.mjs [--seed N] [--json out.json] [--map out.svg]
//                            [--only check1,check2] [--quiet]
//
// ブラウザも WebGL も要らない。src/world.js が組んだ「本物の街」に
// 直接問い合わせる。違反が 1 件でもあれば終了コードは 1。
//
// 順序に意味がある: まず決定性を確かめる。同じシードから二つの街が出るなら、
// この下の全ての主張は無意味になる。
// ============================================================================
import { installDomShim } from './structure/domshim.mjs';
installDomShim();

import * as THREE from 'three';
import { collectObjects, buildTriangles, Grid } from './structure/geom.mjs';
import { ALL_CHECKS } from './structure/checks.mjs';
import { printSummary, writeJson, writeGroundingMap, cluster } from './structure/report.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1]; };
const has = (n) => argv.includes(n);
const SEED = flag('--seed', undefined) === undefined ? undefined : Number(flag('--seed'));
const ONLY = flag('--only', '') ? flag('--only').split(',') : null;

const { buildWorld } = await import('../src/world.js');

// ------------------------------------------------------------ 決定性 ----
function structuralHash(world) {
  // 全ての transform とフットプリントを 1 本の文字列に畳む。
  let h = 0x811c9dc5;
  const mix = (x) => {
    const v = Math.round((Number.isFinite(x) ? x : 0) * 1e4);
    h ^= v & 0xffffffff; h = Math.imul(h, 0x01000193) >>> 0;
  };
  const objs = collectObjects(world.root);
  mix(objs.length);
  for (const o of objs) {
    for (const e of o.matrix.elements) mix(e);
    mix(o.box.min.x); mix(o.box.min.y); mix(o.box.min.z);
    mix(o.box.max.x); mix(o.box.max.y); mix(o.box.max.z);
  }
  for (const p of world.plan.houses) { mix(p.x); mix(p.z); mix(p.yBase); mix(p.eaves); mix(p.w); mix(p.d); }
  for (const p of world.plan.wallPts) { mix(p[0]); mix(p[1]); mix(p[2]); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const t0 = Date.now();
const worldA = buildWorld({ seed: SEED });
const tBuild = Date.now() - t0;
const hashA = structuralHash(worldA);
const worldB = buildWorld({ seed: SEED ?? worldA.seed });
const hashB = structuralHash(worldB);

if (hashA !== hashB) {
  console.error(`\n\x1b[31m決定性の破れ\x1b[0m  同じシード ${worldA.seed} から違う街が出た: ${hashA} ≠ ${hashB}`);
  console.error('この下の全ての主張は意味を持たない。生成に時刻・未シードの乱数・反復順の不定が混じっている。');
  process.exit(2);
}

// ------------------------------------------------------------ 索引 ------
const world = worldA;
const objects = collectObjects(world.root);
const tIdx0 = Date.now();
// 背景(天蓋・雲・遠景の山)は幾何の主張の対象外。索引にも入れない
// — 4km の三角形が格子を汚し、レイ判定が数十倍遅くなる。
const inScope = (o) => !o.backdrop && !o.isPoints && o.tag !== 'sky.dome' && o.tag !== 'sky.clouds';
const { tris, owner } = buildTriangles(objects, { filter: inScope });
const grid = new Grid(tris, 4);
const tIndex = Date.now() - tIdx0;

const ctx = { world, plan: world.plan, objects, tris, owner, grid, stats: {} };
ctx.stats.objects = objects.length;
ctx.stats.triangles = tris.length;
ctx.stats.gridCells = grid.nx * grid.nz;

// ------------------------------------------------------------ 検査 ------
const violations = [];
const timings = { build: tBuild, index: tIndex };
for (const [name, fn] of ALL_CHECKS) {
  if (ONLY && !ONLY.includes(name)) continue;
  const s = Date.now();
  let res = [];
  try {
    res = fn(ctx) || [];
  } catch (e) {
    res = [{ check: name, id: 'CHECK_CRASHED', tag: name, pos: [0, 0, 0], measured: null,
      tolerance: null, error: Infinity, note: `検査自体が落ちた: ${e.message}`, cause: `${name} crashed` }];
    if (!has('--quiet')) console.error(e.stack);
  }
  timings[name] = Date.now() - s;
  violations.push(...res);
}

const result = {
  seed: world.seed, hash: hashA, deterministic: true,
  tolerances: Object.fromEntries(Object.entries(await import('./structure/tolerances.mjs')).filter(([k]) => k === k.toUpperCase())),
  stats: ctx.stats, timings, total: violations.length,
  clusters: cluster(violations).map((c) => ({ cause: c.cause, check: c.check, count: c.count, worst: c.worst })),
  violations,
};

const jsonPath = flag('--json', 'shots/structure.json');
writeJson(jsonPath, result);
if (has('--map') || flag('--map', null)) {
  const p = flag('--map', 'shots/grounding.svg') || 'shots/grounding.svg';
  writeGroundingMap(p, objects, violations, world.plan);
  console.log(`接地マップ: ${p}`);
}
if (!has('--quiet')) printSummary(result);
console.log(`JSON: ${jsonPath}   合計 ${Date.now() - t0}ms`);
process.exit(violations.length ? 1 : 0);
