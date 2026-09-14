// Independent rendered-geometry / texture metric audit. Area ratio 1 means
// one metre of UV describes one metre of the surface. No generator UV helper.
import {installDomShim} from './structure/domshim.mjs';
installDomShim();
import * as THREE from 'three';
import {writeFileSync} from 'node:fs';
const {buildWorld}=await import('../src/world.js');
const w=buildWorld(), rows=[];
const finishMaps=new Map(['wallStone','wallRubble','monumentStone','fortStone'].map(key=>[w.tex[key].map,key])),finishUsage=[];
w.root.traverse(mesh=>{
  if(!mesh.isMesh)return;
  for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]) {
    const family=finishMaps.get(material.map);
    if(family)finishUsage.push({tag:mesh.name,family,instances:mesh.isInstancedMesh?mesh.count:1});
  }
});
console.log('Shared masonry consumers',JSON.stringify(finishUsage));
const tags=new Map([
  ['house.body',3.2],['house.gableFin',3.2],['house.chimney',3.2],
  ['monument.stone',5],['monument.column',.9],['wall.curtain',4.2],['wall.merlon',4.2],
  ['surround.lovrijenac',4.2],['surround.pileBridge',4.2],['surround.arsenal',4.2],['surround.fortImperial',4.2],
]);
const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
w.root.traverse(m=>{
  const tag=m.name,cover=tags.get(tag);if(!cover)return;
  const g=m.geometry,p=g.attributes.position,uv=g.attributes.uv,ix=g.index;
  let min=Infinity,max=0,area=0,outArea=0,triangles=0,invalid=0;
  for(let k=0;k<(ix?.count||p.count);k+=3) {
    const ids=[0,1,2].map(d=>ix ? ix.getX(k+d) : k+d),[i,j,l]=ids;
    a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,j).sub(a);c.fromBufferAttribute(p,l).sub(a);
    const pa=b.cross(c).length()*.5;
    if(pa<1e-9)continue;
    const ua=Math.abs((uv.getX(j)-uv.getX(i))*(uv.getY(l)-uv.getY(i))-(uv.getX(l)-uv.getX(i))*(uv.getY(j)-uv.getY(i)))*.5;
    const r=Math.sqrt(pa/ua)/cover;
    if(!Number.isFinite(r))invalid++;
    min=Math.min(min,r);max=Math.max(max,r);area+=pa;triangles++;
    if(r<.7||r>1.4)outArea+=pa;
  }
  const row={tag,instances:m.isInstancedMesh ? m.count : null,triangles,min,max,outsideMetricAreaPercent:100*outArea/area,invalid};
  rows.push(row);console.log(JSON.stringify(row));
});
const folk=w.life.folk.map(f=>({x:f.x,y:f.y,z:f.z,h:f.h,wx:f.wx,wz:f.wz,rotY:f.rotY,seed:f.seed,sit:f.sit||0}));
console.log('People',folk.length,'seated',folk.filter(f=>f.sit).length);
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify({rows,finishUsage,folk},null,2)+'\n');
if(rows.length!==tags.size||rows.some(r=>r.invalid))process.exitCode=1;
