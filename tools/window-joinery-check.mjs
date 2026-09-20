import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {windowStoneGeometry,windowSashGeometry} from '../src/window-joinery.js';
import {installDomShim} from './structure/domshim.mjs';

// Inspect the actual triangle streams. Disjoint part AABBs prove that their
// closed volumes cannot penetrate; contacts are allowed within Float32 error.
function audit(geometry) {
  const p=geometry.attributes.position,n=geometry.attributes.normal,parts=[];
  assert(!geometry.index);
  for(const range of geometry.userData.windowParts) {
    const edges=new Map(),box=new THREE.Box3(),front=new THREE.Box3();let volume=0;
    for(let j=range.from*3;j<range.to*3;j+=3) {
      const v=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(p,j+k));
      const face=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0]));
      assert(face.length()>1e-10,'Degenerate triangle in '+range.name);
      face.normalize();
      for(let k=0;k<3;k++) {
        box.expandByPoint(v[k]);
        assert(face.dot(new THREE.Vector3().fromBufferAttribute(n,j+k))>.99999,'Normal does not describe the real planar face');
        if(face.z>.99999)front.expandByPoint(v[k]);
        const a=v[k].toArray().join(','),b=v[(k+1)%3].toArray().join(','),key=a<b?a+'|'+b:b+'|'+a;
        const count=edges.get(key)||[0,0];count[0]++;count[1]+=a<b?1:-1;edges.set(key,count);
      }
      volume+=v[0].dot(v[1].clone().cross(v[2]))/6;
    }
    assert(volume>0,'Inward volume in '+range.name);
    assert([...edges.values()].every(([count,direction])=>count===2&&direction===0),'Open or non-manifold part '+range.name);
    parts.push({name:range.name,box,front,volume,triangles:range.to-range.from});
  }
  for(const attribute of Object.values(geometry.attributes))assert(attribute.array.every(Number.isFinite));
  return parts;
}

let meshes,world;
if(process.argv.includes('--unit'))meshes=[{name:'stone',geometry:windowStoneGeometry()},{name:'sash',geometry:windowSashGeometry()}];
else {
  installDomShim();const {buildWorld}=await import('../src/world.js');world=buildWorld({life:false,sky:false,sea:false});
  meshes=['window.frame','window.sash'].map(name=>world.root.getObjectByName(name));
  assert(meshes.every(Boolean),'Both shared instance batches must be present in the live world');
}
const parts=meshes.flatMap(mesh=>audit(mesh.geometry).map(part=>({...part,batch:mesh.name})));
const penetrations=[],coplanarFront=[];
for(let i=0;i<parts.length;i++)for(let j=i+1;j<parts.length;j++) {
  const a=parts[i],b=parts[j],overlap=a.box.clone().intersect(b.box).getSize(new THREE.Vector3());
  if(Math.min(...overlap.toArray())>1e-6)penetrations.push([a.name,b.name]);
  if(Math.abs(a.front.max.z-b.front.max.z)<1e-6) {
    const face=a.front.clone().intersect(b.front).getSize(new THREE.Vector3());
    if(face.x>1e-6&&face.y>1e-6)coplanarFront.push([a.name,b.name]);
  }
}
assert.equal(penetrations.length,0,'Generated pieces penetrate');
assert.equal(coplanarFront.length,0,'Visible front faces overlap');
let matrixSha,windowsSha;
if(world) {
  const hash=a=>createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
  matrixSha=hash(meshes[0].instanceMatrix.array);
  windowsSha=createHash('sha256').update(JSON.stringify(world.buildings.windows)).digest('hex');
  const baseline=JSON.parse(readFileSync(new URL('../docs/september-window-baseline.json',import.meta.url),'utf8'));
  assert.equal(matrixSha,baseline.matrixSha,'Window placement, rotation or scale changed');
  assert.equal(windowsSha,baseline.windowsSha,'Window records changed');
  for(const mesh of meshes) {
    assert.equal(mesh.count,1915);assert.equal(hash(mesh.instanceMatrix.array),matrixSha);
    assert.notEqual(meshes[0].instanceMatrix,meshes[1].instanceMatrix,'LOD streams must have independent ownership');
    const seeds=mesh.geometry.attributes.aWindowSeed;
    for(let i=0;i<mesh.count;i++)assert.equal(seeds.getX(i),Math.fround(world.buildings.windows[i].seed));
  }
}
const report={instances:world?meshes[0].count:null,closedParts:parts.length,triangles:parts.reduce((s,p)=>s+p.triangles,0),
  penetrations,coplanarFront,matrixSha,windowsSha};
console.log(JSON.stringify(report,null,2));
if(world)writeFileSync(new URL('../shots/rendercheck/sept23-window-geometry.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
