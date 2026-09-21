import {chainMaterialShader} from './material-patch.js';

// Height is relative to this flight's own masonry bed. The patina follows the
// hand and damp joints through turns, independently of absolute city height.
export function patchWallStairFinish(material) {
  return chainMaterialShader(material,'stairWallPatina-v1',sh=>{
    sh.vertexShader=sh.vertexShader.replace('#include <common>',
      '#include <common>\nattribute vec3 aStairWall; varying vec3 vStairWall; varying vec3 vStairPoint;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvStairWall=aStairWall;vStairPoint=position;');
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>',
      '#include <common>\nvarying vec3 vStairWall; varying vec3 vStairPoint;')
      .replace('#include <map_fragment>',`#include <map_fragment>
        if(vStairWall.x>.5){
          float irregular=wnNoise(vStairPoint.xz*4.1+vStairPoint.y*.73);
          float hand=exp(-pow((vStairWall.y-1.03)/.24,2.0))*vStairWall.z*(.28+.72*irregular);
          float damp=exp(-max(0.0,vStairWall.y)*4.5)*(.3+.7*irregular);
          diffuseColor.rgb*=1.0-.21*hand-.18*damp;
          diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.76,.85,.65),damp*.24);
        }`)
      .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
        if(vStairWall.x>.5){
          float hand=exp(-pow((vStairWall.y-1.03)/.24,2.0))*vStairWall.z;
          roughnessFactor*=1.0-.19*hand;
        }`);
  });
}
