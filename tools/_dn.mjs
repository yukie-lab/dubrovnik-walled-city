import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import { collectObjects, buildTriangles } from './structure/geom.mjs';
const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const objs = collectObjects(w.root).filter(o=>o.tag==='wall.curtain');
const parts = objs[0].mesh.geometry.userData.parts;
const { tris } = buildTriangles(objs, {});
const acc = new Map();
for (const q of parts) for (let i=q.from;i<q.to;i++){ const t=tris[i];
  const ax=t[3]-t[0],ay=t[4]-t[1],az=t[5]-t[2],bx=t[6]-t[0],by=t[7]-t[1],bz=t[8]-t[2];
  const n=[ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx]; const nl=Math.hypot(...n)||1;
  const A=nl/2; const ny=n[1]/nl;
  const key = q.name + (ny<-0.5?' 下':ny>0.5?' 上':' 横');
  const r=acc.get(key)||{a:0,n:0}; r.a+=A; r.n++; acc.set(key,r); }
for(const [k,r] of [...acc].sort((a,b)=>b[1].a-a[1].a).slice(0,16))
  console.log(`  ${k.padEnd(16)} 面積 ${r.a.toFixed(0).padStart(6)}m²  三角 ${r.n}`);
