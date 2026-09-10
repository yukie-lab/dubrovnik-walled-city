import { ShaderChunk } from 'three';

// Small curved receivers expose the screen-space grain in five rotated PCF
// samples. Integrate the same disk with sixteen fixed samples. This changes
// neither the shadow map nor its world-space radius and never touches the sea.
const finePCF = ShaderChunk.shadowmap_pars_fragment.replace(
  /float phi = interleavedGradientNoise\( gl_FragCoord.xy \) \* PI2;[\s\S]*?\) \* 0\.2;/,
  `shadow = 0.0;
    for(int tap=0;tap<16;tap++) shadow += texture(shadowMap,
      vec3(shadowCoord.xy + vogelDiskSample(tap,16,0.4) * radius,shadowCoord.z));
    shadow *= 0.0625;`,
);
const twoSidedBias = ShaderChunk.shadowmap_vertex.replace(
  'shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias',
  `shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias
    * ((directionalShadowMatrix[ i ] * vec4(shadowWorldNormal,0.0)).z > 0.0 ? -1.0 : 1.0)`,
);

export function patchDetailShadows(material,{twoSided=false}={}) {
  const before=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.onBeforeCompile=(shader,renderer)=>{
    before?.(shader,renderer);
    shader.fragmentShader=shader.fragmentShader.replace('#include <shadowmap_pars_fragment>',finePCF);
    // A thin leaf has two receiving faces. Bias towards the light-facing
    // hemisphere, determined by the actual shadow matrix (also correct at
    // night), rather than pushing one side through its own shadow surface.
    if(twoSided)shader.vertexShader=shader.vertexShader.replace('#include <shadowmap_vertex>',twoSidedBias);
  };
  material.customProgramCacheKey=()=>key+`|detailPCF-v1:${twoSided}`;
  return material;
}
