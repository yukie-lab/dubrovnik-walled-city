// Compare static detail selection against the accepted class, and drive Three's
// real upload-range handling against a small CPU-backed WebGL buffer store.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import * as THREE from 'three';
import {WebGLAttributes} from '../node_modules/three/src/renderers/webgl/WebGLAttributes.js';
import {StaticInstanceLOD} from '../src/instance-lod.js';

const baselineCommit='c6ae107';
const accepted=execFileSync('git',['show',`${baselineCommit}:src/instance-lod.js`],{encoding:'utf8'});
const start=accepted.indexOf('export class StaticInstanceLOD');
const end=accepted.indexOf('export function makeInstanceLOD',start);
assert(start>=0&&end>start,'Accepted source must contain the complete class and intersection helper');
const threeURL=new URL('../node_modules/three/build/three.module.js',import.meta.url).href;
const baselineModule=`import * as THREE from ${JSON.stringify(threeURL)};\n${accepted.slice(start,end)}`;
const {StaticInstanceLOD:AcceptedLOD}=await import(`data:text/javascript;base64,${Buffer.from(baselineModule).toString('base64')}`);
const results={baselineCommit,fixtures:0,selections:0,occlusionSelections:0,shadowSelections:0,
  initialUploads:0,partialUploads:0,partialUploadBytes:0,prefixShrinks:0,emptySelections:0,restorations:0};

