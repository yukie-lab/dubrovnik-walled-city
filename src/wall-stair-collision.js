import * as THREE from 'three';

// At hand distance the visible masonry also owns body clearance. A fixed-width
// corridor would leave an invisible wall across a tread fitted to the city.
// Index actual vertical triangles once; a walking query only visits nearby cells.
export function makeWallStairCollision(plan,geometry) {
  const p=geometry.attributes.position,ix=geometry.index,faces=[],cells=new Map(),size=3;
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  const excluded=new Uint8Array(ix.count/3);
  for(const s of geometry.userData.stairSolids||[])if(s.type==='coping'||s.type==='coping-mortar')excluded.fill(1,s.from,s.to);
  for(let i=0;i<ix.count;i+=3) {
    if(excluded[i/3])continue;
    a.fromBufferAttribute(p,ix.getX(i));b.fromBufferAttribute(p,ix.getX(i+1));c.fromBufferAttribute(p,ix.getX(i+2));
    const n=b.clone().sub(a).cross(c.clone().sub(a)).normalize();if(Math.abs(n.y)>.25)continue;
    const length=Math.hypot(n.x,n.z);if(length<.01)continue;
    const face={triangle:i/3,v:[a.toArray(),b.toArray(),c.toArray()],nx:n.x/length,nz:n.z/length,
      low:Math.min(a.y,b.y,c.y),high:Math.max(a.y,b.y,c.y)},index=faces.length;faces.push(face);
    for(let z=Math.floor(Math.min(a.z,b.z,c.z)/size);z<=Math.floor(Math.max(a.z,b.z,c.z)/size);z++)
      for(let x=Math.floor(Math.min(a.x,b.x,c.x)/size);x<=Math.floor(Math.max(a.x,b.x,c.x)/size);x++) {
        const key=x+','+z;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(index);
      }
  }
  return (x,z,r,bodyY,inspect=false)=>{
    const contacts=inspect?[]:null;
    const ground=plan.walkingGroundAt(x,z,bodyY-1);
    if(!ground.stair?.stone.wallStair.joint)return plan.collide(x,z,r,bodyY);
    const q=ground.stair.stone,rise=q.wallStair.rise||.16;
    // The leading foot lifts over a riser before the body centre crosses it.
    // Include the rise across the body's radius; ankle samples would turn the
    // vertical skirt of every landing into an impassable wall.
    const stepClearance=Math.min(.70,Math.max(.45,rise*2+r*rise/Math.max(.12,q.d-.025)+.08));
    for(let iteration=0;iteration<3;iteration++) {
      const nearby=new Set();
      for(let iz=Math.floor((z-r)/size);iz<=Math.floor((z+r)/size);iz++)
        for(let ix=Math.floor((x-r)/size);ix<=Math.floor((x+r)/size);ix++)
          for(const index of cells.get(ix+','+iz)||[])nearby.add(index);
      let correction=null;
      for(const h of [ground.y+stepClearance,ground.y+.95,ground.y+1.50])for(const index of nearby) {
        const f=faces[index];if(h<f.low||h>f.high)continue;
        const section=[];
        for(let k=0;k<3;k++) {
          const a=f.v[k],b=f.v[(k+1)%3],dy=b[1]-a[1];if(Math.abs(dy)<1e-9)continue;
          const t=(h-a[1])/dy;if(t<0||t>1)continue;
          const q=[a[0]+(b[0]-a[0])*t,a[2]+(b[2]-a[2])*t];
          if(!section.some(p=>Math.hypot(p[0]-q[0],p[1]-q[1])<1e-8))section.push(q);
        }
        if(section.length!==2)continue;
        const [a,b]=section,dx=b[0]-a[0],dz=b[1]-a[1],length=dx*dx+dz*dz;if(length<1e-12)continue;
        const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/length)),qx=a[0]+dx*t,qz=a[1]+dz*t;
        const sx=x-qx,sz=z-qz,distance=Math.hypot(sx,sz),signed=sx*f.nx+sz*f.nz;
        // A normal update cannot tunnel through a thick wall. Reject the back
        // face on the far side instead of pushing alternately through both.
        if(distance>=r||signed<-.08)continue;
        // Tessellation edges are not physical corners. Resolve the most
        // constraining face once, along its normal, instead of accumulating
        // a tangential shove at every internal triangle boundary.
        const depth=r-signed;
        if(!correction||depth>correction.depth)correction={nx:f.nx,nz:f.nz,depth,triangle:f.triangle,height:h,low:f.low,high:f.high};
      }
      if(!correction)break;
      contacts?.push(correction);
      x+=correction.nx*correction.depth;z+=correction.nz*correction.depth;
    }
    return inspect?{x,z,contacts}:{x,z};
  };
}
