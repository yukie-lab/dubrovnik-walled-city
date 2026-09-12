import * as THREE from 'three';

// Cull complete closed buildings within a single indexed draw. The full source
// vertex streams and bounds stay resident; only the submitted index range changes.
export class MergedSolidLOD {
  constructor(mesh) {
    if(!mesh.geometry.index)throw new Error('Indexed merged geometry required');
    this.mesh=mesh;this.source=mesh.geometry.index.array.slice();
    mesh.geometry.index.setUsage(THREE.DynamicDrawUsage);
    mesh.updateWorldMatrix(true,false);
    const p=mesh.geometry.attributes.position,v=new THREE.Vector3(),groups=new Map();
    for(const solid of mesh.geometry.userData.solids) {
      const key=`${solid.x},${solid.z}`;
      if(!groups.has(key))groups.set(key,{from:solid.from*3,to:solid.to*3,box:new THREE.Box3()});
      const g=groups.get(key);g.to=solid.to*3;
      for(let i=solid.from*3;i<solid.to*3;i++) {
        const j=this.source[i];v.fromBufferAttribute(p,j).applyMatrix4(mesh.matrixWorld);g.box.expandByPoint(v);
      }
    }
    this.groups=[...groups.values()].map(g=>({...g,sphere:g.box.getBoundingSphere(new THREE.Sphere())}));
    this.kept=new Uint8Array(this.groups.length).fill(1);this.next=new Uint8Array(this.groups.length);
    this.count=this.source.length;
    mesh.geometry.computeBoundingSphere();
  }
  update(viewPlanes,shadowPlanes,cameraPosition,pixelScale,shadowPixelScale,occlusion=null,shadowView=null,viewMask=1) {
    const inside=(planes,s)=>planes.every(p=>p.distanceToPoint(s.center)>=-s.radius-.02);
    // A mesh also submitted to another render layer needs that layer's view.
    // Main-view buildings cannot hide geometry from a water/reflection pass
    // in which those buildings are absent. Keep such batches conservatively.
    const canOcclude=occlusion && (this.mesh.layers.mask & ~viewMask)===0;
    let changed=false;
    for(let i=0;i<this.groups.length;i++) {
      const sphere=this.groups[i].sphere,{x,y,z}=sphere.center,r=sphere.radius+.02;
      let visible=inside(viewPlanes,sphere);
      if(visible && canOcclude)visible=!occlusion.blocked(cameraPosition.x,cameraPosition.y,cameraPosition.z,x,y,z,r);
      let shadow=this.mesh.castShadow && shadowPlanes && inside(shadowPlanes,sphere);
      if(shadow && canOcclude && shadowView) {
        const e=shadowView.matrixWorldInverse.elements,travel=-(x*e[2]+y*e[6]+z*e[10]+e[14])-shadowView.near;
        if(travel>2*r) {
          const m=shadowView.matrixWorld.elements;
          shadow=!occlusion.blocked(x+m[8]*travel,y+m[9]*travel,z+m[10]*travel,x,y,z,r);
        }
      }
      this.next[i]=visible||shadow ? 1 : 0;
      if(this.next[i]!==this.kept[i])changed=true;
    }
    if(!changed)return;
    const index=this.mesh.geometry.index;let offset=0;
    for(let i=0;i<this.groups.length;i++)if(this.next[i]) {
      const {from,to}=this.groups[i];index.array.set(this.source.subarray(from,to),offset);offset+=to-from;
    }
    this.kept.set(this.next);this.count=offset;index.needsUpdate=true;
    this.mesh.geometry.setDrawRange(0,offset);
  }
  restore() {
    if(this.count===this.source.length)return;
    const index=this.mesh.geometry.index;index.array.set(this.source);index.needsUpdate=true;
    this.count=this.source.length;this.kept.fill(1);this.mesh.geometry.setDrawRange(0,this.count);
  }
}
