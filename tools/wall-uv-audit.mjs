import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {createHash} from 'node:crypto';
import {installDomShim} from './structure/domshim.mjs';
installDomShim();globalThis.__wallCharts=[];globalThis.__wallUVPaths=[];
const alternate=process.argv.indexOf('--source');
const hook=registerHooks({load(url,context,next){
  const result=next(url,context);
  if(!url.endsWith('/src/walls.js'))return result;
  const source=alternate<0 ? String(result.source) : readFileSync(process.argv[alternate+1],'utf8');
  const mark=/U\.push\([^\n]+\);(?=\n    \/\/ 潮の帯)/;
  assert(mark.test(source),'Instrument the common wall chart path exactly');
  let instrumented=source.replace(mark,line=>line+`\n    globalThis.__wallCharts.push({p:[a,b,c,d].map(p=>p.slice()),offset:U.length-8,normal:[n.x,n.y,n.z],scale:uvScale});\n    globalThis.__wallUVPaths.push({from:P.length/3-4,count:4,path:'quad'});`);
  for(const [marker,count,path] of [
    ['for (const q of [a, b, c, d]) U.push(q[0] * um, q[2] * um);',4,'horizontalQuad'],
    [source.includes('U.push(0, 0, 1, 0, 1, 1);')?'U.push(0, 0, 1, 0, 1, 1);':'U.push(...planarMasonryUV(vs,[nx2,ny2,nz2],um));',3,'sweepEndCap'],
    ['U.push(t.x * um, t.z * um, p1x * um, p1z * um, p2x * um, p2z * um);',3,'towerFloor'],
  ]) {
    assert(instrumented.includes(marker),'Instrument wall UV path: '+path);
    instrumented=instrumented.replace(marker,marker+`\n    globalThis.__wallUVPaths.push({from:P.length/3-${count},count:${count},path:'${path}'});`);
  }
  return {...result,source:instrumented};
}});
const {buildWorld}=await import('../src/world.js');
const w=buildWorld({life:false,sea:false,sky:false});hook.deregister();
const geo=w.walls.group.getObjectByName('wall.curtain').geometry;
const hash=array=>createHash('sha256').update(Buffer.from(array.buffer,array.byteOffset,array.byteLength)).digest('hex');
const geometry={position:hash(geo.attributes.position.array),normal:hash(geo.attributes.normal.array),index:hash(geo.index.array)};
const reference=new URL('../docs/september-wall-geometry.json',import.meta.url);
if(process.argv.includes('--record')){assert(!existsSync(reference),'Do not overwrite the wall geometry baseline');writeFileSync(reference,JSON.stringify(geometry,null,2)+'\n');}
if(existsSync(reference))assert.deepEqual(geometry,JSON.parse(readFileSync(reference,'utf8')),'Texture charts must not change the wall solids or their normals');
const charts=globalThis.__wallCharts,vertices=new Map(),key=p=>p.map(v=>Math.round(v*1e5)).join(','),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const paths=new Map();
for(const {from,count,path} of globalThis.__wallUVPaths)for(let i=0;i<count;i++)paths.set(from+i,path);
const metricPaths={};
for(let k=0;k<geo.index.count;k+=3) {
  const ids=[0,1,2].map(i=>geo.index.getX(k+i)),p=ids.map(i=>Array.from(geo.attributes.position.array.slice(i*3,i*3+3))),
    uv=ids.map(i=>Array.from(geo.attributes.uv.array.slice(i*2,i*2+2))),a=p[1].map((v,i)=>v-p[0][i]),b=p[2].map((v,i)=>v-p[0][i]);
  const area=Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])*.5;
  if(area<1e-9)continue;
  const uvArea=Math.abs((uv[1][0]-uv[0][0])*(uv[2][1]-uv[0][1])-(uv[2][0]-uv[0][0])*(uv[1][1]-uv[0][1]))*.5,
    ratio=Math.sqrt(area/uvArea)/w.tex.fortStone.coverM,path=paths.get(ids[0])||'extrudedGate';
  const row=metricPaths[path]||={triangles:0,outsideTriangles:0,area:0,outsideArea:0,min:Infinity,max:0,invalid:0};
  row.triangles++;row.area+=area;row.min=Math.min(row.min,ratio);row.max=Math.max(row.max,ratio);
  if(!Number.isFinite(ratio))row.invalid++;
  if(ratio<.7||ratio>1.4){row.outsideTriangles++;row.outsideArea+=area;}
}
const direction=(a,b)=>{const d=b.map((v,i)=>v-a[i]),length=Math.hypot(...d);return length>1e-6?d.map(v=>v/length):[0,0,0];};
let shared=0,discontinuous=0;const failures=[];
for(const c of charts) {
  c.uv=Array.from(geo.attributes.uv.array.slice(c.offset,c.offset+8));
  c.u=direction(c.p[0],c.p[1]);c.v=direction(c.p[0],c.p[3]);
  for(let i=0;i<4;i++) {
    const k=key(c.p[i]),uv=c.uv.slice(i*2,i*2+2);
    for(const other of vertices.get(k)||[]) {
      if(c.scale!==other.c.scale || dot(c.normal,other.c.normal)<.999999 || dot(c.u,other.c.u)<.999999 || dot(c.v,other.c.v)<.999999)continue;
      shared++;
      if(uv.some((v,j)=>Math.abs(v-other.uv[j]-Math.round(v-other.uv[j]))>1e-4)) {
        discontinuous++;
        if(failures.length<8)failures.push({point:c.p[i],uv,otherUv:other.uv,u:c.u,v:c.v,otherU:other.c.u,otherV:other.c.v,quad:c.p,otherQuad:other.c.p});
      }
    }
    if(!vertices.has(k))vertices.set(k,[]);vertices.get(k).push({c,uv});
  }
}
const report={charts:charts.length,copiedOrigins:charts.filter(c=>c.uv[0]===0&&c.uv[1]===0).length,
  uniqueOrigins:new Set(charts.map(c=>key(c.uv.slice(0,2)))).size,sharedCoplanarCorners:shared,discontinuousCorners:discontinuous,geometry,groups:geo.userData.masonryCharts,metricPaths,failures};
writeFileSync(process.argv.find(a=>a.endsWith('.json'))||'shots/wall-uv.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
if(process.argv.includes('--strict'))assert.equal(discontinuous,0,'Every matching connected chart corner has the same rendered stone coordinates');
