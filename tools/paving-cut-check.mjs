import assert from 'node:assert/strict';
import * as THREE from 'three';
import {cutPavingAtSteps} from '../src/paving-cut.js';

const g=new THREE.PlaneGeometry(8,8,4,4);g.rotateX(-Math.PI/2);
const pos=g.attributes.position;
// Sloped source and a globally affine UV field make attribute interpolation
// independently testable even where several rotated rectangles intersect.
for(let i=0;i<pos.count;i++)pos.setY(i,.2*pos.getX(i)+.1*pos.getZ(i));
g.computeVertexNormals();
for(const steps of [
  [{x:0,z:0,w:2,d:3,rotY:0}],
  [{x:0,z:0,w:2,d:3,rotY:.71}],
  [{x:0,z:0,w:2,d:3,rotY:.71},{x:.6,z:.5,w:2,d:3,rotY:-.3}],
]) {
  const result=cutPavingAtSteps(g,steps),p=result.attributes.position;
  let area=0;
  for(let i=0;i<p.count;i+=3) {
    const a=new THREE.Vector3().fromBufferAttribute(p,i),b=new THREE.Vector3().fromBufferAttribute(p,i+1),c=new THREE.Vector3().fromBufferAttribute(p,i+2);
    const n=b.clone().sub(a).cross(c.clone().sub(a));assert(n.y>0,'winding');area+=n.y/2;
    const m=a.add(b).add(c).divideScalar(3);
    for(const s of steps) {
      const dx=m.x-s.x,dz=m.z-s.z,co=Math.cos(s.rotY),si=Math.sin(s.rotY);
      assert(Math.abs(dx*co-dz*si)>=s.w/2-1e-6 || Math.abs(dx*si+dz*co)>=s.d/2-1e-6,'interior paving survived');
    }
  }
  if(steps.length===1)assert(Math.abs(area-58)<1e-5,'removed area differs from exact rectangle');
  for(let i=0;i<p.count;i++) {
    assert(Math.abs(p.getY(i)-(.2*p.getX(i)+.1*p.getZ(i)))<1e-6);
    assert(Math.abs(result.attributes.uv.getX(i)-(p.getX(i)/8+.5))<1e-6);
    assert(Math.abs(result.attributes.uv.getY(i)-(.5-p.getZ(i)/8))<1e-6);
  }
}
console.log('Paving clipping passed: exact removed area, overlapping rotated stones, upward winding, affine height and UV interpolation.');
