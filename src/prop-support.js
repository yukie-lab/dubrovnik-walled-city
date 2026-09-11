// Seat a circular rigid base on a rendered support surface. Search within the
// same small street-edge neighbourhood, and choose a vessel that fits a tread
// before accepting it. A centre height alone cannot certify a rigid footprint.
export function seatRoundProp(proposal,support,{baseRadius=.24,minScale=.55,maxShift=.85,accept=()=>true}={}) {
  const ceiling=proposal.y+.45,candidates=[[proposal.x,proposal.z]];
  const steps=support.nearbySteps(proposal.x,proposal.z,maxShift);
  let best=null,bestCost=Infinity;
  const scales=[1,.94,.88,.80,.72,.64,.56,.48].map(k=>Math.max(minScale,proposal.s*k));
  for(const scale of new Set(scales)) {
    const radius=baseRadius*scale;
    candidates.length=1;
    for(const distance of [.10,.22,.40,.64,.82])for(let k=0;k<12;k++) {
      const angle=k*Math.PI/6;
      candidates.push([proposal.x+Math.cos(angle)*distance,proposal.z+Math.sin(angle)*distance]);
    }
    for(const e of steps) {
      const q=e.step;if(Math.abs(q.y-proposal.y)>.45 || q.w<radius*2+.012 || q.d<radius*2+.012)continue;
      const dx=proposal.x-q.x,dz=proposal.z-q.z;
      const u=Math.max(-q.w/2+radius+.006,Math.min(q.w/2-radius-.006,dx*e.co-dz*e.si));
      const v=Math.max(-q.d/2+radius+.006,Math.min(q.d/2-radius-.006,dx*e.si+dz*e.co));
      // The neighbouring higher stone overlaps one end of a tread. Test seats
      // through its usable interval and certify each against all surfaces.
      const free=q.d/2-radius-.006;
      for(const z2 of [v,0,-free,free,-free*.5,free*.5])
        candidates.push([q.x+u*e.co+z2*e.si,q.z-u*e.si+z2*e.co]);
    }
    for(const [x,z] of candidates) {
      const distance=Math.hypot(x-proposal.x,z-proposal.z);
      if(distance>maxShift)continue;
      const cost=distance+(proposal.s-scale)*.65;
      if(cost>=bestCost)continue;
      const seat=support.disk(x,z,radius,ceiling,.006,.18);
      if(!seat || Math.abs(seat.y-proposal.y)>.45 || !accept(x,seat.y,z,scale))continue;
      best={...proposal,x,y:seat.y,z,s:scale,up:seat.up};bestCost=cost;
    }
  }
  return best;
}

export function seatPottedPlants(proposals,support,plan) {
  const placed=[],report={proposed:proposals.length,placed:0,shifted:0,resized:0,tilted:0,omitted:0,maxShift:0,maxHeightChange:0,omittedCases:[]};
  for(const p of proposals) {
    const q=seatRoundProp(p,support,{accept:(x,y,z,s)=>{
      const outer=.335*s;
      const c=plan.collide(x,z,outer,y+.22*s);
      if(Math.hypot(c.x-x,c.z-z)>.015)return false;
      const wall=plan.plazaWall(x,z,outer);
      if(wall && y<wall.yTop-.05)return false;
      for(const other of placed)if(Math.hypot(x-other.x,z-other.z)<outer+.335*other.s+.018)return false;
      return true;
    }});
    if(!q){report.omitted++;report.omittedCases.push({...p,supportAvailable:!!seatRoundProp(p,support)});continue;}
    const shift=Math.hypot(q.x-p.x,q.z-p.z);
    if(shift>1e-5)report.shifted++;
    if(q.s<p.s-1e-5)report.resized++;
    if(q.up[1]<.99999)report.tilted++;
    report.maxShift=Math.max(report.maxShift,shift);report.maxHeightChange=Math.max(report.maxHeightChange,Math.abs(q.y-p.y));
    placed.push(q);
  }
  report.placed=placed.length;
  return {pots:placed,report};
}
