import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {tagMesh} from './util.js';

export function makeEntryDoor(layout,tex,plan) {
  const r=layout,w=r.doorHalf-.025,group=new THREE.Group(),leaves=[];
  const wood=new THREE.MeshStandardMaterial({map:tex.wood.map,normalMap:tex.wood.normalMap,
    color:r.kind==='gallery'?0x9c815d:0x63857a,roughness:.78});
  const iron=new THREE.MeshStandardMaterial({color:0xc9b079,metalness:.72,roughness:.4});
  for(const side of [-1,1]) {
    const hinge=new THREE.Group();hinge.position.set(r.doorX+side*w,r.floor+.025,r.z1-.12);
    const shape=new THREE.Shape();shape.moveTo(0,0);shape.lineTo(-side*w,0);
    // Draw each half of the arched leaf in coordinates relative to its hinge.
    for(let i=0;i<=20;i++) {
      const x=-side*w*(1-i/20),worldX=side*w+x;
      shape.lineTo(x,r.spring+Math.sqrt(Math.max(0,w*w-worldX*worldX))-.025);
    }
    shape.closePath();
    const leaf=new THREE.ExtrudeGeometry(shape,{depth:.07,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.007,bevelThickness:.007});
    leaf.translate(0,0,-.035);
    const parts=[leaf];
    for(const y of [.24,1.08,1.92]) {
      const bar=new THREE.BoxGeometry(w-.12,.06,.10);bar.translate(-side*w/2,y,0);parts.push(bar);
    }
    for(let k=1;k<4;k++) {
      const batten=new THREE.BoxGeometry(.018,1.82,.082);batten.translate(-side*w*k/4,1.07,0);parts.push(batten);
    }
    const geometries=parts.map(g=>g.index?g.toNonIndexed():g),geo=mergeGeometries(geometries);
    for(const g of new Set([...parts,...geometries]))g.dispose();
    const mesh=new THREE.Mesh(geo,wood);mesh.castShadow=mesh.receiveShadow=true;
    hinge.add(tagMesh(mesh,'entry.doorLeaf',{solid:true}));
    const handleParts=[];
    for(const z of [-.082,.082]) {
      const ring=new THREE.TorusGeometry(.066,.011,6,16);ring.translate(-side*(w-.13),1.15,z);handleParts.push(ring);
    }
    const handles=new THREE.Mesh(mergeGeometries(handleParts),iron);
    handleParts.forEach(g=>g.dispose());handles.castShadow=handles.receiveShadow=true;
    hinge.add(tagMesh(handles,'entry.doorHandle',{solid:true}));group.add(hinge);
    const collider={x0:0,x1:0,z0:0,z1:0,y0:r.floor,y1:r.floor+r.spring+w};
    r.colliders.push(collider);leaves.push({hinge,side,collider});
  }
  const blockers=plan.extraCylinders.filter(c=>Math.hypot(c.x-r.doorX,c.z-r.z1)<5);
  const door={layout:r,group,leaves,blockers,openness:0,open:false,
    update(dt){
      this.openness=Math.min(1,this.openness+(this.open?dt/.55:0));
      const t=this.openness,angle=(t*t*(3-2*t))*Math.PI*.51;
      for(const {hinge,side,collider:b} of leaves) {
        hinge.rotation.y=-side*angle;
        const dx=-side*w*Math.cos(angle),dz=-w*Math.sin(angle);
        b.x0=Math.min(hinge.position.x,hinge.position.x+dx)-.045;
        b.x1=Math.max(hinge.position.x,hinge.position.x+dx)+.045;
        b.z0=hinge.position.z+dz-.045;b.z1=hinge.position.z+.045;
      }
    },
  };
  door.update(0);return door;
}

// Hit the actual arched doorway, from either side. The reveal and nearby
// arcade columns occlude it; distant, upstairs and side-wall clicks do not act.
export function entryDoorTarget(doors,ray,groundY) {
  let best=null,distance=Infinity;
  for(const door of doors) {
    const r=door.layout;
    if(Math.abs(groundY-r.floor)>.5||Math.abs(ray.direction.z)<1e-5)continue;
    const t=(r.z1-.12-ray.origin.z)/ray.direction.z;
    if(t<=0||t>4.5||t>=distance)continue;
    const p=ray.at(t,new THREE.Vector3()),x=p.x-r.doorX,y=p.y-r.floor;
    if(Math.abs(x)>r.doorHalf||y<.05||y>r.spring+Math.sqrt(Math.max(0,r.doorHalf*r.doorHalf-x*x)))continue;
    let blocked=false;
    for(const z of [r.z1+.275,r.z1-r.wall]) {
      const at=(z-ray.origin.z)/ray.direction.z;
      if(at>0&&at<t&&Math.abs(ray.origin.x+at*ray.direction.x-r.doorX)>r.doorHalf)blocked=true;
    }
    for(const c of door.blockers) {
      const dx=c.x-ray.origin.x,dz=c.z-ray.origin.z;
      const at=(dx*ray.direction.x+dz*ray.direction.z)/(ray.direction.x**2+ray.direction.z**2);
      const height=ray.origin.y+at*ray.direction.y;
      if(at>0&&at<t&&height>c.y0&&height<c.y1&&
        Math.hypot(dx-at*ray.direction.x,dz-at*ray.direction.z)<c.r)blocked=true;
    }
    if(blocked)continue;
    distance=t;best={door,inside:r.contains(ray.origin.x,ray.origin.z)};
  }
  return best;
}
