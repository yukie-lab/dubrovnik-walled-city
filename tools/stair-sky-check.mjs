import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {buildPlan} from '../src/plan.js';
import {wallStairLayout} from '../src/wall-stair-layout.js';
import {makeWallStairMasonry} from '../src/wall-stair-masonry.js';
import {makeStairSkyVisibility} from '../src/wall-stair-light.js';
import {makeStepStone} from '../src/step-stone.js';

// A reference renderer's geometry intersections and analytic boxes independently
// check the production triangle hierarchy. No browser or scene lighting is used.
const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
const referenceIndex=process.argv.indexOf('--reference');
const prior=referenceIndex>=0?JSON.parse(readFileSync(process.argv[referenceIndex+1],'utf8')):null;
const defaultIndex=process.argv.indexOf('--default-samples');
const defaultSamples=defaultIndex>=0?Number(process.argv[defaultIndex+1]):32;
const listArgument=(flag,fallback)=>{const index=process.argv.indexOf(flag);return index<0?fallback:process.argv[index+1].split(',').map(Number);};
const sampleCounts=[...new Set([...listArgument('--samples-list',[16,32]),16,defaultSamples])];
const bakeCounts=listArgument('--bake-samples-list',[16,32,32,16]);
assert([...sampleCounts,...bakeCounts].every(n=>Number.isInteger(n)&&n>0),'Sample counts must be positive integers');
const productionSourceHash=createHash('sha256').update(readFileSync(new URL('../src/wall-stair-light.js',import.meta.url))).digest('hex');
// Keep the actual adopted sixteen-ray implementation as the startup control.
// It has neither the new region proofs nor the precomputed ray coefficients.
const baselineCommit='80ed2ca';
const baselineSource=execFileSync('git',['show',baselineCommit+':src/wall-stair-light.js'],{encoding:'utf8'});
const baseline=await import('data:text/javascript;base64,'+Buffer.from(baselineSource.replace("from 'three'",
  "from '"+new URL('../node_modules/three/build/three.module.js',import.meta.url).href+"'")).toString('base64'));
const normal=new THREE.Vector3(),u=new THREE.Vector3(),v=new THREE.Vector3();
function referenceVisibility(query,samples,blocked) {
  const [x,z,y,nx=0,ny=1,nz=0]=query;
  normal.set(nx,ny,nz).normalize();
  const origin=new THREE.Vector3(x,y,z).addScaledVector(normal,.012),direction=new THREE.Vector3();
  u.set(Math.abs(normal.y)<.95?0:1,Math.abs(normal.y)<.95?1:0,0).cross(normal).normalize();
  v.crossVectors(normal,u).normalize();
  let open=0;
  for(let i=0;i<samples;i++) {
    const radius=Math.sqrt((i+.5)/samples),angle=i*2.399963229728653;
    direction.copy(normal).multiplyScalar(Math.sqrt(1-radius*radius))
      .addScaledVector(u,radius*Math.cos(angle)).addScaledVector(v,radius*Math.sin(angle));
    if(!blocked(origin,direction))open++;
  }
  return {value:.035+.965*open/samples,open,samples};
}
function invoke(sky,query) {return sky(...query);}
function boxGeometry(box) {
  const size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  return new THREE.BoxGeometry(size.x,size.y,size.z).translate(center.x,center.y,center.z);
}
const box=(lo,hi)=>new THREE.Box3(new THREE.Vector3(...lo),new THREE.Vector3(...hi));
function analyticBoxes(boxes,far) {
  const ray=new THREE.Ray(),hit=new THREE.Vector3();
  return (origin,direction)=>{
    ray.set(origin,direction);
    return boxes.some(b=>{
      if(!ray.intersectBox(b,hit))return false;
      const distance=hit.distanceToSquared(origin);
      return distance>.008**2&&distance<far*far;
    });
  };
}
const fixtureRows=[];
function mergeBoxes(boxes) {
  const pieces=boxes.map(boxGeometry),geometry=mergeGeometries(pieces);let from=0;
  geometry.userData.stairSolids=pieces.map((piece,i)=>{
    const solid={name:'box'+i,from,to:from+piece.index.count/3};from=solid.to;return solid;
  });
  pieces.forEach(g=>g.dispose());return geometry;
}
const floor=box([-1.2,-.2,-1.2],[1.2,0,1.2]);
const roomSides=[floor,box([-1.2,0,-1.2],[-1,2.4,1.2]),box([1,0,-1.2],[1.2,2.4,1.2]),
  box([-1,0,-1.2],[1,2.4,-1]),box([-1,0,1],[1,2.4,1.2])];
