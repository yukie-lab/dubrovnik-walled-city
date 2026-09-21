import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {installDomShim} from './structure/domshim.mjs';
import {wallStairPoint} from '../src/wall-stair-joints.js';
installDomShim();
const {buildWorld}=await import('../src/world.js'),w=buildWorld();
const mesh=w.walls.group.getObjectByName('wall.curtain'),g=mesh.geometry,p=g.attributes.position,ix=g.index;
const excluded=new Set();for(const s of g.userData.stairSolids)for(let i=s.from;i<s.to;i++)excluded.add(i);
const indices=[],a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
for(let i=0;i<ix.count;i+=3) {
  if(excluded.has(i/3))continue;
  a.fromBufferAttribute(p,ix.getX(i));b.fromBufferAttribute(p,ix.getX(i+1));c.fromBufferAttribute(p,ix.getX(i+2));
  const n=b.clone().sub(a).cross(c.clone().sub(a)).normalize();if(Math.abs(n.y)>.25)continue;
  indices.push(ix.getX(i),ix.getX(i+1),ix.getX(i+2));
}
const city=g.clone();city.setIndex(indices);const walls=new THREE.Mesh(city,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
const ray=new THREE.Raycaster(),rows=[];
for(const layout of w.walls.stairLayouts.values()) {
  if(layout.enclosed||layout.spiral)continue;
  const samples=[];
  for(const q of layout.steps) {
    const segment=layout.segments.find(s=>s.index===q.seg),side=-segment.railSign;
    const direction=new THREE.Vector3(-(segment.b[1]-segment.a[1])*side,0,(segment.b[0]-segment.a[0])*side).normalize();
    const ends=side>0?[0,3]:[1,2],corners=q.wallStair.corners;
    for(const along of process.argv.includes('--dense')?[0,.1,.25,.5,.75,.9,1]:[0,1]) {
      const edge=wallStairPoint(q.wallStair,side>0?0:1,along,q.y-.08);
      const origin=new THREE.Vector3(edge[0],q.y-.08,edge[1]).addScaledVector(direction,-.15);
      ray.set(origin,direction);ray.far=.70;
      const hit=ray.intersectObject(walls,false)[0];
      samples.push({segment:q.seg,step:q.step,along,edge,extension:hit?hit.distance-.15:null,
        point:hit?.point.toArray(),normal:hit?.face.normal.toArray()});
    }
  }
  const gaps=samples.filter(s=>s.extension>.002),intrusions=samples.filter(s=>s.extension<-.002);
  rows.push({id:layout.id,stones:layout.steps.length,points:samples.length,gappedPoints:gaps.length,
    gappedStones:new Set(gaps.map(s=>s.segment+':'+s.step)).size,
    intrusionPoints:intrusions.length,minGap:Math.min(...gaps.map(s=>s.extension)),maxGap:Math.max(...gaps.map(s=>s.extension)),samples,
    joints:layout.steps.filter(q=>q.wallStair.joint).map(q=>({segment:q.seg,step:q.step,...q.wallStair.joint}))});
}
writeFileSync(process.argv.find(a=>a.endsWith('.json'))||'shots/sept25-joint-probe.json',JSON.stringify({rows},null,2)+'\n');
console.log(JSON.stringify(rows.map(({samples,joints,...r})=>r)));
