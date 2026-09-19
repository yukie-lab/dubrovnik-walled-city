import assert from 'node:assert/strict';
import * as THREE from 'three';
import {chainMaterialShader} from '../src/material-patch.js';
import {patchSkyVis,patchSkyVisInstanced} from '../src/skyvis.js';
import {patchWet} from '../src/wet.js';

// Equal standard-material flags used to hide distinct upstream shaders behind
// a common sky-visibility / shoreline wrapper. Test both shared patch paths.
for(const sky of [patchSkyVis,patchSkyVisInstanced]) {
  const build=(id,uniform)=>{
    const material=new THREE.MeshStandardMaterial();
    chainMaterialShader(material,id,function(shader) {
      assert.equal(this,material,'Material callbacks keep their receiver');
      shader.uniforms.fixture=uniform;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>\ntransformed.x += ${id==='bendA'?'.12':'.24'};`);
    });
    sky(material);patchWet(material,{foam:.35});
    return material;
  };
  const a=build('bendA',{value:1}),b=build('bendB',{value:1}),same=build('bendA',{value:2});
  assert.notEqual(a.customProgramCacheKey(),b.customProgramCacheKey(),'Distinct source programs survive both common wrappers');
  assert.equal(a.customProgramCacheKey(),same.customProgramCacheKey(),'Uniform values do not needlessly split identical GPU programs');
  for(const material of [a,b,same]) {
    const shader={...THREE.ShaderLib.standard,uniforms:THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms)};
    material.onBeforeCompile(shader,{});
    assert(shader.vertexShader.includes('transformed.x +='));
    assert(shader.fragmentShader.includes('reflectedLight.indirectDiffuse'));
    assert(shader.fragmentShader.includes('wetWaterLine(vWetP.xz)'));
    assert.equal(shader.uniforms.fixture.value,material===same?2:1);
  }
}
console.log('Material program identity, callback composition and per-material uniforms passed');
