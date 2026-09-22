import {chainMaterialShader} from './material-patch.js';
// Effective red/green/blue transport bands. beta is the volume scattering
// coefficient toward the viewer [m^-1 sr^-1], not a displayed water colour.
// With a homogeneous water column, source radiance is E * beta / extinction;
// sea.js integrates it as (1-exp(-extinction*path)) and transmits the bottom.
export const WATER_BASELINE=Object.freeze({
  extinction:Object.freeze([1,.16,.03]),
  backscatter:Object.freeze([.001155,.00075,.00063]),
  bottomAlbedo:.30,
});
export const WATER_DEFAULTS=Object.freeze({
  extinction:Object.freeze([1,.22,.09]),
  backscatter:Object.freeze([.00002,.00004,.00008]),
  bottomAlbedo:.30,
});

export function makeWaterOptics(sea) {
  const state={extinction:[...WATER_DEFAULTS.extinction],backscatter:[...WATER_DEFAULTS.backscatter],bottomAlbedo:WATER_DEFAULTS.bottomAlbedo};
  const bottomUniform={value:1};
  const snapshot=()=>({extinction:[...state.extinction],backscatter:[...state.backscatter],bottomAlbedo:state.bottomAlbedo});
  const listeners=new Set();
  function set(change) {
    const next=snapshot();
    for(const key of ['extinction','backscatter'])if(change[key]!==undefined) {
      const a=change[key];
      if(!Array.isArray(a)||a.length!==3||a.some(v=>!Number.isFinite(v)||v<(key==='extinction'?1e-5:0)))
        throw new Error('Expected three finite nonnegative water coefficients: '+key);
      next[key]=a.slice();
    }
    if(change.bottomAlbedo!==undefined) {
      if(!Number.isFinite(change.bottomAlbedo)||change.bottomAlbedo<0||change.bottomAlbedo>1)
        throw new Error('Bottom diffuse albedo must be between zero and one');
      next.bottomAlbedo=change.bottomAlbedo;
    }
    Object.assign(state,next);sea.uniforms.uSigma.value.fromArray(state.extinction);
    bottomUniform.value=state.bottomAlbedo/WATER_BASELINE.bottomAlbedo;
    for(const fn of listeners)fn(snapshot());return snapshot();
  }
  function illuminate(irradiance) {
    const s=sea.uniforms.uInscat.value;
    s.set(irradiance.r*state.backscatter[0]/state.extinction[0],
      irradiance.g*state.backscatter[1]/state.extinction[1],
      irradiance.b*state.backscatter[2]/state.extinction[2]);
  }
  function bindBottomMaterials(scene) {
    const materials=new Set();
    scene.traverse(o=>{if(o.isMesh&&o.userData.terrain&&o.material)materials.add(o.material);});
    for(const material of materials) {
      chainMaterialShader(material,'water-bottom-albedo-v1',shader=>{
        shader.uniforms.uBottomAlbedoScale=bottomUniform;
        shader.vertexShader=shader.vertexShader.replace('#include <common>',
          '#include <common>\nvarying float vBottomHeight;')
          .replace('#include <worldpos_vertex>',
            '#include <worldpos_vertex>\nvBottomHeight=(modelMatrix*vec4(transformed,1.0)).y;');
        // Change diffuse reflectance before any illumination or BRDF, only on
        // submerged terrain. Existing rock/vegetation texture variation stays.
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
          '#include <common>\nuniform float uBottomAlbedoScale;varying float vBottomHeight;')
          .replace('#include <lights_physical_fragment>',
            'if(uBottomAlbedoScale!=1.0&&vBottomHeight<0.0) diffuseColor.rgb=mix(diffuseColor.rgb,clamp(diffuseColor.rgb*uBottomAlbedoScale,0.0,1.0),smoothstep(0.0,-.08,vBottomHeight));\n#include <lights_physical_fragment>');
      });
      material.needsUpdate=true;
    }
    return materials.size;
  }
  const api={get values(){return snapshot();},set,illuminate,bindBottomMaterials,bottomUniform,
    reset:()=>set(WATER_DEFAULTS),baseline:()=>set(WATER_BASELINE),
    subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);}};
  set(WATER_DEFAULTS);
  if(typeof window!=='undefined'&&typeof location!=='undefined') {
    // Keep the existing console interface usable. It must address the live
    // transport state, not a construction-time scattering snapshot.
    window.__waterOptics=api;
    const old=window.__sea;
    window.__sea={...old,
      get sigma(){const [r,g,b]=state.extinction;return {r,g,b};},
      get inscat(){const v=sea.uniforms.uInscat.value;return {r:v.x,g:v.y,b:v.z};},
      set(o={}){const [r,g,b]=state.extinction;set({extinction:[o.r??r,o.g??g,o.b??b]});return this.sigma;},
      reset(){api.reset();return this.sigma;},
      before(){api.baseline();return this.sigma;},
    };
  }
  return api;
}
