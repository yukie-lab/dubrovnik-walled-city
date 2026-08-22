import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import { collectObjects, buildTriangles } from './structure/geom.mjs';
import { nearestOnPolyline } from '../src/util.js';
const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const st = w.plan.WALL_STAIRS.find(s => s.id === 'mincetaShaft');
const poly = st.pts.map(p => [p[0], p[1], p[2]]);
const objs = collectObjects(w.root).filter(o => o.tag === 'wall.curtain');
const parts = objs[0].mesh.geometry.userData.parts.filter(q => q.name === 'stairWall');
const { tris } = buildTriangles(objs, {});
const bad = [], good = [];
for (const q of parts) for (let i = q.from; i < q.to; i++) {
  const t = tris[i];
  const c = [(t[0]+t[3]+t[6])/3, (t[1]+t[4]+t[7])/3, (t[2]+t[5]+t[8])/3];
  const nw = nearestOnPolyline(poly, c[0], c[2]);
  if (nw.d > 3.0) continue;                        // 別の階段
  const ax=t[3]-t[0],ay=t[4]-t[1],az=t[5]-t[2],bx=t[6]-t[0],by=t[7]-t[1],bz=t[8]-t[2];
  let n=[ay*bz-az*by, az*bx-ax*bz, ax*by-ay*bx]; const nl=Math.hypot(...n)||1; n=n.map(v=>v/nl);
  if (Math.abs(n[1]) > 0.55) continue;              // 天井・床は別
  const r = [c[0]-nw.x, 0, c[2]-nw.z];
  const rl = Math.hypot(r[0], r[2]) || 1;
  const dot = (n[0]*r[0] + n[2]*r[2]) / rl;
  (dot < 0 ? bad : good).push({ c, n, d: nw.d, dot });
}
console.log(`mincetaShaft 縦面: 外向き ${good.length} / 内向き ${bad.length}`);
const os = bad.filter(b => b.d > 1.2);            // 外壁(hI=1.03 より外)なのに内向き
console.log(`  うち外壁側(d>1.2)なのに内を向く: ${os.length}`);
for (const b of os.slice(0,5)) console.log(`   ${b.c.map(v=>v.toFixed(1)).join(',')} n=${b.n.map(v=>v.toFixed(2)).join(',')} d=${b.d.toFixed(2)}`);
const is2 = good.filter(b => b.d < 1.1);
console.log(`  内壁側(d<1.1)なのに外を向く: ${is2.length}`);
for (const b of is2.slice(0,5)) console.log(`   ${b.c.map(v=>v.toFixed(1)).join(',')} n=${b.n.map(v=>v.toFixed(2)).join(',')} d=${b.d.toFixed(2)}`);
