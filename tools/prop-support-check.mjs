import assert from 'node:assert/strict';
import * as THREE from 'three';
import {makeGroundSupport} from '../src/support.js';
import {seatRoundProp} from '../src/prop-support.js';
import {makePottedPlants} from '../src/plants.js';

const plane=new THREE.PlaneGeometry(8,8,2,2);plane.rotateX(-Math.PI/2);
const p=plane.attributes.position;
for(let i=0;i<p.count;i++)p.setY(i,.08*p.getX(i)+.035*p.getZ(i));
const mesh=new THREE.Mesh(plane,new THREE.MeshBasicMaterial());mesh.name='ground.paving';
const support=makeGroundSupport(mesh);
const proposal={x:.5,z:.3,y:.05,s:1.1,seed:.6,boug:false};
const seat=seatRoundProp(proposal,support);
assert(seat && seat.s===proposal.s,'A gentle slope must retain the vessel size');
const plants=makePottedPlants([seat],()=>.5,{value:40});
const pot=plants.group.getObjectByName('life.flowerPot'),matrix=new THREE.Matrix4();pot.getMatrixAt(0,matrix);
for(let i=0;i<64;i++) {
  const a=i*Math.PI/32,point=new THREE.Vector3(Math.cos(a)*.229,0,Math.sin(a)*.229).applyMatrix4(matrix);
  assert(Math.abs(point.y-(.08*point.x+.035*point.z))<1e-6,'The real transformed base must touch the sloped plane');
}
const root=new THREE.Vector3(0,.34,0).applyMatrix4(matrix),stem=plants.group.getObjectByName('life.plantStem');
const stemMatrix=new THREE.Matrix4();stem.getMatrixAt(0,stemMatrix);
assert(root.distanceTo(new THREE.Vector3().setFromMatrixPosition(stemMatrix))<1e-6,'Tilting a pot must also attach its stem to the soil');
const wind=stem.geometry.attributes.aWindRoot;
assert(root.distanceTo(new THREE.Vector3(wind.getX(0),wind.getY(0),wind.getZ(0)))<1e-6,'Wind pivot must follow the same attachment');

// A step edge is discontinuous. It must never be accepted as a tilted plane.
const flat=new THREE.Mesh(new THREE.PlaneGeometry(8,8).rotateX(-Math.PI/2));flat.name='ground.paving';
const steps=[{x:0,z:0,y:.16,w:3,d:.4,rotY:0},{x:0,z:.4,y:.32,w:3,d:.4,rotY:0}];
const stepped=makeGroundSupport(flat,steps);
assert.equal(stepped.disk(0,.18,.23,1,.006,.18),null,'A riser cannot masquerade as a slope');
const q=seatRoundProp({x:0,z:.18,y:.16,s:1,seed:.3},stepped);
assert(q,'Find a real seat within the existing treads');
assert(stepped.disk(q.x,q.z,.24*q.s,1,.006,.18),'The entire new footprint must fit');
assert(Math.abs(q.up[1]-1)<1e-8,'A horizontal tread must keep the pot upright');
console.log('Rigid prop support passed: exact sloped-base contact, shared soil/stem/wind transform, step discontinuity and a fitted tread seat.');
