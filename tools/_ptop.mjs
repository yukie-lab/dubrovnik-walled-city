import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import { collectObjects, buildTriangles, Grid, castDown } from './structure/geom.mjs';
import { nearestOnPolyline } from '../src/util.js';
const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const plan = w.plan, pts = plan.wallPts;
const objects = collectObjects(w.root);
const { tris, owner } = buildTriangles(objects, { filter: (o) => !o.backdrop && !o.isPoints });
const grid = new Grid(tris, 4);
const parts = objects.find(o=>o.tag==='wall.curtain').mesh.geometry.userData.parts;
const [x0, z0, x1, z1] = process.argv.slice(2).map(Number);
const L = Math.hypot(x1-x0, z1-z0), N = Math.round(L/0.15);
for (let k = 0; k <= N; k++) {
  const x = x0 + (x1-x0)*k/N, z = z0 + (z1-z0)*k/N;
  const nw = nearestOnPolyline(pts, x, z);
  const wy = plan.wallWalkYAt(nw);
  const h = castDown(grid, owner, x, z, wy + 6, () => true);
  let pn = '-';
  if (h) { const o = objects[h.obj]; if (o.tag === 'wall.curtain') { /* 部位は三角番号が要る */ } pn = o.tag; }
  console.log(`${x.toFixed(2)},${z.toFixed(2)}  歩廊 ${wy.toFixed(2)}  上面 ${h ? h.y.toFixed(2) : 'なし'}  差 ${h ? (h.y-wy).toFixed(2) : '-'}  ${pn}`);
}
