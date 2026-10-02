import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import * as THREE from 'three';
import {woodlandLeafMesh} from '../src/woodland-leaves.js';
import {WoodlandLeafLOD as CPU} from './fixtures/woodland-cpu-lod.mjs';
import {WoodlandLeafLOD as GPU} from '../src/woodland-leaf-lod.js';
export function woodlandMorphChecks() {
const B={FM:[],FC:[],FT:[],FK:[],trees:[]},m=new THREE.Matrix4();
for(const [tree,[x,z]] of [[0,-10],[80,-10],[0,40]].entries()) {
  const from=B.FM.length/16;
  for(let i=0;i<511+tree;i++) {
    m.makeScale(.08,.2,.024);m.setPosition(x+(i%16)*.04,2+Math.floor(i/16)*.025,z);
    B.FM.push(...m.elements);B.FC.push(i/512,.1,.2);B.FT.push(0,.1,.37,1);B.FK.push(i%2);
  }
  B.trees.push({base:[x,0,z],height:10,strength:1,leafFrom:from,leafTo:B.FM.length/16});
}
function build(Type) {
  const mat=new THREE.MeshStandardMaterial();mat.userData.treeWind={value:.115};
  const mesh=woodlandLeafMesh(B,mat,new THREE.MeshDepthMaterial());return new Type(mesh);
}
const cpu=build(CPU),gpu=build(GPU),p=gpu.mesh.geometry.attributes.position,a=new THREE.Vector3(),b=new THREE.Vector3(),cm=new THREE.Matrix4(),gm=new THREE.Matrix4();
let maxError=0;
for(const distance of [10,200,600,1600,160,10]) {
  for(const lod of [cpu,gpu]){lod.prepareDetail(new THREE.Vector3(0,2,distance),1000,true);lod.restore();}
  assert.equal(gpu.mesh.count,cpu.mesh.count);
  const growth=gpu.mesh.geometry.attributes.aLeafGrowth;
  for(let i=0;i<gpu.mesh.count;i++) {
    const id=growth.getX(i),ordinal=growth.getY(i),stride=gpu.morph.data[id*4],fraction=gpu.morph.data[id*4+1];
    // Draw slots may move. Match by the original tree/leaf identity, not by
    // the order in which an opaque instance reaches the rasterizer.
    let reference=ordinal/stride;
    for(let tree=0;tree<id;tree++)reference+=Math.ceil((cpu.groups[tree].to-cpu.groups[tree].from)/2**(cpu.detail[tree]>>6));
    cpu.mesh.getMatrixAt(reference,cm);gpu.mesh.getMatrixAt(i,gm);
    const scale=Math.sqrt(stride*(1+fraction*(1-2*(Math.floor(ordinal/stride)%2))));
    for(let v=0;v<p.count;v++) {
      a.fromBufferAttribute(p,v).applyMatrix4(cm);
      b.fromBufferAttribute(p,v).add(new THREE.Vector3(0,.5,0)).multiplyScalar(scale).sub(new THREE.Vector3(0,.5,0)).applyMatrix4(gm);
      maxError=Math.max(maxError,a.distanceTo(b));
    }
  }
}
assert(maxError<.00002,'Shader growth matches the previous CPU geometry within Float32 matrix quantization');
gpu.prepareDetail(new THREE.Vector3(),1000,false);gpu.restore();
const versions=gpu.streams.map(s=>s.attribute.version),transfers=gpu.transferredBytes;
for(let f=1;f<64;f++) {
  gpu.detail.fill(f);gpu.restore();assert.deepEqual(gpu.streams.map(s=>s.attribute.version),versions,'Fraction changes must not reupload instance streams');
}
const fractionBytes=gpu.transferredBytes-transfers;
for(const s of gpu.streams)s.attribute.clearUpdateRanges();
gpu.next.set([1,0,1]);gpu.applySelection();assert.equal(gpu.mesh.count,1024);
for(const s of gpu.streams) {
  assert.deepEqual(s.attribute.array.subarray(0,511*s.size),s.source.subarray(0,511*s.size),'Unchanged prefix remains exact');
  assert.deepEqual(s.attribute.array.subarray(511*s.size,1024*s.size),s.source.subarray(1023*s.size,1536*s.size),'Changed suffix contains the right native instances');
  assert(s.attribute.updateRanges.every(r=>r.start>=0&&r.start+r.count<=s.attribute.array.length),'Upload ranges stay inside the fixed capacity');
}
gpu.prepareDetail(new THREE.Vector3(),1000,false);gpu.restore();
for(const s of gpu.streams)assert.deepEqual(s.attribute.array,s.source,'Full restoration includes growth IDs and source matrices');
assert.equal(gpu.mesh.material.userData.leafMorph,gpu.mesh.customDepthMaterial.userData.leafMorph,'Color and depth share one growth texture');
for(let turn=0;turn<96;turn++) {
  for(let i=0;i<gpu.groups.length;i++){gpu.next[i]=(turn+i)%3?1:0;gpu.detail[i]=((turn*3+i*13)%7)*64+(turn*7+i*13)%64;}
  gpu.applySelection();
  checkSelected(gpu);
}
if(gpu.sampleCache) {
  const bound=gpu.groups.reduce((sum,g)=>sum+Math.ceil((g.to-g.from)/2),0)*gpu.streams.reduce((sum,s)=>sum+s.size*4,0);
  assert(gpu.sampleCacheBytes<=bound,'Each tree caches at most its half-density sample, rounded up for an odd leaf count');
  const builds=gpu.sampleCacheBuilds;gpu.applySelection();assert.equal(gpu.sampleCacheBuilds,builds,'Unchanged selection does not rebuild samples');
}
console.log(JSON.stringify({instances:gpu.capacity,maxError,fractionOnlyUpdates:63,fractionBytes,instanceUploadsForFractions:0,exactRestoration:true,
  abruptSelections:96,sampleCacheBytes:gpu.sampleCacheBytes||0}));
}

export function checkSelected(lod) {
  const expected=new Set();
  for(let i=0;i<lod.groups.length;i++)if(lod.next[i]) {
    const g=lod.groups[i],stride=2**(lod.detail[i]>>6);
    for(let id=g.from;id<g.to;id+=stride)expected.add(id);
  }
  assert.equal(lod.mesh.count,expected.size);
  const growth=lod.mesh.geometry.attributes.aLeafGrowth;
  for(let slot=0;slot<lod.mesh.count;slot++) {
    const tree=growth.getX(slot),ordinal=growth.getY(slot),id=lod.groups[tree].from+ordinal;
    assert(expected.delete(id),'Every drawn leaf is selected exactly once');
    for(const {source,attribute,size} of lod.streams)
      assert.deepEqual(attribute.array.subarray(slot*size,(slot+1)*size),source.subarray(id*size,(id+1)*size),
        'Matrix, color, wind, needle and growth records preserve the source identity');
  }
  assert.equal(expected.size,0,'No selected leaf is missing');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)woodlandMorphChecks();
