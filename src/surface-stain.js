import * as THREE from 'three';
import {chainMaterialShader} from './material-patch.js';

// A stain is an attenuation coefficient on the already lit, fogged surface.
// Fog colour must never be blended into that coefficient: even alpha-zero
// texels would then darken the background across the entire decal rectangle.
export function multiplyStain(material) {
  material.blending=THREE.CustomBlending;
  material.blendSrc=THREE.DstColorFactor;
  material.blendDst=THREE.ZeroFactor;
  material.toneMapped=false;
  chainMaterialShader(material,'surface-stain-transmittance-v1',shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
      float stainVisibility=1.0;
      #ifdef USE_FOG
        #ifdef FOG_EXP2
          stainVisibility=exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
        #else
          stainVisibility=1.0-smoothstep(fogNear,fogFar,vFogDepth);
        #endif
      #endif
      gl_FragColor=vec4(mix(vec3(1.0),diffuseColor.rgb,diffuseColor.a*stainVisibility),1.0);
    `).replace('#include <fog_fragment>','');
  });
  return material;
}
