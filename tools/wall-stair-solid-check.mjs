import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {buildPlan} from '../src/plan.js';
import {wallStairLayout} from '../src/wall-stair-layout.js';
import {makeWallStairMasonry} from '../src/wall-stair-masonry.js';
import {parapetTop} from '../src/wall-stair-coping.js';
import {stepSurfaceAt} from '../src/step-stone.js';

const plan=buildPlan(),rows=[],bad=[],ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0);
const point=(c,u,v)=>new THREE.Vector3(
  (c[0][0]*(1-u)+c[1][0]*u)*(1-v)+(c[3][0]*(1-u)+c[2][0]*u)*v,0,
  (c[0][1]*(1-u)+c[1][1]*u)*(1-v)+(c[3][1]*(1-u)+c[2][1]*u)*v);
for(const st of plan.WALL_STAIRS) {
  const layout=wallStairLayout(st,{gates:plan.GATES}),g=makeWallStairMasonry(st,layout,plan),p=g.attributes.position,ix=g.index;
  const row={id:st.id,solids:0,copings:0,supportQueries:0,unsupported:0,protruding:0,coveredAtBack:0,minSeatingMm:Infinity,
    copingSeatingQueries:0,minCopingSeatingMm:null};
  for(const s of g.userData.stairSolids) {
    const edges=new Map(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),origin=new THREE.Vector3().fromBufferAttribute(p,ix.getX(s.from*3));
    let volume=0,collapsed=0;
    for(let i=s.from*3;i<s.to*3;i+=3) {
      a.fromBufferAttribute(p,ix.getX(i));b.fromBufferAttribute(p,ix.getX(i+1));c.fromBufferAttribute(p,ix.getX(i+2));
      const cross=b.clone().sub(a).cross(c.clone().sub(a));if(cross.length()<1e-12)collapsed++;
      volume+=a.clone().sub(origin).dot(b.clone().sub(origin).cross(c.clone().sub(origin)))/6;
      const ids=[a,b,c].map(v=>v.toArray().map(x=>Math.round(x*1e6)).join(','));
      for(let k=0;k<3;k++) {
        const a=ids[k],b=ids[(k+1)%3],key=a<b?a+'|'+b:b+'|'+a,r=edges.get(key)||[0,0];
        r[0]++;r[1]+=a<b?1:-1;edges.set(key,r);
      }
    }
    const unclosed=[...edges.values()].filter(r=>r[0]!==2||r[1]!==0).length;
    if(collapsed||volume<=0||unclosed)bad.push({id:st.id,solid:s.name,from:s.from,collapsed,volume,unclosed});
    row.solids++;if(s.type==='coping')row.copings++;
  }
  const parapet=g.clone(),railIndices=[];
  for(const s of g.userData.stairSolids.filter(s=>s.name==='parapet'))for(let i=s.from*3;i<s.to*3;i++)railIndices.push(ix.getX(i));
  parapet.setIndex(railIndices);const rail=new THREE.Mesh(parapet,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  for(const s of g.userData.stairSolids.filter(s=>s.type==='coping'||s.type==='coping-mortar')) {
    const segment=layout.segments.find(q=>q.index===s.segment),side=segment.railSign;
    const a=st.offAt(segment.index-1,side,layout.innerHalf-.02),b=st.offAt(segment.index,side,layout.innerHalf-.02);
    const c=st.offAt(segment.index-1,side,layout.innerHalf+layout.wallThickness+.02),d=st.offAt(segment.index,side,layout.innerHalf+layout.wallThickness+.02);
    for(const u of [.10,.5,.90])for(const v of [.02,.5,.98]) {
      const t=s.t0+(s.t1-s.t0)*v,top=parapetTop(layout,segment,t),bottom=top-(s.type==='coping'?.14:.15);
      const at=new THREE.Vector3((a[0]*(1-t)+b[0]*t)*(1-u)+(c[0]*(1-t)+d[0]*t)*u,top+1,
        (a[1]*(1-t)+b[1]*t)*(1-u)+(c[1]*(1-t)+d[1]*t)*u);
      ray.set(at,down);const hit=ray.intersectObject(rail,false)[0];row.copingSeatingQueries++;
      if(!hit||hit.point.y<bottom+.02||hit.point.y>top-.02)bad.push({id:st.id,kind:'unseated-coping',t,u});
      else row.minCopingSeatingMm=Math.min(row.minCopingSeatingMm??Infinity,(hit.point.y-bottom)*1000);
    }
  }
  const foundation=g.clone(),indices=[];
  for(const s of g.userData.stairSolids.filter(s=>s.name==='foundation'))for(let i=s.from*3;i<s.to*3;i++)indices.push(ix.getX(i));
  foundation.setIndex(indices);const bed=new THREE.Mesh(foundation,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  for(const q of layout.steps)for(const u of [.002,.10,.5,.90,.998])for(const v of [.002,.25,.5,.75,.998]) {
    const at=point(q.wallStair.corners,u,v),surface=stepSurfaceAt(q,at.x,at.z);at.y=q.y+1;
    ray.set(at,down);const hit=ray.intersectObject(bed,false)[0];row.supportQueries++;
    const bottom=q.y-q.wallStair.depth;
    if(!hit||hit.point.y<bottom+.005) {row.unsupported++;bad.push({id:st.id,step:q.step,segment:q.seg,u,v,kind:'unsupported'});}
    else {row.minSeatingMm=Math.min(row.minSeatingMm,(hit.point.y-bottom)*1000);
      if(hit.point.y>surface-.005){
        // Course backs intentionally overlap. A bed reaching into that hidden
        // part is sound masonry; compare against the actual visible envelope.
        const envelope=Math.max(surface,...layout.steps.filter(s=>s!==q&&Math.abs(s.seg-q.seg)<=1)
          .map(s=>stepSurfaceAt(s,at.x,at.z)).filter(y=>y!==null));
        if(hit.point.y>envelope-.005){row.protruding++;bad.push({id:st.id,step:q.step,segment:q.seg,u,v,kind:'protruding',gap:envelope-hit.point.y});}
        else row.coveredAtBack++;
      }}
  }
  rows.push(row);
}
const report={rows,bad};writeFileSync(process.argv.find(a=>a.endsWith('.json'))||'shots/sept25-stair-solids.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({rows,badCount:bad.length,examples:bad.slice(0,12)}));
assert.equal(bad.length,0,'Every stone and coping must be closed and seated across the whole tread');
