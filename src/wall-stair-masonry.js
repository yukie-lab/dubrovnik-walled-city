import * as THREE from 'three';
import {lerp} from './util.js';
import {planarMasonryUV} from './masonry-uv.js';
import {makeStairCoping,parapetTop} from './wall-stair-coping.js';
import {wallStairPoint} from './wall-stair-joints.js';

// Closed masonry pieces use the same mitred inner lines as the tread layout.
// Openings are the empty space between solid piers/spandrels, including their
// full-depth reveals; there are no dark planes pretending to be windows.
export function makeWallStairMasonry(st,layout,plan,coverM=4.2) {
  const P=[],N=[],U=[],C=[],A=[],K=[],I=[],solids=[],slits=[];
  const vector=p=>new THREE.Vector3(...p);
  const addSolid=(name,vertices,segment,type)=>{
    const from=I.length/3,center=vertices.reduce((s,p)=>s.add(vector(p)),new THREE.Vector3()).multiplyScalar(1/8);
    const faces=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
    const unit=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
    const edgeLength=(a,b)=>vector(vertices[a]).distanceTo(vector(vertices[b]));
    const count=[Math.max(1,Math.ceil(Math.max(edgeLength(0,1),edgeLength(3,2),edgeLength(4,5),edgeLength(7,6))/.28)),
      Math.max(1,Math.ceil(Math.max(edgeLength(0,3),edgeLength(1,2),edgeLength(4,7),edgeLength(5,6))/.28)),1];
    const grid=new Map();
    const gridPoint=indices=>{
      const key=indices.join(',');if(grid.has(key))return grid.get(key);
      const [u,v,w]=indices.map((k,i)=>k/count[i]),point=new THREE.Vector3();
      for(let j=0;j<8;j++){const q=unit[j];point.addScaledVector(vector(vertices[j]),
        (q[0]?u:1-u)*(q[1]?v:1-v)*(q[2]?w:1-w));}
      grid.set(key,point);return point;
    };
    for(const ids0 of faces) {
      const ids=ids0.slice(),v=ids.map(i=>vector(vertices[i]));
      const faceCenter=v.reduce((s,p)=>s.add(p),new THREE.Vector3()).multiplyScalar(.25);
      const normal=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).normalize();
      if(normal.dot(faceCenter.clone().sub(center))<0){ids.reverse();normal.negate();}
      const corners=ids.map(i=>unit[i]),axisA=corners[0].findIndex((n,k)=>n!==corners[1][k]);
      const axisB=corners[0].findIndex((n,k)=>n!==corners[3][k]);
      const na=count[axisA],nb=count[axisB];
      const dx=segment.b[0]-segment.a[0],dz=segment.b[1]-segment.a[1];
      const t=((faceCenter.x-segment.a[0])*dx+(faceCenter.z-segment.a[1])*dz)/(segment.length**2);
      const toward=new THREE.Vector3(lerp(segment.a[0],segment.b[0],t)-faceCenter.x,0,lerp(segment.a[1],segment.b[1],t)-faceCenter.z).normalize();
      const inside=(type==='wall'&&normal.dot(toward)>.3)||(type==='roof'&&normal.y<-.3)?1:0;
      const at=(ia,ib)=>gridPoint(corners[0].map((value,k)=>
        value*count[k]+(corners[1][k]-value)*ia+(corners[3][k]-value)*ib));
      const points=[];for(let ib=0;ib<=nb;ib++)for(let ia=0;ia<=na;ia++)points.push(at(ia,ib).toArray());
      const uv=planarMasonryUV(points,normal.toArray(),1/coverM),base=P.length/3;
      for(let ib=0;ib<=nb;ib++)for(let ia=0;ia<=na;ia++) {
        const k=ib*(na+1)+ia,p=points[k];
        const tangentA=at(Math.min(na,ia+1),ib).clone().sub(at(Math.max(0,ia-1),ib));
        const tangentB=at(ia,Math.min(nb,ib+1)).clone().sub(at(ia,Math.max(0,ib-1)));
        const localNormal=tangentA.cross(tangentB).normalize();
        P.push(...p);N.push(...localNormal.toArray());U.push(uv[k*2],uv[k*2+1]);C.push(1,1,1);
        const s=((p[0]-segment.a[0])*dx+(p[2]-segment.a[1])*dz)/(segment.length**2);
        A.push(1,p[1]-lerp(segment.a[2],segment.b[2],s),inside);
        K.push(0,0);
      }
      for(let ib=0;ib<nb;ib++)for(let ia=0;ia<na;ia++) {
        const a=base+ib*(na+1)+ia,b=a+1,c=a+na+1,d=c+1;I.push(a,b,d,a,d,c);
      }
    }
    solids.push({name,from,to:I.length/3,type});
  };
  const point=(segment,t,u,y)=>{
    const a=st.offAt(segment.index-1,u<0?-1:1,Math.abs(u)),b=st.offAt(segment.index,u<0?-1:1,Math.abs(u));
    return [lerp(a[0],b[0],t),y,lerp(a[1],b[1],t)];
  };
  for(const segment of layout.segments) {
    const {index:i,a,b,length,s0}=segment,nominal=t=>lerp(a[2],b[2],t);
    const half=layout.innerHalf,thickness=layout.wallThickness;
    const prism=(name,u0,u1,t0,t1,low,high,type)=>{
      const range=u=>[typeof t0==='function'?t0(u):t0,typeof t1==='function'?t1(u):t1];
      const [a0,a1]=range(u0),[b0,b1]=range(u1),pairs=[[a0,u0],[b0,u1],[b1,u1],[a1,u0]];
      const vertices=[low,high].flatMap(height=>pairs.map(([t,u])=>point(segment,t,u,height(t,u))));
      addSolid(name,vertices,segment,type);
    };
    const terrain0=plan.terrainHeight(a[0],a[1])-.30,terrain1=plan.terrainHeight(b[0],b[1])-.30;
    const bottom=t=>Math.min(nominal(t)-.72,lerp(terrain0,terrain1,t));
    prism('foundation',-half,half,0,1,bottom,t=>nominal(t)-.16,'base');
    // A fitted end remains on real masonry all the way to the existing wall.
    // The bearing shares its actual footprint and overlaps the original bed.
    for(const q of layout.steps.filter(q=>q.seg===i&&q.wallStair.joint?.extensions.some(d=>d>0))) {
      const bounds=[0,...q.wallStair.joint.breaks,1];
      for(let k=1;k<bounds.length;k++) {
        const footprint=[[0,bounds[k-1]],[1,bounds[k-1]],[1,bounds[k]],[0,bounds[k]]].map(([u,v])=>wallStairPoint(q.wallStair,u,v,q.y-.28));
        const low=footprint.map(([x,z])=>Math.min(q.y-.68,plan.terrainHeight(x,z)-.30));
        const vertices=[...footprint.map(([x,z],k)=>[x,low[k],z]),...footprint.map(([x,z])=>[x,q.y-.28,z])];
        addSolid('joint-bearing',vertices,segment,'base');
        Object.assign(solids.at(-1),{segment:i,step:q.step});
      }
    }
    if(layout.enclosed) {
      const end=Math.max(0,Math.min(1,(layout.length-1.2-s0)/length));
      if(end<=0)continue;
      const roof=t=>nominal(t)+layout.headroom;
      prism('roof',-half-thickness,half+thickness,0,end,roof,t=>roof(t)+.22,'roof');
      for(const side of [-1,1]) {
        const u0=side*half,u1=side*(half+thickness);
        const hasSlit=i%2===1&&side===segment.railSign&&length*end>2;
        if(!hasSlit){prism('side',u0,u1,0,end,bottom,roof,'wall');continue;}
        const center=end*.53,lo=nominal(center)+1.03,hi=lo+.78;
        const width=u=>lerp(.38,.15,(Math.abs(u)-half)/thickness);
        const before=u=>center-width(u)/(2*length),after=u=>center+width(u)/(2*length);
        prism('below-slit',u0,u1,before,after,bottom,()=>lo,'wall');
        prism('above-slit',u0,u1,before,after,()=>hi,roof,'wall');
        prism('slit-jamb-a',u0,u1,0,before,bottom,roof,'wall');
        prism('slit-jamb-b',u0,u1,after,end,bottom,roof,'wall');
        slits.push({segment:i,side,center,low:lo,high:hi,insideWidth:.38,outsideWidth:.15,
          inner:point(segment,center,u0,(lo+hi)/2),outer:point(segment,center,u1,(lo+hi)/2)});
      }
    }else if(!layout.spiral) {
      const side=segment.railSign,u0=side*half,u1=side*(half+thickness);
      const top=t=>parapetTop(layout,segment,t)-.10;
      prism('parapet',u0,u1,0,1,bottom,top,'wall');
      for(const cap of makeStairCoping(st,layout,segment)) {
        const g=cap.geometry,offset=P.length/3,from=I.length/3;
        P.push(...g.attributes.position.array);N.push(...g.attributes.normal.array);
        U.push(...g.attributes.uv.array);C.push(...g.attributes.color.array);
        A.push(...g.attributes.aStairWall.array);K.push(...g.attributes.aStairStone.array);
        for(const index of g.index.array)I.push(offset+index);
        solids.push({name:cap.kind,type:cap.kind,from,to:I.length/3,segment:i,t0:cap.t0,t1:cap.t1});
        g.dispose();
      }
      // The uphill edge is part of the foundation. It meets the tread ends
      // along exactly the same inner line instead of leaving a second gap.
      prism('string-course',-u0,-u1,0,1,bottom,t=>nominal(t)-.14,'base');
    }else {
      for(const side of [-1,1])prism('tower-string',side*half,side*(half+.12),0,1,
        t=>nominal(t)-.72,t=>nominal(t)-.14,'base');
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setIndex(I);
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(P,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(N,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(U,2));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(C,3));
  geometry.setAttribute('aStairWall',new THREE.Float32BufferAttribute(A,3));
  geometry.setAttribute('aStairStone',new THREE.Float32BufferAttribute(K,2));
  geometry.userData.stairSolids=solids;geometry.userData.slits=slits;
  return geometry;
}
