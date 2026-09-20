import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {hash2} from '../src/util.js';
import {WINDOW_OPENING} from '../src/window-joinery.js';
import {runoffPixels,RUNOFF_IMAGE} from '../src/window-runoff.js';
import {installDomShim} from './structure/domshim.mjs';

const sha=a=>createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const baseline=JSON.parse(readFileSync(new URL('../docs/september-weather-baseline.json',import.meta.url),'utf8'));
installDomShim();const {buildWorld}=await import('../src/world.js');
const world=buildWorld({life:false,sky:false,sea:false}),windows=world.buildings.windows;
const frames=world.root.getObjectByName('window.frame'),runoff=world.root.getObjectByName('window.runoff');
assert(runoff,'The live world must use the runoff batch');assert.equal(runoff.count,baseline.streakInstances);
assert.equal(windows.length,baseline.windows);assert.equal(world.root.getObjectByName('house.grimeBand').count,baseline.grimeBands);
assert.equal(sha(world.root.getObjectByName('window.litPane').instanceMatrix.array),baseline.litMatrixSha,'Night window placements changed');
const list=windows.map((w,i)=>({w,i})).filter(({w})=>hash2((w.x*31)|0,(w.y*29)|0)<.62);
const range=frames.geometry.userData.windowParts.find(p=>p.name==='drip'),positions=frames.geometry.attributes.position;
const matrix=new THREE.Matrix4(),vertex=new THREE.Vector3(),oldMatrices=runoff.instanceMatrix.array.slice();
let maxAttachmentGapM=0;const traits=runoff.geometry.attributes.aRunoffTraits,uniqueTraits=new Set();
list.forEach(({w,i},j)=>{
  frames.getMatrixAt(i,matrix);let bottom=Infinity;
  for(let k=range.from*3;k<range.to*3;k++)bottom=Math.min(bottom,vertex.fromBufferAttribute(positions,k).applyMatrix4(matrix).y);
  const gap=Math.abs(runoff.instanceMatrix.array[j*16+13]-bottom);
  maxAttachmentGapM=Math.max(maxAttachmentGapM,gap);
  assert(gap<4e-6,'Runoff is disconnected from the actual drip solid');
  // Restore ONLY the former source-height formula. Equality with the archived
  // matrix digest proves all other translation, scale, rotation and order bits
  // remain identical to the previous generation, across all 1,183 instances.
  const scale=w.big ? 1.42 : w.small ? .84+w.seed*.10 : (w.fl===1?1.12:.92)+w.seed*.17;
  const aspect=w.big?1:.94+hash2((w.x*41)|0,(w.z*37+w.y*3)|0)*.13;
  oldMatrices[j*16+13]=w.y-(WINDOW_OPENING.height/2+.20)*scale/aspect;
  const values=[traits.getX(j),traits.getY(j),traits.getZ(j),traits.getW(j)];
  assert(values.every(Number.isFinite));assert(values[0]!==values[1]);
  assert(values.slice(0,2).every(v=>Number.isInteger(v)&&v>=0&&v<RUNOFF_IMAGE.layers));
  uniqueTraits.add(values.join(','));
});
assert.equal(sha(oldMatrices),baseline.streakMatrixSha,'Runoff changed beyond its attachment height');
assert.equal(uniqueTraits.size,runoff.count,'Runoff variations repeat exactly');
const atlas=runoff.material.userData.runoffAtlas,a=atlas.image.data,{width:w,height:h,layers}=RUNOFF_IMAGE;
assert.equal(sha(a),sha(runoffPixels()),'Runoff depends on a shared RNG stream');
const layerHashes=new Set();let maxEdgeAlpha=0,minTopCoverage=Infinity,maxTopCoverage=0;
for(let layer=0;layer<layers;layer++) {
  const bytes=w*h*4,base=layer*bytes;layerHashes.add(sha(a.subarray(base,base+bytes)));
  let topCoverage=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const alpha=a[base+(y*w+x)*4+3];
    if(x===0||x===w-1||y===h-1)maxEdgeAlpha=Math.max(maxEdgeAlpha,alpha);
    if(y===0&&alpha>0)topCoverage++;
  }
  minTopCoverage=Math.min(minTopCoverage,topCoverage);maxTopCoverage=Math.max(maxTopCoverage,topCoverage);
}
assert.equal(layerHashes.size,layers);assert.equal(maxEdgeAlpha,0);assert(minTopCoverage>0);
assert(atlas.isDataArrayTexture&&atlas.generateMipmaps);assert.equal(atlas.minFilter,THREE.LinearMipmapLinearFilter);
const report={windows:windows.length,runoff:runoff.count,uniqueTraits:uniqueTraits.size,maxAttachmentGapM,
  formerPlacementSha:sha(oldMatrices),textureBytes:a.length,layers,distinctLayers:layerHashes.size,
  textureSha:sha(a),maxEdgeAlpha,minTopCoverage,maxTopCoverage};
console.log(JSON.stringify(report,null,2));
writeFileSync(new URL('../shots/rendercheck/sept24-runoff-geometry.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
