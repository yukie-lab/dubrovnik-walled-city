import assert from 'node:assert/strict';
import * as THREE from 'three';
import {pipeShell,pipeBracketGeometry,pipeBoltGeometry,seatDownpipes,makeRainware} from '../src/rainware.js';
import {makeGroundSupport} from '../src/support.js';
import {meshTopology} from './structure/geom.mjs';
for(const [name,g] of [['shell',pipeShell()],['bracket',pipeBracketGeometry()],['bolt',pipeBoltGeometry()]]) {
  const t=meshTopology(g);assert.equal(t.boundaryEdges,0,name+' open metal edge');assert.equal(t.nonManifoldEdges,0,name+' nonmanifold');
  assert.equal(t.flippedEdges,0,name+' inconsistent winding');assert(t.volume>0,name+' inward faces');
  console.log(name,JSON.stringify({triangles:(g.index?.count||g.attributes.position.count)/3,volume:t.volume,boundaryEdges:t.boundaryEdges}));
  if(name==='shell') {
    const mesh=new THREE.Mesh(g,new THREE.MeshBasicMaterial()),ray=new THREE.Raycaster(new THREE.Vector3(0,1.1,0),new THREE.Vector3(0,-1,0));
    assert.equal(ray.intersectObject(mesh).length,0,'A downpipe must retain a hollow bore');
    ray.set(new THREE.Vector3(.053,1.1,0),new THREE.Vector3(0,-1,0));assert(ray.intersectObject(mesh).length>0,'Its rim has real wall thickness');
  }
}
for(const gap of [.079,.144,.30])for(const g of [pipeBracketGeometry(),pipeBoltGeometry()]) {
  const p=g.attributes.position,a=g.attributes.aRainAnchor;
  for(let i=0;i<p.count;i++)p.setZ(i,p.getZ(i)-a.getX(i)*(gap-.09));
  const t=meshTopology(g);assert.equal(t.boundaryEdges,0);assert.equal(t.flippedEdges,0);assert(t.volume>0,'Stretching only the connector keeps closed metal');
}
const geo=new THREE.PlaneGeometry(4,4,8,8);geo.rotateX(-Math.PI/2);const p=geo.attributes.position;
for(let i=0;i<p.count;i++)p.setY(i,p.getX(i)*.32+p.getZ(i)*.06);
const ground=new THREE.Mesh(geo);ground.name='ground.paving';const support=makeGroundSupport(ground);
const proposals=[{x:.3,z:.2,y:.8,h:5.3,seed:.18,nx:0,nz:1},{x:-.2,z:.4,y:-.4,h:4.7,seed:.61,nx:1,nz:0}];
const seated=seatDownpipes(proposals,support),built=makeRainware(proposals,support);
for(let i=0;i<seated.length;i++) {
  const q=seated[i];assert.equal(q.x,proposals[i].x);assert.equal(q.z,proposals[i].z);assert.equal(q.top,proposals[i].y+proposals[i].h);
  for(let k=0;k<48;k++) {
    const a=k*Math.PI/24,h=support.sample(q.x+Math.cos(a)*.055,q.z+Math.sin(a)*.055).y;
    assert(q.y<h && h-q.y<.061,'Every part of the rim enters the sloped street by a small amount');
  }
  const fixing=built.brackets.filter(b=>b.x===q.x && b.z===q.z);
  assert(fixing.length>=2);assert(fixing[0].y>q.supportHigh);assert(fixing.at(-1).y<q.top);
  for(let j=1;j<fixing.length;j++)assert(fixing[j].y-fixing[j-1].y<=1.85,'Unsupported spans stay bounded by one physical spacing');
}
console.log('Rainware support: fixed sites/eaves, hollow bore, closed metal, sloping drain entries and bounded bracket spacing passed.');
