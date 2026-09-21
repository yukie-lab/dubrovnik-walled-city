import * as THREE from 'three';

// Query the already-built city solids, before any stair enclosure is appended.
// Only near-vertical faces can define a side joint; decks and sloping ground
// must never pull a tread away from its fixed route.
export function makeStairJointSampler(positions,indices) {
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  const p=geometry.attributes.position,faces=[],a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  for(let i=0;i<indices.length;i+=3) {
    a.fromBufferAttribute(p,indices[i]);b.fromBufferAttribute(p,indices[i+1]);c.fromBufferAttribute(p,indices[i+2]);
    const n=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    if(Math.abs(n.y)<.25)faces.push(indices[i],indices[i+1],indices[i+2]);
  }
  geometry.setIndex(faces);geometry.computeBoundingSphere();
  const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material),ray=new THREE.Raycaster();
  return {
    at(edge,y,direction,reach,inside=.15) {
      const origin=new THREE.Vector3(edge[0],y,edge[1]).addScaledVector(direction,-inside);
      ray.set(origin,direction);ray.far=reach+inside;
      const hit=ray.intersectObject(mesh,false)[0];if(!hit)return null;
      const normal=hit.face.normal.clone();
      return {point:[hit.point.x,hit.point.z],extension:hit.distance-inside,
        plane:[normal.x,normal.y,normal.z,-normal.dot(hit.point)]};
    },
    dispose(){geometry.dispose();material.dispose();},
  };
}

export function fitWallStairJoints(layout,sampler) {
  if(layout.enclosed||layout.spiral)return;
  for(const q of layout.steps) {
    const segment=layout.segments.find(s=>s.index===q.seg),side=-segment.railSign;
    const ends=side>0?[0,3]:[1,2],before=q.wallStair.corners.map(p=>p.slice());
    const normal=new THREE.Vector3(-(segment.b[1]-segment.a[1])*side,0,(segment.b[0]-segment.a[0])*side).normalize();
    const reach=layout.wallThickness*2+.04;
    const sample=(v,extra=0)=>{
      const a=before[ends[0]],b=before[ends[1]],oa=before[side>0?1:0],ob=before[side>0?2:3];
      const edge=[a[0]*(1-v)+b[0]*v,a[1]*(1-v)+b[1]*v],other=[oa[0]*(1-v)+ob[0]*v,oa[1]*(1-v)+ob[1]*v];
      const direction=new THREE.Vector3(edge[0]-other[0],0,edge[1]-other[1]).normalize();
      const scale=1/Math.max(.25,Math.abs(direction.dot(normal)));
      const hit=sampler.at(edge,q.y-.08,direction,(reach+extra)*scale,.15*scale);
      return {v,edge,direction,hit};
    };
    const survey=[0,.125,.25,.5,.75,.875,1].map(v=>sample(v));
    if(!survey.some(s=>s.hit))for(const s of survey) {
      s.hit=sampler.at(s.edge,q.y-.08,normal,reach);if(s.hit)break;
    }
    if(!survey.some(s=>s.hit))continue;
    for(let k=0;k<survey.length;k++)if(!survey[k].hit)survey[k]=sample(survey[k].v,q.d);
    const valid=survey.filter(s=>s.hit),faces=[valid[0].hit.plane],breaks=[];
    let previous=valid[0];
    for(const next of valid.slice(1)) {
      const first=faces.at(-1),last=next.hit.plane;
      const value=v=>{const p=projectSide(before,side,v,q.y-.08,first);return last[0]*p[0]+last[1]*(q.y-.08)+last[2]*p[1]+last[3];};
      // Float32 triangles of one flat face can differ by microradians. They
      // are one construction plane, not a new wall corner every few centimetres.
      const alignment=first[0]*last[0]+first[1]*last[1]+first[2]*last[2];
      if(alignment>.9999&&Math.abs(value(next.v))<.001){previous=next;continue;}
      let lo=previous.v,hi=next.v,vl=value(lo),vh=value(hi);
      if(vl*vh<0) {
        for(let k=0;k<30;k++){const mid=(lo+hi)/2,vm=value(mid);if(vm*vl>0){lo=mid;vl=vm;}else hi=mid;}
        const cut=(lo+hi)/2;
        if(cut>1e-5&&cut<1-1e-5){breaks.push(cut);faces.push(last);}
      }
      previous=next;
    }
    const planes=[faces[0],faces.at(-1)],extensions=[];
    for(let j=0;j<2;j++) {
      const point=projectSide(before,side,j,q.y-.08,planes[j]),old=before[ends[j]],direction=survey[j?survey.length-1:0].direction;
      extensions.push((point[0]-old[0])*direction.x+(point[1]-old[1])*direction.z);
      q.wallStair.corners[ends[j]]=point;
    }
    q.wallStair.joint={side,ends,before,planes,faces,breaks,extensions};
  }
}

function projectSide(c,side,v,y,plane) {
  const a=c[side>0?0:1],b=c[side>0?3:2],oppositeA=c[side>0?1:0],oppositeB=c[side>0?2:3];
  const edge=[a[0]*(1-v)+b[0]*v,a[1]*(1-v)+b[1]*v];
  const other=[oppositeA[0]*(1-v)+oppositeB[0]*v,oppositeA[1]*(1-v)+oppositeB[1]*v];
  const dx=edge[0]-other[0],dz=edge[1]-other[1],denominator=plane[0]*dx+plane[2]*dz;
  if(Math.abs(denominator)<1e-8)return edge;
  const k=-(plane[0]*edge[0]+plane[1]*y+plane[2]*edge[1]+plane[3])/denominator;
  return [edge[0]+dx*k,edge[1]+dz*k];
}

// Preserve the shared mitre at each end and the existing wall's own corner in
// between. Interpolating just two fitted endpoints cuts across that corner.
export function wallStairPoint(t,u,v,y) {
  const c=t.corners,j=t.joint;
  const edges=[
    [c[0][0]*(1-v)+c[3][0]*v,c[0][1]*(1-v)+c[3][1]*v],
    [c[1][0]*(1-v)+c[2][0]*v,c[1][1]*(1-v)+c[2][1]*v],
  ];
  if(j?.planes.every(Boolean)) {
    const plane=j.faces[j.breaks.filter(cut=>v>cut).length];
    edges[j.side>0?0:1]=projectSide(j.before,j.side,v,y,plane);
  }
  return [edges[0][0]*(1-u)+edges[1][0]*u,edges[0][1]*(1-u)+edges[1][1]*u];
}
