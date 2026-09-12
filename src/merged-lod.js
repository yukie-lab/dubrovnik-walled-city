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
  update(viewPlanes,shadowPlanes) {
    const inside=(planes,s)=>planes.every(p=>p.distanceToPoint(s.center)>=-s.radius-.02);
    let changed=false;
    for(let i=0;i<this.groups.length;i++) {
      const sphere=this.groups[i].sphere;
      this.next[i]=inside(viewPlanes,sphere)||(this.mesh.castShadow && shadowPlanes && inside(shadowPlanes,sphere)) ? 1 : 0;
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
