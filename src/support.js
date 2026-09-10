import * as THREE from 'three';

// Static street-level support surfaces, taken from the generated triangles and
// the same step records used by the rendered step batch. This is for placing
// rigid props; player navigation and the geographic plan remain independent.
export function makeGroundSupport(groundGroup, stepItems = []) {
  const size = 4, cells = new Map(), entries = [];
  const add = (entry,x0,z0,x1,z1) => {
    entries.push(entry);
    for(let z=Math.floor(z0/size);z<=Math.floor(z1/size);z++)
      for(let x=Math.floor(x0/size);x<=Math.floor(x1/size);x++) {
        const key=`${x},${z}`;
        if(!cells.has(key))cells.set(key,[]);
        cells.get(key).push(entry);
      }
  };
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  groundGroup.updateWorldMatrix(true,true);
  groundGroup.traverse(mesh=>{
    if(!['ground.near','ground.paving','ground.stradun'].includes(mesh.name))return;
    const geometry=mesh.geometry,p=geometry.attributes.position,ix=geometry.index;
    const length=ix ? ix.count : p.count;
    const vertex=(target,i)=>target.fromBufferAttribute(p,ix ? ix.getX(i) : i).applyMatrix4(mesh.matrixWorld);
    for(let i=0;i<length;i+=3) {
      vertex(a,i);vertex(b,i+1);vertex(c,i+2);
      const determinant=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
      // Only upper faces can support something. Skirts and underside caps are
      // not a second street underneath a prop.
      if(determinant>=-1e-9)continue;
      const inv=1/determinant;
      const e={type:'triangle',source:mesh.name,
        ax:(b.z-c.z)*inv,az:(c.x-b.x)*inv,
        bx:(c.z-a.z)*inv,bz:(a.x-c.x)*inv,
        cx:c.x,cz:c.z,ay:a.y-c.y,by:b.y-c.y,cy:c.y};
      add(e,Math.min(a.x,b.x,c.x),Math.min(a.z,b.z,c.z),Math.max(a.x,b.x,c.x),Math.max(a.z,b.z,c.z));
    }
  });
  for(const step of stepItems) {
    const co=Math.cos(step.rotY),si=Math.sin(step.rotY);
    const dx=(Math.abs(co)*step.w+Math.abs(si)*step.d)*.5;
    const dz=(Math.abs(si)*step.w+Math.abs(co)*step.d)*.5;
    add({type:'step',source:'steps',step,co,si},step.x-dx,step.z-dz,step.x+dx,step.z+dz);
  }
  const at=(x,z)=>cells.get(`${Math.floor(x/size)},${Math.floor(z/size)}`)||[];
  function sample(x,z,ceiling=Infinity,source=null) {
    let y=-Infinity,found=null;
    for(const e of at(x,z)) {
      if(source && e.source!==source)continue;
      let h;
      if(e.type==='step') {
        const q=e.step,dx=x-q.x,dz=z-q.z;
        if(Math.abs(dx*e.co-dz*e.si)>q.w*.5+1e-7 || Math.abs(dx*e.si+dz*e.co)>q.d*.5+1e-7)continue;
        h=q.y;
      }else {
        const dx=x-e.cx,dz=z-e.cz,u=dx*e.ax+dz*e.az,v=dx*e.bx+dz*e.bz;
        if(u< -1e-7 || v< -1e-7 || u+v>1+1e-7)continue;
        h=e.cy+u*e.ay+v*e.by;
      }
      if(h<=ceiling && h>y){y=h;found=e;}
    }
    return found ? {y,source:found.source,entry:found} : null;
  }
  function disk(x,z,r,ceiling=Infinity,tolerance=.009) {
    const center=sample(x,z,ceiling);
    if(!center)return null;
    let lo=center.y,hi=center.y;
    for(let i=0;i<16;i++) {
      const theta=i*Math.PI/8;
      const h=sample(x+Math.cos(theta)*r,z+Math.sin(theta)*r,ceiling);
      if(!h || Math.abs(h.y-center.y)>tolerance)return null;
      lo=Math.min(lo,h.y);hi=Math.max(hi,h.y);
    }
    return {x,y:center.y,z,lo,hi,r};
  }
  function nearbySteps(x,z,radius=1.3) {
    const candidates=new Set();
    for(let iz=Math.floor((z-radius)/size);iz<=Math.floor((z+radius)/size);iz++)
      for(let ix=Math.floor((x-radius)/size);ix<=Math.floor((x+radius)/size);ix++)
        for(const e of cells.get(`${ix},${iz}`)||[])if(e.type==='step')candidates.add(e);
    return [...candidates].sort((a,b)=>Math.hypot(a.step.x-x,a.step.z-z)-Math.hypot(b.step.x-x,b.step.z-z));
  }
  return {sample,disk,nearbySteps,triangles:entries.filter(e=>e.type==='triangle').length};
}
