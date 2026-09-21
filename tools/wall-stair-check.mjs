import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {buildPlan} from '../src/plan.js';
import {wallStairLayout} from '../src/wall-stair-layout.js';
import {makeWallStairMasonry} from '../src/wall-stair-masonry.js';
import {makeStairSkyVisibility} from '../src/wall-stair-light.js';
import {makeStepStone,stepSurfaceAt} from '../src/step-stone.js';
import {meshTopology} from './structure/geom.mjs';

const plan=buildPlan(),rows=[],ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0);
const point=(c,u,v)=>new THREE.Vector3(
  (c[0][0]*(1-u)+c[1][0]*u)*(1-v)+(c[3][0]*(1-u)+c[2][0]*u)*v,0,
  (c[0][1]*(1-u)+c[1][1]*u)*(1-v)+(c[3][1]*(1-u)+c[2][1]*u)*v);
const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
for(const st of plan.WALL_STAIRS) {
  const layout=wallStairLayout(st,{gates:plan.GATES}),masonry=makeWallStairMasonry(st,layout,plan),body=new THREE.Mesh(masonry,material);
  const row={id:st.id,segments:layout.segments.length,steps:layout.steps.length,clearWidth:2*layout.innerHalf,
    supportRays:0,maxSupportErrorMm:0,minDishMm:Infinity,maxDishMm:0,rises:[],solids:0,slits:[],sky:[]};
  for(const solid of masonry.userData.stairSolids) {
    const check=meshTopology(masonry,null,[solid]);
    assert.equal(check.boundaryEdges+check.nonManifoldEdges+check.flippedEdges+check.degenerate,0,st.id+': '+solid.name);
    assert(check.volume>0);row.solids++;
  }
  for(const q of layout.steps) {
    const g=makeStepStone(q),mesh=new THREE.Mesh(g,material),topology=meshTopology(g);
    // This shared city topology helper welds at 1.5 mm, intentionally merging
    // submillimetre chip samples. step-audit separately checks every real
    // Float32 face and directed edge at 1 micrometre, including these samples.
    assert.equal(topology.boundaryEdges+topology.nonManifoldEdges+topology.flippedEdges,0,st.id+': tread');
    assert(topology.volume>0);
    for(const u of [.001,.08,.25,.5,.75,.92,.999])for(const v of [.002,.04,.24,.5,.85,.998]) {
      const p=point(q.wallStair.corners,u,v);p.y=q.y+1;ray.set(p,down);
      const hit=ray.intersectObject(mesh,false)[0],actual=stepSurfaceAt(q,p.x,p.z);
      assert(hit&&actual!==null,'A tread has a hole or misses the physical foot');
      row.maxSupportErrorMm=Math.max(row.maxSupportErrorMm,Math.abs(actual-hit.point.y)*1000);row.supportRays++;
    }
    const center=point(q.wallStair.corners,.5,.5),edge=point(q.wallStair.corners,.01,.5);
    const cy=stepSurfaceAt(q,center.x,center.z),ey=stepSurfaceAt(q,edge.x,edge.z),dish=ey-cy;
    row.minDishMm=Math.min(row.minDishMm,dish*1000);row.maxDishMm=Math.max(row.maxDishMm,dish*1000);
    assert(dish>.009,'The actual tread must be dished, not merely textured');
    // The solid stone reaches through the sloped masonry bed. A body surface
    // under its centre must lie inside the stone's thickness, without daylight.
    center.y=cy-.045;ray.set(center,down);
    const under=ray.intersectObject(body,false).find(h=>h.point.y<cy-.02);
    assert(under&&under.point.y>q.y-q.wallStair.depth+.01,'Stone is not seated on its masonry bed');
    if(q.step)row.rises.push(q.wallStair.rise);
  }
  assert(row.maxSupportErrorMm<.015);
  for(const slit of masonry.userData.slits) {
    const start=new THREE.Vector3(...slit.inner),direction=new THREE.Vector3(...slit.outer).sub(start).normalize();
    const checks=[];
    for(const y of [(slit.low+slit.high)/2,slit.low-.10,slit.high+.10]) {
      const origin=start.clone();origin.y=y;origin.addScaledVector(direction,-.04);
      ray.set(origin,direction);ray.far=.9;checks.push(ray.intersectObject(body,false).length>0);
    }
    ray.far=Infinity;assert.deepEqual(checks,[false,true,true],'Slits must pass through real thick masonry');
    row.slits.push({segment:slit.segment,checks});
  }
  const skyAt=makeStairSkyVisibility(layout,masonry);
  for(const segment of layout.segments) {
    const a=segment.a,b=segment.b;
    row.sky.push(skyAt((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2+.10));
  }
  row.riseMin=Math.min(...row.rises);row.riseMax=Math.max(...row.rises);delete row.rises;
  rows.push(row);
}
const report={flights:rows.length,segments:rows.reduce((n,r)=>n+r.segments,0),steps:rows.reduce((n,r)=>n+r.steps,0),rows};
writeFileSync(process.argv.find(a=>a.endsWith('.json'))||'shots/sept25-wall-stair-check.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
