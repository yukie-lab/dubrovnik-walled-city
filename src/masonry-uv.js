import * as THREE from 'three';

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
