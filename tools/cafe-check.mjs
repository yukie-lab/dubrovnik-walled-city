import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {installDomShim} from './structure/domshim.mjs';
import {Player} from '../src/player.js';
installDomShim();
const {buildWorld}=await import('../src/world.js');
const w=buildWorld(),r=w.cafe.layout,results=[];
assert.equal(w.plan.interiors.length,1);
assert.equal(w.plan.houses.length,665);
const walk=(p,keys,seconds)=>{for(let i=0;i<seconds*60;i++)p.update(1/60,new Set(keys));};
const p=new Player(w.plan,r.approach);
walk(p,['KeyW'],4);
assert.equal(p.zone,'interior');assert(Math.abs(p.groundY-r.floor)<1e-8);
const entered={x:p.x,z:p.z,y:p.groundY};
p.yaw=Math.PI;walk(p,['KeyW'],4.5);
assert(p.z>r.z1+.5,'The same doorway must allow returning to the street');
assert.equal(p.zone,'stradun');results.push({test:'walk in and out',entered,exit:{x:p.x,z:p.z,y:p.groundY}});

// Press into every closed wall and furniture footprint using the real player,
// including a diagonal corner and the arch jamb from the street.
const cases=[
  ['rear',r.doorX,r.z1-1.1,0,10,p=>p.z>=r.z0+r.wall+.35-1e-6],
  ['right',r.house.x,r.z0+3.1,-Math.PI/2,6,p=>p.x<=r.x1-r.wall-.35+1e-6],
  ['counter',r.house.x,r.counter.z,Math.PI/2,6,p=>p.x>=r.counter.x+r.counter.w/2+.35-1e-6],
  ['jamb',r.doorX+1.25,r.z1+1.1,0,4,p=>p.z>=r.z1+.275+.35-1e-6],
  ['table',r.house.x,r.tables[0].z,-Math.PI/2,5,p=>p.x<=r.tables[0].x-.43-.35+1e-6],
  ['diagonal',r.house.x,r.z0+3.1,-Math.PI/4,8,p=>p.x<=r.x1-r.wall-.35+1e-6&&p.z>=r.z0+r.wall+.35-1e-6],
];
for(const [name,x,z,yaw,seconds,check] of cases) {
  const visitor=new Player(w.plan,{x,z,yaw,groundY:r.floor});walk(visitor,['KeyW','ShiftLeft'],seconds);
  assert(check(visitor),`${name}: player crossed a physical obstruction`);
  results.push({test:name,x:visitor.x,z:visitor.z,y:visitor.groundY});
}

// Inspect rendered triangles, independently of the room's collision records.
const solids=[w.ground.group,w.buildings.group,w.cafe.group],ray=new THREE.Raycaster();
w.root.updateMatrixWorld(true);
const hit=(x,y,z,dir,far=20)=>{ray.set(new THREE.Vector3(x,y,z),new THREE.Vector3(...dir));ray.far=far;return ray.intersectObjects(solids,true)[0];};
for(const depth of [.1,.4,1,2,3,4,5,6]) {
  const x=r.doorX,z=r.z1-depth;
  const floor=hit(x,r.floor+.2,z,[0,-1,0],.5);
  assert(floor&&Math.abs(floor.point.y-r.floor)<2e-5,`Missing/penetrating rendered floor at depth ${depth}`);
  const ceiling=hit(x,r.floor+1.62,z,[0,1,0]);
  assert(ceiling&&ceiling.point.y>=r.floor+2.5&&ceiling.point.y<=r.ceiling+.2,'Missing ceiling');
}
const entry=hit(r.doorX,r.floor+1.62,r.z1+.6,[0,0,-1],1.8);
assert(!entry,'The opening still contains a rendered wall or fake shop plane');
for(const [x,z,dir] of [[r.x0+r.wall+.6,r.z0+3,[ -1,0,0]],
  [r.x1-r.wall-.6,r.z0+3,[1,0,0]],[r.house.x,r.z0+r.wall+.6,[0,0,-1]]])
  assert(hit(x,r.floor+1.62,z,dir,1),'Missing rendered interior wall');
assert(w.cafe.meterAt(new THREE.Vector3(r.doorX,r.floor+1.62,r.z1-3))?.local>0);
assert.equal(w.cafe.meterAt(new THREE.Vector3(r.doorX,r.floor+1.62,r.z1+1)),null);
results.push({test:'rendered floor / ceiling / opening / walls / bounded room meter',pass:true});
const report={house:{x:r.house.x,z:r.house.z,w:r.house.w,d:r.house.d},entry:r.approach,results};
const output=process.argv.indexOf('--output');if(output>=0)writeFileSync(process.argv[output+1],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
