// Behavioural regression: keep offscreen shadow casters, preserve all per-instance
// streams, restore invisible batches, and discard only subpixel distant details.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StaticInstanceLOD } from '../src/instance-lod.js';
const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
geometry.setAttribute('aWeather', new THREE.InstancedBufferAttribute(new Float32Array([0.1, 0.2, 0.3, 0.4]), 1));
const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial(), 4);
mesh.castShadow = true;
const matrix = new THREE.Matrix4();
for (const [i, xyz] of [[0, [0, 0, -5]], [1, [10, 0, -5]], [2, [0, 0, 5]], [3, [0, 0, -5000]]]) {
  mesh.setMatrixAt(i, matrix.makeTranslation(...xyz));
  mesh.setColorAt(i, new THREE.Color(i / 4, 0.5, 1 - i / 4));
}
const sourceMatrix = mesh.instanceMatrix.array.slice(), sourceColor = mesh.instanceColor.array.slice();
const lod = new StaticInstanceLOD(mesh);
const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 10000);
const view = new THREE.Frustum().setFromProjectionMatrix(camera.projectionMatrix);
const shadowCamera = new THREE.OrthographicCamera(9, 11, 1, -1, 0.1, 20);
const shadow = new THREE.Frustum().setFromProjectionMatrix(shadowCamera.projectionMatrix);
const pixelScale = 500;
lod.update(view.planes, shadow.planes, camera.position, pixelScale, 100);
assert.equal(mesh.count, 2, 'Visible instance and offscreen shadow caster must survive');
assert.deepEqual([...lod.ids.subarray(0, 2)], [0, 1]);
assert.equal(geometry.attributes.aWeather.getX(1), Math.fround(0.2));
// Turn around. Source instance 2 now occupies slot 0, with its own colour and attributes.
camera.rotation.y = Math.PI;
camera.updateMatrixWorld();
view.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
lod.update(view.planes, null, camera.position, pixelScale, 0);
assert.equal(mesh.count, 1);
assert.equal(lod.ids[0], 2);
assert.equal(geometry.attributes.aWeather.getX(0), Math.fround(0.3));
assert.deepEqual([...mesh.instanceColor.array.subarray(0, 3)], [...sourceColor.subarray(6, 9)]);
assert.deepEqual([...mesh.instanceMatrix.array.subarray(0, 16)], [...sourceMatrix.subarray(32, 48)]);
// Empty then restore: no stale bounding sphere, no permanent loss of source data.
lod.update([], null, new THREE.Vector3(1e9, 1e9, 1e9), pixelScale, 0);
assert.equal(mesh.count, 0);
lod.restore();
assert.equal(mesh.count, 4);
assert.deepEqual(mesh.instanceMatrix.array, sourceMatrix);
assert.deepEqual(mesh.instanceColor.array, sourceColor);
assert.deepEqual([...geometry.attributes.aWeather.array], [0.1, 0.2, 0.3, 0.4].map(Math.fround));
assert(mesh.boundingSphere.radius > 2000, 'Original bounds must survive an empty frame');
// A shader displaces a whole component into view from an offscreen base mesh.
// Both the per-instance cull and the renderer's whole-batch bound must see it.
const stretched=new THREE.InstancedMesh(new THREE.BoxGeometry(.1,.1,.1),new THREE.MeshBasicMaterial(),1);
stretched.setMatrixAt(0,new THREE.Matrix4().makeTranslation(4,0,-5));
stretched.userData.instanceBounds=(i,sphere)=>{sphere.center.set(-4,0,0);sphere.radius=.1;return sphere;};
const deformed=new StaticInstanceLOD(stretched,{margin:0}),front=new THREE.OrthographicCamera(-1,1,1,-1,.1,20);
const narrow=new THREE.Frustum().setFromProjectionMatrix(front.projectionMatrix);
deformed.update(narrow.planes,null,front.position,500,0);
assert.equal(stretched.count,1,'A deformed visible component must survive');
assert(narrow.intersectsSphere(stretched.boundingSphere),'Its renderer bound must also remain visible');
assert(stretched.boundingSphere.containsPoint(new THREE.Vector3(0,0,-5)));
console.log('Static detail LOD passed: view/shadow union, subpixel cutoff, attribute identity, empty-to-full restoration.');
