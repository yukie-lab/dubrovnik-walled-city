import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {installDomShim} from './structure/domshim.mjs';
import {wallStairPoint} from '../src/wall-stair-joints.js';
installDomShim();
const {buildWorld}=await import('../src/world.js'),w=buildWorld({life:false});
const ray=new THREE.Raycaster(),rows=[],bad=[];
for(const layout of w.walls.stairLayouts.values()) {
  const g=layout.masonry.clone(),ix=g.index,indices=[];
  for(const s of g.userData.stairSolids.filter(s=>s.type==='wall'))
    for(let k=s.from*3;k<s.to*3;k++)indices.push(ix.getX(k));
  g.setIndex(indices);
  const masonry=new THREE.Mesh(g,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  const row={id:layout.id,steps:layout.steps.length,checkedSteps:0,contactQueries:0,exitQueries:0,boundaryQueries:0,maxGapMm:0};
  const triangles=[],p=g.attributes.position;
  for(let k=0;k<g.index.count;k+=3)triangles.push(new THREE.Triangle(...[0,1,2].map(j=>
    new THREE.Vector3().fromBufferAttribute(p,g.index.getX(k+j)))));
  for(const q of layout.steps) {
    const segment=layout.segments.find(s=>s.index===q.seg);
    let checked=false;
    for(const u of [0,1])for(let k=0;k<=16;k++) {
      const v=k/16,y=q.y-.08,t=q.wallStair.front*(1-v)+q.wallStair.back*v;
      // The shaft's final 1.2m is an intentional open emergence. All other
      // tread ends must meet finite, visible flanking masonry on both sides.
      if(layout.enclosed&&segment.s0+t*segment.length>layout.length-1.2+.00001){row.exitQueries++;continue;}
      const edge=wallStairPoint(q.wallStair,u,v,y),other=wallStairPoint(q.wallStair,1-u,v,y);
      const direction=new THREE.Vector3(edge[0]-other[0],0,edge[1]-other[1]).normalize();
      ray.set(new THREE.Vector3(edge[0],y,edge[1]).addScaledVector(direction,-.08),direction);ray.far=.16;
      const hits=ray.intersectObject(masonry,false);
      // At turning landings two closed solids meet. Require a face at the
      // actual joint, even if another overlapping solid is hit first.
      const hit=hits.reduce((best,h)=>!best||Math.abs(h.distance-.08)<Math.abs(best.distance-.08)?h:best,null);
      let gap=hit?Math.abs(hit.distance-.08):Infinity;
      if(gap>.002) {
        // At the exact first/last vertex, Float32 rounding can put a ray
        // micrometres beyond the finite face. Check finite triangles directly
        // instead of stretching them or skipping the exposed endpoint.
        const endpoint=new THREE.Vector3(edge[0],y,edge[1]),nearest=new THREE.Vector3();
        gap=Math.min(gap,...triangles.map(t=>endpoint.distanceTo(t.closestPointToPoint(endpoint,nearest))));
        row.boundaryQueries++;
      }
      checked=true;row.contactQueries++;row.maxGapMm=Math.max(row.maxGapMm,gap*1000);
      if(gap>.002)bad.push({id:layout.id,segment:q.seg,step:q.step,u,v,gap,edge,y});
    }
    if(checked)row.checkedSteps++;
  }
  rows.push(row);g.dispose();masonry.material.dispose();
}
writeFileSync(process.argv[2]||'shots/rendercheck/stair-host-check.json',JSON.stringify({rows,bad},null,2)+'\n');
console.log(JSON.stringify({rows,bad:bad.length,examples:bad.slice(0,12)}));
assert(rows.every(r=>r.contactQueries>0),'Every ascent must receive a nonempty contact audit');
assert.equal(bad.length,0,'Tread ends must meet the actual closed side walls without air gaps');
