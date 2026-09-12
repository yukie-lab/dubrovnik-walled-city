import assert from 'node:assert/strict';
import * as THREE from 'three';
import {writeFileSync} from 'node:fs';
import {installDomShim} from './structure/domshim.mjs';
import {houseCoreGeometry,roofShellGeometry} from '../src/roof-solid.js';
installDomShim();
const {buildWorld}=await import('../src/world.js');
const world=buildWorld(),body=world.root.getObjectByName('house.body'),roofs=world.root.getObjectByName('house.roof');

// Exact Float32 vertices, not the broad 1.5mm tolerance used for scene-wide
// contact diagnostics. A valid small clipped triangle must not be collapsed.
function closed(geometry,range=null) {
  const p=geometry.attributes.position,ix=geometry.index,edges=new Map();let volume=0,zeroArea=0;
  const from=(range?.from||0)*3,to=range ? range.to*3 : ix ? ix.count : p.count;
  const at=i=>{const j=ix ? ix.getX(i) : i;return new THREE.Vector3(p.getX(j),p.getY(j),p.getZ(j));};
  const origin=at(from);
  for(let i=from;i<to;i+=3) {
    const v=[at(i),at(i+1),at(i+2)],keys=v.map(p=>p.toArray().join(','));
    const area=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).length();
    if(area<1e-12)zeroArea++;
    volume+=v[0].clone().sub(origin).dot(v[1].clone().sub(origin).cross(v[2].clone().sub(origin)))/6;
    for(let k=0;k<3;k++) {
      const a=keys[k],b=keys[(k+1)%3],key=a<b ? a+'|'+b : b+'|'+a,sign=a<b ? 1 : -1;
      const row=edges.get(key)||[0,0];row[0]++;row[1]+=sign;edges.set(key,row);
    }
  }
  return {triangles:(to-from)/3,zeroArea,volume,boundary:[...edges.values()].filter(e=>e[0]===1).length,
    invalid:[...edges.values()].filter(e=>e[0]!==2||e[1]!==0).length};
}
const results=body.geometry.userData.solids.map(r=>({...r,...closed(body.geometry,r)}));
const bad=results.filter(r=>r.boundary||r.invalid||r.zeroArea||r.volume<=0);
console.log(`Building volumes: ${results.length}, invalid: ${bad.length}`);
if(bad.length)console.log(bad.slice(0,8));
assert.equal(bad.length,0,'Every generated architectural volume must be closed and outward');
const unit=closed(roofShellGeometry());assert(unit.invalid===0 && unit.zeroArea===0 && unit.volume>0);

const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),ray=new THREE.Raycaster();
const houses=world.plan.houses.filter(h=>!h.garden);
const ridges=world.root.getObjectByName('house.ridgeTile');
// Extract the triangles actually submitted by each merged roof, not a second
// idealised generator. Re-index locally so bounds and rays see that house only.
function piece(geometry,range) {
  const positions=[],indices=[],ids=new Map(),p=geometry.attributes.position,ix=geometry.index;
  for(let k=range.from*3;k<range.to*3;k++) {
    const j=ix.getX(k);
    if(!ids.has(j)) {ids.set(j,ids.size);positions.push(p.getX(j),p.getY(j),p.getZ(j));}
    indices.push(ids.get(j));
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);
  return g;
}
const roofRanges=roofs.geometry.userData.solids,ridgeRanges=ridges.geometry.userData.solids;
assert.equal(roofRanges.length,houses.length);assert.equal(ridgeRanges.length,houses.length);
let maxContactError=0,minimumThickness=Infinity,samples=0;
for(let i=0;i<houses.length;i++) {
  const h=houses[i],g=piece(roofs.geometry,roofRanges[i]);
  for(const [geometry,range] of [[roofs.geometry,roofRanges[i]],[ridges.geometry,ridgeRanges[i]]]) {
    const result=closed(geometry,range);
    assert(result.invalid===0 && result.zeroArea===0 && result.volume>0,'Rendered roof and ridge must be closed');
    const p=geometry.attributes.position,n=geometry.attributes.normal;
    for(let k=range.from*3;k<range.to*3;k++) {
      const j=geometry.index.getX(k),length=Math.hypot(n.getX(j),n.getY(j),n.getZ(j));
      assert(Number.isFinite(p.getX(j)+p.getY(j)+p.getZ(j)) && Math.abs(length-1)<1e-5,'Finite positions and unit baked normals');
    }
  }
  const roofMesh=new THREE.Mesh(g,material),coreMesh=new THREE.Mesh(houseCoreGeometry(h),material);
  for(const u of [-.49,-.23,0,.19,.49])for(const v of [-.49,-.21,.07,.25,.49]) {
    ray.set(new THREE.Vector3(h.x+u*h.w,h.eaves+h.roofH+2,h.z+v*h.d),new THREE.Vector3(0,-1,0));
    const hits=ray.intersectObject(roofMesh).map(h=>h.point.y).sort((a,b)=>b-a),core=ray.intersectObject(coreMesh)[0]?.point.y;
    assert(hits.length>=2 && Number.isFinite(core),'Roof/body must both cover the house footprint');
    const top=hits[0],bottom=hits.at(-1),error=Math.abs(core-bottom-.001);
    maxContactError=Math.max(maxContactError,error);minimumThickness=Math.min(minimumThickness,top-bottom);samples++;
    assert(error<.00015,`Body does not meet the rendered roof underside: ${i} ${error}`);
    assert(core<top-.008,'Stone must not protrude through tiles');
  }
  g.dispose();coreMesh.geometry.dispose();
}
const report={houseCount:world.plan.houses.length,roofCount:houses.length,volumes:results.length,invalidVolumes:bad.length,
  unit,samples,maxContactError,minimumThickness,results};
writeFileSync(process.argv[2]||'shots/roof-check.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,results:undefined},null,2));
