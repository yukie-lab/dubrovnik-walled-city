import assert from 'node:assert/strict';
import * as THREE from 'three';
import {woodlandLeafMesh,woodlandLeafGeometry} from '../src/woodland-leaves.js';
import {WoodlandLeafLOD,WoodlandWoodLOD} from '../src/woodland-lod.js';
import {WoodlandBuffer} from '../src/woodland-shape.js';
import {growPine} from '../src/woodland-growth.js';
import {mulberry32} from '../src/util.js';

const B={FM:[],FC:[],FT:[],trees:[]},matrix=new THREE.Matrix4();
for(const [x,z] of [[0,-10],[80,-10],[0,40]]) {
  const from=B.FM.length/16;
  for(let i=0;i<512;i++) {
    matrix.makeScale(.08,.2,.024);matrix.setPosition(x+(i%16)*.04,2+Math.floor(i/16)*.025,z);
    B.FM.push(...matrix.elements);B.FC.push(i/512,.1,.2);B.FT.push(0,.1,.37,1);
  }
  B.trees.push({base:[x,0,z],height:10,strength:1,leafFrom:from,leafTo:B.FM.length/16});
}
const material=new THREE.MeshStandardMaterial();material.userData.treeWind={value:.115};
const mesh=woodlandLeafMesh(B,material,new THREE.MeshDepthMaterial()),lod=new WoodlandLeafLOD(mesh);
const source=mesh.instanceMatrix.array.slice(),colors=mesh.instanceColor.array.slice(),traits=mesh.geometry.attributes.aTree.array.slice();
const camera=new THREE.PerspectiveCamera(55,1,.1,1000),frustum=new THREE.Frustum().setFromProjectionMatrix(camera.projectionMatrix);
lod.prepareDetail(camera.position,1000,false);lod.update(frustum.planes,null);
assert.equal(mesh.count,512,'Only the foreground tree is visible');
lod.update([new THREE.Plane(new THREE.Vector3(1,0,0),-10000)],null);assert.equal(mesh.count,0);
lod.restore();assert.equal(mesh.count,1536);assert.deepEqual(mesh.instanceMatrix.array,source);
assert.deepEqual(mesh.instanceColor.array,colors);assert.deepEqual(mesh.geometry.attributes.aTree.array,traits);

const sumArea=()=>{
  let result=0;const a=mesh.instanceMatrix.array;
  for(let i=0;i<mesh.count;i++){const o=i*16;result+=Math.hypot(a[o],a[o+1],a[o+2])*Math.hypot(a[o+4],a[o+5],a[o+6])*.5;}
  return result;
};
const originalArea=sumArea(),counts=[];
for(const z of [200,600,1600]) {
  lod.prepareDetail(new THREE.Vector3(0,2,z),1000,true);lod.restore();counts.push(mesh.count);
  assert(Math.abs(sumArea()/originalArea-1)<1e-5,'Equal source leaves preserve total area through thinning and morphing');
  const a=mesh.instanceMatrix.array;
  for(let i=0;i<mesh.count;i++) {
    const o=i*16,det=new THREE.Matrix4().fromArray(a,o).determinant();assert(det>0,'Every retained leaf keeps nonzero thickness');
    const row=B.trees.find(t=>a[o+14]-.5*a[o+6]===t.base[2] && Math.abs(a[o+12]-.5*a[o+4]-t.base[0])<1);
    assert(row,'Leaf sampling must not move planting or growth sites');
  }
}
assert(counts[0]>counts[1] && counts[1]>=counts[2]);
lod.prepareDetail(camera.position,1000,false);lod.restore();assert.deepEqual(mesh.instanceMatrix.array,source);
assert.deepEqual(mesh.instanceColor.array,colors);assert.deepEqual(mesh.geometry.attributes.aTree.array,traits);

// Check a level boundary independently in projected area. Leaves that leave
// the draw have already shrunk to much less than a pixel before compaction.
let lo=10,hi=500;
for(let i=0;i<40;i++){const z=(lo+hi)/2;lod.prepareDetail(new THREE.Vector3(0,2,z),1000,true);if(lod.detail[0]>=64)hi=z;else lo=z;}
lod.prepareDetail(new THREE.Vector3(0,2,lo),1000,true);lod.restore();
let maxDepartingArea=0;
for(let i=1;i<512;i+=2) {
  const a=mesh.instanceMatrix.array,o=i*16,d=Math.hypot(a[o+12],a[o+13]-2,a[o+14]-lo);
  const area=Math.hypot(a[o],a[o+1],a[o+2])*Math.hypot(a[o+4],a[o+5],a[o+6])*.5;
  maxDepartingArea=Math.max(maxDepartingArea,area*1000**2/d**2);
}
assert(maxDepartingArea<.02,'Compacted leaves have negligible projected area at the transition');

const wood=new WoodlandBuffer();growPine(wood,[0,0,-20],mulberry32(98),{h:8});
const wm=new THREE.Mesh(wood.geometry(),material);wm.castShadow=true;const wl=new WoodlandWoodLOD(wm),original=wm.geometry.index.array.slice();
wl.prepareDetail(new THREE.Vector3(0,2,600),1000,true,0,null);wl.restore();
assert(wl.count<original.length,'Subpixel twig ranges are omitted');
assert(wl.count>0,'The continuous trunk and main branches remain');
wl.prepareDetail(camera.position,1000,false,0,null);wl.restore();assert.deepEqual(wm.geometry.index.array,original);
const g=woodlandLeafGeometry();assert([...g.attributes.color.array].every(v=>v===1),'Instance leaf colors have a white vertex multiplier');
console.log(JSON.stringify({counts,areaConserved:true,maxDepartingAreaPixels:maxDepartingArea,exactRestoration:true,closedLeafTriangles:g.index.count/3}));
