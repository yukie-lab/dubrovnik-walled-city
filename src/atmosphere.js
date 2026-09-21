import * as THREE from 'three';
import { ATMOSPHERE_GLSL, TRANSMITTANCE_FRAGMENT, MULTIPLE_FRAGMENT, SKY_VIEW_FRAGMENT } from './atmosphere-glsl.js';
import { ATM, luminance } from './atmosphere-model.js';

const vertexShader='varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}';
function target(w,h,name) {
  const rt=new THREE.WebGLRenderTarget(w,h,{type:THREE.FloatType,depthBuffer:false,
    minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,generateMipmaps:false});
  rt.texture.name=name;return rt;
}

export function makeAtmosphere(renderer) {
  const trans=target(256,64,'atmosphere.transmittance');
  const multi=target(128,48,'atmosphere.multipleScattering');
  const sky=target(384,192,'atmosphere.skyRadiance');
  sky.texture.wrapS=THREE.RepeatWrapping;
  const meter=target(4,1,'atmosphere.irradiance');
  const uniforms={uAtTrans:{value:trans.texture},uAtMulti:{value:multi.texture},
    uAtSky:{value:sky.texture},uAtSun:{value:new THREE.Vector3()},uAtMoon:{value:new THREE.Vector3()},
    uAtHeight:{value:.020}};
  const scene=new THREE.Scene(),camera=new THREE.Camera();
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2));quad.frustumCulled=false;scene.add(quad);
  const material=fragmentShader=>new THREE.ShaderMaterial({uniforms,vertexShader,fragmentShader,
    depthTest:false,depthWrite:false,toneMapped:false});
  const transMat=material(TRANSMITTANCE_FRAGMENT),multiMat=material(MULTIPLE_FRAGMENT),skyMat=material(SKY_VIEW_FRAGMENT);
  const meterMat=material(/* glsl */`
    varying vec2 vUv;
    ${ATMOSPHERE_GLSL}
    void main(){
      int col=int(floor(vUv.x*4.0));
      vec3 s=normalize(vec3(uAtSun.x,0.0,uAtSun.z)), L;
      if(col==0) L=atSkyRadiance(vec3(0.0,1.0,0.0));
      else if(col==1) L=atSkyRadiance(s);
      else if(col==2) L=atSkyRadiance(-s);
      else {
        L=vec3(0.0);
        for(int i=0;i<128;i++) {
          float y=(float(i)+.5)/128.0,a=float(i)*2.39996323;
          L+=atSkyRadiance(vec3(cos(a)*sqrt(1.0-y*y),y,sin(a)*sqrt(1.0-y*y)))*y*(2.0*AT_PI/128.0);
        }
      }
      gl_FragColor=vec4(L,1.0);
    }`);
  const values=new Float32Array(16);
  let ready=false,lastTime=NaN,lastHeight=NaN,revision=0;
  const radiometry={zenith:new THREE.Color(),horizon:new THREE.Color(),horizonFar:new THREE.Color(),
    skyIrradiance:new THREE.Color(),ghi:0,luxPerUnit:ATM.luxPerUnit};
  function render(mat,rt) {quad.material=mat;renderer.setRenderTarget(rt);renderer.render(scene,camera);}
  function update(sun,height) {
    // The sky is independent of horizontal camera position. Height changes by
    // two metres trigger integration; no per-reference-view exceptions exist.
    const h=Math.max(.002,height*.001);
    if(ready&&sun.time===lastTime&&Math.abs(h-lastHeight)<.002) return false;
    const oldTarget=renderer.getRenderTarget(),oldAuto=renderer.autoClear;
    const oldXR=renderer.xr.enabled;
    renderer.xr.enabled=false;renderer.autoClear=true;
    uniforms.uAtSun.value.copy(sun.dir);uniforms.uAtMoon.value.copy(sun.moonDir);
    uniforms.uAtHeight.value=h;
    if(!ready) {render(transMat,trans);render(multiMat,multi);ready=true;}
    render(skyMat,sky);render(meterMat,meter);
    renderer.readRenderTargetPixels(meter,0,0,4,1,values);
    renderer.setRenderTarget(oldTarget);renderer.autoClear=oldAuto;renderer.xr.enabled=oldXR;
    radiometry.zenith.setRGB(...values.slice(0,3));
    radiometry.horizon.setRGB(...values.slice(4,7));
    radiometry.horizonFar.setRGB(...values.slice(8,11));
    radiometry.skyIrradiance.setRGB(...values.slice(12,15));
    radiometry.ghi=luminance(values.slice(12,15))+sun.sunIntensity*Math.max(sun.dir.y,0)
      +sun.moonIntensity*Math.max(sun.moonDir.y,0);
    if(!Number.isFinite(radiometry.ghi)||radiometry.ghi<0) throw new Error('Invalid atmospheric radiometry');
    lastTime=sun.time;lastHeight=h;revision++;
    return true;
  }
  function applyState(sun) {
    sun.zenith.copy(radiometry.zenith);sun.horizon.copy(radiometry.horizon);
    sun.horizonFar.copy(radiometry.horizonFar);sun.hemiSky.copy(radiometry.skyIrradiance).multiplyScalar(1/Math.PI);
    sun.ghi=radiometry.ghi;
    const direct=sun.sunCol.clone().multiplyScalar(sun.sunIntensity*Math.max(0,sun.dir.y))
      .add(sun.moonCol.clone().multiplyScalar(sun.moonIntensity*Math.max(0,sun.moonDir.y)));
    sun.hemiGround.copy(direct).add(radiometry.skyIrradiance).multiply(new THREE.Color(.62,.545,.455)).multiplyScalar(1/Math.PI);
    sun.fogCol.copy(radiometry.horizon);sun.fogFar.copy(radiometry.horizonFar);
  }
  function patchMaterial(mat) {
    if(!mat||mat.userData.physicalAtmosphere||mat.fog===false) return;
    mat.userData.physicalAtmosphere=true;
    const prev=mat.onBeforeCompile,key=mat.customProgramCacheKey();
    mat.onBeforeCompile=(shader,r)=>{
      prev?.(shader,r);
      if(!shader.fragmentShader.includes('#include <fog_fragment>'))return;
      Object.assign(shader.uniforms,uniforms);
      shader.vertexShader=shader.vertexShader.replace('#include <fog_pars_vertex>',
        '#include <fog_pars_vertex>\nvarying vec3 vAirVector;')
        .replace('#include <fog_vertex>','#include <fog_vertex>\nvAirVector=transpose(mat3(viewMatrix))*mvPosition.xyz;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <fog_pars_fragment>',
        '#include <fog_pars_fragment>\nvarying vec3 vAirVector;\n'+ATMOSPHERE_GLSL)
        .replace('#include <fog_fragment>','gl_FragColor.rgb=atAerial(gl_FragColor.rgb,vAirVector,cameraPosition);');
    };
    mat.customProgramCacheKey=()=>key+'|physical-air-v1';mat.needsUpdate=true;
  }
  return {uniforms,update,applyState,patchMaterial,radiometry,get revision(){return revision;},
    targets:{trans,multi,sky,meter}};
}
