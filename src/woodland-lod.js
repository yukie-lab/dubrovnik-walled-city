import * as THREE from 'three';
import {woodlandWindMargin} from './woodland-wind.js';
import {MergedSolidLOD} from './merged-lod.js';

export class WoodlandWoodLOD extends MergedSolidLOD {
  constructor(mesh) {
    super(mesh,{ranges:mesh.geometry.userData.trees.map(t=>({...t,x:t.base[0],z:t.base[2]})),
      padding:t=>woodlandWindMargin(t.height,mesh.material.userData.treeWind.value,t.strength)});
    this.trees=mesh.geometry.userData.trees;this.fine=new Uint8Array(this.trees.length).fill(1);
    this.appliedFine=this.fine.slice();
  }
  prepareDetail(camera,pixelScale,enabled=true,shadowPixelScale=0,shadowPlanes=null) {
    for(let i=0;i<this.trees.length;i++) {
      const t=this.trees[i],s=this.groups[i].sphere,distance=Math.max(1,camera.distanceTo(s.center)-s.radius);
      const shadow=shadowPlanes && shadowPlanes.every(p=>p.distanceToPoint(s.center)>=-s.radius);
      const diameter=Math.max(t.fineDiameter*pixelScale/distance,shadow ? t.fineDiameter*shadowPixelScale : 0);
      this.fine[i]=!enabled || diameter>=.18 ? 1 : 0;
    }
  }
  update(...args) {
    const version=this.mesh.geometry.index.version;super.update(...args);
    this.rebuild(this.mesh.geometry.index.version!==version);
  }
  rebuild(force=false) {
    if(!force && this.fine.every((v,i)=>v===this.appliedFine[i]))return;
    const index=this.mesh.geometry.index;let offset=0;
    for(let i=0;i<this.trees.length;i++)if(this.kept[i]) {
      const t=this.trees[i],ranges=this.fine[i] ? [{from:t.from,to:t.to}] : t.mainRanges;
      for(const r of ranges) {
        const from=r.from*3,to=r.to*3;index.array.set(this.source.subarray(from,to),offset);offset+=to-from;
      }
    }
    this.count=offset;this.mesh.geometry.setDrawRange(0,offset);index.needsUpdate=true;this.appliedFine.set(this.fine);
  }
  restore(){this.kept.fill(1);this.rebuild(true);}
}

