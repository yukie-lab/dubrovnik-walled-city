// Survey residents against rendered street/wall triangles and actual treads.
// The body origin is not a substitute for both animated soles: this locates
// candidate support failures for the subsequent GPU/visual check.
import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {installDomShim} from './structure/domshim.mjs';
import {makeGroundSupport} from '../src/support.js';
import {sunState} from '../src/sky.js';
installDomShim();
const {buildWorld}=await import('../src/world.js'),w=buildWorld({sky:false,sea:false});
const surfaces=new THREE.Group();
for(const name of ['ground.near','ground.stradun','ground.paving','wall.curtain']) {
  const source=w.root.getObjectByName(name),m=new THREE.Mesh(source.geometry);
  m.matrixAutoUpdate=false;m.matrix.copy(source.matrixWorld);m.name='ground.paving';surfaces.add(m);
}
const support=makeGroundSupport(surfaces,w.stepPool.items),sun=sunState(12.87),cases=new Map();
let queries=0,missing=0;
for(let t=0;t<=120;t++) {
  w.life.update(t,sun,null,null);
  w.life.folk.forEach((f,id)=>{
    if(f.sit||f.curS===0)return;
    const h=support.sample(f.curX,f.curZ,f.curY+.5);queries++;
    if(!h){missing++;return;}
    const error=f.curY-h.y;
    if(Math.abs(error)<.02)return;
    let row=cases.get(id);
    if(!row){row={id,walking:!!f.walk,initial:[f.x,f.y,f.z],maxFloat:0,maxSink:0,samples:0,example:null};cases.set(id,row);}
    row.samples++;row.maxFloat=Math.max(row.maxFloat,error);row.maxSink=Math.min(row.maxSink,error);
    if(!row.example||Math.abs(error)>Math.abs(row.example.error))row.example={t,x:f.curX,y:f.curY,z:f.curZ,ground:h.y,error};
  });
}
const residents=[...cases.values()].sort((a,b)=>Math.max(b.maxFloat,-b.maxSink)-Math.max(a.maxFloat,-a.maxSink));
const report={population:w.life.folk.length,walking:w.life.folk.filter(f=>f.walk).length,
  queries,missing,affectedCandidates:residents.length,walkingCandidates:residents.filter(f=>f.walking).length,residents};
writeFileSync(process.argv[2]||'shots/sept26-folk-floor-survey.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,residents:residents.slice(0,12)}));
