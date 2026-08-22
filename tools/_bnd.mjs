// 境界稜線(= 穴の縁)がどこにあるかを部位ごとに吐く。
import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import { collectObjects, buildTriangles } from './structure/geom.mjs';
const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const want = process.argv[2] || 'body';
const objs = collectObjects(w.root).filter(o => o.tag === 'wall.curtain');
const parts = (objs[0].mesh.geometry.userData.parts || []).filter(q => q.name === want);
const { tris } = buildTriangles(objs, {});
const key = (x,y,z)=>`${Math.round(x*1000)},${Math.round(y*1000)},${Math.round(z*1000)}`;
const em = new Map();
for (const q of parts) for (let i=q.from;i<q.to;i++){ const t=tris[i];
  for (let e=0;e<3;e++){ const f=(e+1)%3;
    const a=key(t[e*3],t[e*3+1],t[e*3+2]), b=key(t[f*3],t[f*3+1],t[f*3+2]);
    if(a===b) continue; const k=a<b?a+'|'+b:b+'|'+a;
    let r=em.get(k); if(!r){r={n:0,p:[t[e*3],t[e*3+1],t[e*3+2]],q:[t[f*3],t[f*3+1],t[f*3+2]]};em.set(k,r);} r.n++; }}
const bnd=[...em.values()].filter(r=>r.n===1);
console.log(`${want}: 境界稜線 ${bnd.length}`);
// 連結成分(端点を共有する稜線をまとめる)= 穴 1 個
const uf=new Map(); const find=(x)=>{while(uf.get(x)!==x)x=uf.set(x,uf.get(uf.get(x))).get(x);return x;};
for(const r of bnd){ const a=key(...r.p),b=key(...r.q); if(!uf.has(a))uf.set(a,a); if(!uf.has(b))uf.set(b,b);
  const ra=find(a),rb=find(b); if(ra!==rb) uf.set(ra,rb); }
const grp=new Map();
for(const r of bnd){ const g=find(key(...r.p)); let s=grp.get(g); if(!s){s={n:0,lo:[1e9,1e9,1e9],hi:[-1e9,-1e9,-1e9]};grp.set(g,s);} s.n++;
  for(const p of [r.p,r.q]) for(let k=0;k<3;k++){ s.lo[k]=Math.min(s.lo[k],p[k]); s.hi[k]=Math.max(s.hi[k],p[k]); } }
console.log(`穴の数 ${grp.size}`);
for(const [g,s] of [...grp].sort((a,b)=>b[1].n-a[1].n).slice(0,12)){
  console.log(`  稜線${String(s.n).padStart(4)}  x${s.lo[0].toFixed(0)}..${s.hi[0].toFixed(0)} y${s.lo[1].toFixed(0)}..${s.hi[1].toFixed(0)} z${s.lo[2].toFixed(0)}..${s.hi[2].toFixed(0)}`);
  if (process.argv[3]) for(const r of bnd) if(find(key(...r.p))===g)
    console.log(`      ${r.p.map(v=>v.toFixed(3)).join(',')}  →  ${r.q.map(v=>v.toFixed(3)).join(',')}`);
}
