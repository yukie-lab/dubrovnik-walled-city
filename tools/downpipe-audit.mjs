import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
import * as THREE from 'three';
import {installDomShim} from './structure/domshim.mjs';
import {collectObjects,buildTriangles,Grid,castDown,rayTri} from './structure/geom.mjs';
installDomShim();
const alternate=process.argv.indexOf('--buildings-source');
const hook=alternate>=0 ? registerHooks({load(url,context,next) {
  const result=next(url,context);return url.endsWith('/src/buildings.js') ? {...result,source:readFileSync(process.argv[alternate+1],'utf8')} : result;
}}) : null;
const {buildWorld}=await import('../src/world.js');
const w=buildWorld({life:false,sea:false,sky:false}),root=new THREE.Group();
hook?.deregister();
root.add(w.ground.group.clone(true),w.steps.clone(true));root.updateMatrixWorld(true);
const objects=collectObjects(root),walkable=new Set(['ground.near','ground.paving','ground.stradun','steps']);
const {tris,owner}=buildTriangles(objects,{filter:o=>walkable.has(o.tag)}),grid=new Grid(tris,4);
const pipe=w.buildings.group.getObjectByName('house.downpipe'),m=new THREE.Matrix4(),rows=[],sites=[];
for(let i=0;i<pipe.count;i++) {
  pipe.getMatrixAt(i,m);const a=new THREE.Vector3(0,0,0).applyMatrix4(m),b=new THREE.Vector3(0,1,0).applyMatrix4(m);
  const samples=[];
  for(let k=0;k<16;k++) {
    const theta=k*Math.PI/8,p=new THREE.Vector3(Math.cos(theta)*.055,0,Math.sin(theta)*.055).applyMatrix4(m);
    const h=castDown(grid,owner,p.x,p.z,b.y+.1);samples.push(h ? p.y-h.y : null);
  }
  const record=pipe.userData.pipeRecords?.[i];
  sites.push({x:record?.sourceX??a.x,z:record?.sourceZ??a.z,top:b.y});
  if(record?.sourceX!==undefined) {
    assert(Math.abs((a.x-record.sourceX)*record.nz-(a.z-record.sourceZ)*record.nx)<.00003,'The drain stays at its original facade bay');
    assert(a.x*record.nx+a.z*record.nz-record.outerPlane>=.07898,'The whole tube clears the furthest projecting course');
  }
  rows.push({i,base:a.toArray(),top:b.toArray(),maxGap:Math.max(...samples.map(v=>v??Infinity)),minGap:Math.min(...samples.map(v=>v??-Infinity)),samples});
}
const reference=new URL('../docs/september-downpipes.json',import.meta.url);
if(process.argv.includes('--record')) {
  assert(!existsSync(reference),'Never replace the original downpipe site/eaves records');
  writeFileSync(reference,JSON.stringify(sites,null,2)+'\n');
}
if(existsSync(reference)) {
  const original=JSON.parse(readFileSync(reference,'utf8'));
  const records=pipe.userData.sourceRecords?.map(p=>({x:p.x,z:p.z,top:p.y+p.h}))||sites;
  assert.equal(original.length,records.length);
  for(let i=0;i<records.length;i++)for(const k of ['x','z','top'])assert(Math.abs(records[i][k]-original[i][k])<.00005,'Keep original facade bay proposals and upper connections');
}
const report={count:rows.length,floating:rows.filter(r=>r.maxGap>.025).length,buried:rows.filter(r=>r.minGap<-.025).length,
  rejected:pipe.userData.rejectedPipes?.length||0,
  missing:rows.filter(r=>r.samples.includes(null)).length,maxGap:Math.max(...rows.map(r=>r.maxGap)),minGap:Math.min(...rows.map(r=>r.minGap)),
  brackets:w.buildings.group.getObjectByName('house.pipeBracket')?.count||0,rows};
if(report.brackets) {
  const body=w.buildings.group.getObjectByName('house.body'),list=collectObjects(body),data=buildTriangles(list),walls=new Grid(data.tris,4);
  const brackets=w.buildings.group.getObjectByName('house.pipeBracket'),bad=[];let maximumDistance=0,failedProbes=0,boundsOutside=0;
  brackets.geometry.computeBoundingSphere();
  const position=brackets.geometry.attributes.position,anchor=brackets.geometry.attributes.aRainAnchor,point=new THREE.Vector3();
  for(let i=0;i<brackets.count;i++) {
    brackets.getMatrixAt(i,m);const x=m.elements[12],y=m.elements[13],z=m.elements[14],nx=m.elements[8],nz=m.elements[10];
    const expected=brackets.geometry.attributes.aRainGap.getX(i)+.09;
    const bound=brackets.userData.instanceBounds?.(i,new THREE.Sphere())||brackets.geometry.boundingSphere;
    let outside=false;
    for(let v=0;v<position.count;v++) {
      point.fromBufferAttribute(position,v);point.z-=anchor.getX(v)*(expected-.09);
      if(point.distanceTo(bound.center)>bound.radius+.000001)outside=true;
    }
    if(outside)boundsOutside++;
    const failures=[];
    // Test the plate footprint too: its center can touch a wall while a corner
    // hangs over an opening or hits a different projecting stone course.
    for(const [u,v] of [[0,0],[-.031,-.051],[-.031,.051],[.031,-.051],[.031,.051]]) {
      const px=x+nz*u,py=y+v,pz=z-nx*u,endX=px-nx*(expected+.08),endZ=pz-nz*(expected+.08);let nearest=Infinity;
      for(const ti of new Set(walls.range(Math.min(px,endX),Math.min(pz,endZ),Math.max(px,endX),Math.max(pz,endZ)))) {
        const d=rayTri(px,py,pz,-nx,0,-nz,walls.tris[ti]);if(d>=0 && d<nearest)nearest=d;
      }
      maximumDistance=Math.max(maximumDistance,nearest);
      if(Math.abs(nearest-expected)>.003)failures.push({u,v,wallDistance:nearest});
    }
    if(failures.length){failedProbes+=failures.length;bad.push({i,x,y,z,expected,failures});}
  }
  report.fixings={checked:brackets.count,probes:brackets.count*5,unattached:bad.length,failedProbes,boundsOutside,maximumDistance,bad};
}
writeFileSync(process.argv.find(a=>a.endsWith('.json'))||'shots/downpipes.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,fixings:report.fixings ? {...report.fixings,bad:report.fixings.bad.slice(0,5)} : null,
  rows:rows.filter(r=>r.maxGap>.025 || r.minGap<-.025).slice(0,3).map(({samples,...r})=>r)}));
if(process.argv.includes('--strict'))assert(!report.floating && !report.missing,'Every pipe enters an actual rendered support surface');
if(process.argv.includes('--strict') && report.fixings)assert.equal(report.fixings.unattached,0,'Every bracket enters an actual wall face');
if(process.argv.includes('--strict') && report.fixings)assert.equal(report.fixings.boundsOutside,0,'The culling bounds contain every deformed bracket vertex');
