import * as THREE from 'three';

// A small immutable triangle hierarchy makes enclosure baking proportional to
// nearby stone faces. It uses the actual tessellated solids, including slits.
function enclosureOccluder(geometry) {
  const p=geometry.attributes.position,ix=geometry.index,triangles=[];
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),hit=new THREE.Vector3();
  const coefficients=new Float64Array(ix.count*4),edge1=new THREE.Vector3(),edge2=new THREE.Vector3(),faceNormal=new THREE.Vector3();
  const vertex=(v,k)=>v.fromBufferAttribute(p,ix.getX(k));
  for(let k=0;k<ix.count;k+=3) {
    vertex(a,k);vertex(b,k+1);vertex(c,k+2);
    edge1.subVectors(b,a);edge2.subVectors(c,a);faceNormal.crossVectors(edge1,edge2);
    coefficients.set([...a,...edge1,...edge2,...faceNormal],k*4);
    const box=new THREE.Box3().setFromPoints([a,b,c]);triangles.push({k,box,center:box.getCenter(new THREE.Vector3())});
  }
  const build=items=>{
    const box=new THREE.Box3();for(const t of items)box.union(t.box);
    if(items.length<=10)return {box,items};
    const d=box.getSize(new THREE.Vector3()),axis=d.x>=d.y&&d.x>=d.z?'x':d.y>=d.z?'y':'z';
    items.sort((a,b)=>a.center[axis]-b.center[axis]);const middle=items.length>>1;
    const split=(items[middle-1].center[axis]+items[middle].center[axis])*.5;
    return {box,axis,split,left:build(items.slice(0,middle)),right:build(items.slice(middle))};
  };
  const root=build(triangles),ray=new THREE.Ray();let limit,invX,invY,invZ;
  // Three's slab test, with reciprocals shared by every node of this ray.
  // Retain its NaN handling (zero direction on a box boundary), and use the
  // reciprocal sign so negative zero behaves exactly as in Ray.intersectBox.
  const intersectsBox=box=>{
    const o=ray.origin;let lo,hi,ylo,yhi,zlo,zhi;
    if(invX>=0){lo=(box.min.x-o.x)*invX;hi=(box.max.x-o.x)*invX;}
    else {lo=(box.max.x-o.x)*invX;hi=(box.min.x-o.x)*invX;}
    if(invY>=0){ylo=(box.min.y-o.y)*invY;yhi=(box.max.y-o.y)*invY;}
    else {ylo=(box.max.y-o.y)*invY;yhi=(box.min.y-o.y)*invY;}
    if(lo>yhi||ylo>hi)return false;
    if(ylo>lo||Number.isNaN(lo))lo=ylo;
    if(yhi<hi||Number.isNaN(hi))hi=yhi;
    if(invZ>=0){zlo=(box.min.z-o.z)*invZ;zhi=(box.max.z-o.z)*invZ;}
    else {zlo=(box.max.z-o.z)*invZ;zhi=(box.min.z-o.z)*invZ;}
    if(lo>zhi||zlo>hi)return false;
    if(zlo>lo||Number.isNaN(lo))lo=zlo;
    if(zhi<hi||Number.isNaN(hi))hi=zhi;
    return !(hi<0);
  };
  // The same double precision algebra as Ray.intersectTriangle, with its
  // immutable edges/normal baked once. Keep Ray.at and the squared hit-distance
  // bounds so finite near/far behavior also stays unchanged.
  const intersectsTriangle=k=>{
    const t=k*4,f=coefficients,o=ray.origin,d=ray.direction;
    let denominator=d.x*f[t+9]+d.y*f[t+10]+d.z*f[t+11],sign;
    if(denominator>0)sign=1;else if(denominator<0){sign=-1;denominator=-denominator;}else return false;
    const x=o.x-f[t],y=o.y-f[t+1],z=o.z-f[t+2];
    const b1=sign*(d.x*(y*f[t+8]-z*f[t+7])+d.y*(z*f[t+6]-x*f[t+8])+d.z*(x*f[t+7]-y*f[t+6]));
    if(b1<0)return false;
    const b2=sign*(d.x*(f[t+4]*z-f[t+5]*y)+d.y*(f[t+5]*x-f[t+3]*z)+d.z*(f[t+3]*y-f[t+4]*x));
    if(b2<0||b1+b2>denominator)return false;
    const along=-sign*(x*f[t+9]+y*f[t+10]+z*f[t+11]);
    if(along<0)return false;
    ray.at(along/denominator,hit);const distance=hit.distanceToSquared(o);
    return distance>.008**2&&distance<limit;
  };
  const test=node=>{
    if(!intersectsBox(node.box))return false;
    if(!node.items)return ray.origin[node.axis]<node.split
      ? test(node.left)||test(node.right):test(node.right)||test(node.left);
    for(const {k} of node.items)if(intersectsTriangle(k))return true;
    return false;
  };
  return (origin,direction,far)=>{ray.set(origin,direction);limit=far*far;invX=1/direction.x;invY=1/direction.y;invZ=1/direction.z;return test(root);};
}

