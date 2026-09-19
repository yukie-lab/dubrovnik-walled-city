import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildPlan} from '../src/plan.js';
import {mulberry32} from '../src/util.js';
import {makeHouseOcclusion} from '../src/occlusion.js';
import {installDomShim} from './structure/domshim.mjs';
import {makeTextures} from '../src/tex.js';
import {makeMonuments} from '../src/monuments.js';

// Independent unaccelerated Three ray/box intersections. Exercise the real
// city's sloping heights, including rays which enter its footprint far above
// its roofs, reverse directions, grid boundaries and radius-eroded roofs.
installDomShim();const plan=buildPlan();makeMonuments(plan,makeTextures());
const houses=plan.houses,grid=makeHouseOcclusion(houses),random=mulberry32(0xcef013);
const boxes=houses.map(h=>new THREE.Box3(new THREE.Vector3(h.x-h.w/2,h.yBase,h.z-h.d/2),
  new THREE.Vector3(h.x+h.w/2,h.eaves,h.z+h.d/2)));
const expanded=new THREE.Box3(),eroded=new THREE.Box3(),origin=new THREE.Vector3(),target=new THREE.Vector3(),hit=new THREE.Vector3(),ray=new THREE.Ray();
function brute(ox,oy,oz,x,y,z,r) {
  origin.set(ox,oy,oz);target.set(x,y,z);const length=origin.distanceTo(target);
  if(length<=2*r)return false;
  ray.origin.copy(origin);ray.direction.subVectors(target,origin).divideScalar(length);
  for(const box of boxes) {
    expanded.copy(box).expandByScalar(r);if(expanded.containsPoint(origin))continue;
    eroded.copy(box).expandByScalar(-r);
    if(eroded.min.x>=eroded.max.x||eroded.min.y>=eroded.max.y||eroded.min.z>=eroded.max.z)continue;
    if(ray.intersectBox(eroded,hit)) {
      const distance=hit.distanceTo(origin);if(distance>0 && distance<length-r)return true;
    }
  }
  return false;
}
let checked=0,blocked=0;
for(let i=0;i<24000;i++) {
  const h=houses[i%houses.length],r=.025+random()**3*6;
  let x=h.x+(random()-.5)*(h.w+5),y=h.yBase+random()*(h.eaves-h.yBase+8),z=h.z+(random()-.5)*(h.d+5);
  let ox=(random()-.5)*460,oy=random()*65-3,oz=(random()-.5)*300;
  if(i%6===0){ox=x-600-random()*1400;oy=y+200+random()*1800;oz=z-900-random()*1600;}
  if(i%6===1)oy=y=70+random()*500;
  if(i%6===2){ox=x;oz=Math.round(oz/8)*8;}
  if(i%6===3){oz=z;oy=y;}
  if(i%6===4){oy=h.eaves-r+((i%5)-2)*1e-7; y=oy;}
  const args=[ox,oy,oz,x,y,z,r],actual=grid.blocked(...args),expected=brute(...args);
  assert.equal(actual,expected,JSON.stringify({i,args,actual,expected}));
  checked++;blocked+=Number(actual);
}
console.log(JSON.stringify({houses:houses.length,independentRayBoxComparisons:checked,blocked,allEqual:true}));
