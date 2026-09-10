import assert from 'node:assert/strict';
import * as THREE from 'three';
import { potShellGeometry, leafGeometry, growPot, makePottedPlants } from '../src/plants.js';
import { meshTopology } from './structure/geom.mjs';

const shell = potShellGeometry(), topology = meshTopology(shell);
assert.equal(topology.boundaryEdges,0,'Clay shell must have no holes');
assert.equal(topology.nonManifoldEdges,0,'All shell joins must meet exactly two faces');
assert.equal(topology.flippedEdges,0,'All vessel faces must have consistent winding');
assert.equal(topology.degenerate,0,'Caps must not contain collapsed triangles');
assert(topology.volume > .012 && topology.volume < .04,'Clay volume must be plausible');
shell.computeBoundingBox();
assert.equal(shell.boundingBox.min.y,0,'All pot bases must sit at the supplied ground elevation');
const pot = new THREE.Mesh(shell,new THREE.MeshBasicMaterial());
const ray = new THREE.Raycaster(new THREE.Vector3(0,1,0),new THREE.Vector3(0,-1,0));
assert(Math.abs(ray.intersectObject(pot)[0].point.y-.061)<1e-5,'The opening must reach the inner bottom, not a false lid');
const leaf = leafGeometry();
leaf.computeBoundingBox();
assert(leaf.boundingBox.max.z-leaf.boundingBox.min.z>.03,'A leaf must be cupped in depth');

const pots = Array.from({length:80},(_,i)=>({x:i*2,z:i%5,y:2.6,s:.7+(i%9)*.08,seed:(i+.5)/80,boug:i%6===0}));
const signatures = new Set();
for (const p of pots) {
  const growth = growPot(p);
  signatures.add(growth.stems.slice(1).map(s=>s.b.toArray().join(',')).join('|'));
  for (const leaf of growth.leaves) {
    const stem = growth.stems[leaf.branch];
    const expected = stem.a.clone().lerp(stem.b,leaf.u);
    assert(leaf.base.distanceTo(expected)<1e-9,'Every leaf must attach to its own branch');
    assert(Math.abs(leaf.direction.length()-1)<1e-9);
    assert(leaf.length>0 && leaf.width>0 && leaf.width<.08);
  }
  assert.deepEqual(growth,growPot(p),'Growth must be deterministic');
}
assert.equal(signatures.size,pots.length,'Plants must have different branching, not only a random rotation');
const plants = makePottedPlants(pots,()=>.45,{value:40});
assert.equal(plants.group.children.length,3,'Plants must stay in three batches');
for (const m of plants.group.children) {
  assert(m.isInstancedMesh && m.material.isMeshStandardMaterial);
  assert.equal(m.geometry.attributes.aSkyI.count,m.count);
  if (m.name !== 'life.flowerPot') {
    assert(m.customDepthMaterial,'Moving leaves and stems must move in the shadow pass');
    assert.equal(m.geometry.attributes.aWindRoot.count,m.count);
  }
  for (const n of m.instanceMatrix.array) assert(Number.isFinite(n),'No invalid transforms');
}
console.log(JSON.stringify({topology,plants:pots.length,shapes:signatures.size,batches:plants.group.children.map(m=>({name:m.name,count:m.count}))},null,2));
