import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {installDomShim} from './structure/domshim.mjs';
import {Player} from '../src/player.js';
import {stepSurfaceAt} from '../src/step-stone.js';
import {wallStairPoint} from '../src/wall-stair-joints.js';
installDomShim();
const {buildWorld}=await import('../src/world.js'),world=buildWorld(),plan=world.plan,rows=[],lateral=[];
const forward=new Set(['KeyW']),empty=new Set(),dt=1/60;
for(const st of plan.WALL_STAIRS) {
  const path=st.pts.map(p=>p.slice()),end=path.at(-1),landing=plan.landings.find(l=>Math.hypot(l.x-end[0],l.z-end[1])<.01);
  if(landing)path.push([landing.x+landing.ux*landing.len,landing.z+landing.uz*landing.len,landing.y]);
  else if(st.spiral) {
    const tower=Object.values(plan.TOWERS).filter(t=>Math.abs(t.topY-end[2])<.5)
      .sort((a,b)=>Math.hypot(a.x-end[0],a.z-end[1])-Math.hypot(b.x-end[0],b.z-end[1]))[0];
    if(tower)path.push([end[0]+(tower.x-end[0])*.22,end[1]+(tower.z-end[1])*.22,tower.topY]);
  }
  for(const descending of process.argv.includes('--descending')?[false,true]:[false]) {
    const course=descending?path.slice().reverse():path,p=new Player(plan,{x:course[0][0],z:course[0][1],groundY:course[0][2],
      yaw:Math.atan2(course[0][0]-course[1][0],course[0][1]-course[1][1])});
    let index=1,elapsed=0,stuck=0,lastDistance=Infinity,maxFootError=0,minStepHeadOffset=Infinity,maxStepHeadOffset=-Infinity,maxGroundStep=0;
    const visited=new Set();
    while(index<course.length&&elapsed<100&&stuck<7) {
      const target=course[index],dx=target[0]-p.x,dz=target[1]-p.z,distance=Math.hypot(dx,dz);
      const turn=Math.atan2(Math.sin(Math.atan2(-dx,-dz)-p.yaw),Math.cos(Math.atan2(-dx,-dz)-p.yaw));
      const beforeY=p.groundY,beforeStair=p.stair;
      p.yaw+=Math.max(-dt*1.9,Math.min(dt*1.9,turn));p.update(dt,Math.abs(turn)<.55?forward:empty);elapsed+=dt;
      if(beforeStair||p.stair)maxGroundStep=Math.max(maxGroundStep,Math.abs(p.groundY-beforeY));
      if(p.stair) {
        const actual=stepSurfaceAt(p.stair.stone,p.x,p.z);assert(actual!==null);
        maxFootError=Math.max(maxFootError,Math.abs(actual-p.groundY));visited.add(p.stair.key);
        minStepHeadOffset=Math.min(minStepHeadOffset,p.smoothY-p.groundY);maxStepHeadOffset=Math.max(maxStepHeadOffset,p.smoothY-p.groundY);
      }
      if(distance<.18){index++;lastDistance=Infinity;stuck=0;}
      else {stuck=distance>lastDistance-.001?stuck+dt:0;lastDistance=distance;}
    }
    const next=course[Math.min(index,course.length-1)],distance=Math.hypot(next[0]-p.x,next[1]-p.z)||1;
    const blocked=index<course.length?plan.walkingCollide(p.x+(next[0]-p.x)*.08/distance,p.z+(next[1]-p.z)*.08/distance,.35,p.groundY+1,true):null;
    if(blocked?.contacts)for(const c of blocked.contacts)c.owner=world.walls.group.getObjectByName('wall.curtain').geometry.userData.parts.find(s=>c.triangle>=s.from&&c.triangle<s.to)?.name;
    rows.push({id:st.id,descending,completed:index===course.length,waypoint:index,elapsed,visited:visited.size,blocked,
      maxFootErrorMm:maxFootError*1000,maxGroundStepMm:maxGroundStep*1000,minStepHeadOffset,maxStepHeadOffset,end:[p.x,p.groundY,p.z]});
  }
  for(const q of world.walls.stairLayouts.get(st.id).steps.filter(q=>q.wallStair.joint)) {
    const u=q.wallStair.joint.side>0?0:1,edge=wallStairPoint(q.wallStair,u,.5,q.y),other=wallStairPoint(q.wallStair,1-u,.5,q.y);
    const distance=Math.hypot(other[0]-edge[0],other[1]-edge[1]),x=edge[0]+(other[0]-edge[0])*.36/distance,z=edge[1]+(other[1]-edge[1])*.36/distance;
    const g=plan.walkingGroundAt(x,z,q.y);if(!g.stair)continue;
    const before=plan.collide(x,z,.35,g.y+1),after=plan.walkingCollide(x,z,.35,g.y+1);
    lateral.push({id:st.id,segment:q.seg,step:q.step,legacyShift:Math.hypot(before.x-x,before.z-z),actualShift:Math.hypot(after.x-x,after.z-z)});
  }
}
const report={rows,lateral,legacyGhosts:lateral.filter(r=>r.legacyShift>.02&&r.actualShift<.002).length};
writeFileSync(process.argv.find(a=>a.endsWith('.json'))||'shots/sept25-stair-walk-check.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({rows,legacyGhosts:report.legacyGhosts,lateralSamples:lateral.length}));
assert(rows.every(r=>r.completed),'Every real Player ascent must reach its landing without teleporting');
assert(rows.every(r=>r.maxFootErrorMm<.015),'The player must stand on the actual worn surface');
assert(rows.every(r=>r.maxGroundStepMm<300),'A nominal flight must not insert phantom steps between real treads');