// Prove constant visibility before tracing a hemisphere. A point strictly
// inside a closed solid sees no sky; a supporting plane with all enclosure
// vertices behind it sees the entire outward hemisphere. Neither shortcut
// approximates the openings. Only closed, consistently oriented pieces may
// participate in the first proof.
function enclosureRegions(geometry) {
  const p=geometry.attributes.position,ix=geometry.index,solids=[];
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3();
  const vertex=(v,k)=>v.fromBufferAttribute(p,ix.getX(k));
  for(const solid of geometry.userData.stairSolids||[]) {
    const box=new THREE.Box3(),planes=[],edges=new Map();let volume=0;
    for(let k=solid.from*3;k<solid.to*3;k+=3) {
      vertex(a,k);vertex(b,k+1);vertex(c,k+2);box.expandByPoint(a).expandByPoint(b).expandByPoint(c);
      normal.copy(b).sub(a).cross(c.clone().sub(a));
      if(normal.lengthSq()<1e-20)continue;
      volume+=a.dot(b.clone().cross(c))/6;normal.normalize();
      planes.push(normal.x,normal.y,normal.z,-normal.dot(a));
      const keys=[a,b,c].map(v=>`${v.x},${v.y},${v.z}`);
      for(let i=0;i<3;i++) {
        const from=keys[i],to=keys[(i+1)%3],key=from<to?from+'|'+to:to+'|'+from;
        const edge=edges.get(key)||{count:0,winding:0};edge.count++;edge.winding+=from<to?1:-1;edges.set(key,edge);
      }
    }
    if(volume<=1e-8||!planes.length||[...edges.values()].some(e=>e.count!==2||e.winding!==0))continue;
    solids.push({box,planes:Float64Array.from(planes),center:box.getCenter(new THREE.Vector3()),radius:box.getSize(new THREE.Vector3()).length()*.5});
  }
  const bounds=new THREE.Box3().setFromBufferAttribute(p);
  return {
    planeBytes:solids.reduce((sum,s)=>sum+s.planes.byteLength,0),
    inside(origin,far) {
      for(const {box,planes,center,radius} of solids) {
        if(!box.containsPoint(origin)||origin.distanceTo(center)+radius>=far)continue;
        let enclosed=true;
        for(let i=0;i<planes.length;i+=4)if(planes[i]*origin.x+planes[i+1]*origin.y+planes[i+2]*origin.z+planes[i+3]>=-.008){enclosed=false;break;}
        if(enclosed)return true;
      }
      return false;
    },
    outside(origin,normal) {
      // The box corner is an upper support bound for every actual vertex.
      // It is less selective than scanning all vertices for each new normal,
      // but proves the same all-open result without that startup cost.
      const maximum=normal.x*(normal.x>=0?bounds.max.x:bounds.min.x)
        +normal.y*(normal.y>=0?bounds.max.y:bounds.min.y)
        +normal.z*(normal.z>=0?bounds.max.z:bounds.min.z);
      return normal.dot(origin)>maximum+1e-9;
    },
  };
}

// Local enclosure visibility augments the existing city sky/bounce response.
// It changes neither the sun nor exposure; actual openings also participate in
// the ordinary directional shadow map and cast the narrow shafts of sunlight.
export function makeStairSkyVisibility(layout,geometry,{samples=32}={}) {
  if(!layout.enclosed)return ()=>1;
  const blocked=enclosureOccluder(geometry),regions=enclosureRegions(geometry);
  const origin=new THREE.Vector3(),normal=new THREE.Vector3(),u=new THREE.Vector3(),v=new THREE.Vector3(),direction=new THREE.Vector3();
  // Narrow, deep openings occupy much less than one of 16 hemisphere samples.
  // Resolve their actual visibility before baking it into stone vertices. The
  // ray basis is shared by every query; only its orientation changes.
  const cache=new Map(),rays=Array.from({length:samples},(_,i)=>{
    const r=Math.sqrt((i+.5)/samples),theta=i*2.399963229728653;
    return [Math.sqrt(1-r*r),r*Math.cos(theta),r*Math.sin(theta)];
  });
  const stats={cacheMisses:0,insideSolid:0,outsidePlane:0,sampled:0,rays:0,planeBytes:regions.planeBytes};
  const query=(x,z,y,nx=0,ny=1,nz=0)=>{
    const key=[x,y,z].map(v=>Math.round(v*8)).join(',')+':'+[nx,ny,nz].map(v=>Math.round(v*4)).join(',');
    if(cache.has(key))return cache.get(key);
    normal.set(nx,ny,nz).normalize();origin.set(x,y,z).addScaledVector(normal,.012);
    stats.cacheMisses++;
    // Preserve the existing zero-direction result; enclosure proofs require
    // a genuine hemisphere, and production surface normals are nonzero.
    if(normal.lengthSq()===0){cache.set(key,1);return 1;}
    if(regions.inside(origin,layout.length+5)){stats.insideSolid++;cache.set(key,.035);return .035;}
    if(regions.outside(origin,normal)){stats.outsidePlane++;cache.set(key,1);return 1;}
    stats.sampled++;stats.rays+=samples;
    u.set(Math.abs(normal.y)<.95?0:1,Math.abs(normal.y)<.95?1:0,0).cross(normal).normalize();v.crossVectors(normal,u).normalize();
    let open=0;
    for(const [along,across,up] of rays) {
      direction.copy(normal).multiplyScalar(along).addScaledVector(u,across).addScaledVector(v,up);
      if(!blocked(origin,direction,layout.length+5))open++;
    }
    const visibility=.035+.965*open/samples;cache.set(key,visibility);return visibility;
  };
  query.stats=stats;return query;
}
