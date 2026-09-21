import * as THREE from 'three';

// A small immutable triangle hierarchy makes enclosure baking proportional to
// nearby stone faces. It uses the actual tessellated solids, including slits.
function enclosureOccluder(geometry) {
  const p=geometry.attributes.position,ix=geometry.index,triangles=[];
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),hit=new THREE.Vector3();
  const vertex=(v,k)=>v.fromBufferAttribute(p,ix.getX(k));
  for(let k=0;k<ix.count;k+=3) {
    vertex(a,k);vertex(b,k+1);vertex(c,k+2);
    const box=new THREE.Box3().setFromPoints([a,b,c]);triangles.push({k,box,center:box.getCenter(new THREE.Vector3())});
  }
  const build=items=>{
    const box=new THREE.Box3();for(const t of items)box.union(t.box);
    if(items.length<=10)return {box,items};
    const d=box.getSize(new THREE.Vector3()),axis=d.x>=d.y&&d.x>=d.z?'x':d.y>=d.z?'y':'z';
    items.sort((a,b)=>a.center[axis]-b.center[axis]);const middle=items.length>>1;
    return {box,left:build(items.slice(0,middle)),right:build(items.slice(middle))};
  };
  const root=build(triangles),ray=new THREE.Ray();let limit;
  const test=node=>{
    if(!ray.intersectsBox(node.box))return false;
    if(!node.items)return test(node.left)||test(node.right);
    for(const {k} of node.items) {
      vertex(a,k);vertex(b,k+1);vertex(c,k+2);
      if(ray.intersectTriangle(a,b,c,false,hit)) {
        const d=hit.distanceToSquared(ray.origin);if(d>.008**2&&d<limit)return true;
      }
    }
    return false;
  };
  return (origin,direction,far)=>{ray.set(origin,direction);limit=far*far;return test(root);};
}

// Local enclosure visibility augments the existing city sky/bounce response.
// It changes neither the sun nor exposure; actual openings also participate in
// the ordinary directional shadow map and cast the narrow shafts of sunlight.
export function makeStairSkyVisibility(layout,geometry) {
  if(!layout.enclosed)return ()=>1;
  const blocked=enclosureOccluder(geometry);
  const origin=new THREE.Vector3(),normal=new THREE.Vector3(),u=new THREE.Vector3(),v=new THREE.Vector3(),direction=new THREE.Vector3();
  const cache=new Map(),samples=16;
  return (x,z,y,nx=0,ny=1,nz=0)=>{
    const key=[x,y,z].map(v=>Math.round(v*8)).join(',')+':'+[nx,ny,nz].map(v=>Math.round(v*4)).join(',');
    if(cache.has(key))return cache.get(key);
    normal.set(nx,ny,nz).normalize();origin.set(x,y,z).addScaledVector(normal,.012);
    u.set(Math.abs(normal.y)<.95?0:1,Math.abs(normal.y)<.95?1:0,0).cross(normal).normalize();v.crossVectors(normal,u).normalize();
    let open=0;
    for(let i=0;i<samples;i++) {
      const r=Math.sqrt((i+.5)/samples),theta=i*2.399963229728653;
      direction.copy(normal).multiplyScalar(Math.sqrt(1-r*r)).addScaledVector(u,r*Math.cos(theta)).addScaledVector(v,r*Math.sin(theta));
      if(!blocked(origin,direction,layout.length+5))open++;
    }
    const visibility=.035+.965*open/samples;cache.set(key,visibility);return visibility;
  };
}
