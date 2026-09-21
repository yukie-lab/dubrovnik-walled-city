import * as THREE from 'three';
import {hash2,lerp} from './util.js';

const unique=values=>values.sort((a,b)=>a-b).filter((x,i,a)=>!i||x-a[i-1]>1e-5);

// A tread is one closed limestone volume. Its walking surface is the actual
// triangulated dish, including the rounded and chipped leading edge.
export function makeWallTread(step,{coverM=5}={}) {
  const t=step.wallStair,[a,b,c,d]=t.corners;
  const width=(Math.hypot(b[0]-a[0],b[1]-a[1])+Math.hypot(c[0]-d[0],c[1]-d[1]))/2;
  const chips=Array.from({length:3},(_,i)=>({u:.08+.84*hash2((t.seed*1e6)|0,i*97+19),
    half:(.014+.024*hash2(i+13,(t.seed*1e5)|0))/width,
    depth:.003+.007*hash2((t.seed*1e7)|0,i+79)}));
  const lane=.5+t.walkingLineM/width,half=t.walkingHalfWidthM/width;
  const wearSamples=[-1,-.78,-.52,-.25,0,.25,.52,.78,1].map(x=>lane+x*half).filter(x=>x>0&&x<1);
  const us=unique([...Array.from({length:13},(_,i)=>i/12),...wearSamples,...chips.flatMap(c=>[c.u-c.half,c.u,c.u+c.half])]);
  const radius=Math.min(t.nose,step.d*.24),noseFraction=radius/step.d;
  const vs=unique([0,noseFraction*.12,noseFraction*.38,noseFraction*.72,noseFraction,.25,.5,.75,1]);
  const p=[],uv=[],col=[],wear=[],traits=[],ix=[],nu=us.length,nv=vs.length;
  const append=(x,y,z,u,v,w,dust,moss)=>{
    p.push(x,y,z);uv.push(u*width/coverM,v*step.d/coverM);col.push(1,1,1);wear.push(w);
    traits.push(1,w,dust,moss);return p.length/3-1;
  };
  const point=(u,v)=>[lerp(lerp(a[0],b[0],u),lerp(d[0],c[0],u),v),lerp(lerp(a[1],b[1],u),lerp(d[1],c[1],u),v)];
  for(const v of vs)for(const u of us) {
    const x=(u-lane)/half;
    const across=(u===0||u===1)?0:Math.pow(Math.max(0,1-x*x),2);
    const dish=t.wear*across*(.62+.38*Math.sin(Math.PI*v));
    const along=v*step.d,round=along<radius?radius-Math.sqrt(Math.max(0,radius*radius-(radius-along)**2)):0;
    let loss=0;for(const chip of chips)loss+=chip.depth*Math.pow(Math.max(0,1-Math.abs(u-chip.u)/chip.half),2)*Math.exp(-along/.025);
    const corner=Math.pow(Math.abs(2*u-1),5),back=Math.pow(v,7);
    const dust=Math.min(1,corner*(.55+.45*back)+back*.35)*(1-across*.8);
    const moss=corner*back*(t.enclosed?.7:.22)*(1-t.traffic*.35);
    const [px,pz]=point(u,v);append(px,step.y-dish-round-loss,pz,u,v,across,dust,moss);
  }
  for(let j=0;j<nv-1;j++)for(let i=0;i<nu-1;i++) {
    const a=j*nu+i,b=a+1,c=a+nu,d=c+1;ix.push(a,c,b,b,c,d);
  }
  const border=[];
  for(let i=0;i<nu;i++)border.push(i);
  for(let j=1;j<nv;j++)border.push(j*nu+nu-1);
  for(let i=nu-2;i>=0;i--)border.push((nv-1)*nu+i);
  for(let j=nv-2;j>0;j--)border.push(j*nu);
  const bottom=step.y-t.depth,bottomRing=[];
  // Separate side normals keep the real cut faces flat. Duplicate coordinates
  // are bit-identical after Float32 conversion, so there is no topological gap.
  for(let i=0;i<border.length;i++) {
    const a=border[i],b=border[(i+1)%border.length],base=p.length/3;
    for(const [j,y] of [[a,p[a*3+1]],[b,p[b*3+1]],[b,bottom],[a,bottom]]) {
      append(p[j*3],y,p[j*3+2],uv[j*2]*coverM/width,(y-step.y)/step.d,0,.10,0);
    }
    ix.push(base,base+1,base+2,base,base+2,base+3);
    bottomRing.push(append(p[a*3],bottom,p[a*3+2],uv[a*2]*coverM/width,uv[a*2+1]*coverM/step.d,0,0,0));
  }
  const middle=point(.5,.5),center=append(middle[0],bottom,middle[1],.5,.5,0,0,0);
  for(let i=0;i<bottomRing.length;i++)ix.push(center,bottomRing[i],bottomRing[(i+1)%bottomRing.length]);
  const g=new THREE.BufferGeometry();g.setIndex(ix);
  const shiftU=hash2((t.seed*1e6)|0,373)*3.7,shiftV=hash2(971,(t.seed*1e6)|0)*3.7;
  for(let i=0;i<uv.length;i+=2){uv[i]+=shiftU;uv[i+1]+=shiftV;}
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
  g.setAttribute('aWear',new THREE.Float32BufferAttribute(wear,1));
  g.setAttribute('aStair',new THREE.Float32BufferAttribute(traits,4));
  g.computeVertexNormals();g.computeBoundingBox();return g;
}
