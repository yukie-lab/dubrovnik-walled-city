// カメラ位置と画面座標から実三角形へレイを飛ばし、当たった順に「部位・法線・
// 表裏」を並べる。裏面カリングで消えた面を特定するための計器。
import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import { collectObjects, buildTriangles } from './structure/geom.mjs';
const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const [ox,oy,oz,yaw,pitch,fov,sx,sy] = process.argv.slice(2).map(Number);
const th = Math.tan(fov*Math.PI/360), aspect = 1.6;
const ndcX = sx/1600*2-1, ndcY = -(sy/1000*2-1);
const cy=Math.cos(yaw), sy2=Math.sin(yaw), cp=Math.cos(pitch), sp=Math.sin(pitch);
// YXZ: forward = (-sin y cos p, sin p, -cos y cos p)
const F=[-sy2*cp, sp, -cy*cp], R=[cy,0,-sy2];
const U=[R[1]*F[2]-R[2]*F[1], R[2]*F[0]-R[0]*F[2], R[0]*F[1]-R[1]*F[0]];
let d=[F[0]+R[0]*ndcX*th*aspect+U[0]*ndcY*th, F[1]+R[1]*ndcX*th*aspect+U[1]*ndcY*th, F[2]+R[2]*ndcX*th*aspect+U[2]*ndcY*th];
const dl=Math.hypot(...d); d=d.map(v=>v/dl);
console.log('dir', d.map(v=>v.toFixed(3)).join(','));
const rayTri=(o,dd,t)=>{ const e1=[t[3]-t[0],t[4]-t[1],t[5]-t[2]],e2=[t[6]-t[0],t[7]-t[1],t[8]-t[2]];
  const p=[dd[1]*e2[2]-dd[2]*e2[1],dd[2]*e2[0]-dd[0]*e2[2],dd[0]*e2[1]-dd[1]*e2[0]];
  const det=e1[0]*p[0]+e1[1]*p[1]+e1[2]*p[2]; if(Math.abs(det)<1e-12) return -1; const inv=1/det;
  const tv=[o[0]-t[0],o[1]-t[1],o[2]-t[2]]; const u=(tv[0]*p[0]+tv[1]*p[1]+tv[2]*p[2])*inv; if(u<0||u>1)return -1;
  const q=[tv[1]*e1[2]-tv[2]*e1[1],tv[2]*e1[0]-tv[0]*e1[2],tv[0]*e1[1]-tv[1]*e1[0]];
  const v=(dd[0]*q[0]+dd[1]*q[1]+dd[2]*q[2])*inv; if(v<0||u+v>1)return -1; return (e2[0]*q[0]+e2[1]*q[1]+e2[2]*q[2])*inv; };
const hits=[];
for (const o of collectObjects(w.root)) {
  if (o.backdrop || o.isPoints) continue;
  const ps = o.mesh?.geometry?.userData?.parts;
  const { tris } = buildTriangles([o], {});
  for (let i=0;i<tris.length;i++){ const t=tris[i]; const dist=rayTri([ox,oy,oz],d,t); if(!(dist>0.05)) continue;
    const ax=t[3]-t[0],ay=t[4]-t[1],az=t[5]-t[2],bx=t[6]-t[0],by=t[7]-t[1],bz=t[8]-t[2];
    let n=[ay*bz-az*by, az*bx-ax*bz, ax*by-ay*bx]; const nl=Math.hypot(...n)||1; n=n.map(v=>v/nl);
    let pn='-'; if(ps) for(const q of ps) if(i>=q.from&&i<q.to) pn=q.name;
    hits.push({dist, tag:o.tag, pn, n, back: n[0]*d[0]+n[1]*d[1]+n[2]*d[2] > 0, side: o.mesh?.material?.side}); }}
hits.sort((a,b)=>a.dist-b.dist);
for(const h of hits.slice(0,8))
  console.log(`  ${h.dist.toFixed(2)}m  ${(h.tag+'/'+h.pn).padEnd(26)} n=${h.n.map(v=>v.toFixed(2)).join(',')} ${h.back?'裏面':'表面'} side=${h.side}`);
