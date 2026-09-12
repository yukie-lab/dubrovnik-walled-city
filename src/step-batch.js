import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {makeStepStone} from './step-stone.js';
import {patchSkyVisInstanced} from './skyvis.js';
import {tagMesh} from './util.js';

export function makeStepBatch(items,tex,skyAt) {
  const pieces=[],solids=[],tint=new THREE.Color();let from=0;
  for(let i=0;i<items.length;i++) {
    const q=items[i],g=makeStepStone(q,{coverM:tex.paving.coverM}),c=g.attributes.color;
    tint.setHSL(.10,.15,.775*q.tint,THREE.SRGBColorSpace);
    for(let j=0;j<c.count;j++)c.setXYZ(j,c.getX(j)*tint.r,c.getY(j)*tint.g,c.getZ(j)*tint.b);
    // Preserve the existing scalar sky response. A merged stone stores the
    // same value on its vertices instead of an instance attribute.
    const sky=skyAt ? skyAt(q.x,q.z,q.y+.25,0,1,0) : 1;
    g.setAttribute('aSkyI',new THREE.Float32BufferAttribute(new Float32Array(c.count).fill(sky),1));
    const to=from+g.index.count/3;
    solids.push({id:i,kind:'step',x:q.x,z:q.z,from,to});from=to;pieces.push(g);
  }
  const geometry=mergeGeometries(pieces);geometry.userData.solids=solids;pieces.forEach(g=>g.dispose());
  const material=new THREE.MeshStandardMaterial({
    map:tex.paving.map,normalMap:tex.paving.normalMap,roughnessMap:tex.paving.roughnessMap,
    vertexColors:true,roughness:.70,metalness:0,envMapIntensity:.55,
  });
  material.onBeforeCompile=sh=>{
    sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute float aWear; varying float vStepWear;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvStepWear=aWear*clamp(normal.y,0.0,1.0);');
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying float vStepWear;')
      .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor*=mix(1.0,.60,vStepWear);');
  };
  material.customProgramCacheKey=()=>'wornStepStone';patchSkyVisInstanced(material);
  const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;
  return tagMesh(mesh,'steps',{solid:true,masonry:true,groundContact:true,buriedBase:true,steps:items});
}
