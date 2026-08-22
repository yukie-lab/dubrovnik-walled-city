import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import { collectObjects, buildTriangles, Grid } from './structure/geom.mjs';
const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const objs = collectObjects(w.root);
const partsOf = new Map();
for (const o of objs) if (o.mesh?.geometry?.userData?.parts) partsOf.set(o, o.mesh.geometry.userData.parts);
const rayTri=(ox,oy,oz,dx,dy,dz,t)=>{ const e1=[t[3]-t[0],t[4]-t[1],t[5]-t[2]],e2=[t[6]-t[0],t[7]-t[1],t[8]-t[2]];
  const px=dy*e2[2]-dz*e2[1],py=dz*e2[0]-dx*e2[2],pz=dx*e2[1]-dy*e2[0];
  const det=e1[0]*px+e1[1]*py+e1[2]*pz; if(Math.abs(det)<1e-12) return -1; const inv=1/det;
  const tx=ox-t[0],ty=oy-t[1],tz=oz-t[2]; const u=(tx*px+ty*py+tz*pz)*inv; if(u<0||u>1)return -1;
  const qx=ty*e1[2]-tz*e1[1],qy=tz*e1[0]-tx*e1[2],qz=tx*e1[1]-ty*e1[0];
  const v=(dx*qx+dy*qy+dz*qz)*inv; if(v<0||u+v>1)return -1; return (e2[0]*qx+e2[1]*qy+e2[2]*qz)*inv; };
for (const arg of process.argv.slice(2)) {
  const [x, z] = arg.split(',').map(Number);
  const hits = [];
  for (const o of objs) {
    if (o.backdrop || o.isPoints) continue;
    const { tris } = buildTriangles([o], {});
    const ps = partsOf.get(o);
    for (let i = 0; i < tris.length; i++) {
      const d = rayTri(x, 60, z, 0, -1, 0, tris[i]);
      if (d > 0) { let pn='-'; if(ps) for(const q of ps) if(i>=q.from&&i<q.to) pn=q.name;
        hits.push({ y: 60 - d, tag: o.tag, pn }); }
    }
  }
  hits.sort((a,b)=>b.y-a.y);
  console.log(`(${x}, ${z})`);
  for (const h of hits.slice(0, 30)) console.log(`   y=${h.y.toFixed(2)}  ${h.tag}/${h.pn}`);
}
