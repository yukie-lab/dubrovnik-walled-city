import * as THREE from 'three';
import {chainMaterialShader} from './material-patch.js';

// Stable local-light slots avoid recompiling the whole city as lamps enter or
// leave range. A uniform zero-radiance branch avoids evaluating their BRDFs.
// Nonzero lamps use the original Three code, without changing attenuation.
const chunk=THREE.ShaderChunk.lights_fragment_begin;
const pointStart=chunk.indexOf('\t\tpointLight = pointLights[ i ];');
const pointEnd=chunk.indexOf('\n\t}',pointStart);
if(pointStart<0||pointEnd<pointStart)throw new Error('Point-light shader interface changed');
const point=chunk.slice(pointStart,pointEnd);
const guarded=point.replace('pointLight = pointLights[ i ];',
  'pointLight = pointLights[ i ];\n\t\tif(any(notEqual(pointLight.color,vec3(0.0)))) {')+'\n\t\t}';
const lights=chunk.slice(0,pointStart)+guarded+chunk.slice(pointEnd);
const patched=new WeakSet();
export function skipInactiveLocalLights(material) {
  if(!material||patched.has(material))return;patched.add(material);
  chainMaterialShader(material,'inactive-point-lights-v1',shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',lights);
  });
  material.needsUpdate=true;
}
