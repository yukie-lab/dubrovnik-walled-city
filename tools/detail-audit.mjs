import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { makeGroundSupport } from '../src/support.js';
import { collectObjects, buildTriangles, Grid, castDown, meshTopology } from './structure/geom.mjs';
const { buildWorld } = await import('../src/world.js');
const world = buildWorld(), objects = collectObjects(world.root);
const walkable = new Set(['ground.near','ground.paving','ground.stradun','steps']);
const { tris, owner } = buildTriangles(objects,{filter:o=>walkable.has(o.tag)});
const grid = new Grid(tris,4);
const support = makeGroundSupport(world.ground.group,world.stepPool.items);
let supportError=0;
const pots = objects.filter(o=>o.tag==='life.flowerPot'), rows = [];
for (const pot of pots) {
  const e = pot.matrix.elements, x = e[12], y = e[13], z = e[14];
  const radius = .24 * Math.hypot(e[0],e[1],e[2]);
  const samples = [];
  for (let k = -1; k < 12; k++) {
    const a = k * Math.PI / 6, r = k === -1 ? 0 : radius;
    const point=new THREE.Vector3(Math.cos(a)*(k===-1 ? 0 : .229),0,Math.sin(a)*(k===-1 ? 0 : .229)).applyMatrix4(pot.matrix);
    const hit = castDown(grid,owner,point.x,point.z,point.y+.40);
    if (hit) {
      samples.push({k,delta:point.y-hit.y,support:objects[hit.obj]?.tag});
      const probe=support.sample(point.x,point.z,point.y+.40);
      supportError=Math.max(supportError,probe ? Math.abs(hit.y-probe.y) : Infinity);
    }
  }
  rows.push({id:pot.id,x,y,z,radius,min:Math.min(...samples.map(s=>s.delta)),
    max:Math.max(...samples.map(s=>s.delta)),center:samples[0]?.delta,samples});
}
const meshes=[];
world.root.traverse(m=>{if (m.isInstancedMesh && ['life.flowerPot','life.plantStem','life.foliage','door.leaf','door.frameArch'].includes(m.name))
  meshes.push({name:m.name,count:m.count,unitTopology:meshTopology(m.geometry)});});
const pavedOverSteps=[];
for (const [i,q] of world.stepPool.items.entries()) {
  let depth=0;
  for (const t of [-.42,0,.42]) for (const side of [-.34,0,.34]) {
    const x=q.x+Math.sin(q.rotY)*q.d*t+Math.cos(q.rotY)*q.w*side;
    const z=q.z+Math.cos(q.rotY)*q.d*t-Math.sin(q.rotY)*q.w*side;
    const p=support.sample(x,z,q.y+.3,'ground.paving');
    if(p)depth=Math.max(depth,p.y-q.y);
  }
  if(depth>.01)pavedOverSteps.push({i,x:q.x,z:q.z,y:q.y,run:q.run,depth});
}
const report = { pots:pots.length,supportError,supportTriangles:support.triangles,
  seating:world.life.potSeating,
  pavingAboveTreads:pavedOverSteps.length,pavedOverSteps,
  floatingCenters:rows.filter(r=>r.center>.01).length,
  embeddedCenters:rows.filter(r=>r.center<-.04).length,
  maxBaseGap:Math.max(...rows.map(r=>r.max)),maxBasePenetration:-Math.min(...rows.map(r=>r.min)),
  unsupportedFootprints:rows.filter(r=>r.max>.03 || r.min<-.04).length,
  footprintCases:rows.filter(r=>r.max>.03 || r.min<-.04),meshes,
  roofAxes:world.plan.houses.reduce((a,h)=>(a[h.ridgeAxis]=(a[h.ridgeAxis]||0)+1,a),{}),
  bodyTopology:meshTopology(world.buildings.group.getObjectByName('house.body').geometry) };
writeFileSync(process.argv[2] || 'shots/detail-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,pavedOverSteps:report.pavedOverSteps.slice(0,5),
  footprintCases:report.footprintCases.slice(0,3).map(({samples,...r})=>r),
  bodyTopology:{...report.bodyTopology,boundarySample:[],nonManifoldSample:[]},
  meshes:meshes.map(m=>({...m,unitTopology:{...m.unitTopology,boundarySample:[],nonManifoldSample:[]}}))},null,2));
if(supportError>1e-5)throw new Error('Placement support differs from independent triangle raycasts');
if(process.argv.includes('--strict')) {
  if(report.maxBaseGap>.009 || report.maxBasePenetration>.009)throw new Error('A rendered vessel base does not fit its support');
  for(const r of pavedOverSteps) {
    const q=world.stepPool.items[r.i];
    if((q.step!==0 && q.step!==q.of) || r.depth>.035)throw new Error('Paving still penetrates a tread away from a landing');
  }
}
