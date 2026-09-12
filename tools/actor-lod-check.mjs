import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ActorBatchLOD} from '../src/actor-lod.js';

const walk=new THREE.InstancedBufferAttribute(Float32Array.from([.1,.2,.3,.4]),1);
const meshes=[0,1].map(()=>{
  const g=new THREE.BoxGeometry(.3,1.9,.3);g.setAttribute('aWalk',walk);
  g.setAttribute('aId',new THREE.InstancedBufferAttribute(Float32Array.from([100,101,102,103]),1));
  const m=new THREE.InstancedMesh(g,new THREE.MeshBasicMaterial(),4);m.castShadow=true;
  for(let i=0;i<4;i++)m.setMatrixAt(i,new THREE.Matrix4().makeTranslation(i*10,0,0));
  return m;
});
const lod=new ActorBatchLOD(meshes);
const view=[new THREE.Plane(new THREE.Vector3(1,0,0),-8),new THREE.Plane(new THREE.Vector3(-1,0,0),22)];
const shadow=[new THREE.Plane(new THREE.Vector3(1,0,0),28)]; // use a small independent box below
shadow[0].constant=-28;shadow.push(new THREE.Plane(new THREE.Vector3(-1,0,0),32));
const camera=new THREE.Vector3();
const update=(v=view,s=shadow)=>{lod.capture();lod.update(v,s,camera,1000,10,null,null);};
update();assert.deepEqual([...lod.ids.slice(0,3)],[1,2,3]);
for(const m of meshes) {
  assert.equal(m.count,3);
  assert.deepEqual([...m.geometry.attributes.aId.array.slice(0,3)],[101,102,103]);
  assert(Math.abs(m.geometry.attributes.aWalk.getX(0)-.2)<1e-6);
}
// Shared attributes restore to resident indices before the next animation.
lod.restore();assert(Math.abs(walk.getX(0)-.1)<1e-6);assert.equal(meshes[1].count,4);
for(const m of meshes)m.setMatrixAt(0,new THREE.Matrix4().makeTranslation(15,0,0));
walk.setX(0,.75);update();assert.equal(meshes[0].count,4);
assert.equal(meshes[1].geometry.attributes.aId.getX(0),100);assert.equal(walk.getX(0),.75);
// A completely empty batch can return, and disabling LOD restores all data.
lod.restore();update([new THREE.Plane(new THREE.Vector3(1,0,0),-100)],null);
assert.equal(meshes[0].count,0);lod.restore();
assert.equal(meshes[0].count,4);assert.equal(walk.getX(0),.75);
update();assert.equal(meshes[0].count,4);
console.log('Actor LOD: shadow retention, shared attributes, animated indices and empty recovery passed');
