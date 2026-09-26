import * as THREE from 'three';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {chainMaterialShader} from './material-patch.js';
import {exposureForIlluminance} from './atmosphere-model.js';

// Half-float targets cannot retain the small scene units of shaded moonlit
// stone. Store radiance in power-of-two units, then undo that scale wherever
// absolute radiance is needed. Lights, reflectance and exposure do not change.
export function radianceStorageScale(illuminance) {
  return 2**Math.max(0,Math.min(13,Math.floor(Math.log2(exposureForIlluminance(illuminance)))));
}

export function patchRadianceStorage(material,uniform) {
  if(!material||material.isMeshDepthMaterial||material.isMeshDistanceMaterial)return false;
  // Multiplicative stains write transmittance, not radiance. Scaling that
  // coefficient would multiply the underlying image a second time.
  if(material.blending===THREE.MultiplyBlending||
    (material.blending===THREE.CustomBlending&&material.blendSrc===THREE.DstColorFactor&&material.blendDst===THREE.ZeroFactor))return false;
  chainMaterialShader(material,'radiance-storage-v1',shader=>{
    shader.uniforms.uRadianceScale=uniform;
    const main=/void\s+main\s*\(\s*\)\s*\{/;
    if(!main.test(shader.fragmentShader))throw new Error('Missing colour shader main for radiance storage');
    // Wrap main so custom shaders' early diagnostic returns are scaled too.
    shader.fragmentShader='uniform float uRadianceScale;\n'+shader.fragmentShader.replace(main,'void radianceMain() {')+
      '\nvoid main(){radianceMain();gl_FragColor.rgb*=uRadianceScale;}\n';
  });
  material.needsUpdate=true;return true;
}

export class RadianceOutputPass extends OutputPass {
  constructor(scale){super();this.scale=scale;}
  render(renderer,writeBuffer,readBuffer,...args) {
    const exposure=renderer.toneMappingExposure;
    renderer.toneMappingExposure=exposure/this.scale.value;
    try{super.render(renderer,writeBuffer,readBuffer,...args);}
    finally{renderer.toneMappingExposure=exposure;}
  }
}

export function makeRadianceStorage(scene,sea) {
  const scale={value:1},materials=new Set();let patched=0;
  scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)materials.add(m);});
  for(const material of materials)if(patchRadianceStorage(material,scale))patched++;
  // Refraction and screen-space reflection consume the underwater buffer in
  // physical units. Only its storage changes; the protected water optics do not.
  chainMaterialShader(sea.mesh.material,'underwater-radiance-units-v1',shader=>{
    const source=shader.fragmentShader;
    if((source.match(/texture2D\(tScene,/g)||[]).length!==3)throw new Error('Underwater radiance interface changed');
    shader.fragmentShader=source.replace(/texture2D\(tScene,\s*(\w+)\)\.rgb/g,
      '(texture2D(tScene,$1).rgb/uRadianceScale)');
  });
  return {scale,materials:patched,update(illuminance){scale.value=radianceStorageScale(illuminance);}};
}
