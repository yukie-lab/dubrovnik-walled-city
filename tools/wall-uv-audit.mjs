import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {createHash} from 'node:crypto';
import {installDomShim} from './structure/domshim.mjs';
installDomShim();globalThis.__wallCharts=[];
const alternate=process.argv.indexOf('--source');
const hook=registerHooks({load(url,context,next){
  const result=next(url,context);
  if(!url.endsWith('/src/walls.js'))return result;
  const source=alternate<0 ? String(result.source) : readFileSync(process.argv[alternate+1],'utf8');
  const mark=/U\.push\([^\n]+\);(?=\n    \/\/ 潮の帯)/;
  assert(mark.test(source),'Instrument the common wall chart path exactly');
  return {...result,source:source.replace(mark,line=>line+`\n    globalThis.__wallCharts.push({p:[a,b,c,d].map(p=>p.slice()),uv:U.slice(-8),normal:[n.x,n.y,n.z],scale:uvScale});`)};
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
const direction=(a,b)=>{const d=b.map((v,i)=>v-a[i]),length=Math.hypot(...d);return length>1e-6?d.map(v=>v/length):[0,0,0];};
let shared=0,discontinuous=0;const failures=[];
for(const c of charts) {
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
  uniqueOrigins:new Set(charts.map(c=>key(c.uv.slice(0,2)))).size,sharedCoplanarCorners:shared,discontinuousCorners:discontinuous,geometry,failures};
writeFileSync(process.argv.find(a=>a.endsWith('.json'))||'shots/wall-uv.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
