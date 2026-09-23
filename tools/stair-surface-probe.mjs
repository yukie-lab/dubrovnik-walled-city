import * as THREE from 'three';
import {writeFileSync} from 'node:fs';
import {installDomShim} from './structure/domshim.mjs';
installDomShim();
const {buildWorld}=await import('../src/world.js'),w=buildWorld({life:false});
const wall=w.walls.group.getObjectByName('wall.curtain'),targets=[wall,w.steps];
w.root.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh&&(o.name==='house.body'||o.name.startsWith('monument.')))targets.push(o);});
const camera=new THREE.PerspectiveCamera(60,1.6,.1,6000),ray=new THREE.Raycaster(),rows=[];
for(const id of ['pileStair','stjohnStair','ploceStair']) {
  const st=w.plan.WALL_STAIRS.find(s=>s.id===id),lengths=st.pts.slice(1).map((b,i)=>Math.hypot(b[0]-st.pts[i][0],b[1]-st.pts[i][1]));
  let distance=lengths.reduce((a,b)=>a+b,0)*.4,i=0;
  while(distance>lengths[i]&&i<lengths.length-1)distance-=lengths[i++];
  const a=st.pts[i],b=st.pts[i+1],t=distance/lengths[i],x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
  const floor=w.plan.walkingGroundAt(x,z,a[2]+(b[2]-a[2])*t);
  camera.position.set(x,floor.y+1.62,z);camera.rotation.set(.045,Math.atan2(a[0]-b[0],a[1]-b[1]),0,'YXZ');
  camera.updateMatrixWorld();camera.updateProjectionMatrix();
  const hits=[];
  for(const py of [450,600,750,850,950])for(const px of [1100,1250,1375,1450,1525]) {
    ray.setFromCamera(new THREE.Vector2(px/800-1,1-py/500),camera);
    const hit=ray.intersectObjects(targets,false)[0];if(!hit)continue;
    const g=hit.object.geometry,owner=g.userData.stairSolids?.find(s=>hit.faceIndex>=s.from&&hit.faceIndex<s.to),
      solid=g.userData.solids?.find(s=>hit.faceIndex>=s.from&&hit.faceIndex<s.to),
      part=g.userData.parts?.find(s=>hit.faceIndex>=s.from&&hit.faceIndex<s.to);
    hits.push({pixel:[px,py],object:hit.object.name,point:hit.point.toArray(),normal:hit.face.normal.toArray(),
      owner,part:part?.name,step:hit.object===w.steps?{...w.stepPool.items[solid.id],wallStair:undefined}:undefined});
  }
  rows.push({id,position:camera.position.toArray(),hits});
}
const file=process.argv[2]||'shots/rendercheck/stair-surfaces.json';writeFileSync(file,JSON.stringify(rows,null,2)+'\n');
for(const r of rows)console.log(JSON.stringify({id:r.id,hits:r.hits.map(h=>({pixel:h.pixel,object:h.object,part:h.part,owner:h.owner?.name}))}));
