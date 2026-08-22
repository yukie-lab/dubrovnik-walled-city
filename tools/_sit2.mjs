// 座位の脚が石にめり込んでいないか。足だけでなく脛・膝も測る。
import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import * as THREE from 'three';
import { collectObjects, buildTriangles, Grid, castDown } from './structure/geom.mjs';
const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const objects = collectObjects(w.root);
const { tris, owner } = buildTriangles(objects, { filter: (o) => !o.backdrop && !o.isPoints });
const grid = new Grid(tris, 4);
const notLife = (oi) => !/^life\./.test(objects[oi].tag || '');
const legs = objects.filter(o => /life\.folkLegs/.test(o.tag || ''));
const sitAttr = legs[0]?.mesh?.geometry?.getAttribute('aSit');
// シェーダの座位変形(aSit>1.5)を CPU 側で再現する
const pose = (y) => {
  if (y >= 0.91) return { y: y - 0.40, z: 0 };
  if (y >= 0.45) { const t3 = 0.91 - y; return { y: 0.50 - t3 * 0.10, z: t3 * 1.90 }; }
  return { y: 0.454 - (0.45 - y) * 0.66, z: 1.35 };
};
const P = new THREE.Vector3();
const rows = [];
for (const o of legs) {
  const sv = sitAttr && o.instance >= 0 ? sitAttr.getX(o.instance) : 0;
  if (sv < 1.5) continue;
  let worst = -9, at = null, part = '';
  for (const [nm, y0] of [['足', 0.0], ['脛下', 0.10], ['脛中', 0.24], ['膝', 0.45], ['腿中', 0.68]]) {
    const q = pose(y0);
    for (const dx of [-0.10, 0, 0.10]) {
      P.set(dx, q.y, q.z).applyMatrix4(o.matrix);
      // 上限は「蹴上 1 段ぶん + 少し」。1.4m にすると、脚がくぐっている
      // 頭上の段まで「埋まっている」と数える(実測でそれを 1.17m と誤報した)。
      const h = castDown(grid, owner, P.x, P.z, P.y + 0.26, notLife);
      if (!h) continue;
      const d = h.y - P.y;                   // 正 = 石が上 = めり込み
      if (d > worst) { worst = d; at = [P.x, P.y, P.z]; part = nm; }
    }
  }
  if (at) rows.push({ worst, at, part });
}
rows.sort((a, b) => b.worst - a.worst);
console.log(`石段に座る人 ${rows.length} 人`);
console.log(`  めり込み > 0.06m: ${rows.filter(r => r.worst > 0.06).length}`);
for (const r of rows.slice(0, 10))
  console.log(`   ${r.worst >= 0 ? '+' : ''}${r.worst.toFixed(3)}m ${r.part}  @ ${r.at.map(v => v.toFixed(1)).join(',')}`);
