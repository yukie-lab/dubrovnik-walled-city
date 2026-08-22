// メルロンの足元で、胸壁の石が前後にどこまであるかを実測する。
import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import * as THREE from 'three';
import { collectObjects, buildTriangles, Grid, castRay, castDown } from './structure/geom.mjs';
const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const objects = collectObjects(w.root);
const { tris, owner } = buildTriangles(objects, { filter: (o) => !o.backdrop && !o.isPoints });
const grid = new Grid(tris, 4);
const wallOnly = (oi) => objects[oi].tag === 'wall.curtain';
const mm = objects.filter(o => o.tag === 'wall.merlon');
const HDbase = 0.72 / 2;
let n = 0; const rows = [];
for (const o of mm) {
  const M = o.matrix;
  const base = new THREE.Vector3(0, 0, 0).applyMatrix4(M);
  if (base.y < 1) continue;
  // 局所 +Z / −Z のワールド方向
  const zv = new THREE.Vector3(0, 0, 1).applyMatrix4(M).sub(new THREE.Vector3(0,0,0).applyMatrix4(M));
  const HD = HDbase * zv.length();
  const zdir = zv.clone().normalize();
  const y = base.y - 0.35;                       // 胸壁の中ほど
  // 中心から外へ / 内へ撃って、石が切れるまでの距離
  const out1 = castRay(grid, owner, base.x - zdir.x * 3, y, base.z - zdir.z * 3, zdir.x, 0, zdir.z, 6, wallOnly);
  const out2 = castRay(grid, owner, base.x + zdir.x * 3, y, base.z + zdir.z * 3, -zdir.x, 0, -zdir.z, 6, wallOnly);
  const dNeg = out1 ? 3 - out1.dist : null;      // −Z 側の石の縁までの距離(中心基準・正なら石がある)
  const dPos = out2 ? 3 - out2.dist : null;      // +Z 側
  rows.push({ base: base.toArray().map(v => +v.toFixed(1)), dNeg, dPos, HD });
  n++;
}
const f = (v) => v === null ? '  なし' : (v >= 0 ? '+' : '') + v.toFixed(2);
let bad = 0;
for (const r of rows) { const ov = Math.max(r.HD - (r.dNeg ?? -9), r.HD - (r.dPos ?? -9)); if (ov > 0.05) bad++; }
console.log(`メルロン ${n} 本 / 胸壁からのはみ出しが 5cm を超えるもの ${bad}`);
console.log(`d は中心から石の縁まで。`);
rows.forEach(r => { r.ov = Math.max(r.HD - (r.dNeg ?? -9), r.HD - (r.dPos ?? -9)); });
rows.sort((a, b) => b.ov - a.ov);
for (const r of rows.slice(0, 14)) console.log(`   はみ出し ${r.ov.toFixed(2)}m  半奥行 ${r.HD.toFixed(2)}  ${r.base.join(',').padEnd(20)} −Z側 ${f(r.dNeg)}  +Z側 ${f(r.dPos)}`);
