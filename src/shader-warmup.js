import {WebGLRenderTarget} from 'three';

// compileAsync prepares colour materials, not the depth materials selected by
// WebGLShadowMap. Exercise that same selection path once before display, with
// every caster eligible. No object or time of day receives a special case.
export function warmShadowPrograms(renderer,scene,camera) {
  const target=new WebGLRenderTarget(1,1),previousTarget=renderer.getRenderTarget();
  const draw=renderer.renderBufferDirect,states=[],materials=new Set();
  const auto=renderer.shadowMap.autoUpdate;
  let casters=0;
  scene.traverse(object=>{
    states.push([object,object.visible,object.frustumCulled]);
    object.visible=true;
    if(object.castShadow) {object.frustumCulled=false;casters++;}
  });
  renderer.renderBufferDirect=function(camera,scene,geometry,material,object,group) {
    if(scene!==null)return;
    materials.add(material);
    return draw.call(this,camera,scene,geometry,material,object,group);
  };
  renderer.shadowMap.autoUpdate=true;renderer.shadowMap.needsUpdate=true;
  try {
    renderer.setRenderTarget(target);renderer.render(scene,camera);
    return {casters,materials:materials.size};
  } finally {
    renderer.renderBufferDirect=draw;
    renderer.shadowMap.autoUpdate=auto;renderer.shadowMap.needsUpdate=true;
    for(const [object,visible,frustumCulled] of states) {
      object.visible=visible;object.frustumCulled=frustumCulled;
    }
    renderer.setRenderTarget(previousTarget);target.dispose();
  }
}
