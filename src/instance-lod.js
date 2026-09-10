import * as THREE from 'three';

// Compact static detail batches without changing the source instances. The
// camera and the shadow camera both participate, so an offscreen window frame
// still casts its shadow into the visible street. Never use this for animated
// or externally re-indexed batches such as people and opening shutters.
export class StaticInstanceLOD {
  constructor(mesh, { minPixels = 0.4, margin = 0.35 } = {}) {
    if (!mesh.isInstancedMesh || mesh.morphTexture) throw new Error('Static instance batch required');
    this.mesh = mesh;
    this.capacity = mesh.count;
    this.minPixels = minPixels;
    this.margin = margin;
    this.streams = [mesh.instanceMatrix, mesh.instanceColor,
      ...Object.values(mesh.geometry.attributes).filter(a => a.isInstancedBufferAttribute)].filter(Boolean)
      .map(attribute => {
        if ((attribute.meshPerAttribute ?? 1) !== 1) throw new Error('Repeated instance attributes require a separate batch');
        return { attribute, source: attribute.array.slice(), size: attribute.itemSize };
      });
    this.ids = Int32Array.from({ length: this.capacity }, (_, i) => i);
    this.nextIds = new Int32Array(this.capacity);
    this.spheres = new Float32Array(this.capacity * 4);
    mesh.updateWorldMatrix(true, false);
    mesh.geometry.computeBoundingSphere();
    // Keep this original conservative bound after compaction. An empty batch
    // must not cache an empty bound and disappear forever when it fills again.
    mesh.computeBoundingSphere();
    const matrix = new THREE.Matrix4(), center = new THREE.Vector3();
    const unit = mesh.geometry.boundingSphere;
    for (let i = 0; i < this.capacity; i++) {
      mesh.getMatrixAt(i, matrix);
      matrix.premultiply(mesh.matrixWorld);
      center.copy(unit.center).applyMatrix4(matrix);
      this.spheres.set([center.x, center.y, center.z, unit.radius * matrix.getMaxScaleOnAxis()], i * 4);
    }
  }

  update(viewPlanes, shadowPlanes, cameraPosition, pixelScale, shadowPixelScale) {
    const { spheres: s, nextIds, ids, margin, mesh } = this;
    let count = 0, changed = false;
    for (let i = 0; i < this.capacity; i++) {
      const o = i * 4, x = s[o], y = s[o + 1], z = s[o + 2], r = s[o + 3];
      const near = Math.max(0.01, Math.hypot(x - cameraPosition.x, y - cameraPosition.y, z - cameraPosition.z) - r);
      const inView = 2 * r * pixelScale / near >= this.minPixels && intersects(viewPlanes, x, y, z, r + margin);
      const inShadow = mesh.castShadow && shadowPlanes && 2 * r * shadowPixelScale >= this.minPixels
        && intersects(shadowPlanes, x, y, z, r + margin);
      if (!inView && !inShadow) continue;
      nextIds[count] = i;
      if (ids[count] !== i) changed = true;
      count++;
    }
    if (count !== mesh.count) changed = true;
    if (!changed) return;
    for (const { attribute, source, size } of this.streams) {
      const target = attribute.array;
      for (let i = 0; i < count; i++) {
        const from = nextIds[i] * size, to = i * size;
        for (let j = 0; j < size; j++) target[to + j] = source[from + j];
      }
      attribute.needsUpdate = true;
    }
    ids.set(nextIds.subarray(0, count));
    mesh.count = count;
  }

  restore() {
    if (this.mesh.count === this.capacity) return;
    for (const { attribute, source } of this.streams) {
      attribute.array.set(source);
      attribute.needsUpdate = true;
    }
    for (let i = 0; i < this.capacity; i++) this.ids[i] = i;
    this.mesh.count = this.capacity;
  }
}

function intersects(planes, x, y, z, radius) {
  for (const p of planes) {
    if (p.normal.x * x + p.normal.y * y + p.normal.z * z + p.constant < -radius) return false;
  }
  return true;
}

export function makeInstanceLOD(root) {
  const batches = [];
  root.traverse(mesh => {
    if (mesh.userData.staticDetail) batches.push(new StaticInstanceLOD(mesh,{minPixels:mesh.userData.lodMinPixels ?? .4}));
  });
  const view = new THREE.Frustum(), shadow = new THREE.Frustum(), matrix = new THREE.Matrix4();
  return {
    enabled: true,
    batches,
    update(camera, sun, renderer) {
      if (!this.enabled) { for (const b of batches) b.restore(); return; }
      camera.updateMatrixWorld();
      matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      view.setFromProjectionMatrix(matrix, camera.coordinateSystem, camera.reversedDepth);
      sun.updateWorldMatrix(true, false);
      sun.target.updateWorldMatrix(true, false);
      sun.shadow.updateMatrices(sun);
      const sc = sun.shadow.camera;
      matrix.multiplyMatrices(sc.projectionMatrix, sc.matrixWorldInverse);
      shadow.setFromProjectionMatrix(matrix, sc.coordinateSystem, sc.reversedDepth);
      const pixelScale = renderer.domElement.height * camera.projectionMatrix.elements[5] * 0.5;
      const shadowPixelScale = sun.shadow.mapSize.x / (sc.right - sc.left);
      for (const b of batches) b.update(view.planes, sun.castShadow ? shadow.planes : null,
        camera.position, pixelScale, shadowPixelScale);
    },
  };
}
