import * as THREE from 'three';
import {woodlandWindMargin} from './woodland-wind.js';
import {makeLeafMorph} from './woodland-morph.js';

// The small per-tree texture carries continuous growth. Instance streams are
// compacted only when a whole representative enters/leaves the draw, and only
// the changed suffix is uploaded. A subpixel growth change costs a few KB.
export class WoodlandLeafLOD {
  constructor(mesh) {
    this.mesh=mesh;this.capacity=mesh.count;this.pixelArea=1.5;
    this.morph=makeLeafMorph(mesh,mesh.userData.woodlandLeaves);
    this.streams=[mesh.instanceMatrix,mesh.instanceColor,mesh.geometry.attributes.aTree,
      mesh.geometry.attributes.aNeedle,mesh.geometry.attributes.aLeafGrowth].map(attribute=>({attribute,source:attribute.array.slice(),size:attribute.itemSize}));
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
      const sphere=box.getBoundingSphere(new THREE.Sphere());maxLeafRadius=Math.max(maxLeafRadius,radius);
      sphere.radius+=radius*15+woodlandWindMargin(t.height,mesh.material.userData.treeWind.value,t.strength);
      return {from:t.leafFrom,to:t.leafTo,sphere,area:area/(t.leafTo-t.leafFrom)};
    });
    this.kept=new Uint8Array(this.groups.length).fill(1);this.next=new Uint8Array(this.groups.length);
    this.detail=new Uint16Array(this.groups.length);this.appliedDetail=new Uint16Array(this.groups.length);
    mesh.boundingSphere.radius+=14*maxLeafRadius+Math.max(...mesh.userData.woodlandLeaves.map(t=>woodlandWindMargin(t.height,mesh.material.userData.treeWind.value,t.strength)));
    for(const {attribute} of this.streams)attribute.setUsage(THREE.DynamicDrawUsage);
    this.transferredBytes=0;this.compactions=0;
  }
  prepareDetail(camera,pixelScale,enabled=true) {
    for(let i=0;i<this.groups.length;i++) {
      const g=this.groups[i],distance=Math.max(1,camera.distanceTo(g.sphere.center)-g.sphere.radius);
      const projected=g.area*pixelScale*pixelScale/(distance*distance);
      const ratio=enabled ? Math.min(64,Math.max(1,this.pixelArea/Math.max(projected,1e-6))) : 1;
      const level=Math.floor(Math.log2(ratio)),stride=2**level,fraction=Math.min(63,Math.floor((ratio/stride-1)*64));
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
    let first=this.groups.length,morphChanged=false,prefix=0;
    for(let i=0;i<this.groups.length;i++) {
      const level=this.detail[i]>>6,previous=this.appliedDetail[i]>>6;
      if(this.next[i]!==this.kept[i] || (this.next[i] && level!==previous))first=Math.min(first,i);
      if(this.detail[i]!==this.appliedDetail[i]) {
        this.morph.data[i*4]=2**level;this.morph.data[i*4+1]=(this.detail[i]%64)/64;morphChanged=true;
      }
    }
    if(morphChanged){this.morph.texture.needsUpdate=true;this.transferredBytes+=this.morph.data.byteLength;}
    if(first<this.groups.length) {
      for(let i=0;i<first;i++)if(this.next[i])prefix+=Math.ceil((this.groups[i].to-this.groups[i].from)/2**(this.detail[i]>>6));
      let count=prefix;
      for(const {attribute,source,size} of this.streams) {
        let offset=prefix*size;
        for(let i=first;i<this.groups.length;i++)if(this.next[i]) {
          const g=this.groups[i],stride=2**(this.detail[i]>>6);
          if(stride===1){attribute.array.set(source.subarray(g.from*size,g.to*size),offset);offset+=(g.to-g.from)*size;}
          else for(let j=g.from;j<g.to;j+=stride) {
            const from=j*size;for(let k=0;k<size;k++)attribute.array[offset+k]=source[from+k];offset+=size;
          }
        }
        // A previous render may not yet have consumed its update range. Keep
        // those ranges too; Three merges them before the next upload.
        if(offset>prefix*size){attribute.addUpdateRange(prefix*size,offset-prefix*size);attribute.needsUpdate=true;this.transferredBytes+=(offset-prefix*size)*4;}
        count=offset/size;
      }
      this.mesh.count=count;this.compactions++;
    }
    this.kept.set(this.next);this.appliedDetail.set(this.detail);
  }
  restore(){this.next.fill(1);this.applySelection();}
}
