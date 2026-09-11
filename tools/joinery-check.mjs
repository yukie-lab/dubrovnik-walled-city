import assert from 'node:assert/strict';
import * as THREE from 'three';
import {doorLeafGeometry,doorFrameGeometry,doorArchTopGeometry,doorIronworkGeometry,wornThresholdGeometry} from '../src/joinery.js';
import {meshTopology} from './structure/geom.mjs';
for(const [name,g] of [['leaf',doorLeafGeometry()],['frame',doorFrameGeometry()],['arch',doorFrameGeometry(true)],
  ['archTop',doorArchTopGeometry()],['iron',doorIronworkGeometry()],['threshold',wornThresholdGeometry()]]) {
  const t=meshTopology(g);console.log(name,JSON.stringify({...t,boundarySample:[],nonManifoldSample:[]}));
  assert.equal(t.boundaryEdges,0,`${name} has holes`);
  assert.equal(t.nonManifoldEdges,0,`${name} has invalid joins`);
  assert.equal(t.flippedEdges,0,`${name} winding`);
  assert(t.volume>0,`${name} inward-facing solid`);
  for(const a of Object.values(g.attributes))assert([...a.array].every(Number.isFinite));
  if(name==='leaf') {
    g.computeBoundingBox();assert(g.boundingBox.min.y>.08 && g.boundingBox.max.y<=2.201,'leaf must clear sill and lintel');
    const ray=new THREE.Raycaster(new THREE.Vector3(.25,1.1,1),new THREE.Vector3(0,0,-1));
    assert(ray.intersectObject(new THREE.Mesh(g,new THREE.MeshBasicMaterial())).length>0,'front missing');
  }
}