const aperture={x:[.32,.49],z:[-.31,.24]};
const roofWithSlit=[box([-1,2.2,-1],[aperture.x[0],2.4,1]),box([aperture.x[1],2.2,-1],[1,2.4,1]),
  box([aperture.x[0],2.2,-1],[aperture.x[1],2.4,aperture.z[0]]),
  box([aperture.x[0],2.2,aperture.z[1]],[aperture.x[1],2.4,1])];
for(const [name,boxes,queries,exact] of [
  ['open',[floor],[[0,0,.1],[.3,-.2,.2]],1],
  ['closed',[...roomSides,box([-1,2.2,-1],[1,2.4,1])],[[0,0,.1],[.3,-.2,.2],[.9,0,1, -1,0,0]],.035],
  ['slit',[...roomSides,...roofWithSlit],[[0,0,.1],[.3,-.2,.2],[-.5,.4,.1],[.9,0,1,-1,0,0]],null],
]) {
  const geometry=mergeBoxes(boxes),layout={enclosed:true,length:10};
  for(const samples of sampleCounts) {
    const sky=makeStairSkyVisibility(layout,geometry,{samples}),expected=analyticBoxes(boxes,layout.length+5);
    for(const query of queries) {
      const actual=invoke(sky,query),reference=referenceVisibility(query,samples,expected);
      assert.equal(actual,reference.value,name+': hierarchy must match independent analytic box intersections');
      if(exact!==null)assert.equal(actual,exact,name+': exact hemisphere visibility');
      assert.equal(invoke(sky,query),actual,name+': cached result is deterministic');
      fixtureRows.push({name,samples,query,visibility:actual,open:reference.open,stats:{...sky.stats}});
    }
  }
  assert.equal(makeStairSkyVisibility({...layout,enclosed:false},geometry)(0,0,.1),1,'An open stair does not acquire an enclosure mask');
  geometry.dispose();
}
{
  const geometry=mergeBoxes([floor]),layout={enclosed:true,length:10},query=[0,0,-.1,0,0,0];
  const sky=makeStairSkyVisibility(layout,geometry),old=baseline.makeStairSkyVisibility(layout,geometry);
  assert.equal(invoke(sky,query),invoke(old,query),'A zero normal preserves the old degenerate ray behavior');
  assert.equal(invoke(sky,query),1);assert.equal(sky.stats.insideSolid,0);assert.equal(sky.stats.outsidePlane,0);
  fixtureRows.push({name:'zero-normal-inside',samples:defaultSamples,query,visibility:1,stats:{...sky.stats}});
  geometry.dispose();
}
// These fixtures carry the same solid metadata as production. They explicitly
// exercise both proof shortcuts and the finite-distance/near-surface guards.
for(const [name,boxes,query,length,proof] of [
  ['inside-solid',[floor],[0,0,-.1],10,'insideSolid'],
  ['outward-surface',[floor],[0,0,0],10,'outsidePlane'],
  ['inward-surface',[floor],[0,0,0,0,-1,0],10,'insideSolid'],
  ['near-surface',[floor],[0,0,-.017],10,'sampled'],
  ['inward-exterior',[floor],[0,0,.1,0,-1,0],10,'sampled'],
  ['far-limit',[box([-10,-10,-10],[10,10,10])],[0,0,0],1,'sampled'],
]) {
  const geometry=mergeBoxes(boxes),layout={enclosed:true,length};
  for(const samples of sampleCounts) {
    const sky=makeStairSkyVisibility(layout,geometry,{samples}),reference=referenceVisibility(query,samples,analyticBoxes(boxes,length+5));
    const actual=invoke(sky,query);assert.equal(actual,reference.value,name+': proof preserves independent analytic visibility');
    assert.equal(sky.stats[proof],1,name+': the intended proof or guard must be exercised');
    assert(sky.stats.planeBytes>0,name+': valid closed metadata must produce solid planes');
    const stats={...sky.stats};assert.equal(invoke(sky,query),actual);assert.deepEqual(sky.stats,stats,name+': cache hit traces no further rays');
    fixtureRows.push({name,samples,query,visibility:actual,open:reference.open,stats});
  }
  geometry.dispose();
}
// A metadata label alone cannot make an open mesh a closed solid.
{
  const geometry=boxGeometry(box([-1,-1,-1],[1,1,1]));
  geometry.setIndex(Array.from(geometry.index.array).slice(0,-6));
  geometry.userData.stairSolids=[{name:'open-box',from:0,to:geometry.index.count/3}];
  const mesh=new THREE.Mesh(geometry,material),raycaster=new THREE.Raycaster(),hits=[];
  raycaster.near=.008;raycaster.far=15;
  const blocked=(origin,direction)=>{raycaster.set(origin,direction);hits.length=0;mesh.raycast(raycaster,hits);return hits.length>0;};
  const query=[0,0,0,0,0,-1];
  for(const samples of sampleCounts) {
    const sky=makeStairSkyVisibility({enclosed:true,length:10},geometry,{samples}),reference=referenceVisibility(query,samples,blocked);
    const actual=invoke(sky,query);assert.equal(actual,reference.value,'An unclosed metadata piece must use geometry rays');
    assert.equal(sky.stats.insideSolid,0);assert.equal(sky.stats.planeBytes,0);assert.equal(sky.stats.sampled,1);
    assert(actual>.035,'The removed face must remain a real opening');
    fixtureRows.push({name:'unclosed-metadata',samples,query,visibility:actual,open:reference.open,stats:{...sky.stats}});
  }
  geometry.dispose();
}

