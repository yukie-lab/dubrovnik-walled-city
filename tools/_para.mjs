import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import { collectObjects, buildTriangles, Grid, castRay } from './structure/geom.mjs';
import { nearestOnPolyline } from '../src/util.js';
const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const plan = w.plan, pts = plan.wallPts;
const objects = collectObjects(w.root);
const { tris, owner } = buildTriangles(objects, { filter: (o) => !o.backdrop && !o.isPoints });
const grid = new Grid(tris, 4);
const stoneOk = (oi) => objects[oi].solid && !objects[oi].thin && !objects[oi].backdrop;
const partOf = (oi, tri) => { const o=objects[oi]; const ps=o.mesh?.geometry?.userData?.parts; return o.tag + (ps?'':''); };
for (const arg of process.argv.slice(2)) {
  const [px, pz] = arg.split(',').map(Number);
  const nw = nearestOnPolyline(pts, px, pz);
  const i = nw.i;
  const [ax, az] = pts[i-1], [bx, bz] = pts[i];
  const L = Math.hypot(bx-ax, bz-az), tx=(bx-ax)/L, tz=(bz-az)/L, nx=-tz, nz=tx;
  const y = plan.wallWalkYAt(nw);
  console.log(`(${px},${pz}) 区間${i} kind=${plan.wallKinds[i-1]} segN=${plan.wallSegN[i]} walkY=${y.toFixed(2)} half=${(plan.wallNodeHalf[i]??0).toFixed(2)} parapet=${(plan.WALL_KIND[plan.wallKinds[i-1]]||{}).parapet}`);
  for (const sgn of [1,-1]) {
    let top = null;
    for (let h = 0.1; h < 2.6; h += 0.05) {
      const r = castRay(grid, owner, nw.x, y+h, nw.z, nx*sgn, 0, nz*sgn, 12, stoneOk);
      if (r && r.dist < 4) top = h; else if (top !== null && h > top + 0.3) break;
    }
    const r95 = castRay(grid, owner, nw.x, y+0.95, nw.z, nx*sgn, 0, nz*sgn, 12, stoneOk);
    console.log(`   ${sgn>0?'n+':'n-'} 石の上端 ≈ ${top===null?'なし':(top).toFixed(2)}m  / 0.95 の射線: ${r95?objects[r95.obj].tag+' '+r95.dist.toFixed(2)+'m':'なし'}`);
  }
}
