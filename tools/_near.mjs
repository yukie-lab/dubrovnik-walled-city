import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import { collectObjects, buildTriangles } from './structure/geom.mjs';
const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const [px,py,pz,R] = process.argv.slice(2).map(Number);
const rr = R || 2;
for (const o of collectObjects(w.root)) {
  if (o.backdrop || o.isPoints) continue;
  const ps = o.mesh?.geometry?.userData?.parts;
  const { tris } = buildTriangles([o], {});
  for (let i=0;i<tris.length;i++){ const t=tris[i];
    const c=[(t[0]+t[3]+t[6])/3,(t[1]+t[4]+t[7])/3,(t[2]+t[5]+t[8])/3];
    if (Math.hypot(c[0]-px,c[1]-py,c[2]-pz) > rr) continue;
    const ax=t[3]-t[0],ay=t[4]-t[1],az=t[5]-t[2],bx=t[6]-t[0],by=t[7]-t[1],bz=t[8]-t[2];
    let n=[ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx]; const nl=Math.hypot(...n)||1; n=n.map(v=>v/nl);
    let pn='-'; if(ps) for(const q of ps) if(i>=q.from&&i<q.to) pn=q.name;
    console.log(`  ${(o.tag+'/'+pn).padEnd(24)} c=${c.map(v=>v.toFixed(2)).join(',')} n=${n.map(v=>v.toFixed(2)).join(',')}`); }}
