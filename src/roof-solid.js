import * as THREE from 'three';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';

// One roof contract for the tile shell, the stone volume beneath it, and the
// shadow pass. Coordinates and subdivisions retain the existing roof plan.
export const ROOF_NS=8,ROOF_NT=3,ROOF_THICKNESS=.05;
export function roofDrop(x,z,seed) {
  return (.040+.022*Math.sin(x*11+seed*6.2832))*(1-4*x*x)*Math.max(0,1-2*Math.abs(z));
}
export function roofDimensions(h) {
  const z=h.ridgeAxis==='z';
  return {length:(z ? h.d : h.w)+.62,width:(z ? h.w : h.d)+.70,height:h.roofH,zAxis:z};
}

function topGrid() {
  const vertices=[],indices=[];
  for(const sign of [1,-1]) {
    const start=vertices.length;
    for(let j=0;j<=ROOF_NT;j++)for(let k=0;k<=ROOF_NS;k++) {
      const t=-.5+k/ROOF_NS,q=j/ROOF_NT;
      vertices.push({p:[sign*t,1-q,sign*.5*q],uv:[t+.5,1-q],n:[0,1/Math.sqrt(5),sign*2/Math.sqrt(5)]});
    }
    for(let j=0;j<ROOF_NT;j++)for(let k=0;k<ROOF_NS;k++) {
      const a=start+j*(ROOF_NS+1)+k,b=a+1,c=a+ROOF_NS+1,d=c+1;
      indices.push(a,c,d,a,d,b);
    }
  }
  return {vertices,indices};
}
const GRID=topGrid();
const pointKey=p=>p.map(v=>Math.round(v*1e7)).join(',');

function boundaryEdges(vertices,indices) {
  const edges=new Map();
  for(let i=0;i<indices.length;i+=3)for(let j=0;j<3;j++) {
    const a=indices[i+j],b=indices[i+(j+1)%3],ka=pointKey(vertices[a]),kb=pointKey(vertices[b]);
    const key=ka<kb ? ka+'|'+kb : kb+'|'+ka;
    const old=edges.get(key);if(old)old.count++;else edges.set(key,{a,b,count:1});
  }
  return [...edges.values()].filter(e=>e.count===1);
}

function makeBuilder() {
  const p=[],n=[],uv=[],surface=[];
  return {
    triangle(a,b,c,ta=[0,0],tb=[0,0],tc=[0,0],normal=null,top=0) {
      const ab=new THREE.Vector3().fromArray(b).sub(new THREE.Vector3().fromArray(a));
      const ac=new THREE.Vector3().fromArray(c).sub(new THREE.Vector3().fromArray(a));
      const cross=ab.cross(ac);if(cross.lengthSq()<1e-18)return;
      const nn=normal || cross.normalize().toArray();
      for(const [v,t] of [[a,ta],[b,tb],[c,tc]]){p.push(...v);n.push(...nn);uv.push(...t);surface.push(top);}
    },
    finish() {
      const g=new THREE.BufferGeometry();
      g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
      g.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));
      g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
      g.setAttribute('aRoofSurface',new THREE.Float32BufferAttribute(surface,1));
      // Preserve hard edges and UV seams, but share identical shaded vertices.
      // Non-indexed roof triangles repeat the expensive vertex/depth shader.
      const indexed=mergeVertices(g,1e-7);g.dispose();return indexed;
    }
  };
}

export function roofShellGeometry() {
  const build=makeBuilder(),{vertices:v,indices:ix}=GRID;
  for(let i=0;i<ix.length;i+=3) {
    const [a,b,c]=ix.slice(i,i+3).map(j=>v[j]);
    build.triangle(a.p,b.p,c.p,a.uv,b.uv,c.uv,a.n,1);
    const lower=p=>[p[0],p[1]-ROOF_THICKNESS,p[2]];
    build.triangle(lower(c.p),lower(b.p),lower(a.p),c.uv,b.uv,a.uv,a.n.map(n=>-n));
  }
  for(const {a,b} of boundaryEdges(v.map(v=>v.p),ix)) {
    const u=v[a],w=v[b],c=[u.p[0],u.p[1]-ROOF_THICKNESS,u.p[2]],d=[w.p[0],w.p[1]-ROOF_THICKNESS,w.p[2]];
    build.triangle(u.p,c,w.p,u.uv,[u.uv[0],u.uv[1]-.12],w.uv);
    build.triangle(w.p,c,d,w.uv,[u.uv[0],u.uv[1]-.12],[w.uv[0],w.uv[1]-.12]);
  }
  return build.finish();
}

