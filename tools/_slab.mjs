// 指定した範囲で「宙に浮いた水平な板」を探す。
// 上向き/下向きの大きい面のうち、真下 1.5m に石が無いものを挙げる。
import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import { collectObjects, buildTriangles, Grid, castDown } from './structure/geom.mjs';
const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const objects = collectObjects(w.root);
const { tris, owner } = buildTriangles(objects, { filter: (o) => !o.backdrop && !o.isPoints });
const grid = new Grid(tris, 4);
const [x0, x1, z0, z1] = process.argv.slice(2).map(Number);
const agg = new Map();
for (const o of objects) {
  if (o.backdrop || o.isPoints) continue;
  if (o.box.max.x < x0 || o.box.min.x > x1 || o.box.max.z < z0 || o.box.min.z > z1) continue;
  const parts = o.mesh?.geometry?.userData?.parts;
  const local = buildTriangles([o], {});
  for (let i = 0; i < local.tris.length; i++) {
    const t = local.tris[i];
    const c = [(t[0]+t[3]+t[6])/3, (t[1]+t[4]+t[7])/3, (t[2]+t[5]+t[8])/3];
    if (c[0] < x0 || c[0] > x1 || c[2] < z0 || c[2] > z1) continue;
    const ax=t[3]-t[0],ay=t[4]-t[1],az=t[5]-t[2],bx=t[6]-t[0],by=t[7]-t[1],bz=t[8]-t[2];
    const nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx;
    const nl=Math.hypot(nx,ny,nz); if (nl < 1e-9) continue;
    const A = nl/2; if (A < 1.0) continue;
    if (Math.abs(ny/nl) < 0.6) continue;                  // 水平な面だけ
    const h = castDown(grid, owner, c[0], c[2], c[1] - 0.08,
      (oi) => objects[oi].mesh !== o.mesh);               // 自分のメッシュは除く
    const drop = h ? c[1] - h.y : Infinity;
    if (drop < 1.5) continue;
    let pn = '-'; if (parts) for (const q of parts) if (i>=q.from&&i<q.to) pn = q.name;
    const k = o.tag + '/' + pn;
    const r = agg.get(k) || { n:0, area:0, max:0, c:null };
    r.n++; r.area += A; if (drop > r.max) { r.max = drop; r.c = c; }
    agg.set(k, r);
  }
}
console.log(`x ${x0}..${x1} / z ${z0}..${z1} の宙に浮いた水平面`);
for (const [k,a] of [...agg].sort((x,y)=>y[1].area-x[1].area).slice(0,14))
  console.log(`  ${k.padEnd(26)} ${String(a.n).padStart(4)}枚 面積${a.area.toFixed(0).padStart(5)}m² 最大落差 ${a.max===Infinity?'∞':a.max.toFixed(1)}m @ ${a.c.map(v=>v.toFixed(1)).join(',')}`);
