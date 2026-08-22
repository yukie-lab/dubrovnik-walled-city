// 歩廊から外がどれだけ見えるか。目の高さから外向きに扇状にレイを撃ち、
// 石に当たらず抜けた割合を測る。「上から海が見たいのに見えない」を数で言う。
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
const stone = (oi) => objects[oi].solid && !objects[oi].thin;
const CX = 0, CZ = 15;
const EYE = 1.62;
let open = 0, tot = 0;
const perSeg = new Map();
for (let i = 1; i < pts.length; i++) {
  const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
  const L = Math.hypot(bx - ax, bz - az); if (L < 1) continue;
  const kind = plan.wallKinds[i - 1] || '?';
  const m2 = Math.max(2, Math.round(L / 2.0));
  let so = 0, st = 0;
  for (let k = 0; k <= m2; k++) {
    const cx = ax + (bx - ax) * k / m2, cz = az + (bz - az) * k / m2;
    const nw = nearestOnPolyline(pts, cx, cz);
    const y = plan.wallWalkYAt(nw) + EYE;
    let tx = -(bz - az) / L, tz = (bx - ax) / L;
    if (Math.hypot(cx + tx * 3 - CX, cz + tz * 3 - CZ) < Math.hypot(cx - tx * 3 - CX, cz - tz * 3 - CZ)) { tx = -tx; tz = -tz; }
    for (let h = -30; h <= 30; h += 5) {           // 水平 ±30°
      for (let v = -12; v <= 6; v += 3) {          // 俯角 12° 〜 仰角 6°
        const ha = h * Math.PI / 180, va = v * Math.PI / 180;
        const dx = (tx * Math.cos(ha) - tz * Math.sin(ha)) * Math.cos(va);
        const dz = (tz * Math.cos(ha) + tx * Math.sin(ha)) * Math.cos(va);
        const dy = Math.sin(va);
        const hit = castRay(grid, owner, cx, y, cz, dx, dy, dz, 26, stone);
        st++; if (!hit) so++;
      }
    }
  }
  open += so; tot += st;
  const r = perSeg.get(kind) || { o: 0, t: 0 }; r.o += so; r.t += st; perSeg.set(kind, r);
}
console.log(`歩廊から外が見える割合: ${(open / tot * 100).toFixed(1)}%  (標本 ${tot})`);
for (const [k, r] of [...perSeg].sort((a, b) => a[1].o / a[1].t - b[1].o / b[1].t))
  console.log(`  ${k.padEnd(11)} ${(r.o / r.t * 100).toFixed(1)}%`);
