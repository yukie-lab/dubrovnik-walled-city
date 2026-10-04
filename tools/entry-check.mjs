import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {installDomShim} from './structure/domshim.mjs';
import {Player} from '../src/player.js';
import {entryDoorTarget} from '../src/entry-door.js';
installDomShim();
const {buildWorld}=await import('../src/world.js');
const w=buildWorld(),results=[];
assert.equal(w.interiors.length,2);assert.equal(w.plan.houses.length,665);
const walk=(p,seconds)=>{for(let i=0;i<seconds*60;i++)p.update(1/60,new Set(['KeyW']));};
const ray=new THREE.Raycaster();
for(const door of w.entryDoors) {
  const r=door.layout,p=new Player(w.plan,r.approach);
  walk(p,5);assert(p.z>r.z1,'Closed door must prevent walking through');
  const target=(x,z,yaw=0,groundY=r.floor)=>entryDoorTarget(w.entryDoors,
    new THREE.Ray(new THREE.Vector3(x,groundY+1.62,z),new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw))),groundY);
  assert.equal(target(r.doorX,r.z1+3)?.door,door);
  assert.equal(target(r.doorX,r.z1+8),null,'Distant door must not act');
  assert.equal(target(r.doorX+3,r.z1+2),null,'Adjacent wall must not act');
  assert.equal(target(r.doorX,r.z1+2,0,r.ceiling+1),null,'Upper floor must not act');
  door.open=true;door.update(1);w.root.updateMatrixWorld(true);
  p.teleport(r.doorX,r.z1+1.2,0,0,r.floor);walk(p,3);
  assert.equal(p.zone,'interior');assert.equal(p.groundY,r.floor);
  assert.equal(target(r.doorX,r.z1-1.65,Math.PI)?.inside,true);
  const hit=(x,y,z,direction,far=2)=>{
    ray.set(new THREE.Vector3(x,y,z),new THREE.Vector3(...direction));ray.far=far;
    return ray.intersectObjects([w.ground.group,w.buildings.group,w.monuments.group,...w.interiors.map(i=>i.group)],true)[0];
  };
  assert(!hit(r.doorX,r.floor+1.62,r.z1+.6,[0,0,-1],2),'Open door must have no facade or fake plane across it');
  for(const depth of [.1,.5,1.5,3,4,5,6]) {
    const z=r.z1-depth;
    const floor=hit(r.doorX,r.floor+.5,z,[0,-1,0],1);
    assert(floor&&Math.abs(floor.point.y-r.floor)<.002,`${r.id}: visible floor at depth ${depth}: ${floor?.point.y}`);
    assert(hit(r.doorX,r.floor+1.62,z,[0,1,0],8),`${r.id}: missing ceiling`);
  }
  let floorSamples=0;
  for(let x=r.x0+r.wall+.5;x<r.x1-r.wall-.5;x+=2)for(let z=r.z0+r.wall+.5;z<r.z1-.5;z+=2) {
    const c=w.plan.walkingCollide(x,z,.35,r.floor+1);
    if(Math.hypot(c.x-x,c.z-z)>.001)continue;
    const surface=hit(x,r.floor+.5,z,[0,-1,0],1);
    assert(surface?.object.name==='interior.floor'&&Math.abs(surface.point.y-r.floor)<.002,`${r.id}: incorrect visible floor at ${x}/${z}: ${surface?.object.name}/${surface?.point.y}`);
    floorSamples++;
  }
  assert(w.life.folk.every(f=>!r.contains(f.x,f.z)||f.y>r.ceiling),'Outdoor crowd leaked into the room');
  if(r.displays) {
    const d=r.displays[0];p.teleport(d.x,d.z+1.7,0,0,r.floor);walk(p,3);
    assert(p.z>=d.z+.7+.35-1e-5,'Display cabinet collision');
    const b=r.benches[0];p.teleport(b.x,b.z+1,0,0,r.floor);walk(p,3);
    assert(p.z>=b.z+.32+.35-1e-5,'Bench collision');
  }
  // Main aisle reaches the rear; walls and furniture still stop the body.
  p.teleport(r.doorX,r.z1-1.65,0,0,r.floor);walk(p,15);
  assert(p.z>=r.z0+r.wall+.35-1e-5,'Rear wall collision');
  p.teleport(r.doorX,r.z1-2,Math.PI,0,r.floor);walk(p,4);
  assert(p.z>r.z1+.5&&p.zone!=='interior','Walk back out');
  results.push({id:r.id,closedDoorBlocks:true,raySelection:true,physicalOpening:true,floorSamples,ceiling:true,walkInOut:true,outdoorCrowdExcluded:true});
}
const output=process.argv.indexOf('--output');
if(output>=0)writeFileSync(process.argv[output+1],JSON.stringify({results},null,2)+'\n');
console.log(JSON.stringify(results,null,2));
