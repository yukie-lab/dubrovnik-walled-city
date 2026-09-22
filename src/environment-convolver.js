import * as THREE from 'three';

// Three r185's original Gaussian/GGX kernels, in their original order. Capture
// the six source faces once, then finish one filter job per frame. Unfinished
// roughness levels are never used by the city. No lower-resolution substitute
// or reduced integration sample count is used to meet the frame budget.
export function makeEnvironmentConvolver(renderer) {
  const generator=new THREE.PMREMGenerator(renderer);
  if(THREE.REVISION!=='185'||typeof generator._halfBlur!=='function'
    ||typeof generator._applyGGXFilter!=='function')
    throw new Error('Environment scheduling needs the verified Three r185 PMREM kernels');
  let target=null,jobs=[];
  const state={pending:0,lastDrawCalls:0};
  function begin(scene) {
    if(target)throw new Error('Finish or cancel the previous environment first');
    const half=generator._halfBlur,ggx=generator._applyGGXFilter;
    generator._halfBlur=(...args)=>jobs.push(()=>half.apply(generator,args));
    generator._applyGGXFilter=(...args)=>jobs.push(()=>ggx.apply(generator,args));
    const before=renderer.info.render.calls;
    try {target=generator.fromScene(scene,.04,.1,100,{size:128});}
    finally {generator._halfBlur=half;generator._applyGGXFilter=ggx;}
    // fromScene's cleanup restores the completed-target viewport. Deferred
    // jobs still need the native per-LOD scissor until the last job is done.
    target.scissorTest=true;
    state.pending=jobs.length;state.lastDrawCalls=renderer.info.render.calls-before;
  }
  function step() {
    if(!target)return null;
    const previous=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel();
    const clear=renderer.autoClear,xr=renderer.xr.enabled,before=renderer.info.render.calls;
    renderer.autoClear=false;renderer.xr.enabled=false;
    try {jobs.shift()();}
    finally {
      renderer.autoClear=clear;renderer.xr.enabled=xr;
      renderer.setRenderTarget(previous,face,mip);
    }
    state.pending=jobs.length;state.lastDrawCalls=renderer.info.render.calls-before;
    if(jobs.length)return null;
    const complete=target;target=null;
    complete.scissorTest=false;
    complete.viewport.set(0,0,complete.width,complete.height);
    complete.scissor.copy(complete.viewport);
    return complete;
  }
  function cancel() {
    target?.dispose();target=null;jobs=[];state.pending=0;state.lastDrawCalls=0;
  }
  function initial(scene) {
    // A synchronous initial bake is startup work. Subsequent displayed frames
    // always use begin/step, including teleports and manual changes of time.
    if(target)throw new Error('Cannot initialize during an environment bake');
    return generator.fromScene(scene,.04,.1,100,{size:128});
  }
  return {begin,step,cancel,initial,state};
}
