import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {mulberry32} from '../src/util.js';
import {WoodlandBuffer} from '../src/woodland-shape.js';
import {woodlandLeafGeometry} from '../src/woodland-leaves.js';
import * as current from '../src/woodland-growth.js';

// Compare independent seeded trees to the accepted pre-crown generator. Check
// the budget, random stream, trunk, colours and other species, not the new formula.
const ref=process.argv[2]||'2ae8104';
const source=execFileSync('git',['show',ref+':src/woodland-growth.js'],{encoding:'utf8'});
const hook=registerHooks({load(url,context,next){
  return url.endsWith('woodland-growth.js?crown-baseline') ? {format:'module',source,shortCircuit:true} : next(url,context);
}});
const baseline=await import('../src/woodland-growth.js?crown-baseline');hook.deregister();
const leaf=woodlandLeafGeometry(),leafVertices=Array.from({length:leaf.attributes.position.count},(_,i)=>
  new THREE.Vector3().fromBufferAttribute(leaf.attributes.position,i)),leafIndices=[...leaf.index.array];leaf.dispose();
const hash=B=>createHash('sha256').update(JSON.stringify(B)).digest('hex');
const grow=(fn,seed,options)=>{
  const B=new WoodlandBuffer(),random=mulberry32(seed);let calls=0;
  const h=fn(B,[21.25,7.3,-49.8],()=>{calls++;return random();},options);
  return {B,h,calls,next:random()};
};
const profile=B=>{
  const matrix=new THREE.Matrix4(),edgeA=new THREE.Vector3(),edgeB=new THREE.Vector3(),ys=[],radii=[];
  let area=0,minY=Infinity,maxY=-Infinity;
  for(let i=0;i<B.FM.length;i+=16) {
    matrix.fromArray(B.FM,i);const e=matrix.elements;
    ys.push(e[13]);radii.push(Math.hypot(e[12]-21.25,e[14]+49.8));
    const vertices=leafVertices.map(v=>v.clone().applyMatrix4(matrix));
    for(const point of vertices){minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);}
    for(let j=0;j<leafIndices.length;j+=3) {
      const [a,b,c]=leafIndices.slice(j,j+3).map(k=>vertices[k]);
      area+=edgeA.subVectors(b,a).cross(edgeB.subVectors(c,a)).length()*.5;
    }
  }
  ys.sort((a,b)=>a-b);radii.sort((a,b)=>a-b);
  return {leaves:ys.length,area,minY,maxY,vertical80:ys[Math.floor(ys.length*.9)]-ys[Math.floor(ys.length*.1)],
    radius90:radii[Math.floor(radii.length*.9)]};
};
const rows=[];let unchangedSpecies=0;
for(const kind of ['growPine','growCypress','growOlive','growMaquis'])for(let seed=1;seed<=24;seed++) {
  const options={h:kind==='growMaquis'?.8+seed*.03:3+seed*.5,detail:seed%2?.2:1};
  const a=grow(baseline[kind],seed,options),b=grow(current[kind],seed,options);
  assert.equal(a.h,b.h);assert.equal(a.calls,b.calls,'Do not shift the per-site random stream');assert.equal(a.next,b.next);
  assert.equal(a.B.tris,b.B.tris);assert.equal(a.B.FM.length,b.B.FM.length,'No extra leaf instances');
  assert.equal(a.B.P.length,b.B.P.length);assert.deepEqual(a.B.FC,b.B.FC,'Keep foliage reflectance');
  assert.deepEqual(a.B.FT,b.B.FT,'Keep wind phases');assert.deepEqual(a.B.FK,b.B.FK);
  if(kind!=='growPine'){assert.equal(hash(a.B),hash(b.B),'Other species must remain byte-identical');unchangedSpecies++;continue;}
  const first=a.B.closedParts[0],vertices=Math.max(...a.B.I.slice(0,first.to*3))+1;
  for(const [key,size] of [['P',3],['N',3],['C',3],['U',2],['W',4],['L',1],['G',3]])
    assert.deepEqual(a.B[key].slice(0,vertices*size),b.B[key].slice(0,vertices*size),'Keep the original rooted trunk');
  const before=profile(a.B),after=profile(b.B);
  assert(Math.abs(before.area-after.area)<1e-9,'Do not inflate the leaf area');
  assert(after.minY>=7.3&&after.maxY<=7.3+b.h*1.3,'Keep foliage within the tree envelope');
  rows.push({seed,height:b.h,before,after});
}
const mean=(key,side)=>rows.reduce((sum,r)=>sum+r[side][key]/r.height,0)/rows.length;
const result={baseline:ref,pines:rows.length,unchangedOtherSpecies:unchangedSpecies,budgetAndRandomStreamUnchanged:true,
  meanVertical80PerHeight:{before:mean('vertical80','before'),after:mean('vertical80','after')},
  meanRadius90PerHeight:{before:mean('radius90','before'),after:mean('radius90','after')},rows};
writeFileSync(process.argv[3]||'shots/pine-crown-check.json',JSON.stringify(result,null,2)+'\n');
const {rows:omit,...summary}=result;console.log(JSON.stringify(summary));
