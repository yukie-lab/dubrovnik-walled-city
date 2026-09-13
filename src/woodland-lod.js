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

export {WoodlandLeafLOD} from "./woodland-leaf-lod.js";
