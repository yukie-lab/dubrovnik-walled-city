import assert from 'node:assert/strict';
import * as THREE from 'three';
import {makeStepStone,stepSurfaceAt} from '../src/step-stone.js';

// Independent triangle rays verify the public support query, including the
// rounded corners. Topology is checked after actual Float32 world transforms.
let cases=0,maxError=0,badSupport=0;
for(const w of [.72,2.9,4.3])for(const d of [.14,.38,1.1])for(const rotY of [0,.71,2.1]) {
  const q={x:174.31,y:29.12,z:-82.81,w,d,rotY,run:12,step:7},g=makeStepStone(q),p=g.attributes.position,ix=g.index;
  const edges=new Map(),v=i=>new THREE.Vector3().fromBufferAttribute(p,ix.getX(i));let volume=0;
  const origin=v(0),normal=new THREE.Vector3();
  for(let i=0;i<ix.count;i+=3) {
    const a=v(i),b=v(i+1),c=v(i+2),area=b.clone().sub(a).cross(c.clone().sub(a)).length();
    assert(area>1e-12,'No collapsed rounded faces');
    volume+=a.clone().sub(origin).dot(b.clone().sub(origin).cross(c.clone().sub(origin)))/6;
    const ids=[a,b,c].map(v=>v.toArray().map(x=>Math.round(x*1e6)).join(','));
    for(let j=0;j<3;j++) {
      const a=ids[j],b=ids[(j+1)%3],key=a<b ? a+'|'+b : b+'|'+a,r=edges.get(key)||[0,0];
      r[0]++;r[1]+=a<b ? 1 : -1;edges.set(key,r);
    }
  }
  assert([...edges.values()].every(r=>r[0]===2 && r[1]===0),'Closed outward stone, including cut ends');
  assert(volume>0);
  const mesh=new THREE.Mesh(g,new THREE.MeshBasicMaterial()),ray=new THREE.Raycaster();
  for(const u of [-.499,-.35,-.13,0,.22,.499])for(const t of [-.499,-.48,-.44,-.15,0,.28,.46,.49,.499]) {
    const x=q.x+Math.cos(rotY)*w*u+Math.sin(rotY)*d*t,z=q.z-Math.sin(rotY)*w*u+Math.cos(rotY)*d*t;
    ray.set(new THREE.Vector3(x,q.y+1,z),new THREE.Vector3(0,-1,0));
    const hit=ray.intersectObject(mesh,false)[0],height=stepSurfaceAt(q,x,z);
    assert(hit && height!==null,'No opening in the rendered tread');
    const error=Math.abs(hit.point.y-height);maxError=Math.max(maxError,error);
    if(error>.000015)badSupport++;
  }
  for(let i=0;i<p.count;i++)assert(Math.abs(normal.fromBufferAttribute(g.attributes.normal,i).length()-1)<1e-5);
  assert.equal(stepSurfaceAt(q,q.x+100,q.z),null);
  cases++;g.dispose();mesh.material.dispose();
}
console.log(JSON.stringify({cases,maxSupportErrorMm:maxError*1000,badSupport,closed:true}));
assert(maxError<.000015,'Float32 rendered support agrees within 0.015 mm');
