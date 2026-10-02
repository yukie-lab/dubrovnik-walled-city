import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {installDomShim} from './structure/domshim.mjs';
installDomShim();
const {buildWorld}=await import('../src/world.js');
const {sunState}=await import('../src/sky.js');
const w=buildWorld(),glass=w.root.getObjectByName('life.lampGlass'),pools=w.root.getObjectByName('life.lampPool');
assert(glass&&pools,'Actual lamp geometry must exist');
glass.geometry.computeBoundingBox();
const centre=glass.geometry.boundingBox.getCenter(new THREE.Vector3()),matrix=new THREE.Matrix4();
const emitters=Array.from({length:glass.count},(_,id)=>{
  glass.getMatrixAt(id,matrix);
  return centre.clone().applyMatrix4(matrix).applyMatrix4(glass.matrixWorld);
});
const lights=[];w.root.traverse(o=>{if(o.isPointLight)lights.push(o);});
const rows=[];let assignments=0,maximumEmitterError=0;
for(let id=0;id<emitters.length;id++) {
  const e=emitters[id];w.life.update(40,sunState(22.5),e);
  const active=lights.filter(l=>l.intensity>0);
  assert(active.length>0,'Each actual lamp must receive a pooled light when approached');
  let closest=Infinity;
  for(const l of active) {
    const position=l.getWorldPosition(new THREE.Vector3());
    const error=Math.min(...emitters.map(p=>p.distanceTo(position)));
    maximumEmitterError=Math.max(maximumEmitterError,error);assignments++;
    closest=Math.min(closest,position.distanceTo(e));
  }
  pools.getMatrixAt(id,matrix);
  const floor=new THREE.Vector3().setFromMatrixPosition(matrix).applyMatrix4(pools.matrixWorld);
  const floorError=Math.hypot(e.x-floor.x,e.z-floor.z);
  rows.push({id,emitter:e.toArray(),closestLightError:closest,poolHorizontalError:floorError,
    poolHeightError:floor.y-(w.plan.groundAt(e.x,e.z,200).y+.06)});
}
const result={lamps:emitters.length,lightSlots:lights.length,assignments,maximumEmitterError,
  maximumPoolHorizontalError:Math.max(...rows.map(r=>r.poolHorizontalError)),
  maximumPoolHeightError:Math.max(...rows.map(r=>Math.abs(r.poolHeightError))),rows};
if(process.argv.includes('--strict')) {
  assert.equal(lights.length,8);
  assert(maximumEmitterError<2e-5,'Point lights must coincide with the rendered glass centres');
  assert(rows.every(r=>r.closestLightError<2e-5),'Every approached lamp must be represented');
  assert(result.maximumPoolHorizontalError<2e-5,'Ground return must lie beneath the actual glass');
  assert(result.maximumPoolHeightError<2e-5,'Ground return must use the receiving floor height');
}
const output=process.argv.indexOf('--output');if(output>=0)writeFileSync(process.argv[output+1],JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,rows:undefined}));