const plan=buildPlan(),stair=plan.WALL_STAIRS.find(st=>st.enclosed);
assert(stair,'The actual plan must include the enclosed stair');
const layout=wallStairLayout(stair,{gates:plan.GATES}),masonry=makeWallStairMasonry(stair,layout,plan);
const vertex=masonry.attributes.position,indices=masonry.index;
// Copy each solid into its own finite geometry. Three's independent raycast
// can reject its bounding box/sphere before visiting that solid's triangles.
const meshes=masonry.userData.stairSolids.map(solid=>{
  const geometry=new THREE.BufferGeometry(),positions=[],index=[],mapping=new Map();
  for(let k=solid.from*3;k<solid.to*3;k++) {
    const old=indices.getX(k);
    if(!mapping.has(old)) {
      mapping.set(old,positions.length/3);positions.push(vertex.getX(old),vertex.getY(old),vertex.getZ(old));
    }
    index.push(mapping.get(old));
  }
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(index);
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return new THREE.Mesh(geometry,material);
});
const raycaster=new THREE.Raycaster(),hits=[];raycaster.near=.008;raycaster.far=layout.length+5;
const independentlyBlocked=(origin,direction)=>{
  raycaster.set(origin,direction);
  for(const mesh of meshes) {
    hits.length=0;mesh.raycast(raycaster,hits);
    if(hits.some(hit=>hit.distance>.008&&hit.distance<raycaster.far))return true;
  }
  return false;
};
const queries=layout.steps.map(q=>[q.x,q.z,q.y+.025]);
const geometryHash=createHash('sha256').update(Buffer.from(vertex.array.buffer,vertex.array.byteOffset,vertex.array.byteLength))
  .update(Buffer.from(indices.array.buffer,indices.array.byteOffset,indices.array.byteLength)).digest('hex');
