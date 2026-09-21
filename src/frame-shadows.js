// Build one complete city shadow map per frame, then share it between the
// underwater/reflection pass and the normal colour pass. This wrapper executes
// inside WebGLRenderer.render, while Three's render state is valid; calling
// shadowMap.render independently would bypass that state.
export function shareFrameShadows(renderer, scene, camera) {
  const map=renderer.shadowMap,render=map.render;
  let pending=false;
  const state={enabled:true,passes:0,calls:0};
  map.render=function(lights,renderScene,renderCamera) {
    if(renderScene!==scene||renderCamera!==camera||!state.enabled)
      return render.call(this,lights,renderScene,renderCamera);
    if(!pending)return;
    const mask=camera.layers.mask,auto=map.autoUpdate,before=renderer.info.render.calls;
    // The underwater colour list intentionally contains only its own layer.
    // Shadow casters must still include the entire physical city (layer 0).
    camera.layers.set(0);map.autoUpdate=true;
    try {render.call(this,lights,renderScene,renderCamera);}
    finally {
      camera.layers.mask=mask;map.autoUpdate=auto;pending=false;
      state.passes++;state.calls+=renderer.info.render.calls-before;
    }
  };
  function beginFrame(){pending=true;state.passes=0;state.calls=0;}
  return {state,beginFrame};
}
