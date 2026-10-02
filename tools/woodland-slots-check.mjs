import assert from 'node:assert/strict';
import * as THREE from 'three';
import {woodlandLeafMesh} from '../src/woodland-leaves.js';
import {WoodlandLeafLOD} from '../src/woodland-leaf-lod.js';
import {mulberry32} from '../src/util.js';
import {checkSelected,woodlandMorphChecks} from './woodland-morph-check.mjs';

woodlandMorphChecks();

const B={FM:[],FC:[],FT:[],FK:[],trees:[]},matrix=new THREE.Matrix4();
for(let tree=0;tree<31;tree++) {
  const from=B.FM.length/16;
  for(let leaf=0;leaf<65+tree*3;leaf++) {
    matrix.makeScale(.08,.2,.024);matrix.setPosition(tree*8,2+leaf*.01,-10);
    B.FM.push(...matrix.elements);B.FC.push(tree/31,leaf/160,.2);B.FT.push(0,.1,tree/31,1);B.FK.push(tree%2);
  }
  B.trees.push({base:[tree*8,0,-10],height:10,strength:1,leafFrom:from,leafTo:B.FM.length/16});
}
const material=new THREE.MeshStandardMaterial();material.userData.treeWind={value:.115};
const lod=new WoodlandLeafLOD(woodlandLeafMesh(B,material,new THREE.MeshDepthMaterial()));
const device=lod.streams.map(s=>s.attribute.array.slice());
const consume=()=>{
  for(const [i,{attribute,size}] of lod.streams.entries()) {
    for(const r of attribute.updateRanges)device[i].set(attribute.array.subarray(r.start,r.start+r.count),r.start);
    attribute.clearUpdateRanges();
    assert.deepEqual(device[i].subarray(0,lod.mesh.count*size),attribute.array.subarray(0,lod.mesh.count*size),
      'Partial uploads include all pending changes, even after several selections before a render');
  }
};
lod.next.fill(1);lod.detail[0]=64;lod.applySelection();checkSelected(lod);consume();
const bytesPerLeaf=lod.streams.reduce((sum,s)=>sum+s.size*4,0),firstChangeBytes=lod.transferredBytes-lod.morph.data.byteLength;
const suffixBytes=lod.mesh.count*bytesPerLeaf;
assert(firstChangeBytes<suffixBytes*.1,'A small early-tree change must not upload the following trees');
const rnd=mulberry32(7908);let sparseChanges=0;
for(let turn=0;turn<240;turn++) {
  // Mostly individual trees; occasional empty/full/teleport transitions.
  if(turn%40===0){lod.next.fill(0);lod.detail.fill(0);}
  else if(turn%40===1){lod.next.fill(1);lod.detail.fill(0);}
  else {
    const tree=Math.floor(rnd()*lod.groups.length);
    lod.next[tree]=rnd()>.2 ? 1 : 0;lod.detail[tree]=Math.floor(rnd()*7)*64+Math.floor(rnd()*64);sparseChanges++;
  }
  lod.applySelection();checkSelected(lod);
  const growth=lod.mesh.geometry.attributes.aLeafGrowth,previous=new Int32Array(lod.groups.length).fill(-1);
  for(let slot=0;slot<lod.mesh.count;slot++) {
    const tree=growth.getX(slot),ordinal=growth.getY(slot);
    assert(ordinal>previous[tree],'Each crown retains source primitive order, including equal-depth overlaps');previous[tree]=ordinal;
  }
  if(turn%3===2)consume();
}
consume();lod.detail.fill(0);lod.restore();checkSelected(lod);consume();
const transfers=lod.transferredBytes,versions=lod.streams.map(s=>s.attribute.version);
lod.applySelection();assert.equal(lod.transferredBytes,transfers);assert.deepEqual(lod.streams.map(s=>s.attribute.version),versions);
console.log(JSON.stringify({instances:lod.capacity,selections:240,sparseChanges,firstChangeBytes,suffixBytes,
  partialUploads:true,identityAndAttributes:true,emptyAndFullRestoration:true,
  slotStorageBytes:lod.slots.slotOf.byteLength+lod.slots.sourceAt.byteLength+lod.slots.dirty.byteLength+lod.slots.touched.byteLength}));
