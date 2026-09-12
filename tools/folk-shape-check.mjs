import assert from 'node:assert/strict';
import * as THREE from 'three';
import {makeFolkGeometry} from '../src/folk-shape.js';

const shapes=makeFolkGeometry();let triangles=0;
for(const [name,g] of Object.entries(shapes)) {
  const p=g.attributes.position,n=g.attributes.normal,ix=g.index;
  const v=i=>new THREE.Vector3().fromBufferAttribute(p,ix.getX(i));
  const key=v=>v.toArray().map(x=>Math.round(x*1e7)).join(',');
  for(const range of g.userData.closedParts) {
    const edges=new Map();let volume=0;
    const origin=v(range.from*3);
    for(let i=range.from*3;i<range.to*3;i+=3) {
      const points=[v(i),v(i+1),v(i+2)],ks=points.map(key);
      const a=points[0],b=points[1],c=points[2];
      assert(b.clone().sub(a).cross(c.clone().sub(a)).length()>1e-12,`${name} zero face`);
      volume+=a.clone().sub(origin).dot(b.clone().sub(origin).cross(c.clone().sub(origin)))/6;
      for(let k=0;k<3;k++) {
        const a=ks[k],b=ks[(k+1)%3],edge=a<b ? a+'|'+b : b+'|'+a;
        const row=edges.get(edge)||[0,0];row[0]++;row[1]+=a<b ? 1 : -1;edges.set(edge,row);
      }
    }
    assert([...edges.values()].every(r=>r[0]===2 && r[1]===0),`${name} must be closed and consistently wound`);
    assert(volume>0,`${name} outward volume`);
  }
  for(let i=0;i<p.count;i++)assert(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-5,`${name} unit normals`);
  assert(p.count===g.attributes.aLimb.count && p.count===g.attributes.color.count);
  triangles+=ix.count/3;
  console.log(name,{vertices:p.count,triangles:ix.count/3,solids:g.userData.closedParts.length});
}
assert.equal(shapes.legs.boundingBox.min.y,0,'Entire shoe sole is seated at the rig origin');
assert(shapes.hair.boundingBox.max.y<1.93,'Original human height scale is retained');
assert(triangles<2400,'Five shared batches must remain modest geometry');
console.log('Closed folk shapes passed',triangles,'triangles per resident');
