// The first accessible ground floor. The original house footprint and roof
// remain authoritative; the room, opening, floor and colliders share this plan.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {houseCoreGeometry} from './roof-solid.js';

export function planCafe(plan) {
  const house=plan.houses.filter(h=>h.stradunFront&&h.side===-1&&!h.garden&&h.w>=5.7&&h.w<7&&h.x>-120&&h.x< -55)
    .sort((a,b)=>Math.abs(a.x+86)-Math.abs(b.x+86))[0];
  if(!house)return null;
  const h=house,wall=.42,floor=2.62,ceiling=floor+3.45;
  const x0=h.x-h.w/2,x1=h.x+h.w/2,z0=h.z-h.d/2,z1=h.z+h.d/2;
  // Match the existing shop-bay spacing, including worlds with another seed.
  const bays=Math.max(1,Math.round(h.w/4.1)),doorX=h.x+((Math.floor(bays/2)+.5)/bays-.5)*h.w;
  const cafe={id:'stradun-cafe',name:'ストラドゥンの小さなカフェ',house,x0,x1,z0,z1,wall,floor,ceiling,
    doorX,doorHalf:.925,spring:2.05,colliders:[],
    approach:{x:doorX,z:z1+2.3,yaw:0,pitch:0,name:'カフェ前 — 開いたアーチから店内へ'},
    contains(x,z){return x>x0&&x<x1&&z>z0&&z<z1;},
    floorAt(x,z,currentY){
      // Include the flush stone threshold; a viewpoint above the roof keeps
      // its original layer. An unspecified height denotes a ground visitor.
      if(x>x0&&x<x1&&z>z0&&z<z1+.18&&(currentY==null||currentY<ceiling))
        return {y:floor,zone:z<z1-wall?'interior':'stradun',interior:this.id};
      return null;
    },
  };
  const collider=(x0,x1,z0,z1,y1=ceiling)=>cafe.colliders.push({x0,x1,z0,z1,y0:floor-.2,y1});
  collider(x0,x0+wall,z0,z1);collider(x1-wall,x1,z0,z1);
  collider(x0,x1,z0,z0+wall);
  // The arch's stone jamb projects 19 cm to each side, but its clear opening
  // remains 1.85 m. The walker fits through without an interaction key.
  collider(x0,doorX-cafe.doorHalf,z1-wall,z1+.275);
  collider(doorX+cafe.doorHalf,x1,z1-wall,z1+.275);
  cafe.counter={x:x0+wall+.48,z:z0+wall+2.05,w:.85,d:2.8,h:1.02};
  const c=cafe.counter;collider(c.x-c.w/2,c.x+c.w/2,c.z-c.d/2,c.z+c.d/2,floor+c.h);
  cafe.tables=[{x:x1-wall-.88,z:z0+wall+1.45},{x:x1-wall-.88,z:z0+wall+4.05}];
  for(const t of cafe.tables) {
    collider(t.x-.43,t.x+.43,t.z-.43,t.z+.43,floor+.76);
    for(const dz of [-.76,.76])collider(t.x-.25,t.x+.25,t.z+dz-.24,t.z+dz+.24,floor+.88);
  }
  // Body collision queries are made at floor+1m. Low furniture still occupies
  // the walker's legs, so give its footprint the same standing-body interval.
  for(const b of cafe.colliders)b.y1=Math.max(b.y1,floor+1.7);
  Object.defineProperty(h,'interior',{value:cafe,enumerable:false});
  plan.interiors.push(cafe);
  return cafe;
}

export function cafeHouseGeometry(h,coverM) {
  const r=h.interior,structuralTop=r.ceiling+.18;
  const parts=[houseCoreGeometry({...h,yBase:structuralTop},coverM)];
  const low=Math.min(h.yBase,r.floor-.2),height=structuralTop-low;
  const box=(w,d,x,z)=>{
    const g=new THREE.BoxGeometry(w,height,d);g.translate(x,low+height/2,z);parts.push(g);
  };
  box(r.wall,h.d,r.x0+r.wall/2,h.z);box(r.wall,h.d,r.x1-r.wall/2,h.z);
  box(h.w-2*r.wall,r.wall,h.x,r.z0+r.wall/2);
  // A true arched notch in a thick wall, with a soffit and both reveals.
  const s=new THREE.Shape(),left=r.x0-r.doorX,right=r.x1-r.doorX;
  s.moveTo(left,low);s.lineTo(-r.doorHalf,low);s.lineTo(-r.doorHalf,r.floor+r.spring);
  s.absarc(0,r.floor+r.spring,r.doorHalf,Math.PI,0,true);
  s.lineTo(r.doorHalf,low);s.lineTo(right,low);s.lineTo(right,structuralTop);s.lineTo(left,structuralTop);s.closePath();
  const front=new THREE.ExtrudeGeometry(s,{depth:r.wall,bevelEnabled:false,curveSegments:16});
  front.translate(r.doorX,0,r.z1-r.wall);parts.push(front);
  // All pieces use metric UVs and only the attributes consumed by houseBody.
  for(const g of parts) {
    for(const name of Object.keys(g.attributes))if(!['position','normal','uv'].includes(name))g.deleteAttribute(name);
    if(g===parts[0])continue;
    const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
    for(let i=0;i<p.count;i++)uv.setXY(i,(Math.abs(n.getX(i))>.5?p.getZ(i):p.getX(i))/coverM,
      (Math.abs(n.getY(i))>.5?p.getZ(i):p.getY(i))/coverM);
  }
  const source=parts.map(g=>g.index?g.toNonIndexed():g),result=mergeGeometries(source);
  for(const g of new Set([...parts,...source]))g.dispose();
  return result;
}
