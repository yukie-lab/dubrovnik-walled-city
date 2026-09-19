import * as THREE from 'three';

// Preserve a quad's metric chart directions and scale, but place its origin
// in space. Coplanar pieces with the same axes then share one continuous chart
// instead of restarting the first stone at each geometry subdivision.
const dot3=(a,b)=>a.reduce((sum,value,i)=>sum+value*b[i],0);
const normalize3=v=>{const length=Math.hypot(...v);return length>1e-8?v.map(x=>x/length):[0,0,0];};
const quadAxes=([a,b,c,d])=>{
  const edge=(from,to,otherFrom,otherTo)=>{
    const v=to.map((x,i)=>x-from[i]);
    return normalize3(Math.hypot(...v)>1e-8?v:otherTo.map((x,i)=>x-otherFrom[i]));
  };
  return {u:edge(a,b,d,c),v:edge(a,d,b,c)};
};
const orthogonalV=(u,v)=>normalize3(v.map((x,i)=>x-u[i]*dot3(u,v)));
const projectQuad=(points,u,v,scale)=>points.flatMap(p=>[dot3(p,u)*scale,dot3(p,v)*scale]);
export function anchoredQuadUV(a,b,c,d,scale=1) {
  const points=[a,b,c,d],{u,v}=quadAxes(points);
  // Sloped edges are not orthogonal to vertical edges, and C need not be the
  // fourth corner of a rectangle. Project every real corner into the chart.
  return projectQuad(points,u,orthogonalV(u,v),scale);
}

// A triangulated cap is one plane. Its triangle-fan spokes must not select a
// different texture direction or map the entire stone atlas to each triangle.
export function planarMasonryUV(points,normal,scale=1) {
  const n=normalize3(normal);
  const u=Math.abs(n[1])>.9999?normalize3([1-n[0]*n[0],-n[0]*n[1],-n[0]*n[2]]):normalize3([n[2],0,-n[0]]);
  const v=[n[1]*u[2]-n[2]*u[1],n[2]*u[0]-n[0]*u[2],n[0]*u[1]-n[1]*u[0]];
  return projectQuad(points,u,v,scale);
}

// Subdivisions of a surface need one chart, not independently rounded frames.
// Join only touching faces with matching directions and metre scales. A broad
// curved component is deliberately kept out of planar projection: transitive
// adjacency must never flatten a finely tessellated cylinder into a line.
export function connectMasonryCharts(charts,uv) {
  const roots=charts.map((_,i)=>i),frames=charts.map(c=>quadAxes(c.p)),vertices=new Map();
  const find=i=>{while(roots[i]!==i){roots[i]=roots[roots[i]];i=roots[i];}return i;};
  const key=p=>p.map(v=>Math.round(v*1e5)).join(',');
  const parallel=(a,b)=>dot3(a,b)>.999999;
  for(let i=0;i<charts.length;i++)for(const p of charts[i].p) {
    const k=key(p),neighbors=vertices.get(k)||[];
    for(const j of neighbors)if(charts[i].scale===charts[j].scale
      &&parallel(charts[i].normal,charts[j].normal)
      &&parallel(frames[i].u,frames[j].u)&&parallel(frames[i].v,frames[j].v))roots[find(i)]=find(j);
    if(!neighbors.includes(i))neighbors.push(i);vertices.set(k,neighbors);
  }
  const groups=new Map();
  for(let i=0;i<charts.length;i++){const root=find(i);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(i);}
  let joinedCharts=0,joinedGroups=0,curvedGroups=0,minNormalAlignment=1,largestGroup=1;
  for(const members of groups.values()) {
    if(members.length<2)continue;
    const sum=(get)=>normalize3(members.reduce((v,i)=>v.map((x,k)=>x+get(i)[k]),[0,0,0]));
    const u=sum(i=>frames[i].u),v=orthogonalV(u,sum(i=>frames[i].v)),normal=sum(i=>charts[i].normal);
    const alignment=Math.min(...members.map(i=>dot3(normal,charts[i].normal)));
    if(alignment<.999 || dot3(u,u)<.99 || dot3(v,v)<.99){curvedGroups++;continue;}
    joinedCharts+=members.length;joinedGroups++;largestGroup=Math.max(largestGroup,members.length);
    minNormalAlignment=Math.min(minNormalAlignment,alignment);
    for(const i of members) {
      const c=charts[i],values=projectQuad(c.p,u,v,c.scale);
      for(let k=0;k<8;k++)uv[c.offset+k]=values[k];
    }
  }
  return {charts:charts.length,joinedCharts,joinedGroups,largestGroup,curvedGroups,minNormalAlignment};
}

// Normalised primitive UVs describe a whole face, not metres. Keep topology,
// normals and all other streams, and give each planar face an isometric chart.
// Smooth surfaces retain their existing seam, with metric U/V derivatives.
export function metricMasonryUV(g,coverM) {
  const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv,ix=g.index;
  if(!uv)return g;
  const flat=new Uint8Array(p.count).fill(1),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  const du=new THREE.Vector3(),dv=new THREE.Vector3();let sumU=0,sumV=0,weight=0;
  for(let k=0;k<(ix?.count||p.count);k+=3) {
    const i=ix ? ix.getX(k) : k,j=ix ? ix.getX(k+1) : k+1,l=ix ? ix.getX(k+2) : k+2;
    const curved=Math.abs(n.getX(i)-n.getX(j))+Math.abs(n.getY(i)-n.getY(j))+Math.abs(n.getZ(i)-n.getZ(j))
      +Math.abs(n.getX(i)-n.getX(l))+Math.abs(n.getY(i)-n.getY(l))+Math.abs(n.getZ(i)-n.getZ(l))>1e-5;
    if(!curved)continue;
    flat[i]=flat[j]=flat[l]=0;
    a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,j).sub(a);c.fromBufferAttribute(p,l).sub(a);
    const u1=uv.getX(j)-uv.getX(i),v1=uv.getY(j)-uv.getY(i),u2=uv.getX(l)-uv.getX(i),v2=uv.getY(l)-uv.getY(i);
    const det=u1*v2-u2*v1,area=a.crossVectors(b,c).length();if(Math.abs(det)<1e-14||area<1e-12)continue;
    du.copy(b).multiplyScalar(v2).addScaledVector(c,-v1).divideScalar(det);
    dv.copy(c).multiplyScalar(u1).addScaledVector(b,-u2).divideScalar(det);
    sumU+=du.length()*area;sumV+=dv.length()*area;weight+=area;
  }
  const scaleU=weight ? sumU/weight/coverM : 1,scaleV=weight ? sumV/weight/coverM : 1;
  const normal=new THREE.Vector3(),tangent=new THREE.Vector3(),up=new THREE.Vector3();
  for(let i=0;i<p.count;i++) {
    if(!flat[i]){uv.setXY(i,uv.getX(i)*scaleU,uv.getY(i)*scaleV);continue;}
    a.fromBufferAttribute(p,i);normal.fromBufferAttribute(n,i).normalize();
    if(Math.abs(normal.y)>.9999)tangent.set(1,0,0);
    else tangent.set(normal.z,0,-normal.x).normalize();
    up.crossVectors(normal,tangent).normalize();
    uv.setXY(i,a.dot(tangent)/coverM,a.dot(up)/coverM);
  }
  uv.needsUpdate=true;g.userData.metricMasonry={coverM,curved:weight>0};return g;
}
