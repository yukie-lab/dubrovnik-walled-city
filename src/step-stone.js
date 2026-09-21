import * as THREE from 'three';
import {hash2} from './util.js';
import {makeWallTread} from './wall-tread.js';

// The same cross section supplies the mesh and placement support. Heights and
// positions in the geographic step records are never edited. Wear removes at
// most 4 mm; the 12 mm rounded nose lies inside the original stone envelope.
const ACROSS=[-.5,-.30,0,.30,.5],DEPTH=.55;
const profiles=new WeakMap();
function profile(step) {
  if(profiles.has(step))return profiles.get(step);
  if(step.wallStair){const value={};profiles.set(step,value);return value;}
  const r=Math.min(.012,step.d*.1),section=[[-DEPTH,step.d*.5],[-r,step.d*.5]];
  for(let i=1;i<=3;i++) {
    const a=i*Math.PI/6;section.push([-r+r*Math.sin(a),step.d*.5-r+r*Math.cos(a)]);
  }
  section.push([0,0],[0,-step.d*.5+r]);
  for(let i=4;i<=6;i++) {
    const a=i*Math.PI/6;section.push([-r+r*Math.sin(a),-step.d*.5+r+r*Math.cos(a)]);
  }
  section.push([-DEPTH,-step.d*.5]);
  const seed=hash2(Math.round(step.x*73),Math.round(step.z*71));
  const wear=ACROSS.map(x=>(.002+.002*seed)*Math.max(0,1-Math.pow(Math.abs(x)/.45,1.6)));
  const value={r,section,wear,seed};profiles.set(step,value);return value;
}

export function stepSurfaceAt(step,x,z) {
  const data=profile(step);if(!data.surfaces)makeStepStone(step);
  if(step.wallStair) {
    const box=data.geometry.boundingBox;
    if(x<box.min.x-.00004||x>box.max.x+.00004||z<box.min.z-.00004||z>box.max.z+.00004)return null;
  }else {
  const co=Math.cos(step.rotY),si=Math.sin(step.rotY),dx=x-step.x,dz=z-step.z;
  const u=(dx*co-dz*si)/step.w,v=dx*si+dz*co;
  if(Math.abs(u)>.5+.00004/step.w || Math.abs(v)>step.d*.5+.00004)return null;
  }
  let height=-Infinity;
  // Use Float32 WORLD vertices, as the renderer does. An analytic local
  // section misses the last rounding on a steep nose far from the origin.
  for(const e of data.surfaces) {
    const dx=x-e.cx,dz=z-e.cz,a=dx*e.ax+dz*e.az,b=dx*e.bx+dz*e.bz;
    if(a>=-1e-7 && b>=-1e-7 && a+b<=1+1e-7)height=Math.max(height,e.cy+a*e.ay+b*e.by);
  }
  return height===-Infinity ? null : height;
}

export function makeStepStone(step,{coverM=5}={}) {
  const data=profile(step);if(data.geometry)return data.geometry;
  if(step.wallStair)return cacheSurface(data,makeWallTread(step,{coverM:1}));
  const {section,wear,seed}=profile(step),n=section.length,p=[],uv=[],color=[],ix=[],wearAttr=[];
  const length=[0];for(let i=1;i<n;i++)length.push(length.at(-1)+Math.hypot(section[i][0]-section[i-1][0],section[i][1]-section[i-1][1]));
  const shiftX=hash2(step.run*17+step.step,Math.round(step.x*5))*4.7;
  const shiftV=hash2(Math.round(step.z*9),step.run*13+step.step)*4.7;
  for(let j=0;j<ACROSS.length;j++)for(let k=0;k<n;k++) {
    const [y,z]=section[k],top=k>0 && k<n-1;
    p.push(ACROSS[j]*step.w,y-(top ? wear[j] : 0),z);
    uv.push((ACROSS[j]*step.w+shiftX)/coverM,(length[k]+shiftV)/coverM);
    const shade=.97+.03*Math.sin(seed*6.28+j*1.7);color.push(shade,shade,shade);
    wearAttr.push(top ? wear[j]/.004 : 0);
  }
  for(let j=0;j<ACROSS.length-1;j++)for(let k=0;k<n;k++) {
    const next=(k+1)%n,a=j*n+k,b=j*n+next,c=(j+1)*n+k,d=(j+1)*n+next;
    ix.push(a,c,b,c,d,b);
  }
  // Separate normal/UV vertices for the cut ends, sharing exact positions.
  // Triangulate the real concave outline instead of fanning through the nose.
  for(const end of [0,ACROSS.length-1]) {
    const offset=p.length/3,outline=[];
    for(let k=0;k<n;k++) {
      const i=(end*n+k)*3,x=p[i],y=p[i+1],z=p[i+2];p.push(x,y,z);
      uv.push((z+shiftV)/coverM,(y+shiftX)/coverM);color.push(.96,.96,.96);wearAttr.push(0);
      outline.push(new THREE.Vector2(y,z));
    }
    for(const face of THREE.ShapeUtils.triangulateShape(outline,[])) {
      const [a,b,c]=face.map(i=>offset+i);
      const nx=(p[b*3+1]-p[a*3+1])*(p[c*3+2]-p[a*3+2])-(p[b*3+2]-p[a*3+2])*(p[c*3+1]-p[a*3+1]);
      if((nx>0)===(end>0))ix.push(a,b,c);else ix.push(a,c,b);
    }
  }
  const g=new THREE.BufferGeometry();g.setIndex(ix);
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setAttribute('color',new THREE.Float32BufferAttribute(color,3));
  g.setAttribute('aWear',new THREE.Float32BufferAttribute(wearAttr,1));
  g.setAttribute('aStair',new THREE.Float32BufferAttribute(new Float32Array(p.length/3*4),4));
  g.computeVertexNormals();
  // Physical dimensions are already baked. Colour/depth/raycasting see the
  // same mesh, with no displacement that disappears in another render pass.
  g.rotateY(step.rotY);g.translate(step.x,step.y,step.z);
  return cacheSurface(data,g);
}

function cacheSurface(data,g) {
  data.geometry=g;data.surfaces=[];
  const pos=g.attributes.position,ix=g.index.array;
  for(let i=0;i<ix.length;i+=3) {
    const [a,b,c]=Array.from(ix.subarray(i,i+3),j=>new THREE.Vector3().fromBufferAttribute(pos,j));
    const determinant=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
    if(determinant>=-1e-10)continue;
    const inv=1/determinant;
    data.surfaces.push({ax:(b.z-c.z)*inv,az:(c.x-b.x)*inv,bx:(c.z-a.z)*inv,bz:(a.x-c.x)*inv,
      cx:c.x,cz:c.z,cy:c.y,ay:a.y-c.y,by:b.y-c.y});
  }
  return g;
}
