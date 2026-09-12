import * as THREE from 'three';
import { makeHouseOcclusion } from './occlusion.js';
import { MergedSolidLOD } from './merged-lod.js';
import { ActorBatchLOD } from './actor-lod.js';

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
    // A leaf-sized occlusion ray for each of 29,000 leaves costs more CPU than
    // their saved drawing. First test small spatial groups; if their whole
    // sphere is hidden, every member is hidden. A partially visible group keeps
    // its members conservatively and needs no per-leaf occlusion ray.
    const groups=new Map();this.groupIds=new Uint32Array(this.capacity);
    for(let i=0;i<this.capacity;i++) {
      const o=i*4,s=this.spheres,key=`${Math.floor(s[o]/2)},${Math.floor(s[o+1]/2)},${Math.floor(s[o+2]/2)}`;
      if(!groups.has(key))groups.set(key,{id:groups.size,members:[]});
      const g=groups.get(key);g.members.push(i);this.groupIds[i]=g.id;
    }
    this.groupSpheres=new Float64Array(groups.size*4);this.groupFlags=new Uint8Array(groups.size);
    for(const g of groups.values()) {
      const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity],s=this.spheres;
      for(const i of g.members)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],s[i*4+k]-s[i*4+3]);hi[k]=Math.max(hi[k],s[i*4+k]+s[i*4+3]);}
      const c=lo.map((n,k)=>(n+hi[k])*.5);let radius=0;
      for(const i of g.members)radius=Math.max(radius,Math.hypot(s[i*4]-c[0],s[i*4+1]-c[1],s[i*4+2]-c[2])+s[i*4+3]);
      this.groupSpheres.set([...c,radius],g.id*4);
    }
  }

  update(viewPlanes, shadowPlanes, cameraPosition, pixelScale, shadowPixelScale, occlusion = null, shadowView = null) {
    const { spheres: s, nextIds, ids, margin, mesh } = this;
    let count = 0, changed = false;
    if(occlusion)for(let i=0;i<this.groupFlags.length;i++) {
      const o=i*4,g=this.groupSpheres,x=g[o],y=g[o+1],z=g[o+2],r=g[o+3]+margin;
      const visible=intersects(viewPlanes,x,y,z,r) && !occlusion.blocked(cameraPosition.x,cameraPosition.y,cameraPosition.z,x,y,z,r);
      let shadow=mesh.castShadow && shadowPlanes && intersects(shadowPlanes,x,y,z,r);
      if(shadow && shadowView) {
        const e=shadowView.matrixWorldInverse.elements;
        const travel=-(x*e[2]+y*e[6]+z*e[10]+e[14])-shadowView.near;
        if(travel>2*r) {
          const m=shadowView.matrixWorld.elements;
          shadow=!occlusion.blocked(x+m[8]*travel,y+m[9]*travel,z+m[10]*travel,x,y,z,r);
        }
      }
      this.groupFlags[i]=(visible ? 1 : 0)|(shadow ? 2 : 0);
    }
    for (let i = 0; i < this.capacity; i++) {
      const o = i * 4, x = s[o], y = s[o + 1], z = s[o + 2], r = s[o + 3];
      const flags=occlusion ? this.groupFlags[this.groupIds[i]] : 3;
      if(!flags)continue;
      const near = Math.max(0.01, Math.hypot(x - cameraPosition.x, y - cameraPosition.y, z - cameraPosition.z) - r);
      const inView = (flags & 1) && 2 * r * pixelScale / near >= this.minPixels && intersects(viewPlanes, x, y, z, r + margin);
      const inShadow = (flags & 2) && mesh.castShadow && shadowPlanes && 2 * r * shadowPixelScale >= this.minPixels
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

export function makeInstanceLOD(root, plan) {
  const batches = [], actorGroups = new Map();
  root.traverse(mesh => {
    if (mesh.userData.staticDetail) batches.push(new StaticInstanceLOD(mesh,{minPixels:mesh.userData.lodMinPixels ?? .4}));
    if(!mesh.isInstancedMesh && mesh.geometry?.userData.solids?.length)batches.push(new MergedSolidLOD(mesh));
    if(mesh.userData.actorFamily) {
      const family=mesh.userData.actorFamily;
      if(!actorGroups.has(family))actorGroups.set(family,[]);
      actorGroups.get(family).push(mesh);
    }
  });
  const actors=[...actorGroups.values()].map(meshes=>new ActorBatchLOD(meshes));
  const view = new THREE.Frustum(), shadow = new THREE.Frustum(), matrix = new THREE.Matrix4();
  const occlusion=plan ? makeHouseOcclusion(plan.houses) : null;
  const signature=new Float64Array(35).fill(NaN), nextSignature=new Float64Array(35);
  return {
    enabled: true,
    occlusionEnabled: true,
    batches,
    actors,
    restoreActors() { for(const actor of actors)actor.restore(); },
    update(camera, sun, renderer) {
      // All shared streams must be captured before any family is compacted.
      for(const actor of actors)actor.capture();
      if (!this.enabled) { for (const b of batches) b.restore(); signature.fill(NaN); return; }
      camera.updateMatrixWorld();
      matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      nextSignature.set(matrix.elements,0);
      view.setFromProjectionMatrix(matrix, camera.coordinateSystem, camera.reversedDepth);
      sun.updateWorldMatrix(true, false);
      sun.target.updateWorldMatrix(true, false);
      sun.shadow.updateMatrices(sun);
      const sc = sun.shadow.camera;
      matrix.multiplyMatrices(sc.projectionMatrix, sc.matrixWorldInverse);
      nextSignature.set(matrix.elements,16);
      shadow.setFromProjectionMatrix(matrix, sc.coordinateSystem, sc.reversedDepth);
      const pixelScale = renderer.domElement.height * camera.projectionMatrix.elements[5] * 0.5;
      const shadowPixelScale = sun.shadow.mapSize.x / (sc.right - sc.left);
      nextSignature[32]=pixelScale;nextSignature[33]=sun.castShadow ? shadowPixelScale : 0;
      nextSignature[34]=this.occlusionEnabled ? 1 : 0;
      // Moving residents need a fresh selection even with a stationary camera.
      for(const actor of actors)actor.update(view.planes,sun.castShadow ? shadow.planes : null,
        camera.position,pixelScale,shadowPixelScale,this.occlusionEnabled ? occlusion : null,sc);
      if(nextSignature.every((n,i)=>n===signature[i]))return;
      signature.set(nextSignature);
      for (const b of batches) b.update(view.planes, sun.castShadow ? shadow.planes : null,
        camera.position, pixelScale, shadowPixelScale,this.occlusionEnabled ? occlusion : null,sc);
    },
  };
}
