import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {installDomShim} from './structure/domshim.mjs';
import {wallStairLayout} from '../src/wall-stair-layout.js';
installDomShim();
const {buildWorld}=await import('../src/world.js'),w=buildWorld({life:false});
const wall=w.walls.group.getObjectByName('wall.curtain'),g=wall.geometry,ix=g.index;
const excluded=new Set();for(const s of g.userData.stairSolids)for(let i=s.from;i<s.to;i++)excluded.add(i);
const indices=[],source=[];
for(let i=0;i<ix.count;i+=3)if(!excluded.has(i/3)){indices.push(ix.getX(i),ix.getX(i+1),ix.getX(i+2));source.push(i/3);}
const city=new THREE.Mesh(g.clone(),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));city.geometry.setIndex(indices);
const ray=new THREE.Raycaster(),rows=[];
for(const st of w.plan.WALL_STAIRS) {
  const layout=wallStairLayout(st,{gates:w.plan.GATES});if(layout.enclosed)continue;
  const samples=[];
  for(const q of layout.steps) {
    const segment=layout.segments.find(s=>s.index===q.seg),c=q.wallStair.corners;
    for(const side of layout.spiral?[-1,1]:[-segment.railSign]) {
      const u=side>0?0:1,a=c[u],b=c[3-u],edge=[(a[0]+b[0])/2,(a[1]+b[1])/2];
      const direction=new THREE.Vector3(-(segment.b[1]-segment.a[1])*side,0,(segment.b[0]-segment.a[0])*side).normalize();
      ray.set(new THREE.Vector3(edge[0],q.y-.08,edge[1]).addScaledVector(direction,-.3),direction);ray.far=20;
      const hit=ray.intersectObject(city,false).find(h=>Math.abs(h.face.normal.y)<.55&&Math.abs(h.face.normal.dot(direction))>.4);
      const n=hit?.face.normal,triangle=hit?source[hit.faceIndex]:null;
      samples.push({segment:q.seg,step:q.step,side,edge,y:q.y,gap:hit?hit.distance-.3:null,
        plane:hit?[...n.toArray(),-n.dot(hit.point)]:null,point:hit?.point.toArray(),
        part:g.userData.parts.find(p=>triangle>=p.from&&triangle<p.to)?.name});
    }
  }
  rows.push({id:st.id,samples});
}
writeFileSync(process.argv[2]||'shots/rendercheck/stair-host-survey.json',JSON.stringify(rows,null,2)+'\n');
for(const r of rows)for(const seg of new Set(r.samples.map(s=>s.segment)))for(const side of [-1,1]) {
  const a=r.samples.filter(s=>s.segment===seg&&s.side===side);if(!a.length)continue;
  const hits=a.filter(s=>s.gap!==null);
  console.log(JSON.stringify({id:r.id,segment:seg,side,steps:a.length,hits:hits.length,
    gap:hits.length?[Math.min(...hits.map(s=>s.gap)),Math.max(...hits.map(s=>s.gap))]:null,
    first:hits[0],last:hits.at(-1)}));
}
