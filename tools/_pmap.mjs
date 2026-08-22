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
console.log('メルロン底 y=' + base.y.toFixed(2) + '  局所 u=幅 / v=奥行き。数字 = 底からの落差');
const notM = (oi) => objects[oi].tag !== 'wall.merlon';
for (let ui = -20; ui <= 30; ui++) {
  const u = ui * 0.1;
  let line = 'u=' + u.toFixed(2).padStart(6) + '  ';
  for (let vi = -2; vi <= 2; vi++) {
    P.set(u, 0, vi * 0.15).applyMatrix4(M);
    const h = castDown(grid, owner, P.x, P.z, P.y + 3.0, notM);
    line += (h ? (P.y - h.y).toFixed(2) : ' なし').padStart(8);
  }
  console.log(line);
}
