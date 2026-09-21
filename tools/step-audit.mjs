import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {installDomShim} from './structure/domshim.mjs';
installDomShim();
const {buildWorld}=await import('../src/world.js');
const w=buildWorld(),steps=w.stepPool.items,hash=createHash('sha256').update(JSON.stringify(steps)).digest('hex');
const path=new URL('../docs/september-steps.json',import.meta.url);
if(process.argv.includes('--record')) {
  assert(!existsSync(path),'Never replace the geographic step baseline');
  writeFileSync(path,JSON.stringify({count:steps.length,sha256:hash},null,2)+'\n');
}
const baseline=JSON.parse(readFileSync(path,'utf8'));
const wallBaseline=JSON.parse(readFileSync(new URL('../docs/september-wall-step-records.json',import.meta.url),'utf8'));
const originalRuns=new Map(wallBaseline.stairs.map(s=>[s.run,s.steps])),seenRuns=new Set(),reconstructed=[];
for(const q of steps) {
  if(!originalRuns.has(q.run)){reconstructed.push(q);continue;}
  assert(q.wallStair,'Only the explicitly requested wall-ascent class may change');
  if(!seenRuns.has(q.run)){reconstructed.push(...originalRuns.get(q.run));seenRuns.add(q.run);}
}
assert.equal(seenRuns.size,6);
assert.equal(reconstructed.length,baseline.count);
assert.equal(createHash('sha256').update(JSON.stringify(reconstructed)).digest('hex'),baseline.sha256,
  'Every source record outside the six authorized wall ascents must remain byte-identical');
const unique=new Set(steps.map(q=>`${q.x},${q.z}`)),mesh=w.steps;
const groups=new Map();steps.forEach((q,i)=>{const key=`${q.x},${q.z}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);});
const report={count:steps.length,uniqueCenters:unique.size,overlappingCenterRecords:steps.length-unique.size,
  noncontiguousCenterGroups:[...groups.values()].filter(v=>v.some((j,i)=>i && j!==v[i-1]+1)).length,
  instanced:!!mesh.isInstancedMesh,vertices:mesh.geometry.attributes.position.count,
  triangles:mesh.geometry.index.count/3,ordinaryStepsUnchanged:steps.filter(q=>!q.wallStair).length,
  wallStepsBefore:wallBaseline.stairs.reduce((n,s)=>n+s.steps.length,0),wallStepsAfter:steps.filter(q=>q.wallStair).length};
if(mesh.geometry.userData.solids) {
  const g=mesh.geometry,p=g.attributes.position,ix=g.index;
  const point=i=>[p.getX(i),p.getY(i),p.getZ(i)];
  const sub=(a,b)=>a.map((x,k)=>x-b[k]);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const dot=(a,b)=>a.reduce((s,x,k)=>s+x*b[k],0),bad=[];
  for(const s of g.userData.solids) {
    const edges=new Map(),origin=point(ix.getX(s.from*3));let volume=0,collapsed=0;
    for(let i=s.from*3;i<s.to*3;i+=3) {
      const [a,b,c]=[0,1,2].map(k=>point(ix.getX(i+k))),n=cross(sub(b,a),sub(c,a));
      if(Math.hypot(...n)<1e-12)collapsed++;
      volume+=dot(sub(a,origin),cross(sub(b,origin),sub(c,origin)))/6;
      const ids=[a,b,c].map(p=>p.map(x=>Math.round(x*1e6)).join(','));
      for(let k=0;k<3;k++) {
        const a=ids[k],b=ids[(k+1)%3],key=a<b ? a+'|'+b : b+'|'+a,r=edges.get(key)||[0,0];
        r[0]++;r[1]+=a<b ? 1 : -1;edges.set(key,r);
      }
    }
    if(collapsed || volume<=0 || [...edges.values()].some(r=>r[0]!==2 || r[1]!==0))bad.push({id:s.id,collapsed,volume});
  }
  report.solids=g.userData.solids.length;report.badSolids=bad;
}
writeFileSync(process.argv.find(a=>a.endsWith('.json'))||'shots/sept12-step-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
assert(!report.badSolids?.length,'Every rendered stone must be closed, outward and non-degenerate');
