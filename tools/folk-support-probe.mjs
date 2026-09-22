import * as THREE from 'three';
import {readFileSync,writeFileSync} from 'node:fs';
import {installDomShim} from './structure/domshim.mjs';
import {makeGroundSupport} from '../src/support.js';
import {makeFolkContact} from '../src/folk-contact.js';
import {sunState} from '../src/sky.js';
installDomShim();
const {buildWorld}=await import('../src/world.js'),w=buildWorld({sky:false,sea:false});
const source=new THREE.Group();
for(const name of ['ground.near','ground.stradun','ground.paving','wall.curtain']) {
  const mesh=w.root.getObjectByName(name),m=new THREE.Mesh(mesh.geometry);m.name='ground.paving';source.add(m);
}
const records=makeGroundSupport(source,w.stepPool.items);
const stepMesh=new THREE.Mesh(w.steps.geometry);stepMesh.name='ground.paving';source.add(stepMesh);
const triangles=makeGroundSupport(source),rows=[];let active;
const solve=makeFolkContact(w.root.getObjectByName('life.folkLegs').geometry,{height(x,z,ceiling){
  const a=records.sample(x,z,ceiling),b=triangles.sample(x,z,ceiling);
  if(a&&b&&Math.abs(a.y-b.y)>.002)rows.push({id:active,x,z,record:a.y,mesh:b.y,
    step:a.entry.step,source:a.source});
  return a?.y??null;
}});
w.life.update(0,sunState(12.87),null,null);
w.life.folk.forEach((f,id)=>{
  if(f.sit||!f.curS)return;active=id;solve(f,f.curX,f.curY,f.curZ,f.curR,f.curS,0,f.curW);
});
writeFileSync('shots/sept26-support-probe.json',JSON.stringify(rows,null,2)+'\n');
console.log(JSON.stringify({differences:rows.length,residents:[...new Set(rows.map(r=>r.id))],examples:rows.slice(0,8)}));
if(process.argv[2]) {
  const cases=JSON.parse(readFileSync(process.argv[2],'utf8')).residents;
  const compare=[];
  for(const row of cases) {
    const f=w.life.folk[row.id],e=row.example,points=[];
    const solveOne=makeFolkContact(w.root.getObjectByName('life.folkLegs').geometry,{height(x,z,ceiling){
      const record=records.sample(x,z,ceiling),mesh=triangles.sample(x,z,ceiling);
      points.push({x,z,ceiling,record:record?.y,mesh:mesh?.y,source:record?.source});
      return record?.y??null;
    }});
    const expectedY=solveOne(f,e.x,f.y,e.z,f.rotY,f.h,e.time,e.walk);
    const mismatches=points.map((p,i)=>({...p,index:i,gpuX:e.soles[i*3],gpuZ:e.soles[i*3+2],
      delta:Math.hypot(p.x-e.soles[i*3],p.z-e.soles[i*3+2])}));
    compare.push({id:row.id,expectedY,actualY:e.y,sourceY:f.y,
      largestXY:Math.max(...mismatches.map(p=>p.delta)),points:mismatches});
  }
  writeFileSync('shots/sept26-support-compare.json',JSON.stringify(compare,null,2)+'\n');
  console.log(JSON.stringify(compare.map(({points,...r})=>({...r,points:points.slice(0,2)}))));
}
