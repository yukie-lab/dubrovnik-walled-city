// The shape/animation campaign must not reshuffle residents or their palettes.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {installDomShim} from './structure/domshim.mjs';
installDomShim();
const {buildWorld}=await import('../src/world.js');
const w=buildWorld(),baseline=JSON.parse(readFileSync(new URL('../docs/september-population.json',import.meta.url),'utf8'));
const folk=w.life.folk.map(f=>({x:f.x,y:f.y,z:f.z,h:f.h,wx:f.wx,wz:f.wz,rotY:f.rotY,seed:f.seed,sit:f.sit||0}));
assert.equal(folk.length,baseline.population);
assert.equal(createHash('sha256').update(JSON.stringify(folk)).digest('hex'),baseline.sha256,
  'All original resident locations, scale, colour seeds and seating types');
const census=folk.reduce((r,f)=>(r[f.sit]=(r[f.sit]||0)+1,r),{}),batches=[];
w.root.traverse(m=>{if(m.userData.actorFamily)batches.push({name:m.name,family:m.userData.actorFamily,instances:m.count,triangles:m.geometry.index?.count/3||m.geometry.attributes.position.count/3});});
assert.equal(batches.filter(b=>b.family==='folk').length,5);
assert(batches.filter(b=>b.family==='folk').every(b=>b.instances===folk.length));
const report={population:folk.length,census,batches,originalRecordsUnchanged:true};
writeFileSync(new URL('../shots/sept11-folk-audit.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
