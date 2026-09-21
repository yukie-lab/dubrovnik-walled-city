import * as THREE from 'three';
import {hash2,lerp} from './util.js';

// A continuous hand-height crown reaches each landing without a height jump.
export function parapetTop(layout,segment,t) {
  const last=segment.index===layout.segments.at(-1).index;
  return lerp(segment.a[2],segment.b[2],t)+(last?lerp(1,.22,t):1);
}

// Each cap is a closed rounded limestone solid seated into the parapet core.
// Individual stones are merged into the existing wall batch by the caller.
export function makeStairCoping(st,layout,segment,side=segment.railSign) {
  const n=Math.max(1,Math.round(segment.length/.68)),weights=Array.from({length:n},(_,i)=>
    .82+.36*hash2(Math.round(segment.seed*1e6),i*41+237)),sum=weights.reduce((a,b)=>a+b,0),out=[];
  const half=layout.innerHalf,thick=layout.wallThickness,width=thick+.04;
  const boundary=t=>{
    const a=st.offAt(segment.index-1,side,half-.02),b=st.offAt(segment.index,side,half-.02);
    const c=st.offAt(segment.index-1,side,half+thick+.02),d=st.offAt(segment.index,side,half+thick+.02);
    return [[lerp(a[0],b[0],t),lerp(a[1],b[1],t)],[lerp(c[0],d[0],t),lerp(c[1],d[1],t)]];
  };
  const stones=[];let s=0;
  for(let k=0;k<n;k++) {
    const a=s;s+=weights[k]/sum;
    const t0=a+(k?.003/segment.length:0),t1=s-(k<n-1?.003/segment.length:0);
    const seed=hash2(Math.round(segment.a[0]*71)+k*23,Math.round(segment.a[1]*73)+side*57);
    stones.push({t0,t1,seed,mortar:false});
  }
  const courses=stones.flatMap((stone,k)=>k?[{t0:stones[k-1].t1,t1:stone.t0,
    seed:(stone.seed+stones[k-1].seed)/2,mortar:true},stone]:[stone]);
  for(const {t0,t1,seed,mortar} of courses) {
    const radius=.024+.013*seed,depth=.14;
    const profile=[[0,-depth],[1,-depth],[1,-radius]];
    for(let i=1;i<=4;i++){const theta=i*Math.PI/8;profile.push([1-radius/width+radius/width*Math.cos(theta),-radius+radius*Math.sin(theta)]);}
    profile.push([.72,-.001],[.5,-.0025-.0015*seed],[.28,-.001],[radius/width,0]);
    for(let i=1;i<=4;i++){const theta=Math.PI/2+i*Math.PI/8;profile.push([radius/width+radius/width*Math.cos(theta),-radius+radius*Math.sin(theta)]);}
    const fractions=mortar?[0,1]:[0,.03,.27,.58,.97,1],P=[],U=[],C=[],A=[],K=[],I=[],count=profile.length;
    const at=(u,t,dy)=>{
      if(mortar){u=lerp(.004/width,1-.004/width,u);dy-=.010;}
      const [a,b]=boundary(t);return new THREE.Vector3(lerp(a[0],b[0],u),parapetTop(layout,segment,t)+dy,lerp(a[1],b[1],u));
    };
    const add=(p,uv,profileIndex)=>{
      const [u,dy]=profile[profileIndex],polish=dy>-.025?Math.max(0,1-(u*2-1)**2):0;
      P.push(...p.toArray());U.push(...uv);const tint=(mortar?.76:.97)+(seed-.5)*.09;C.push(tint,tint,tint);
      const dx=segment.b[0]-segment.a[0],dz=segment.b[1]-segment.a[1];
      const t=((p.x-segment.a[0])*dx+(p.z-segment.a[1])*dz)/segment.length**2;
      A.push(1,p.y-lerp(segment.a[2],segment.b[2],t),polish);
      K.push(mortar?2:1,mortar?0:polish);return P.length/3-1;
    };
    const contour=[0];for(let j=1;j<count;j++)contour.push(contour.at(-1)+Math.hypot((profile[j][0]-profile[j-1][0])*width,profile[j][1]-profile[j-1][1]));
    for(const f of fractions) {
      const t=lerp(t0,t1,f),endWear=!mortar&&(f===0||f===1)?.003:0;
      for(let j=0;j<count;j++) {
        const [u,y]=profile[j],wear=y>-.025?endWear+(!mortar?.0015:0)*Math.sin(u*7+seed*21)*Math.sin(f*Math.PI):0;
        add(at(u,t,y-wear),[contour[j]+seed*3.1,(segment.s0+t*segment.length)+seed*2.7],j);
      }
    }
    const interior=at(.5,(t0+t1)/2,-.075);
    const triangle=(a,b,c)=>{
      const va=new THREE.Vector3().fromArray(P,a*3),vb=new THREE.Vector3().fromArray(P,b*3),vc=new THREE.Vector3().fromArray(P,c*3);
      const normal=vb.clone().sub(va).cross(vc.clone().sub(va)),center=va.clone().add(vb).add(vc).multiplyScalar(1/3);
      if(normal.dot(center.sub(interior))>0)I.push(a,b,c);else I.push(a,c,b);
    };
    for(let row=0;row<fractions.length-1;row++)for(let j=0;j<count;j++) {
      const next=(j+1)%count,a=row*count+j,b=row*count+next,c=a+count,d=b+count;
      triangle(a,b,c);triangle(b,d,c);
    }
    for(const row of [0,fractions.length-1]) {
      const base=P.length/3,shape=[];
      for(let j=0;j<count;j++) {
        const v=new THREE.Vector3().fromArray(P,(row*count+j)*3),u=profile[j][0];
        add(v,[u*width,v.y-parapetTop(layout,segment,row?t1:t0)],j);
        shape.push(new THREE.Vector2(u*width,v.y-parapetTop(layout,segment,row?t1:t0)));
      }
      for(const [a,b,c] of THREE.ShapeUtils.triangulateShape(shape,[]))triangle(base+a,base+b,base+c);
    }
    const g=new THREE.BufferGeometry();g.setIndex(I);
    g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(U,2));
    g.setAttribute('color',new THREE.Float32BufferAttribute(C,3));g.setAttribute('aStairWall',new THREE.Float32BufferAttribute(A,3));
    g.setAttribute('aStairStone',new THREE.Float32BufferAttribute(K,2));g.computeVertexNormals();
    out.push({geometry:g,kind:mortar?'coping-mortar':'coping',segment:segment.index,side,t0,t1,seed});
  }
  return out;
}