// Keep whole moving crowns coherent. Bulk range copies avoid one JavaScript
// culling test and sixteen scalar matrix copies for every individual needle.
export class WoodlandLeafLOD {
  constructor(mesh) {
    this.mesh=mesh;this.capacity=mesh.count;
    this.pixelArea=1.5;
    this.streams=[mesh.instanceMatrix,mesh.instanceColor,mesh.geometry.attributes.aTree,mesh.geometry.attributes.aNeedle].map(attribute=>
      ({attribute,source:attribute.array.slice(),size:attribute.itemSize}));
    let maxLeafRadius=0;
    this.groups=mesh.userData.woodlandLeaves.map(t=>{
      const box=new THREE.Box3(),p=new THREE.Vector3(),matrix=this.streams[0].source;let radius=0,area=0;
      for(let i=t.leafFrom;i<t.leafTo;i++) {
        const o=i*16;p.set(matrix[o+12],matrix[o+13],matrix[o+14]);box.expandByPoint(p);
        radius=Math.max(radius,.5*Math.max(Math.hypot(matrix[o],matrix[o+1],matrix[o+2]),
          Math.hypot(matrix[o+4],matrix[o+5],matrix[o+6]),Math.hypot(matrix[o+8],matrix[o+9],matrix[o+10])));
        const coverage=mesh.geometry.attributes.aNeedle.getX(i)>.5 ? mesh.geometry.userData.needleCoverage : 1;
        area+=Math.hypot(matrix[o],matrix[o+1],matrix[o+2])*Math.hypot(matrix[o+4],matrix[o+5],matrix[o+6])*.5*coverage;
      }
      const sphere=box.getBoundingSphere(new THREE.Sphere());
      maxLeafRadius=Math.max(maxLeafRadius,radius);
      sphere.radius+=radius*15+woodlandWindMargin(t.height,mesh.material.userData.treeWind.value,t.strength);
      return {from:t.leafFrom,to:t.leafTo,sphere,area:area/(t.leafTo-t.leafFrom)};
    });
    this.kept=new Uint8Array(this.groups.length).fill(1);this.next=new Uint8Array(this.groups.length);
    this.detail=new Uint16Array(this.groups.length);this.appliedDetail=new Uint16Array(this.groups.length);
    mesh.boundingSphere.radius+=14*maxLeafRadius+Math.max(...mesh.userData.woodlandLeaves.map(t=>woodlandWindMargin(t.height,mesh.material.userData.treeWind.value,t.strength)));
    for(const {attribute} of this.streams)attribute.setUsage(THREE.DynamicDrawUsage);
  }
  prepareDetail(camera,pixelScale,enabled=true) {
    for(let i=0;i<this.groups.length;i++) {
      const g=this.groups[i],distance=Math.max(1,camera.distanceTo(g.sphere.center)-g.sphere.radius);
      const projected=g.area*pixelScale*pixelScale/(distance*distance);
      const ratio=enabled ? Math.min(64,Math.max(1,this.pixelArea/Math.max(projected,1e-6))) : 1;
      const level=Math.floor(Math.log2(ratio)),stride=2**level;
      const fraction=Math.min(63,Math.floor((ratio/stride-1)*64));
      this.detail[i]=level*64+fraction;
    }
  }
  update(view,shadow) {
    const inside=(planes,s)=>planes.every(p=>p.distanceToPoint(s.center)>=-s.radius-.02);
    for(let i=0;i<this.groups.length;i++) {
      const s=this.groups[i].sphere;this.next[i]=inside(view,s)||(this.mesh.castShadow&&shadow&&inside(shadow,s)) ? 1 : 0;
    }
    this.applySelection();
  }
  applySelection() {
    let changed=false;
    for(let i=0;i<this.groups.length;i++)if(this.next[i]!==this.kept[i] || this.detail[i]!==this.appliedDetail[i]){changed=true;break;}
    if(!changed)return;
    for(const {attribute,source,size} of this.streams) {
      let offset=0;
      for(let i=0;i<this.groups.length;i++)if(this.next[i]) {
        const g=this.groups[i],level=Math.floor(this.detail[i]/64),stride=2**level,fraction=(this.detail[i]%64)/64;
        if(!this.detail[i]) {
          attribute.array.set(source.subarray(g.from*size,g.to*size),offset);offset+=(g.to-g.from)*size;
        } else for(let j=g.from;j<g.to;j+=stride) {
          const from=j*size;for(let k=0;k<size;k++)attribute.array[offset+k]=source[from+k];
          if(attribute===this.mesh.instanceMatrix) {
            // Alternating representatives trade projected area continuously.
            // At the next power-of-two level, every disappearing leaf has
            // shrunk to zero and the retained leaf has absorbed its area.
            const parity=((j-g.from)/stride)%2;
            const scale=Math.sqrt(stride*(parity ? 1-fraction : 1+fraction));
            // A representative grows from its real petiole attachment. Its
            // base stays on the twig at every density, including transitions.
            for(let k=0;k<3;k++)attribute.array[offset+12+k]+=source[from+4+k]*(scale-1)*.5;
            for(const k of [0,1,2,4,5,6,8,9,10])attribute.array[offset+k]*=scale;
          }
          offset+=size;
        }
      }
      attribute.needsUpdate=true;this.mesh.count=offset/size;
    }
    this.kept.set(this.next);this.appliedDetail.set(this.detail);
  }
  restore() {
    this.next.fill(1);this.applySelection();
  }
}
