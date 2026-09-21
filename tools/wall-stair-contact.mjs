import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {installDomShim} from './structure/domshim.mjs';
installDomShim();
const {buildWorld}=await import('../src/world.js');
const world=buildWorld(),wall=world.walls.group.getObjectByName('wall.curtain'),ray=new THREE.Raycaster(),rows=[];
for(const st of world.plan.WALL_STAIRS) {
  const layout=world.walls.stairLayouts.get(st.id),steps=world.stepPool.items.filter(q=>q.wallStair?.id===st.id),samples=[];
  for(const q of steps) {
    if(q.step===0||q.step===q.of)continue;
    const c=q.wallStair.corners,segment=layout.segments.find(s=>s.index===q.seg);
    if(st.enclosed&&q.wallStair.s>layout.length-1.2)continue;
    for(const side of [1,-1]) {
      const a=c[side>0?0:1],b=c[side>0?3:2],x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
      const normal=new THREE.Vector3(b[1]-a[1],0,a[0]-b[0]).normalize();
      if(normal.x*(x-q.x)+normal.z*(z-q.z)<0)normal.negate();
      const edge=(x-q.x)*normal.x+(z-q.z)*normal.z;
      const origin=new THREE.Vector3(q.x,q.y+.06,q.z);
      ray.set(origin,normal);ray.near=.0001;ray.far=edge+3;
      const hit=ray.intersectObject(wall,false)[0];
      const owner=hit&&wall.geometry.userData.stairSolids.find(s=>hit.faceIndex>=s.from&&hit.faceIndex<s.to);
      samples.push({seg:q.seg,step:q.step,side,rail:side===segment.railSign,
        gap:hit?hit.distance-edge:null,hit:hit?owner?.name||'existing-wall':null,point:[x,q.y+.06,z]});
    }
  }
  const summary=side=>{
    const list=samples.filter(p=>p.rail===side),gaps=list.filter(p=>p.gap!==null&&p.gap>.002);
    return {samples:list.length,contact:list.filter(p=>p.gap!==null&&Math.abs(p.gap)<.002).length,
      gaps:gaps.length,missingWall:list.filter(p=>p.gap===null).length,maxGap:Math.max(0,...gaps.map(p=>p.gap))};
  };
  rows.push({id:st.id,enclosed:!!st.enclosed,spiral:!!st.spiral,rail:summary(true),uphill:summary(false),samples});
}
const report={rows};writeFileSync(process.argv.find(a=>a.endsWith('.json'))||'shots/sept25-stair-contact.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(rows.map(({samples,...row})=>row)));
