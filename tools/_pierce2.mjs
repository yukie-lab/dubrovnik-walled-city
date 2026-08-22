import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import { collectObjects, buildTriangles, Grid, castRay } from './structure/geom.mjs';
const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const objects = collectObjects(w.root);
const { tris, owner } = buildTriangles(objects, { filter: (o) => !o.backdrop && !o.isPoints });
const grid = new Grid(tris, 4);
const any = () => true;
const [ox,oy,oz,dx,dy,dz] = process.argv.slice(2).map(Number);
const L = Math.hypot(dx,dy,dz);
let t = 0;
for (let k = 0; k < 12; k++) {
  const h = castRay(grid, owner, ox+dx/L*t, oy+dy/L*t, oz+dz/L*t, dx/L, dy/L, dz/L, 120, any);
  if (!h) { console.log('  (これ以上なし)'); break; }
  t += h.dist + 0.02;
  const p = [ox+dx/L*t, oy+dy/L*t, oz+dz/L*t];
  const o = objects[h.obj];
  const parts = o.mesh?.geometry?.userData?.parts; let pn='-';
  console.log(`  ${t.toFixed(2)}m  ${o.tag}  @ ${p.map(v=>v.toFixed(1)).join(',')}`);
}
