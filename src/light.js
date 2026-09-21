// Solar/lunar lighting and exposure share the atmosphere's radiometric scale.
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './util.js';
import { glassNightUniform, litWindowsMat, specularEnvTargets } from './buildings.js';
import { urbanTint, bounceRad, groundRefY } from './skyvis.js';
import { makeAtmosphere } from './atmosphere.js';
import { bindSeaAtmosphere } from './atmosphere-sea.js';
import { ATMOSPHERE_GLSL } from './atmosphere-glsl.js';
import { ATM, exposureForIlluminance } from './atmosphere-model.js';
import { localHorizontalIlluminance } from './illumination-meter.js';

const ZONE_EXPOSURE={stradun:1,square:.98,street:1.02,alley:1.11,shaft:1.19,
  gate:1.14,stair:1.01,wall:.95,port:.95};
export function makeLighting(renderer,scene,tex,sky,sea) {
  const atmosphere=makeAtmosphere(renderer);
  sky.bindAtmosphere({...atmosphere.uniforms,
    uAtOceanInscat:sea.uniforms.uInscat,uAtOceanF0:{value:.0204}});
  const waterLight=bindSeaAtmosphere(sea,atmosphere);
  // Only the dominant astronomical source needs a shadow map. The subordinate
  // source still contributes, so switching the shadow allocation loses no light.
  const sun=new THREE.DirectionalLight(0xffffff,0);
  sun.castShadow=true;sun.shadow.mapSize.set(3072,3072);
  sun.shadow.camera.near=440;sun.shadow.camera.far=700;
  sun.shadow.bias=-.0006;sun.shadow.normalBias=.025;
  const secondary=new THREE.DirectionalLight(0xffffff,0);
  scene.add(sun,sun.target,secondary,secondary.target);
  // Kept as an inspection handle, with zero energy: IBL already integrates sky
  // irradiance. Counting a hemisphere light as well would double that energy.
  const hemi=new THREE.HemisphereLight(0xffffff,0xffffff,0);scene.add(hemi);
  const localLights=[];scene.traverse(o=>{if(o.isPointLight)localLights.push(o);});
  scene.fog=new THREE.FogExp2(0x000000,0);
  scene.traverse(o=>{const m=o.material;if(Array.isArray(m))m.forEach(atmosphere.patchMaterial);else atmosphere.patchMaterial(m);});

  const pmrem=new THREE.PMREMGenerator(renderer),envScene=new THREE.Scene();
  const envUniforms={...atmosphere.uniforms,uGround:{value:new THREE.Color()}};
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10,24,16),new THREE.ShaderMaterial({
    uniforms:envUniforms,side:THREE.BackSide,toneMapped:false,
    vertexShader:'varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:`varying vec3 vDir;uniform vec3 uGround;${ATMOSPHERE_GLSL}
      void main(){vec3 d=normalize(vDir);gl_FragColor=vec4(d.y>=0.0?atSkyRadiance(d):uGround,1.0);}`,
  })));
  let envRT=null,lastEnvTime=-99,lastSkyY=1;
  const state={exposure:.6,targetExposure:.6,glare:0,snap:false};
  function place(light,dir,colour,intensity,camPos) {
    light.position.copy(camPos).addScaledVector(dir,500);light.target.position.copy(camPos);
    // Keep both astronomical slots present, including at zero irradiance.
    // Removing one at its first/last visible limb recompiles every lit material
    // as the number of directional lights changes during the continuous cycle.
    light.color.copy(colour);light.intensity=intensity;light.visible=true;
  }
  function update(sunState,camPos,zone,dt,elapsed) {
    atmosphere.update(sunState,camPos.y);atmosphere.applyState(sunState);
    const lunar=sunState.moonIntensity>sunState.sunIntensity;
    place(sun,lunar?sunState.moonDir:sunState.dir,lunar?sunState.moonCol:sunState.sunCol,
      lunar?sunState.moonIntensity:sunState.sunIntensity,camPos);
    place(secondary,lunar?sunState.dir:sunState.moonDir,lunar?sunState.sunCol:sunState.moonCol,
      lunar?sunState.sunIntensity:sunState.moonIntensity,camPos);
    // ---- 影ボリューム: 高所ほど広く(屋根海に影を)
    // 320 だと 4096 マップで 0.156m/texel になり、PCF が 1m の対角バンド(アクネ)を描く。
    // 「対地高度」で駆動しようとしたが、groundY = player.smoothY で
    // camera.y = smoothY + EYE なので恒久的に 1.62 = 分岐が到達不能だった。
    // 市街の地盤(≒2m)を基準にした絶対高度で駆動する。
    // 低い太陽は影が長い(鐘楼 20m → 影 142m)ので、そのぶん広げる。
    const upK = smoothstep(6, 30, camPos.y - 2.0);
    const elForShadow = lunar ? -sunState.el : sunState.el;
    // 低い太陽で影ボリュームを **広げる** のは接地に対して逆向き。texel が太くなり、
    // アクネを避けるのに要る深度バイアスも比例して増え、影が足元から離れる
    // (実測 el 4.7° で後退 1.11m — 人も煙突も影を失う)。しかも影長は
    // el 15°→4.7° で 3.3 倍に伸びるので、どのみち 1 枚の影マップでは覆えない。
    // 遠い影の先を捨てて接地を取る。el 4.7° の直射は水平面照度の 19% しか
    // 担っていないので、遠景の影を失う損失は小さい。
    const lowSun = lerp(1.0, 0.70, smoothstep(15, 4, Math.max(elForShadow, 0)));
    const radius = lerp(40, 170, upK) * lowSun;
    const c = sun.shadow.camera;
    if (Math.abs(c.right - radius) > 1) {
      c.left = -radius; c.right = radius; c.top = radius; c.bottom = -radius;
      // 深度レンジを広げると bias の実効ワールド値も比例して伸び、影が漏れる。
      const far = 500 + radius * 2.4;
      c.near = 500 - radius * 1.2; c.far = far;
      // アクネを避けるのに要る深度は「1 テクセルぶん横に動いたときの深度差」
      // = texel·cos(el)。以前は高度に **比例** する固定値 0.156·sin(el) を使い、
      // しかも sin に床 0.28 を置いていたので、el 16.3° 以下で補正が止まり、
      // 影の後退量が 1/sin(el) で発散していた(el 4.7° で bias 由来 0.537m)。
      const texelW = (2 * radius) / 3072;
      const elRad = Math.max(elForShadow, 1.2) * Math.PI / 180;
      sun.shadow.bias = -(texelW * 1.7 * Math.cos(elRad) + 0.006) / (far - c.near);
      // radius に比例させると城壁上で 0.125m になり、瓦の起伏(4cm)や窓の見込みの
      // セルフシャドウが丸ごと消える。平方根で伸ばす。
      // normalBias は法線方向のずらしなので、水平面では 1/tan(el) で効く。低い
      // 太陽では絞らないと、これだけで 0.575m 影が後退する。
      sun.shadow.normalBias = 0.025 * Math.sqrt(radius / 34)
        * clamp(Math.sin(elRad) / 0.35, 0.30, 1);
      c.updateProjectionMatrix();
    }
    // テクセルスナップ
    const texel = (radius * 2) / 3072;
    sun.target.position.x = Math.round(sun.target.position.x / texel) * texel;
    sun.target.position.z = Math.round(sun.target.position.z / texel) * texel;


    urbanTint.value.set(1,1,1);
    const bq=sun.intensity*.030;
    bounceRad.value.set(bq*.60*sun.color.r,bq*.575*sun.color.g,bq*.552*sun.color.b);
    groundRefY.value=state.groundY??(camPos.y-1.62);
    scene.fog.color.copy(sunState.fogCol);
    state.localIlluminance=localHorizontalIlluminance(localLights,camPos,groundRefY.value);
    state.meterIlluminance=sunState.ghi+state.localIlluminance;
    state.targetExposure=(ZONE_EXPOSURE[zone]??1)*exposureForIlluminance(state.meterIlluminance);
    const tau=state.snap?.0001:(state.targetExposure>state.exposure?5.0:.8);
    // Adapt in stops, so a transition spanning 10+ stops has a sensible rate.
    const previous=Math.log(Math.max(state.exposure,1e-6));
    const target=Math.log(Math.max(state.targetExposure,1e-6));
    state.exposure=Math.exp(lerp(previous,target,Math.min(1,dt/tau)));
    renderer.toneMappingExposure=state.exposure;
    state.glare=clamp(Math.abs(target-Math.log(state.exposure))*.15,0,1);
    glassNightUniform.value=smoothstep(-1,-6,sunState.el);
    // Lit interiors have finite luminance; exposure is never baked into it.
    litWindowsMat.color.setRGB(.012,.012,.012);
    litWindowsMat.opacity=glassNightUniform.value*.95;
    const sy=sunState.hemiSky.r*.2126+sunState.hemiSky.g*.7152+sunState.hemiSky.b*.0722;
    if(Math.abs(sunState.time-lastEnvTime)>.012||!envRT) {
      lastEnvTime=sunState.time;lastSkyY=Math.max(sy,1e-12);
      envUniforms.uGround.value.copy(sunState.hemiGround);
      const rt=pmrem.fromScene(envScene,0.04,.1,100,{size:128});
      const prev=envRT;envRT=rt;scene.environment=rt.texture;
      for(const m of specularEnvTargets){m.envMap=rt.texture;}
      prev?.dispose();
    }
    scene.environmentIntensity=sy/lastSkyY;
    tex.clock.draw(sunState.time);
    return state;
  }
  return {sun,hemi,update,state,envUniforms,atmosphere,waterLight};
}
