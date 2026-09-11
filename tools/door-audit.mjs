import {installDomShim} from './structure/domshim.mjs';
import * as THREE from 'three';
import {writeFileSync} from 'node:fs';
import {collectObjects,buildTriangles,Grid,castDown} from './structure/geom.mjs';
installDomShim();
const {buildWorld}=await import('../src/world.js');
const world=buildWorld(),objects=collectObjects(world.root),walkable=new Set(['ground.near','ground.paving','ground.stradun','steps']);
const {tris,owner}=buildTriangles(objects,{filter:o=>walkable.has(o.tag) || o.tag==='door.stoneSeat'}),grid=new Grid(tris,4);
const doors=objects.filter(o=>o.tag==='door.frameRect' || o.tag==='door.frameArch'),rows=[];
for(const d of doors) {
  const samples=[];
  for(const x of [-.64,-.48,0,.48,.64])for(const z of [.035,.075]) {
    const bottom=new THREE.Vector3(x,d.mesh.geometry.boundingBox.min.y,z).applyMatrix4(d.matrix);
    const top=new THREE.Vector3(x,.055,z).applyMatrix4(d.matrix);
    const hit=castDown(grid,owner,bottom.x,bottom.z,top.y+.75);
    const floor=castDown(grid,owner,bottom.x,bottom.z,top.y+.75,i=>walkable.has(objects[i].tag));
    samples.push({x,z,bottom:bottom.y,top:top.y,floor:floor?.y ?? null,gap:hit ? bottom.y-hit.y : null,buried:floor ? floor.y-top.y : null});
  }
  rows.push({id:d.id,position:new THREE.Vector3().setFromMatrixPosition(d.matrix).toArray(),
    maxGap:Math.max(...samples.map(s=>s.gap ?? Infinity)),maxBuried:Math.max(...samples.map(s=>s.buried ?? Infinity)),samples});
}
const report={count:rows.length,floating:rows.filter(r=>r.maxGap>.025).length,
  buried:rows.filter(r=>r.maxBuried>.025).length,severeFloating:rows.filter(r=>r.maxGap>.20).length,
  rows};
const seats=objects.filter(o=>o.tag==='door.stoneSeat'),seatRows=[];
for(const o of seats) {
  let maxGap=-Infinity;
  for(let i=0;i<=16;i++)for(const z of [.10,.30,.495]) {
    const p=new THREE.Vector3(i/16-.5,-.5,z).applyMatrix4(o.matrix);
    const hit=castDown(grid,owner,p.x,p.z,p.y+1.5,j=>walkable.has(objects[j].tag));
    maxGap=Math.max(maxGap,hit ? p.y-hit.y : Infinity);
  }
  seatRows.push({id:o.id,maxGap});
}
report.seats=seats.length;report.floatingSeats=seatRows.filter(r=>r.maxGap>.015).length;
report.seatRows=seatRows;
writeFileSync(process.argv[2]||'shots/door-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,seatRows:seatRows.filter(r=>r.maxGap>.015),rows:rows.filter(r=>r.maxGap>.025 || r.maxBuried>.025).slice(0,4).map(({samples,...r})=>r)},null,2));
if(process.argv.includes('--strict') && (report.floating || report.buried || report.floatingSeats))throw new Error('Doorway support is incomplete');
