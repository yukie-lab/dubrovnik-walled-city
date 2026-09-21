import {chainMaterialShader} from './material-patch.js';
import {ShaderChunk} from 'three';

// Height is relative to this flight's own masonry bed. The patina follows the
// hand and damp joints through turns, independently of absolute city height.
export function patchWallStairFinish(material,stone) {
  return chainMaterialShader(material,'stairWallPatina-v2',sh=>{
    sh.uniforms.uStairCopingMap={value:stone.map};
    sh.uniforms.uStairCopingNormal={value:stone.normalMap};
    sh.uniforms.uStairCopingCover={value:stone.coverM};
    sh.vertexShader=sh.vertexShader.replace('#include <common>',
      '#include <common>\nattribute vec3 aStairWall; attribute vec2 aStairStone; varying vec3 vStairWall; varying vec3 vStairPoint; varying vec2 vStairStone;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvStairWall=aStairWall;vStairPoint=position;vStairStone=aStairStone;');
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>',
      `#include <common>
       varying vec3 vStairWall; varying vec3 vStairPoint; varying vec2 vStairStone;
       uniform sampler2D uStairCopingMap; uniform sampler2D uStairCopingNormal; uniform float uStairCopingCover;`)
      .replace('#include <map_fragment>',`#include <map_fragment>
        if(vStairStone.x>.5){
          float grain=wnNoise(vMapUv*61.0),mineral=wnNoise(vMapUv*8.1);
          diffuseColor.rgb=texture2D(uStairCopingMap,vMapUv/uStairCopingCover).rgb*.80;
          diffuseColor.rgb*=1.0+.14*(mineral-.5)-.07*vStairStone.y;
          diffuseColor.rgb*=1.0-.10*smoothstep(.72,.90,grain)*(1.0-vStairStone.y);
        }
        if(vStairWall.x>.5){
          float irregular=wnNoise(vStairPoint.xz*4.1+vStairPoint.y*.73);
          float hand=exp(-pow((vStairWall.y-1.03)/.24,2.0))*vStairWall.z*(.28+.72*irregular);
          float damp=exp(-max(0.0,vStairWall.y)*4.5)*(.3+.7*irregular);
          diffuseColor.rgb*=1.0-.21*hand-.18*damp;
          diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.76,.85,.65),damp*.24);
        }`)
      .replace('#include <normal_fragment_maps>',ShaderChunk.normal_fragment_maps.replaceAll(
        'texture2D( normalMap, vNormalMapUv ).xyz',
        'mix(texture2D(normalMap,vNormalMapUv).xyz,mix(texture2D(uStairCopingNormal,vNormalMapUv/uStairCopingCover).xyz,vec3(.5,.5,1.0),.68*vStairStone.y),min(1.0,vStairStone.x))'))
      .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
        if(vStairWall.x>.5){
          float hand=exp(-pow((vStairWall.y-1.03)/.24,2.0))*vStairWall.z;
          roughnessFactor*=1.0-.19*hand;
        }
        roughnessFactor=mix(roughnessFactor,mix(.85,.48,vStairStone.y),min(1.0,vStairStone.x));
        if(vStairStone.x>1.5)roughnessFactor=.95;`);
  });
}
