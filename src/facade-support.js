// Vertical sections through the actual, closed facade geometry. Pipework
// needs the wall's relief and solid intervals, not a guessed flat rectangle.
export function makeFacadeSupport(mesh) {
  const p=mesh.geometry.attributes.position,ix=mesh.geometry.index,cells=new Map(),size=4;
  const owners=new Array(ix.count/3);
  for(const r of mesh.geometry.userData.solids||[])for(let f=r.from;f<r.to;f++)owners[f]=r.x+','+r.z;
  for(let i=0;i<ix.count;i+=3) {
    const a=[0,1,2].map(k=>{const j=ix.getX(i+k);return [p.getX(j),p.getY(j),p.getZ(j)];});
    const b=a[1].map((v,k)=>v-a[0][k]),c=a[2].map((v,k)=>v-a[0][k]);
    const n=[b[1]*c[2]-b[2]*c[1],b[2]*c[0]-b[0]*c[2],b[0]*c[1]-b[1]*c[0]],length=Math.hypot(...n);
    if(!length || Math.abs(n[1])>length*.00001)continue;
    const normal=n.map(v=>v/length);
    if(Math.max(Math.abs(normal[0]),Math.abs(normal[2]))<.99999)continue;
    const entry={a,normal,owner:owners[i/3]};
    for(let z=Math.floor(Math.min(...a.map(v=>v[2]))/size);z<=Math.floor(Math.max(...a.map(v=>v[2]))/size);z++)
      for(let x=Math.floor(Math.min(...a.map(v=>v[0]))/size);x<=Math.floor(Math.max(...a.map(v=>v[0]))/size);x++) {
        const key=x+','+z;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(entry);
      }
  }
  return {column(x,z,nx,nz,bottom,top,{owner=null,opposite=false}={}) {
    const plane=x*nx+z*nz-.09,u=x*nz-z*nx,found=new Set(),sections=new Map();
    for(let zz=Math.floor((z-.4)/size);zz<=Math.floor((z+.4)/size);zz++)for(let xx=Math.floor((x-.4)/size);xx<=Math.floor((x+.4)/size);xx++)
      for(const e of cells.get(xx+','+zz)||[])found.add(e);
    for(const {a,normal:n,owner:faceOwner} of found) {
      if(owner && (opposite ? faceOwner===owner : faceOwner!==owner))continue;
      if((n[0]*nx+n[2]*nz)*(opposite ? -1 : 1)<.9999)continue;
      const front=a[0][0]*nx+a[0][2]*nz;if(front<plane-.16 || front>plane+.23)continue;
      const intersections=[];
      for(let k=0;k<3;k++) {
        const b=a[k],c=a[(k+1)%3],u0=b[0]*nz-b[2]*nx,u1=c[0]*nz-c[2]*nx;
        if(Math.abs(u0-u)<1e-6)intersections.push(b[1]);
        if(Math.abs(u1-u0)>1e-8) {
          const t=(u-u0)/(u1-u0);if(t>=0 && t<=1)intersections.push(b[1]+(c[1]-b[1])*t);
        }
      }
      if(intersections.length<2)continue;
      const lo=Math.max(bottom,Math.min(...intersections)),hi=Math.min(top,Math.max(...intersections));if(hi-lo<1e-6)continue;
      const key=Math.round(front*100000);if(!sections.has(key))sections.set(key,[]);sections.get(key).push({lo,hi,front});
    }
    const merged=[];
    for(const list of sections.values()) {
      list.sort((a,b)=>a.lo-b.lo);let last=null;
      for(const r of list) {
        if(last && r.lo<=last.hi+.0001)last.hi=Math.max(last.hi,r.hi);
        else {last={...r};merged.push(last);}
      }
    }
    return merged;
  }};
}
