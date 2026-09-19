import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createHash} from 'node:crypto';
import {metricMasonryUV,anchoredQuadUV,connectMasonryCharts,planarMasonryUV} from '../src/masonry-uv.js';

const hash=a=>createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
function ratios(g,coverM) {
  const p=g.attributes.position,uv=g.attributes.uv,ix=g.index,a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),out=[];
  for(let k=0;k<(ix?.count||p.count);k+=3) {
    const [i,j,l]=[0,1,2].map(d=>ix ? ix.getX(k+d) : k+d);
    a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,j).sub(a);c.fromBufferAttribute(p,l).sub(a);
    const area=b.cross(c).length(),ua=Math.abs((uv.getX(j)-uv.getX(i))*(uv.getY(l)-uv.getY(i))-(uv.getX(l)-uv.getX(i))*(uv.getY(j)-uv.getY(i)));
    if(area>1e-9)out.push(Math.sqrt(area/ua)/coverM);
  }
  return out;
}
for(const g of [new THREE.BoxGeometry(.09,.26,.09),new THREE.BoxGeometry(15,3.2,.6),new THREE.CylinderGeometry(.185,.185,2.2,12)]) {
  g.rotateY(.71);g.rotateZ(.23);g.translate(127,18,-130);
  const before={position:hash(g.attributes.position.array),normal:hash(g.attributes.normal.array),index:hash(g.index.array)};
  metricMasonryUV(g,3.2);const r=ratios(g,3.2);
  assert.equal(hash(g.attributes.position.array),before.position);
  assert.equal(hash(g.attributes.normal.array),before.normal);assert.equal(hash(g.index.array),before.index);
  assert(r.every(v=>Math.abs(v-1)<.002),'Rotated / translated solid surface retains metre-scale UVs');
  console.log(g.type,{triangles:r.length,min:Math.min(...r),max:Math.max(...r)});
}

// Skinny raking faces must have an orthonormal chart even when both of their
// world axes slope. This is the failure normalised 0..1 quads used to hide.
const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,2,1,0,2,1,.09,0,0,.09],3));
g.setIndex([0,2,1,0,3,2]);g.computeVertexNormals();g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,1,1,0,1],2));
metricMasonryUV(g,4.2);assert(ratios(g,4.2).every(v=>Math.abs(v-1)<1e-5));
console.log('Raking stone metric / topology preservation passed');

const chartTransform=new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(.18,.47,.23));
chartTransform.setPosition(127,18,-130);
const point=(x,y)=>new THREE.Vector3(x,y,0).applyMatrix4(chartTransform).toArray();
const left=anchoredQuadUV(point(0,0),point(2,0),point(2,3),point(0,3),1/4.2),
  right=anchoredQuadUV(point(2,0),point(5,0),point(5,3),point(2,3),1/4.2);
for(const [a,b] of [[2,0],[3,1],[4,6],[5,7]])assert(Math.abs(left[a]-right[b])<1e-10,'Adjacent pieces share exactly the same stone at both ends of their seam');
assert(Math.abs(left[2]-left[0]-2/4.2)<1e-12,'Anchoring keeps the existing metric width');
assert(Math.abs(right[7]-right[1]-3/4.2)<1e-12,'Anchoring keeps the existing metric height');
assert(anchoredQuadUV(point(0,0),point(0,0),point(2,3),point(0,3),1/4.2).every(Number.isFinite),'Collapsed triangle edges do not make invalid UVs');
console.log('Anchored charts: rotated adjacent seams, metric scale and collapsed edges passed');

// Exercise the stored Float32 UV stream, including the very slight twist made
// by interpolating a battered wall profile between differently mitered ends.
function connected(points,scales=points.map(()=>1/4.2)) {
  const values=[],charts=points.map((p,i)=>{
    const a=new THREE.Vector3(...p[0]),b=new THREE.Vector3(...p[1]),c=new THREE.Vector3(...p[2]),d=new THREE.Vector3(...p[3]);
    const normal=b.clone().sub(a).cross(c.clone().sub(a)).add(c.sub(a).cross(d.sub(a))).normalize().toArray();
    const offset=values.length;values.push(...anchoredQuadUV(...p,scales[i]));
    return {p,scale:scales[i],normal,offset};
  });
  const before=values.slice(),stats=connectMasonryCharts(charts,values);
  return {uv:new Float32Array(values),before,stats};
}
const p1=[[-2,0,0],[0,0,0],[0,3,0],[-2,3,.0009]],p2=[[0,0,0],[2,0,0],[2,3,-.0009],[0,3,0]];
const transform=p=>new THREE.Vector3(...p).applyMatrix4(chartTransform).toArray();
const connectedPair=connected([p1.map(transform),p2.map(transform)]);
assert.equal(connectedPair.stats.joinedCharts,2);
for(const [a,b] of [[2,8],[3,9],[4,14],[5,15]])assert.equal(connectedPair.uv[a],connectedPair.uv[b],'Twisted subdivisions retain exactly matching Float32 seam coordinates');
const separate=connected([p1.map(transform),p2.map(transform)],[1/4.2,1/3.2]);
assert.equal(separate.stats.joinedCharts,0,'Distinct physical texture scales do not share a chart');
const corner=connected([p1,[[0,0,0],[0,0,2],[0,3,2],[0,3,0]]]);
assert.equal(corner.stats.joinedCharts,0,'A solid corner keeps separate face charts');
// A cylinder with extremely fine tessellation qualifies as nearly coplanar at
// every single seam. Transitive grouping must not collapse its circumference.
const slices=8192,cylinder=Array.from({length:slices},(_,i)=>{
  const a=i/slices*Math.PI*2,b=(i+1)/slices*Math.PI*2;
  return [[Math.cos(a),0,Math.sin(a)],[Math.cos(b),0,Math.sin(b)],
    [Math.cos(b),2,Math.sin(b)],[Math.cos(a),2,Math.sin(a)]];
});
const curved=connected(cylinder);
assert.equal(curved.stats.curvedGroups,1);assert.equal(curved.stats.joinedCharts,0);
assert(curved.uv.every(Number.isFinite));
console.log('Connected charts: Float32 seam continuity, scale / corner isolation and curvature bound passed');

const capNormal=new THREE.Vector3(0,0,1).transformDirection(chartTransform).toArray();
const capA=[point(0,0),point(4,.2),point(2,7)],capB=[point(0,0),point(2,7),point(-1,5)];
const uvA=planarMasonryUV(capA,capNormal,1/4.2),uvB=planarMasonryUV(capB,capNormal,1/4.2);
for(const [a,b] of [[0,0],[1,1],[4,2],[5,3]])assert.equal(uvA[a],uvB[b],'Different fan spokes share one plane chart');
const capGeo=new THREE.BufferGeometry();capGeo.setAttribute('position',new THREE.Float32BufferAttribute(capA.flat(),3));
capGeo.setAttribute('uv',new THREE.Float32BufferAttribute(uvA,2));
assert(ratios(capGeo,4.2).every(v=>Math.abs(v-1)<1e-5));
console.log('Triangulated end caps: shared chart and physical metric scale passed');
