import * as THREE from 'three';

// Replace the part of a paving strip occupied by real stone treads. The old
// continuous ramp must not pass through their upper faces. This clips the
// source triangles against the exact StepPool footprints and interpolates all
// vertex attributes; neither street coordinates nor step heights are changed.
export function cutPavingAtSteps(geometry,steps) {
  if(!steps.length)return geometry;
  const names=Object.keys(geometry.attributes),attrs=names.map(n=>geometry.attributes[n]);
  const starts=[];let stride=0;
  for(const a of attrs){starts.push(stride);stride+=a.itemSize;}
  const pOffset=starts[names.indexOf('position')],out=names.map(()=>[]),indices=[];
  const bounds=steps.map(q=>{
    const c=Math.cos(q.rotY),s=Math.sin(q.rotY),w=q.w/2,d=q.d/2;
    const dx=Math.abs(c)*w+Math.abs(s)*d,dz=Math.abs(s)*w+Math.abs(c)*d;
    return {x0:q.x-dx,x1:q.x+dx,z0:q.z-dz,z1:q.z+dz,
      planes:[[c,-s,w-c*q.x+s*q.z],[-c,s,w+c*q.x-s*q.z],
        [s,c,d-s*q.x-c*q.z],[-s,-c,d+s*q.x+c*q.z]]};
  });
  const cells=new Map(),cellSize=2;
  for(const [i,b] of bounds.entries())for(let z=Math.floor(b.z0/cellSize);z<=Math.floor(b.z1/cellSize);z++)
    for(let x=Math.floor(b.x0/cellSize);x<=Math.floor(b.x1/cellSize);x++) {
      const key=`${x},${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(i);
    }
  const loadVertex=i=>{
    const v=[];
    attrs.forEach(a=>{for(let k=0;k<a.itemSize;k++)v.push(a.getComponent(i,k));});
    return v;
  };
  const distance=(v,p)=>v[pOffset]*p[0]+v[pOffset+2]*p[1]+p[2];
  function split(poly,plane) {
    const inside=[],outside=[];
    for(let i=0;i<poly.length;i++) {
      const a=poly[i],b=poly[(i+1)%poly.length],da=distance(a,plane),db=distance(b,plane);
      const ai=da>=0,bi=db>=0;
      (ai ? inside : outside).push(a);
      if(ai!==bi) {
        const t=da/(da-db),v=a.map((n,k)=>n+(b[k]-n)*t);
        inside.push(v);outside.push(v);
      }
    }
    return [inside,outside];
  }
  function emit(poly) {
    for(let i=1;i<poly.length-1;i++) {
      const a=poly[0],b=poly[i],c=poly[i+1],o=pOffset;
      const area=(b[o]-a[o])*(c[o+2]-a[o+2])-(b[o+2]-a[o+2])*(c[o]-a[o]);
      if(Math.abs(area)<1e-10)continue;
      for(const v of [a,b,c]) {
        indices.push(indices.length);
        attrs.forEach((attr,k)=>{for(let n=0;n<attr.itemSize;n++)out[k].push(v[starts[k]+n]);});
      }
    }
  }
  const ix=geometry.index,length=ix ? ix.count : geometry.attributes.position.count;
  for(let i=0;i<length;i+=3) {
    const tri=[0,1,2].map(k=>loadVertex(ix ? ix.getX(i+k) : i+k));
    const xs=tri.map(v=>v[pOffset]),zs=tri.map(v=>v[pOffset+2]);
    const x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs),candidates=new Set();
    for(let z=Math.floor(z0/cellSize);z<=Math.floor(z1/cellSize);z++)
      for(let x=Math.floor(x0/cellSize);x<=Math.floor(x1/cellSize);x++)
        for(const id of cells.get(`${x},${z}`)||[])candidates.add(id);
    let polygons=[tri];
    for(const id of candidates) {
      const b=bounds[id];if(b.x1<x0 || b.x0>x1 || b.z1<z0 || b.z0>z1)continue;
      const remaining=[];
      for(const poly of polygons) {
        let inside=poly;
        for(const plane of b.planes) {
          const [next,outside]=split(inside,plane);
          if(outside.length>=3)remaining.push(outside);
          inside=next;if(inside.length<3)break;
        }
        // Anything still inside all four half-spaces belongs to a stone.
      }
      polygons=remaining;if(!polygons.length)break;
    }
    for(const poly of polygons)emit(poly);
  }
  const result=new THREE.BufferGeometry();
  names.forEach((n,i)=>result.setAttribute(n,new THREE.Float32BufferAttribute(out[i],attrs[i].itemSize)));
  result.setIndex(indices);result.userData={...geometry.userData};
  return result;
}
