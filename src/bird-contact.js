// Perch against the actual generated surface using the same posed sole as the
// vertex shader. A roof-ridge height is only a layer hint, never a floor plane.
export function makeBirdContact(geometry,support) {
  const p=geometry.attributes.position,unique=new Map();let low=Infinity;
  for(let i=0;i<p.count;i++)low=Math.min(low,p.getY(i));
  for(let i=0;i<p.count;i++)if(p.getY(i)<low+1e-5) {
    const v=[p.getX(i),p.getY(i),p.getZ(i)];unique.set(v.join(','),v);
  }
  const feet=[...unique.values()],cache=new WeakMap();
  return (bird,rotation,scale,time,ceiling=bird.y+.6)=>{
    if(!support)return bird.y;
    const previous=cache.get(bird);
    if(previous&&previous.x===bird.x&&previous.z===bird.z&&previous.rotation===rotation
      &&previous.scale===scale&&previous.time===time&&Math.abs(previous.y-bird.y)<1e-6)return previous.y;
    const yaw=rotation+Math.sin(Math.fround(time)*.29+Math.fround(bird.ph)*11)*.62;
    const co=Math.cos(yaw),si=Math.sin(yaw);let y=-Infinity;
    for(const [x,py,z] of feet) {
      const h=support.height(bird.x+(x*co+z*si)*scale,bird.z+(-x*si+z*co)*scale,ceiling);
      if(h!==null)y=Math.max(y,h-py*scale);
    }
    if(!Number.isFinite(y))return null;
    cache.set(bird,{x:bird.x,z:bird.z,rotation,scale,time,y});return y;
  };
}
