import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {roofDrop,roofDimensions} from './roof-solid.js';

// Roof settlement is static. Bake the same shape and normal into a per-house
// piece once, then batch the pieces. The normal and shadow passes can share
// those positions without repeating trigonometry for every frame.
export function bakeRoofPiece(source,h,color,{ridge=false,coverM=2}={}) {
  const g=source.clone();
  for(const [name,a] of Object.entries(g.attributes))if(a.isInstancedBufferAttribute)g.deleteAttribute(name);
  const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv,dims=roofDimensions(h),seed=Math.fround(h.seed);
  const length=ridge ? (dims.zAxis ? h.d : h.w)+.10 : dims.length;
  const ratio=Math.fround(length/dims.length),height=Math.fround(h.roofH);
  for(let i=0;i<p.count;i++) {
    const rawX=p.getX(i),z=p.getZ(i),ny=n.getY(i);let x=rawX,y=p.getY(i),nx=n.getX(i),nz=n.getZ(i);
    if(ridge) {
      x=Math.abs(x)<.49 ? x/ratio : x;
      const t=Math.max(-.5,Math.min(.5,x*ratio)),k=Math.min(7,Math.floor((t+.5)*8)),a=k/8-.5,b=a+.125;
      const da=roofDrop(a,0,seed),db=roofDrop(b,0,seed);
      y-=THREE.MathUtils.lerp(da,db,(t-a)*8)*height;
      nx+=(db-da)*8*height*ratio*ny;
    } else {
      const phase=x*11+seed*6.2832,amp=.040+.022*Math.sin(phase),st=1-4*x*x,ss=Math.max(0,1-2*Math.abs(z));
      y-=roofDrop(x,z,seed);
      nx+=(.242*Math.cos(phase)*st-8*x*amp)*ss*ny;
      nz+=-2*Math.sign(z)*amp*st*ny;
      uv.setXY(i,uv.getX(i)*Math.fround(dims.length)/coverM,uv.getY(i)*Math.fround(dims.width)*.5/coverM);
    }
    p.setXYZ(i,x,y,z);n.setXYZ(i,nx,ny,nz);
  }
  const dummy=new THREE.Object3D();
  dummy.position.set(h.x,h.eaves+(ridge ? h.roofH+.02 : 0),h.z);
  dummy.rotation.y=dims.zAxis ? Math.PI/2 : 0;
  dummy.scale.set(length,ridge ? 1 : h.roofH,ridge ? 1 : dims.width);dummy.updateMatrix();
  // Match the Float32 instance matrices used by the original renderer.
  dummy.matrix.elements=dummy.matrix.elements.map(Math.fround);g.applyMatrix4(dummy.matrix);
  const colors=new Float32Array(p.count*3);
  for(let i=0;i<p.count;i++)colors.set([color.r,color.g,color.b],i*3);
  g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  g.setAttribute('aSeed',new THREE.Float32BufferAttribute(new Float32Array(p.count).fill(seed),1));
  return g;
}

export function mergeRoofPieces(pieces,houses,kind) {
  let from=0;
  const solids=pieces.map((g,i)=>{
    const count=(g.index ? g.index.count : g.attributes.position.count)/3,h=houses[i];
    const range={kind,x:h.x,z:h.z,from,to:from+count};from+=count;return range;
  });
  const g=mergeGeometries(pieces);g.userData.solids=solids;
  pieces.forEach(p=>p.dispose());return g;
}