function clip(poly,axis,bound,sign) {
  const out=[];
  for(let i=0;i<poly.length;i++) {
    const a=poly[i],b=poly[(i+1)%poly.length],da=(a[axis]-bound)*sign,db=(b[axis]-bound)*sign;
    if(da>=-1e-10)out.push(a);
    if((da<0 && db>0)||(da>0 && db<0)) {
      const t=da/(da-db),v=a.map((x,k)=>x+(b[k]-x)*t);v[axis]=bound;out.push(v);
    }
  }
  return out;
}

// Clip the actual triangulated roof underside to the unchanged house footprint.
// A separately sampled analytic curve could poke through a rendered triangle.
export function houseCoreGeometry(h,coverM=3.2) {
  if(h.garden) {
    const g=new THREE.BoxGeometry(h.w,h.eaves-h.yBase,h.d);
    g.translate(h.x,(h.eaves+h.yBase)/2,h.z);return g;
  }
  const dims=roofDimensions(h),p=[],ix=[],keys=new Map();
  const bounds=[h.x-h.w/2,h.x+h.w/2,h.z-h.d/2,h.z+h.d/2];
  const toWorld=([x,y,z])=>{
    const up=h.eaves+(y-roofDrop(x,z,h.seed)-ROOF_THICKNESS)*dims.height+.001;
    return dims.zAxis ? [h.x+z*dims.width,up,h.z-x*dims.length] : [h.x+x*dims.length,up,h.z+z*dims.width];
  };
  const vertex=v=>{const key=pointKey(v);if(keys.has(key))return keys.get(key);const i=p.length;p.push(v);keys.set(key,i);return i;};
  for(let i=0;i<GRID.indices.length;i+=3) {
    let poly=GRID.indices.slice(i,i+3).map(j=>toWorld(GRID.vertices[j].p));
    for(const [axis,bound,sign] of [[0,bounds[0],1],[0,bounds[1],-1],[2,bounds[2],1],[2,bounds[3],-1]])poly=clip(poly,axis,bound,sign);
    if(poly.length<3)continue;
    const ids=poly.map(vertex);
    for(let k=1;k<ids.length-1;k++) {
      const a=p[ids[0]],b=p[ids[k]],c=p[ids[k+1]];
      const area=(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
      if(Math.abs(area)>1e-10)ix.push(ids[0],ids[k],ids[k+1]);
    }
  }
  const build=makeBuilder(),uvTop=v=>[(v[0]-bounds[0])/coverM,(v[2]-bounds[2])/coverM];
  for(let i=0;i<ix.length;i+=3) {
    const [a,b,c]=ix.slice(i,i+3).map(j=>p[j]);build.triangle(a,b,c,uvTop(a),uvTop(b),uvTop(c));
  }
  for(const {a,b} of boundaryEdges(p,ix)) {
    const u=p[a],v=p[b],c=[u[0],h.yBase,u[2]],d=[v[0],h.yBase,v[2]];
    const dx=v[0]-u[0],dz=v[2]-u[2];
    const wallUV=q=>[(Math.abs(dx)>Math.abs(dz) ? dx>0 ? q[0]-bounds[0] : bounds[1]-q[0] : dz<0 ? bounds[3]-q[2] : q[2]-bounds[2])/coverM,(q[1]-h.yBase)/coverM];
    build.triangle(u,c,v,wallUV(u),wallUV(c),wallUV(v));
    build.triangle(v,c,d,wallUV(v),wallUV(c),wallUV(d));
    const middle=[h.x,h.yBase,h.z];build.triangle(middle,d,c,uvTop(middle),uvTop(d),uvTop(c));
  }
  return build.finish();
}

const DEFORM=`
  float roofDropAt(vec2 p,float seed){return (.040+.022*sin(p.x*11.0+seed*6.2832))
    *(1.0-4.0*p.x*p.x)*max(0.0,1.0-2.0*abs(p.y));}
  vec2 roofDropGradient(vec2 p,float seed){
    float phase=p.x*11.0+seed*6.2832,amp=.040+.022*sin(phase),st=1.0-4.0*p.x*p.x;
    return vec2((.242*cos(phase)*st-8.0*p.x*amp)*max(0.0,1.0-2.0*abs(p.y)),
      -2.0*sign(p.y)*amp*st);
  }`;

export function deformRoofShader(shader,{depth=false,seedDeclared=false}={}) {
  shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\n${seedDeclared ? '' : 'attribute float aSeed;'}\n${DEFORM}`)
    .replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.y-=roofDropAt(position.xz,aSeed);');
  if(!depth)shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
    vec2 dropGradient=roofDropGradient(position.xz,aSeed);
    objectNormal.xz+=dropGradient*objectNormal.y;`);
}

