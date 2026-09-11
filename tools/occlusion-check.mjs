import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeHouseOcclusion } from '../src/occlusion.js';
const houses=[{x:0,z:-5,w:2,d:2,yBase:-1,eaves:1},{x:12,z:8,w:3,d:4,yBase:0,eaves:4}];
const occlusion=makeHouseOcclusion(houses);
assert(occlusion.blocked(0,0,0,0,0,-10,.2));
assert(!occlusion.blocked(0,0,0,0,0,-2,.2),'An occluder behind a leaf cannot hide it');
assert(!occlusion.blocked(0,0,0,2.5,0,-10,.3),'Visible silhouette edges must survive');
assert(!occlusion.blocked(0,0,0,0,0,-10,1.1),'A solid smaller than the sphere cannot occlude it');
assert(!occlusion.blocked(0,0,-5,0,0,-10,.2),'An observing camera inside a house must not hide the outside');
assert(!occlusion.blocked(0,4,0,0,4,-10,.2),'Detail above the eaves remains visible');
assert(occlusion.blocked(12,2,20,12,2,0,.3),'Grid traversal must work in either direction');
// Independent rays cover the entire silhouette, for many random directions.
// Every conservative positive must actually hit a rendered closed box first.
const solids=houses.map(h=>{const m=new THREE.Mesh(new THREE.BoxGeometry(h.w,h.eaves-h.yBase,h.d),new THREE.MeshBasicMaterial());
  m.position.set(h.x,(h.yBase+h.eaves)/2,h.z);m.updateMatrixWorld();return m;});
let checked=0;
const ray=new THREE.Raycaster(),origin=new THREE.Vector3(),target=new THREE.Vector3();
for(let k=0;k<600;k++) {
  const a=k*2.399963,r=.05+(k%11)*.035;
  origin.set(Math.cos(a)*15,((k*7)%15)-5,Math.sin(a)*15);
  target.set(Math.cos(a+2.5)*12,((k*11)%11)-3,Math.sin(a+2.5)*12);
  if(!occlusion.blocked(...origin.toArray(),...target.toArray(),r))continue;
  for(let j=0;j<80;j++) {
    const y=1-2*(j+.5)/80,phi=j*2.399963,s=Math.sqrt(1-y*y);
    const point=target.clone().add(new THREE.Vector3(Math.cos(phi)*s,y,Math.sin(phi)*s).multiplyScalar(r));
    const direction=point.clone().sub(origin),distance=direction.length();
    ray.set(origin,direction.normalize());ray.far=distance;
    assert(ray.intersectObjects(solids,false).length,'Occlusion produced a false positive at a sphere edge');
    checked++;
  }
}
assert(checked>100,'Random rays must exercise real occluders');
console.log(`Occlusion passed: near/far, grazing edge, oversized detail, inside camera, eaves; ${checked} independent silhouette rays.`);