function random(seed) {
  return ()=>{let t=seed+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
}

function fixture(count,{line=false,tailRows=false,deformed=false,transformed=false}={}) {
  const geometry=new THREE.BoxGeometry(.4,.25,.15),rnd=random(19790807);
  geometry.setAttribute('aSourceId',new THREE.InstancedBufferAttribute(Int32Array.from({length:count},(_,i)=>i),1));
  geometry.setAttribute('aDetail',new THREE.InstancedBufferAttribute(Float32Array.from({length:count*4},(_,i)=>(i%17-8)*.137),4));
  geometry.setAttribute('aPacked',new THREE.InstancedBufferAttribute(Uint8Array.from({length:count*2},(_,i)=>(i*73+11)%256),2,true));
  const mesh=new THREE.InstancedMesh(geometry,new THREE.MeshBasicMaterial(),count);
  mesh.castShadow=true;
  const matrix=new THREE.Matrix4(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3(),position=new THREE.Vector3();
  for(let i=0;i<count;i++) {
    position.set(line ? i*3 : (rnd()-.5)*150,line ? (tailRows&&i>=count/2 ? (i%2 ? 6 : -6) : 0) : rnd()*22,
      line ? -5 : (rnd()-.5)*170);
    quaternion.setFromEuler(new THREE.Euler(line ? 0 : rnd()*2,line ? 0 : rnd()*6,line ? 0 : rnd()*2));
    scale.set(line ? 1 : .15+rnd()*2,line ? 1 : .1+rnd()*1.5,line ? 1 : .2+rnd()*3);
    mesh.setMatrixAt(i,matrix.compose(position,quaternion,scale));
    mesh.setColorAt(i,new THREE.Color((i%13)/13,(i%29)/29,(i%47)/47));
  }
  if(deformed)mesh.userData.instanceBounds=(id,sphere)=>{
    sphere.center.set((id%9-4)*.35,(id%5)*.17,(id%7-3)*.22);sphere.radius=.13+(id%11)*.035;return sphere;
  };
  if(transformed) {
    const parent=new THREE.Group();parent.position.set(7,2,-9);parent.rotation.set(.05,.37,-.08);parent.scale.set(1.3,.8,.9);parent.add(mesh);
  }
  return mesh;
}

function simulatedGPU(lod) {
  let bound;
  const gl={ARRAY_BUFFER:34962,FLOAT:5126,UNSIGNED_INT:5125,INT:5124,UNSIGNED_BYTE:5121,
    createBuffer:()=>({array:null}),bindBuffer:(_type,buffer)=>{bound=buffer;},
    bufferData:(_type,array)=>{bound.array=array.slice();results.initialUploads++;},
    bufferSubData:(_type,offset,array,start=0,count=array.length)=>{
      bound.array.set(array.subarray(start,start+count),offset/array.BYTES_PER_ELEMENT);
      results.partialUploads++;results.partialUploadBytes+=count*array.BYTES_PER_ELEMENT;
    }};
  const buffers=WebGLAttributes(gl);
  return ()=>{
    for(const {attribute,size} of lod.streams) {
      for(const range of attribute.updateRanges)assert(Number.isInteger(range.start)&&Number.isInteger(range.count)
        &&range.start>=0&&range.count>0&&range.start+range.count<=attribute.array.length,'Ranges stay inside fixed-capacity attributes');
      buffers.update(attribute,gl.ARRAY_BUFFER);
      const device=buffers.get(attribute).buffer.array;
      assert.deepEqual(device.subarray(0,lod.mesh.count*size),attribute.array.subarray(0,lod.mesh.count*size),
        'GPU draw prefix includes every pending stream change');
    }
  };
}

function pair(count,options={}) {
  const current=new StaticInstanceLOD(fixture(count,options),{minPixels:.4,margin:.35});
  const previous=new AcceptedLOD(fixture(count,options),{minPixels:.4,margin:.35});
  assert.deepEqual(current.spheres,previous.spheres);
  assert.deepEqual(current.groupSpheres,previous.groupSpheres);
  assert.deepEqual(current.mesh.boundingSphere,previous.mesh.boundingSphere);
  const consume=simulatedGPU(current);results.fixtures++;
  return {current,previous,consume};
}

function compare({current,previous}) {
  const count=current.mesh.count;
  assert.equal(count,previous.mesh.count,'Selected count matches accepted selection');
  assert.deepEqual(current.ids.subarray(0,count),previous.ids.subarray(0,count),'Exact source IDs match accepted selection');
  for(let i=1;i<count;i++)assert(current.ids[i]>current.ids[i-1],'Primitive order stays in ascending source order');
  for(const [stream,{attribute,source,size}] of current.streams.entries()) {
    assert.equal(attribute.array.length,source.length,'Buffer capacity never changes');
    assert.deepEqual(attribute.array.subarray(0,count*size),previous.streams[stream].attribute.array.subarray(0,count*size));
    for(let slot=0;slot<count;slot++)assert.deepEqual(attribute.array.subarray(slot*size,(slot+1)*size),
      source.subarray(current.ids[slot]*size,(current.ids[slot]+1)*size),'All attributes retain the selected source identity');
  }
  assert.deepEqual(current.mesh.boundingSphere,previous.mesh.boundingSphere,'Original batch bound survives compaction');
}

function selection(p,args,{checkRanges=false}={}) {
  const oldCount=p.current.mesh.count,oldIds=p.current.ids.slice();
  const state=p.current.streams.map(({attribute})=>({version:attribute.version,ranges:attribute.updateRanges.map(r=>({...r}))}));
  p.previous.update(...args);p.current.update(...args);compare(p);results.selections++;
  if(args[5])results.occlusionSelections++;
  if(args[1])results.shadowSelections++;
  if(!p.current.mesh.count)results.emptySelections++;
  if(checkRanges) {
    const count=p.current.mesh.count;
    // Slots outside the previous draw prefix still hold valid source data. A
    // prefix can regrow without writes when that unchanged tail is reused.
    let first=0;while(first<count&&p.current.ids[first]===oldIds[first])first++;
    const writes=first<count;
    if(!writes&&count<oldCount)results.prefixShrinks++;
    for(const [stream,{attribute,size}] of p.current.streams.entries()) {
      const before=state[stream];
      assert.deepEqual(attribute.updateRanges.slice(0,before.ranges.length),before.ranges,'Pending ranges survive subsequent selections');
      if(!writes) {
        assert.equal(attribute.version,before.version,'Count-only shrink or stable selection must not schedule an upload');
        assert.deepEqual(attribute.updateRanges,before.ranges);
      } else {
        assert.equal(attribute.version,before.version+1);
        assert.deepEqual(attribute.updateRanges.slice(before.ranges.length),[{start:first*size,count:(count-first)*size}],
          'Only the changed suffix is scheduled, in attribute components');
      }
    }
  }
}

function restore(p) {
  p.previous.restore();p.current.restore();compare(p);results.restorations++;
  for(const {attribute,source} of p.current.streams)assert.deepEqual(attribute.array,source,'Restoration recovers the entire original stream');
}

const reject=[new THREE.Plane(new THREE.Vector3(1,0,0),-1e8)];
const linePlanes=(from,to)=>[new THREE.Plane(new THREE.Vector3(1,0,0),-from*3+1),
  new THREE.Plane(new THREE.Vector3(-1,0,0),to*3+1)];
const lineArgs=(from,to)=>[linePlanes(from,to),null,new THREE.Vector3(),500,0];
const line=pair(64,{line:true});
// No renderer has consumed these changes yet. Its first bufferData must upload
// the entire current capacity, regardless of the queued partial update ranges.
selection(line,lineArgs(8,47),{checkRanges:true});
selection(line,lineArgs(4,55),{checkRanges:true});line.consume();
selection(line,lineArgs(4,47),{checkRanges:true});line.consume();
// Separate suffix writes accumulate before a render. Keep an unchanged prefix,
// grow its tail, then change the prefix so the two upload ranges overlap.
selection(line,lineArgs(4,55),{checkRanges:true});
selection(line,lineArgs(4,59),{checkRanges:true});
selection(line,lineArgs(7,62),{checkRanges:true});line.consume();
selection(line,lineArgs(7,62),{checkRanges:true});
selection(line,[reject,null,new THREE.Vector3(),500,0],{checkRanges:true});
selection(line,lineArgs(2,12),{checkRanges:true});line.consume();
selection(line,lineArgs(8,22),{checkRanges:true});restore(line);line.consume();
const stableVersions=line.current.streams.map(s=>s.attribute.version);
restore(line);assert.deepEqual(line.current.streams.map(s=>s.attribute.version),stableVersions);
selection(line,lineArgs(0,31),{checkRanges:true});line.consume();restore(line);line.consume();

// An interior removal changes only the tail, rather than the whole draw prefix.
const suffix=pair(64,{line:true,tailRows:true});suffix.consume();
const scheduledBytesBefore=results.partialUploadBytes;
selection(suffix,[[new THREE.Plane(new THREE.Vector3(0,-1,0),2)],null,new THREE.Vector3(),500,0],{checkRanges:true});
assert.equal(suffix.current.mesh.count,48);
assert.equal(suffix.current.streams[0].attribute.updateRanges[0].start,33*16);
suffix.consume();
const changedSuffixBytes=results.partialUploadBytes-scheduledBytesBefore;
const oldSelectedPrefixBytes=suffix.current.streams.reduce((bytes,{size,attribute})=>bytes+48*size*attribute.array.BYTES_PER_ELEMENT,0);
const oldFullBufferUploadBytes=suffix.current.streams.reduce((bytes,{source})=>bytes+source.byteLength,0);
assert(changedSuffixBytes<oldSelectedPrefixBytes*.4,'Interior removal uploads only the suffix following the first moved source');
results.interiorRemoval={changedSuffixBytes,oldSelectedPrefixBytes,oldFullBufferUploadBytes};
selection(suffix,[[new THREE.Plane(new THREE.Vector3(0,1,0),2)],null,new THREE.Vector3(),500,0],{checkRanges:true});
restore(suffix);suffix.consume();

function frustum(camera) {
  camera.updateMatrixWorld();
  return new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)).planes;
}
const occlusion={blocked:(cx,cy,cz,x,y,z,r)=>{
  // A finite vertical slab between the ray's endpoints. It is intentionally
  // conservative at group level, as production's group visibility is.
  if((cx+12)*(x+12)>=0)return false;
  const t=(-12-cx)/(x-cx),hitY=cy+(y-cy)*t,hitZ=cz+(z-cz)*t;
  return hitY+r<15&&Math.abs(hitZ)+r<46;
}};
for(const options of [{},{deformed:true},{deformed:true,transformed:true}]) {
  const p=pair(320,options),rnd=random(88731);
  p.consume();
  for(let turn=0;turn<192;turn++) {
    const camera=turn%4===0 ? new THREE.OrthographicCamera(-35,35,24,-24,.1,350)
      : new THREE.PerspectiveCamera(25+rnd()*70,.8+rnd()*1.2,.1,350);
    camera.position.set((rnd()-.5)*140,3+rnd()*35,(rnd()-.5)*170);
    camera.lookAt((rnd()-.5)*60,rnd()*12,(rnd()-.5)*60);
    const shadowView=new THREE.OrthographicCamera(-20-rnd()*60,20+rnd()*60,20+rnd()*40,-20-rnd()*40,.1,300);
    shadowView.position.set((rnd()-.5)*90,20+rnd()*100,(rnd()-.5)*90);shadowView.lookAt(0,0,0);
    const viewPlanes=frustum(camera),shadowPlanes=frustum(shadowView);
    const target=turn%p.current.capacity,o=target*4,s=p.current.spheres;
    const near=Math.max(.01,Math.hypot(s[o]-camera.position.x,s[o+1]-camera.position.y,s[o+2]-camera.position.z)-s[o+3]);
    const epsilon=[1-1e-12,1,1+1e-12][turn%3];
    const pixelScale=turn%5===0 ? p.current.minPixels*near/(2*s[o+3])*epsilon : 50+rnd()*900;
    const shadowPixelScale=turn%7===0 ? p.current.minPixels/(2*s[o+3])*epsilon : .03+rnd()*35;
    const hasShadow=turn%6!==0;
    p.current.mesh.castShadow=p.previous.mesh.castShadow=turn%11!==0;
    selection(p,[viewPlanes,hasShadow ? shadowPlanes : null,camera.position,pixelScale,shadowPixelScale,
      turn%3===0 ? occlusion : null,turn%4===0 ? null : shadowView],{checkRanges:true});
    if(turn%4===3)p.consume();
    if(turn%31===30){restore(p);p.consume();}
  }
  p.consume();restore(p);p.consume();
}

