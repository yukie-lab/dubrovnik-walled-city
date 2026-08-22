// 下を向いた面(軒裏・底)から真下へ撃ち、支えの石までの距離を測る。
// 大きく空いていれば、その石は宙に浮いている。
import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import { collectObjects, buildTriangles, Grid, castDown } from './structure/geom.mjs';
const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const objects = collectObjects(w.root);
const { tris, owner } = buildTriangles(objects, { filter: (o) => !o.backdrop && !o.isPoints });
const grid = new Grid(tris, 4);
const rows = [];
for (const o of objects) {
  if (!/^wall\./.test(o.tag || '')) continue;
  const parts = o.mesh?.geometry?.userData?.parts;
  const local = buildTriangles([o], {});
  for (let i = 0; i < local.tris.length; i++) {
    const t = local.tris[i];
    const ax=t[3]-t[0],ay=t[4]-t[1],az=t[5]-t[2],bx=t[6]-t[0],by=t[7]-t[1],bz=t[8]-t[2];
    const nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx;
    const nl=Math.hypot(nx,ny,nz); if (nl<1e-9) continue;
    const A = nl/2; if (A < 0.25) continue;
    if (ny/nl > -0.6) continue;                     // 下を向いた面だけ
    const c = [(t[0]+t[3]+t[6])/3,(t[1]+t[4]+t[7])/3,(t[2]+t[5]+t[8])/3];
    const h = castDown(grid, owner, c[0], c[2], c[1] - 0.03, () => true);
    const drop = h ? c[1] - h.y : Infinity;
    if (drop < 1.2) continue;                       // 1.2m 以内に支えがあれば庇として妥当
    let pn = '-'; if (parts) for (const q of parts) if (i>=q.from&&i<q.to) pn = q.name;
    rows.push({ k: o.tag + '/' + pn, drop, A, c });
  }
}
const agg = new Map();
for (const r of rows) { const a = agg.get(r.k) || {n:0,area:0,max:0,c:null}; a.n++; a.area+=r.A;
  if (r.drop>a.max){a.max=r.drop;a.c=r.c;} agg.set(r.k,a); }
console.log(`下を向いた面で 1.2m 以内に支えが無いもの: ${rows.length} 枚`);
for (const [k,a] of [...agg].sort((x,y)=>y[1].area-x[1].area))
  console.log(`  ${k.padEnd(26)} ${String(a.n).padStart(4)}枚 面積${a.area.toFixed(0).padStart(5)}m² 最大落差 ${a.max===Infinity?'∞':a.max.toFixed(1)}m @ ${a.c.map(v=>v.toFixed(1)).join(',')}`);
