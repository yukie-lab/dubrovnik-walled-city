import {stepSurfaceAt} from './step-stone.js';
import {clamp} from './util.js';

// Keep the geographic multi-level resolver. Within a constructed wall ascent,
// replace its nominal course heights with the upper rendered stone triangles.
export function makeWallStairGround(plan,steps) {
  const cells=new Map(),cellSize=2;
  for(const step of steps) {
    if(!step.wallStair)continue;
    const c=step.wallStair.corners,xs=c.map(p=>p[0]),zs=c.map(p=>p[1]);
    for(let z=Math.floor(Math.min(...zs)/cellSize);z<=Math.floor(Math.max(...zs)/cellSize);z++)
      for(let x=Math.floor(Math.min(...xs)/cellSize);x<=Math.floor(Math.max(...xs)/cellSize);x++) {
        const key=x+','+z;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(step);
      }
  }
  return (x,z,currentY)=>{
    const nominal=plan.groundAt(x,z,currentY),onNominalStair=nominal.zone==='shaft'||nominal.zone==='stair';
    let y=-Infinity,stone=null;
    for(const q of cells.get(Math.floor(x/cellSize)+','+Math.floor(z/cellSize))||[]) {
      const height=stepSurfaceAt(q,x,z);if(height===null)continue;
      if(Math.abs(height-nominal.y)>(onNominalStair?.65:.16))continue;
      if(height>y){y=height;stone=q;}
    }
    if(!stone)return nominal;
    // At the final overlap the deck is the visible upper surface. Do not pull
    // the walker below it just because a stone is mortared into its edge.
    if(!onNominalStair&&nominal.y>y+.002)return nominal;
    const t=stone.wallStair,c=t.corners;
    const front=[(c[0][0]+c[1][0])/2,(c[0][1]+c[1][1])/2],back=[(c[2][0]+c[3][0])/2,(c[2][1]+c[3][1])/2];
    const dx=back[0]-front[0],dz=back[1]-front[1];
    const along=clamp(((x-front[0])*dx+(z-front[1])*dz)/(dx*dx+dz*dz),0,1);
    return {...nominal,y,zone:t.enclosed?'shaft':'stair',stair:{stone,along,key:stone.run+':'+stone.seg+':'+stone.step}};
  };
}