// Exact cutoff equality and near-camera clamping, using a single visible detail.
const edge=pair(1,{line:true});edge.consume();
const radius=edge.current.spheres[3],position=new THREE.Vector3(0,0,-5),min=edge.current.minPixels;
for(const factor of [1-1e-12,1,1+1e-12]) {
  selection(edge,[[],null,position,min*.01/(2*radius)*factor,0],{checkRanges:true});
  selection(edge,[reject,[],position,0,min/(2*radius)*factor],{checkRanges:true});
}
edge.consume();restore(edge);edge.consume();

// A fully retained shadow batch must avoid camera-distance work altogether.
const shadowOnly=pair(256,{line:true});
const originalHypot=Math.hypot;
function hypotCalls(lod) {
  let calls=0;Math.hypot=(...values)=>{calls++;return originalHypot(...values);};
  try {lod.update(reject,[],new THREE.Vector3(1e6,1e6,1e6),0,100);}finally {Math.hypot=originalHypot;}
  return calls;
}
const oldDistanceCalls=hypotCalls(shadowOnly.previous),newDistanceCalls=hypotCalls(shadowOnly.current);
compare(shadowOnly);assert.equal(oldDistanceCalls,256);assert.equal(newDistanceCalls,0);
results.shadowOnlyDistanceCalls={before:oldDistanceCalls,after:newDistanceCalls};
results.exactSourceIds=true;results.exactAllInstanceAttributes=true;results.customBounds=true;
results.pendingRangeConsumption=true;results.initialFullUpload=true;results.cutoffEquality=true;
console.log(JSON.stringify(results));