const queryHash=createHash('sha256').update(JSON.stringify(queries)).digest('hex');
if(prior) {
  assert.equal(prior.view,'stair-sky-independent');assert.equal(prior.stair,stair.id);assert.equal(prior.points,queries.length);
  assert.equal(prior.triangles,masonry.index.count/3);assert.equal(prior.referenceSamples,4096);
  if(prior.geometryHash)assert.equal(prior.geometryHash,geometryHash,'Reference must have identical real triangles');
  if(prior.queryHash)assert.equal(prior.queryHash,queryHash,'Reference must have identical probe positions');
}
const skies=new Map(sampleCounts.map(samples=>[samples,makeStairSkyVisibility(layout,masonry,{samples})]));
const defaultSky=makeStairSkyVisibility(layout,masonry);
const startReference=performance.now();
const convergence=queries.map((query,index)=>{
  const oldReference=prior?.convergence[index];
  if(oldReference) {
    assert.equal(oldReference.index,index);assert.equal(oldReference.segment,layout.steps[index].seg);
    assert.equal(oldReference.step,layout.steps[index].step);
  }
  const reference=oldReference?{value:oldReference.reference4096,open:oldReference.referenceOpen}
    :referenceVisibility(query,4096,independentlyBlocked);
  const values=Object.fromEntries(sampleCounts.map(samples=>[samples,invoke(skies.get(samples),query)]));
  const old=values[16],current=values[defaultSamples];
  // Equal angular samples separate hierarchy correctness from integration
  // accuracy. This reference invokes Three.Mesh.raycast rather than the BVH.
  for(const samples of sampleCounts) {
    const independent=referenceVisibility(query,samples,independentlyBlocked);
    assert.equal(values[samples],independent.value,'Actual stair: '+samples+'-ray BVH matches Three raycast');
  }
  assert.equal(invoke(defaultSky,query),values[defaultSamples],'Production default uses the declared angular precision');
  if(oldReference) {
    assert.equal(old,oldReference.old16,'Reference reuse preserves every original 16-ray result');
    for(const samples of sampleCounts)if(samples!==16&&oldReference['current'+samples]!==undefined)
      assert.equal(values[samples],oldReference['current'+samples],'Reference reuse preserves every original '+samples+'-ray result');
  }
  return {index,segment:layout.steps[index].seg,step:layout.steps[index].step,
    old16:old,...Object.fromEntries(sampleCounts.filter(n=>n!==16).map(n=>['current'+n,values[n]])),
    reference4096:reference.value,referenceOpen:reference.open};
});
const referenceMs=performance.now()-startReference;
const errorStats=key=>({maxAbsolute:Math.max(...convergence.map(row=>Math.abs(row[key]-row.reference4096))),
  rms:Math.sqrt(convergence.reduce((sum,row)=>sum+(row[key]-row.reference4096)**2,0)/convergence.length),
  missedOpenings:convergence.filter(row=>row.referenceOpen>0&&row[key]===.035).length,
  falseOpenings:convergence.filter(row=>row.referenceOpen===0&&row[key]>.035).length});
const oldError=errorStats('old16'),currentError=errorStats(defaultSamples===16?'old16':'current'+defaultSamples);
const errorsBySamples=Object.fromEntries(sampleCounts.map(n=>[n,errorStats(n===16?'old16':'current'+n)]));
assert(currentError.rms<oldError.rms,'The adopted angular precision must reduce actual stair quadrature error');
assert(currentError.missedOpenings<oldError.missedOpenings,'Small actual openings must be missed less often');

