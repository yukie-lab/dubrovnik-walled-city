import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import * as THREE from 'three';
import { collectObjects, buildTriangles, Grid, castDown } from './structure/geom.mjs';
const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const objects = collectObjects(w.root);
const { tris, owner } = buildTriangles(objects, { filter: (o) => !o.backdrop && !o.isPoints });
const grid = new Grid(tris, 4);
const [tx, tz] = process.argv.slice(2).map(Number);
const mm = objects.filter(o => o.tag === 'wall.merlon');
let best = null, bd = 9;
for (const o of mm) { const c = new THREE.Vector3().setFromMatrixPosition(o.matrix);
  const d = Math.hypot(c.x - tx, c.z - tz); if (d < bd) { bd = d; best = o; } }
const M = best.matrix, P = new THREE.Vector3();
const base = new THREE.Vector3().setFromMatrixPosition(M);
console.log('メルロン中心', base.toArray().map(v=>+v.toFixed(3)).join(','));
const sc = new THREE.Vector3(); M.decompose(new THREE.Vector3(), new THREE.Quaternion(), sc);
console.log('スケール', sc.toArray().map(v=>+v.toFixed(3)).join(','));
for (const c of [[-0.49,0,-0.32],[0.49,0,-0.32],[0.49,0,0.32],[-0.49,0,0.32],[0,0,0]]) {
  P.set(c[0], 0, c[2]).applyMatrix4(M);
  const hits = [];
  for (const o of objects) { if (o.tag === 'wall.merlon') continue; }
  const h = castDown(grid, owner, P.x, P.z, P.y + 0.20, (oi) => objects[oi].tag !== 'wall.merlon');
  console.log(`  局所 ${c.join(',')} → ${P.x.toFixed(2)},${P.y.toFixed(2)},${P.z.toFixed(2)}  下の石 ${h ? objects[h.obj].tag + ' y=' + h.y.toFixed(2) + ' 落差 ' + (P.y - h.y).toFixed(2) : 'なし'}`);
}
