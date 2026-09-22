import * as THREE from 'three';
import {writeFileSync} from 'node:fs';
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