// Reproduce every enclosure query used by production masonry and tread
// baking, retaining position/normal rounding and the ordinary cache.
const bakeQueries=[],normals=masonry.attributes.normal;
for(let i=0;i<vertex.count;i++)bakeQueries.push([vertex.getX(i),vertex.getZ(i),vertex.getY(i),
  normals.getX(i),normals.getY(i),normals.getZ(i)]);
let treadVertices=0;
for(const q of layout.steps) {
  const geometry=makeStepStone(q),positions=geometry.attributes.position,normals=geometry.attributes.normal;
  treadVertices+=positions.count;
  for(let i=0;i<positions.count;i++)bakeQueries.push([positions.getX(i),positions.getZ(i),positions.getY(i)+.025,
    normals.getX(i),normals.getY(i),normals.getZ(i)]);
  geometry.dispose();
}
const uniqueKeys=new Set(bakeQueries.map(([x,z,y,nx,ny,nz])=>[x,y,z].map(n=>Math.round(n*8)).join(',')+':'+[nx,ny,nz].map(n=>Math.round(n*4)).join(',')));
const bakeRuns=[];
for(const samples of bakeCounts) {
  const mode=samples===16?'committed-baseline':'region-proofs';
  const start=performance.now(),sky=samples===16?baseline.makeStairSkyVisibility(layout,masonry)
    :makeStairSkyVisibility(layout,masonry,{samples}),built=performance.now();
  let checksum=0;
  for(const query of bakeQueries)checksum+=invoke(sky,query);
  const baked=performance.now();
  let cachedChecksum=0;
  for(const query of bakeQueries)cachedChecksum+=invoke(sky,query);
  const cached=performance.now();
  assert.equal(cachedChecksum,checksum,'A repeated full bake must retain exact cached values');
  const previousRun=prior?.bake.runs.find(run=>run.samples===samples);
  if(previousRun)assert.equal(checksum,previousRun.checksum,'Proof shortcuts preserve the entire original bake checksum');
  const repeat=bakeRuns.find(run=>run.samples===samples);
  if(repeat)assert.equal(checksum,repeat.checksum,'Fresh full bakes retain exact results at each angular precision');
  const run={mode,samples,hierarchyMs:built-start,bakeMs:baked-built,cachedMs:cached-baked,totalMs:baked-start,checksum,
    stats:sky.stats?{...sky.stats}:null};
  bakeRuns.push(run);console.error(JSON.stringify({view:'stair-sky-bake-progress',...run}));
}
const median=values=>{const sorted=values.slice().sort((a,b)=>a-b),mid=sorted.length>>1;return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;};
const bakeSummary=[...new Set(bakeCounts)].sort((a,b)=>a-b).map(samples=>({samples,runs:bakeRuns.filter(run=>run.samples===samples).length,
  totalMedianMs:median(bakeRuns.filter(run=>run.samples===samples).map(run=>run.totalMs)),
  bakeMedianMs:median(bakeRuns.filter(run=>run.samples===samples).map(run=>run.bakeMs)),
  cachedMedianMs:median(bakeRuns.filter(run=>run.samples===samples).map(run=>run.cachedMs))}));
const report={view:'stair-sky-independent',stair:stair.id,triangles:masonry.index.count/3,
  baselineCommit,baselineSourceHash:createHash('sha256').update(baselineSource).digest('hex'),
  productionSourceHash,defaultSamples,sampleCounts,bakeCounts,
  geometryHash,queryHash,fixtureChecks:fixtureRows.length,fixtureRows,points:convergence.length,referenceSamples:4096,referenceMs,
  referenceReused:!!prior,referenceReport:prior?process.argv[referenceIndex+1]:null,
  error:{old16:oldError,['current'+defaultSamples]:currentError},errorsBySamples,bake:{masonryVertices:vertex.count,treadVertices,
    queries:bakeQueries.length,uniqueCachedQueries:uniqueKeys.size,runs:bakeRuns,summary:bakeSummary},convergence};
console.log(JSON.stringify(report,null,2));
meshes.forEach(mesh=>mesh.geometry.dispose());masonry.dispose();material.dispose();
