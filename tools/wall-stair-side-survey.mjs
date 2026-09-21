import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {installDomShim} from './structure/domshim.mjs';
import {wallStairPoint} from '../src/wall-stair-joints.js';
installDomShim();
const {buildWorld}=await import('../src/world.js'),world=buildWorld();
const meshes=[];
world.root.traverse(mesh=>{
  if(!mesh.isMesh||mesh.isInstancedMesh||!mesh.geometry.attributes.position)return;
  if(mesh.name==='wall.curtain') {
    const g=mesh.geometry,ix=g.index,excluded=new Set();
    for(const s of g.userData.stairSolids)for(let i=s.from;i<s.to;i++)excluded.add(i);
    const faces=[],original=[];
    for(let i=0;i<ix.count;i+=3)if(!excluded.has(i/3)){faces.push(ix.getX(i),ix.getX(i+1),ix.getX(i+2));original.push(i/3);}
    const copy=new THREE.Mesh(g.clone(),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
    copy.geometry.setIndex(faces);copy.name=mesh.name;copy.userData.original=original;copy.userData.parts=g.userData.parts;
    meshes.push(copy);
  } else if(mesh.name==='house.body'||mesh.name.startsWith('monument.')) {
    const copy=new THREE.Mesh(mesh.geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
    copy.name=mesh.name;copy.matrix.copy(mesh.matrixWorld);copy.matrixAutoUpdate=false;copy.updateMatrixWorld();meshes.push(copy);
  }
});
const rows=[],ray=new THREE.Raycaster();
for(const layout of world.walls.stairLayouts.values()) {
  if(layout.enclosed)continue;
  const samples=[];
  for(const q of layout.steps) {
    const segment=layout.segments.find(s=>s.index===q.seg);
    for(const side of layout.spiral?[-1,1]:[-segment.railSign]) {
    const direction=new THREE.Vector3(-(segment.b[1]-segment.a[1])*side,0,(segment.b[0]-segment.a[0])*side).normalize();
    for(const v of [.1,.5,.9]) {
      const y=q.y-.06,edge=wallStairPoint(q.wallStair,side>0?0:1,v,y);
      ray.set(new THREE.Vector3(edge[0],y,edge[1]).addScaledVector(direction,-.15),direction);ray.far=3.15;
      const hit=ray.intersectObjects(meshes,false)[0],triangle=hit?.object.userData.original?.[hit.faceIndex];
      samples.push({segment:q.seg,step:q.step,side,v,edge,y,fitted:!!q.wallStair.joint,
        gap:hit?hit.distance-.15:null,object:hit?.object.name,point:hit?.point.toArray(),normal:hit?.face.normal.toArray(),
        part:hit?.object.userData.parts?.find(p=>triangle>=p.from&&triangle<p.to)?.name});
    }
    }
  }
  const distant=samples.filter(s=>s.gap>.002),parts={};
  for(const s of distant){const key=[s.object,s.part,Math.abs(s.normal[1])>.25?'battered':'vertical'].filter(Boolean).join('/');
    (parts[key]??=[]).push(s.segment+':'+s.step);}
  rows.push({id:layout.id,stones:layout.steps.length,samples,distantStones:new Set(distant.map(s=>s.segment+':'+s.step)).size,
    byPart:Object.fromEntries(Object.entries(parts).map(([k,v])=>[k,new Set(v).size]))});
}
const report={meshes:meshes.map(m=>m.name),rows};
writeFileSync(process.argv.find(a=>a.endsWith('.json'))||'shots/sept25-stair-side-survey.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(rows.map(({samples,...r})=>r)));