export function roofDepthMaterial() {
  const material=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
  material.onBeforeCompile=shader=>deformRoofShader(shader,{depth:true});
  material.customProgramCacheKey=()=> 'roof-depth-deformation-v1';
  return material;
}

// Ridge rings sit at the roof's actual longitudinal breakpoints. This makes
// the underside follow the same piecewise linear surface, including its ends.
export function deformRidgeShader(shader,{depth=false}={}) {
  shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
    attribute float aRoofH; attribute float aSeedR; attribute float aRidgeRatio;
    ${DEFORM}
    float ridgeX(float x){return abs(x)<.49 ? x/aRidgeRatio : x;}
    vec2 ridgeDropAndSlope(float x){
      float t=clamp(x*aRidgeRatio,-.5,.5),k=min(7.0,floor((t+.5)*8.0));
      float a=k/8.0-.5,b=a+.125;
      float da=roofDropAt(vec2(a,0.0),aSeedR),db=roofDropAt(vec2(b,0.0),aSeedR);
      return vec2(mix(da,db,(t-a)*8.0),(db-da)*8.0);
    }`)
    .replace('#include <begin_vertex>',`#include <begin_vertex>
      transformed.x=ridgeX(position.x);
      transformed.y-=ridgeDropAndSlope(transformed.x).x*aRoofH;`);
  if(!depth)shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
    objectNormal.x+=ridgeDropAndSlope(ridgeX(position.x)).y*aRoofH*aRidgeRatio*objectNormal.y;`);
}
export function ridgeDepthMaterial() {
  const material=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
  material.onBeforeCompile=shader=>deformRidgeShader(shader,{depth:true});
  material.customProgramCacheKey=()=> 'ridge-depth-deformation-v1';return material;
}

// Extrude architectural profiles as closed volumes. The mapping handles both
// façade orientations and stair sections without relying on double-sided faces.
export function profilePrismGeometry(profile,project,back,front,coverM=3.2) {
  let poly=profile.map(p=>new THREE.Vector2(...p));
  if(THREE.ShapeUtils.isClockWise(poly))poly.reverse();
  const triangles=THREE.ShapeUtils.triangulateShape(poly,[]),build=makeBuilder();
  const o=new THREE.Vector3().fromArray(project(0,0,0));
  const u=new THREE.Vector3().fromArray(project(1,0,0)).sub(o),v=new THREE.Vector3().fromArray(project(0,1,0)).sub(o),d=new THREE.Vector3().fromArray(project(0,0,1)).sub(o);
  const reverse=u.cross(v).dot(d)<0;
  const emit=(a,b,c,ta,tb,tc)=>reverse ? build.triangle(c,b,a,tc,tb,ta) : build.triangle(a,b,c,ta,tb,tc);
  const uv=p=>[p.x/coverM,p.y/coverM],at=(p,d)=>project(p.x,p.y,d);
  for(const [ia,ib,ic] of triangles) {
    const [a,b,c]=[ia,ib,ic].map(i=>poly[i]);
    emit(at(a,front),at(b,front),at(c,front),uv(a),uv(b),uv(c));
    emit(at(c,back),at(b,back),at(a,back),uv(c),uv(b),uv(a));
  }
  for(let i=0;i<poly.length;i++) {
    const a=poly[i],b=poly[(i+1)%poly.length],t=a.distanceTo(b)/coverM,dep=(front-back)/coverM;
    emit(at(a,front),at(a,back),at(b,front),[0,dep],[0,0],[t,dep]);
    emit(at(b,front),at(a,back),at(b,back),[t,dep],[0,0],[t,0]);
  }
  return build.finish();
}
