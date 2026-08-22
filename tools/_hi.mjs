import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import { collectObjects, buildTriangles } from './structure/geom.mjs';
const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const T = w.plan.TOWERS[process.argv[2] || 'stjohn'];
console.log('塔', process.argv[2], JSON.stringify({x:T.x,z:T.z,r:T.r,crownR:T.crownR,crownY0:T.crownY0,topY:T.topY,galleryY:T.galleryY,terraceR:T.terraceR}));
const objs = collectObjects(w.root).filter(o => o.tag === 'wall.curtain');
const parts = objs[0].mesh.geometry.userData.parts;
const { tris } = buildTriangles(objs, {});
const lim = T.topY + 1.36;
const rows = [];
for (const q of parts) for (let i=q.from;i<q.to;i++){ const t=tris[i];
  let mx=-1e9, near=1e9;
  for(let k=0;k<3;k++){ mx=Math.max(mx,t[k*3+1]); near=Math.min(near, Math.hypot(t[k*3]-T.x, t[k*3+2]-T.z)); }
  if (mx > lim && near < T.crownR*1.3) rows.push({p:q.name, mx, t, near}); }
rows.sort((a,b)=>b.mx-a.mx);
console.log(`crownTop=${lim.toFixed(2)} を超える三角: ${rows.length}`);
for(const r of rows.slice(0,10)){
  const v=[0,1,2].map(k=>[r.t[k*3].toFixed(1),r.t[k*3+1].toFixed(2),r.t[k*3+2].toFixed(1)].join(','));
  console.log(`  ${r.p} 最高${r.mx.toFixed(2)} r=${r.near.toFixed(1)}  ${v.join(' | ')}`); }
