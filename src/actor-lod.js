import * as THREE from 'three';

function intersects(planes,x,y,z,r) {
  return planes.every(p=>p.normal.x*x+p.normal.y*y+p.normal.z*z+p.constant>=-r);
}

// Animation writes stable resident indices. Restore those indices before the
// next animation update, snapshot all streams, then compact a whole actor's
// body batches with one shared selection. The shared walking attribute is
// copied once, never read again after another body batch has compacted it.
export class ActorBatchLOD {
  constructor(meshes) {
    if(!meshes.length || meshes.some(m=>!m.isInstancedMesh || m.count!==meshes[0].count))throw new Error('Aligned actor batches required');
    this.meshes=meshes;this.capacity=meshes[0].count;this.compacted=false;
    this.ids=new Uint32Array(this.capacity);this.streams=[];
    const seen=new Set();
    for(const m of meshes) {
      // Individual actor bounds below include the animated limbs. A cached
      // whole-batch bound from an earlier frame must not reject new positions.
      m.frustumCulled=false;
      for(const a of [m.instanceMatrix,m.instanceColor,...Object.values(m.geometry.attributes).filter(a=>a.isInstancedBufferAttribute)].filter(Boolean)) {
        if(seen.has(a))continue;seen.add(a);
        if((a.meshPerAttribute??1)!==1)throw new Error('Actor attributes must follow resident indices');
        this.streams.push({attribute:a,source:a.array.slice(),size:a.itemSize});
      }
    }
    this.matrices=this.streams.find(s=>s.attribute===meshes[0].instanceMatrix).source;
    this.castShadow=meshes.some(m=>m.castShadow);
    meshes[0].updateWorldMatrix(true,false);this.world=meshes[0].matrixWorld.clone();
    this.center=new THREE.Vector3();
  }
  restore() {
    if(!this.compacted)return;
    for(const {attribute,source} of this.streams){attribute.array.set(source);attribute.needsUpdate=true;}
    for(const m of this.meshes)m.count=this.capacity;
    this.compacted=false;
  }
  capture() {
    if(this.compacted)throw new Error('Restore actor indices before updating their animation');
    for(const s of this.streams)s.source.set(s.attribute.array);
  }
  update(viewPlanes,shadowPlanes,cameraPosition,pixelScale,shadowPixelScale,occlusion,shadowView) {
    const a=this.matrices,worldScale=this.world.getMaxScaleOnAxis();let count=0;
    for(let i=0;i<this.capacity;i++) {
      const k=i*16,scale=Math.max(Math.hypot(a[k],a[k+1],a[k+2]),Math.hypot(a[k+4],a[k+5],a[k+6]),Math.hypot(a[k+8],a[k+9],a[k+10]));
      if(scale<1e-8)continue;
      this.center.set(a[k+12]+a[k+4]*.98,a[k+13]+a[k+5]*.98,a[k+14]+a[k+6]*.98).applyMatrix4(this.world);
      const {x,y,z}=this.center,r=1.65*scale*worldScale;
      let visible=intersects(viewPlanes,x,y,z,r);
      if(visible && occlusion)visible=!occlusion.blocked(cameraPosition.x,cameraPosition.y,cameraPosition.z,x,y,z,r);
      let shadow=this.castShadow && shadowPlanes && intersects(shadowPlanes,x,y,z,r);
      if(shadow && occlusion && shadowView) {
        const e=shadowView.matrixWorldInverse.elements,travel=-(x*e[2]+y*e[6]+z*e[10]+e[14])-shadowView.near;
        if(travel>2*r) {
          const m=shadowView.matrixWorld.elements;
          shadow=!occlusion.blocked(x+m[8]*travel,y+m[9]*travel,z+m[10]*travel,x,y,z,r);
        }
      }
      if(visible || shadow)this.ids[count++]=i;
    }
    if(count===this.capacity)return;
    for(const {attribute,source,size} of this.streams) {
      const target=attribute.array;
      for(let i=0;i<count;i++)for(let j=0;j<size;j++)target[i*size+j]=source[this.ids[i]*size+j];
      attribute.needsUpdate=true;
    }
    for(const m of this.meshes)m.count=count;
    this.compacted=true;
  }
}
