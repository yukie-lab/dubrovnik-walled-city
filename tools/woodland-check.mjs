import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import * as THREE from 'three';
import {mulberry32} from '../src/util.js';
import {WoodlandBuffer,woodStem,foliageLobe} from '../src/woodland-shape.js';
import {growPine,growCypress,growOlive,growMaquis} from '../src/woodland-growth.js';

export function closedGeometry(g,ranges=g.userData.closedParts) {
  const p=g.attributes.position,ix=g.index,n=g.attributes.normal;
  const v=i=>new THREE.Vector3().fromBufferAttribute(p,ix.getX(i));
  for(const part of ranges) {
    const edges=new Map();let volume=0;const origin=v(part.from*3);
    for(let i=part.from*3;i<part.to*3;i+=3) {
      const a=v(i),b=v(i+1),c=v(i+2),normal=b.clone().sub(a).cross(c.clone().sub(a));
      assert(normal.length()>1e-10,'No collapsed wood or foliage face');
      volume+=a.clone().sub(origin).dot(b.clone().sub(origin).cross(c.clone().sub(origin)))/6;
      const ids=[ix.getX(i),ix.getX(i+1),ix.getX(i+2)];
      for(let k=0;k<3;k++) {
        const a=ids[k],b=ids[(k+1)%3],key=a<b ? a+':'+b : b+':'+a,r=edges.get(key)||[0,0];
        r[0]++;r[1]+=a<b ? 1 : -1;edges.set(key,r);
      }
    }
    assert([...edges.values()].every(r=>r[0]===2 && r[1]===0),'Every cut end and foliage edge must close');
    assert(volume>0,'Outward-facing surface encloses positive volume');
  }
  for(let i=0;i<p.count;i++) {
    assert(Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i)));
    assert(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-5,'Unit surface normal');
  }
}

export function woodlandShapeChecks() {
let trees=0,vertices=0,triangles=0,parts=0;
for(const grow of [growPine,growCypress,growOlive,growMaquis])for(let seed=1;seed<=12;seed++) {
  const base=[283.2,17.09,842.12],B=new WoodlandBuffer();
  const h=grow(B,base,mulberry32(seed),{h:grow===growMaquis ? .55+seed*.07 : 3+seed,detail:seed%2 ? .2 : 1});
  const g=B.geometry();closedGeometry(g);
  assert.deepEqual(g.userData.trees[0].base,base);assert.deepEqual(g.userData.trees[0].roots[0],base,'First wood ring is anchored at the planting root');
  assert.equal(g.userData.trees[0].height,h);
  assert.equal(g.attributes.aTree.count,g.attributes.position.count);
  assert(g.boundingBox.max.y-base[1]<h*1.2,'Crown and twig scale follows original height');
  vertices+=g.attributes.position.count;triangles+=g.index.count/3;parts+=g.userData.closedParts.length;trees++;g.dispose();
}
// Cover horizontal and curved axes as well as upward growth.
for(const path of [[[0,0,0],[0,2,0]],[[0,0,0],[2,0,0]],[[0,0,0],[0,0,2]],[[0,0,0],[.1,1,.2],[.6,2,.5]]]) {
  const g=woodStem(path,path.map((_,i)=>.1-i*.02));closedGeometry(g,[{from:0,to:g.index.count/3}]);g.dispose();
}
for(let seed=1;seed<=20;seed++) {
  const g=foliageLobe([0,0,0],[1,.2,.7],mulberry32(seed));closedGeometry(g,[{from:0,to:g.index.count/3}]);g.dispose();
}
assert(vertices<triangles,'Indexed crowns must reduce submitted vertex storage');
console.log(JSON.stringify({trees,closedParts:parts,vertices,triangles,rooted:true}));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)woodlandShapeChecks();
