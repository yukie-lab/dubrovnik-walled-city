import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import * as THREE from 'three';
import { collectObjects, buildTriangles, Grid, castDown } from './structure/geom.mjs';
const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const objects = collectObjects(w.root);
const { tris, owner } = buildTriangles(objects, { filter: (o) => !o.backdrop && !o.isPoints });
const grid = new Grid(tris, 4);
// 脚メッシュのインスタンスのうち、底が石の中に沈んでいるものを探す
const legs = objects.filter(o => /life\.folkLegs/.test(o.tag || ''));
console.log('脚インスタンス', legs.length);
const rows = [];
// 座位(aSit=2)の足は、局所で z+1.35 / y=-0.10 の所に着く。
// インスタンス行列の +Z 方向へ 1.35m 出た点で床を測る。
const sitAttr = legs[0]?.mesh?.geometry?.getAttribute('aSit');
for (const o of legs) {
  const sv = sitAttr && o.instance >= 0 ? sitAttr.getX(o.instance) : 0;
  if (sv < 1.5) continue;                       // 石段に座る人だけ
  const c = new THREE.Vector3().setFromMatrixPosition(o.matrix);
  const fwd = new THREE.Vector3(0, 0, 1).transformDirection(o.matrix).normalize();
  for (const [nm, fx, fy] of [['座', 1.35, 0.157]]) {
    const px = c.x + fwd.x * fx, pz = c.z + fwd.z * fx, py = c.y + fy;
    const h = castDown(grid, owner, px, pz, py + 2.4,
      (oi) => !/^life\./.test(objects[oi].tag || ''));
    if (!h) continue;
    rows.push({ err: py - h.y, p: [px, py, pz], on: objects[h.obj].tag, nm });
  }
}
rows.sort((a, b) => a.err - b.err);
console.log('沈んでいる順:');
for (const r of rows.filter(q=>q.nm==='座').slice(0, 8)) console.log(`  座位の足 ${r.err.toFixed(2)}m  ${r.p.map(v => v.toFixed(1)).join(',')}  下は ${r.on}`);
const sit = rows.filter(q=>q.nm==='座');
console.log('  座位: 足が 0.15m 以上沈む', sit.filter(r => r.err < -0.15).length, '/ 0.15m 以上浮く', sit.filter(r => r.err > 0.15).length, '/ 全', sit.length);
