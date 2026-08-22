// ============================================================================
// foottest.mjs — 人の足が石に埋まっていないか / 浮いていないかを実三角形で測る。
//
//   node tools/foottest.mjs [--all]
//
// 足は「腰の位置」ではなく「足の裏」で測る。人は 700 体以上いるので、
// 一体でも埋まっていれば必ず誰かの視界に入る。歩行の上下動(シェーダで
// 骨盤を下げる)も込みで最悪値を取る — 静止時だけ合わせても意味が無い。
//
// 立位: 足裏はローカル y = 0(足の箱の下端 = インスタンス原点)。
// 座位(aSit≥1.5): シェーダが足を前 1.35m・下 0.30m へ動かす。
// ============================================================================
import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import * as THREE from 'three';
import { collectObjects, buildTriangles, Grid, castDown } from './structure/geom.mjs';

const BURY = 0.06;      // これ以上「床が足裏より上」なら埋没
const FLOAT = 0.10;     // これ以上「床が足裏より下」なら浮き
const WALK_DIP = 0.90 * (1 - Math.cos(0.40));   // 歩行で骨盤が沈む最大量

const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const objects = collectObjects(w.root);
const { tris, owner } = buildTriangles(objects, { filter: (o) => !o.backdrop && !o.isPoints });
const grid = new Grid(tris, 4);
// buildTriangles の owner は「物の添字」であって物ではない。物として扱うと
// 全部が accept され、自分の胸に当たって「404 体中 369 体が 1.2m 埋没」と出た。
// 極端に悪い答えが出たら、壊れているのは計器のほう。
// 床として数えないもの: 人そのもの、灯りの落とし影のような板の飾り、
// 建具・洗濯物・葉。これらを床に数えると「灯りの下に立つ人は全員埋没」と出る。
const NOT_FLOOR = /^(life\.(folk|chair|cat|cat2|pigeon|swift|gull|bird|lampPool|lampGlass|lampArm|laundryCloth|foliage|parasol)|arcade\.shadow|monument\.fountain(Ripple|Water|Jet)|house\.grimeBand|window\.|door\.|shop\.)/;
const notFolk = (oi) => !NOT_FLOOR.test(objects[oi]?.tag || '');

const legs = objects.filter((o) => /life\.folkLegs/.test(o.tag || ''));
const g0 = legs[0]?.mesh?.geometry;
const sitAttr = g0?.getAttribute('aSit');
const walkAttr = g0?.getAttribute('aWalk');

const bad = [];
let n = 0;
for (const o of legs) {
  const sv = sitAttr && o.instance >= 0 ? sitAttr.getX(o.instance) : 0;
  const wv = walkAttr && o.instance >= 0 ? walkAttr.getX(o.instance) : 0;
  const m = o.matrix;
  const sc = new THREE.Vector3().setFromMatrixScale(m).y;
  // 足裏の局所座標(左右)。座位はシェーダの移動を織り込む。
  // 座位の足裏は **シェーダが実際にやっている変換** で求める。
  // life.js の aSit>1.5 の分岐:  局所 y < 0.45 → z += 0.45, y *= 1.11
  // 計器はここを「前 1.35m・下 0.45m」という **別の姿勢** で測っていたので、
  // 石段に腰まで埋まった人を一体も鳴らせなかった(実測 0.450m の埋没を見逃した)。
  // 姿勢の式は 1 つ。計器が別の式を持った時点で、計器は嘘をつく。
  const sitSole = (lx) => [lx, 0.0 * 0.55 + 0.30, 0.042 + 0.45];
  const soles = sv >= 1.5
    ? [sitSole(-0.096), sitSole(0.096)]
    : [[-0.096, 0.0, 0.042], [0.096, 0.0, 0.042]];
  const dip = 0;   // 沈み込みは足首より上だけに効くので足裏には掛からない
  n++;
  let worst = null;
  for (const [lx, ly, lz] of soles) {
    const p = new THREE.Vector3(lx, ly - dip, lz).applyMatrix4(m);
    const hit = castDown(grid, owner, p.x, p.z, p.y + 1.2, notFolk);
    if (!hit) continue;
    const d = hit.y - p.y;                      // + = 床が足裏より上 = 埋没
    if (!worst || d > worst.d) worst = { d, p, hit };
  }
  if (!worst) continue;
  if (worst.d > BURY || worst.d < -FLOAT) {
    bad.push({ d: worst.d, x: worst.p.x, y: worst.p.y, z: worst.p.z, sit: sv,
      on: objects[worst.hit.obj]?.tag || '?', h: sc });
  }
}

bad.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
const buried = bad.filter((b) => b.d > 0), floated = bad.filter((b) => b.d < 0);
const C = { red: '\x1b[31m', grn: '\x1b[32m', dim: '\x1b[2m', off: '\x1b[0m' };
console.log(`\n人 ${n} 体 — 埋没 ${buried.length} / 浮き ${floated.length}`
  + `  ${C.dim}(埋没 > ${BURY}m, 浮き > ${FLOAT}m。歩行の沈み込み ${WALK_DIP.toFixed(3)}m 込み)${C.off}`);
const show = process.argv.includes('--all') ? bad : bad.slice(0, 14);
for (const b of show) {
  console.log(`  ${b.d > 0 ? C.red + '埋没' : '浮き'} ${Math.abs(b.d).toFixed(3)}m${C.off}`
    + ` @ (${b.x.toFixed(1)}, ${b.y.toFixed(2)}, ${b.z.toFixed(1)})`
    + ` ${b.sit >= 1.5 ? '座' : b.sit >= 0.5 ? '椅' : '立'} 床=${b.on}`);
}
if (bad.length > show.length) console.log(`  ${C.dim}… ほか ${bad.length - show.length} 体${C.off}`);
console.log(bad.length ? `${C.red}足が床と合っていない ${bad.length} 体${C.off}` : `${C.grn}ALL CLEAN${C.off}`);
process.exit(bad.length ? 1 : 0);
