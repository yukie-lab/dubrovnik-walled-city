// A walkable ground-floor gallery within the existing Sponza footprint.
// The exhibits are an interpretation for this miniature city, not a survey
// of the real building's rooms or collection.
export function planSponza(plan) {
  const m=plan.MONUMENTS.sponza;
  const house=plan.houses.find(h=>h.monument&&h.x===m.x&&h.z===m.z);
  if(!house)return null;
  const x0=m.x-m.w/2,x1=m.x+m.w/2,z0=m.z-m.d/2,z1=m.z+m.d/2,wall=.55;
  const floor=plan.groundAt(m.x,z1+.7).y+.025,ceiling=floor+5.7;
  const r={id:'sponza-gallery',kind:'gallery',name:'スポンザ館',house,x0,x1,z0,z1,wall,floor,ceiling,
    doorX:m.x,doorHalf:1.08,spring:2.35,colliders:[],
    approach:{x:m.x,z:z1+3,yaw:0,pitch:0,name:'スポンザ館 — 中央の扉をクリック、または F で入館'},
    contains(x,z){return x>x0&&x<x1&&z>z0&&z<z1;},
    floorAt(x,z,currentY){
      if(x>x0&&x<x1&&z>z0&&z<z1+.18&&(currentY==null||currentY<ceiling))
        return {y:floor,zone:z<z1-wall?'interior':'plaza',interior:this.id};
      return null;
    },
  };
  const solid=(x0,x1,z0,z1)=>r.colliders.push({x0,x1,z0,z1,y0:floor-.2,y1:ceiling});
  solid(x0,x0+wall,z0,z1);solid(x1-wall,x1,z0,z1);solid(x0,x1,z0,z0+wall);
  solid(x0,r.doorX-r.doorHalf,z1-wall,z1+.275);
  solid(r.doorX+r.doorHalf,x1,z1-wall,z1+.275);
  r.displays=[{x:m.x-3.5,z:z0+4.7},{x:m.x+3.5,z:z0+4.7}];
  for(const d of r.displays)solid(d.x-1.05,d.x+1.05,d.z-.7,d.z+.7);
  r.benches=[{x:m.x-3.5,z:z1-3},{x:m.x+3.5,z:z1-3}];
  for(const b of r.benches)solid(b.x-1.2,b.x+1.2,b.z-.32,b.z+.32);
  for(const x of [x0+1.2,x1-1.2])for(const z of [z0+3.1,z0+6.4,z0+9.7])
    solid(x-.28,x+.28,z-.28,z+.28);
  // Cabinets and their cornices occupy the back wall; the centre stays clear.
  for(const x of [m.x-4.5,m.x+4.5])solid(x-1.25,x+1.25,z0+wall,z0+wall+.5);
  Object.defineProperty(house,'interior',{value:r,enumerable:false});
  plan.interiors.push(r);
  return r;
}
