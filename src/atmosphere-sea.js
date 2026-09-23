// The water's intrinsic optics stay in sea.js. This adapter replaces only the
// old illumination floors and camera-to-water fog with the shared atmospheric
// radiometry. The user-authorized colour calibration supplies live extinction
// and volume scattering coefficients. The September glare revision integrates
// sky reflection over visible GGX facets. Waves, solar glitter and foam stay fixed.
import {makeWaterOptics} from './water-optics.js';
import {bindWaterReflectionShader} from './water-reflection.js';
export function bindSeaAtmosphere(sea,atmosphere) {
  const uniforms=sea.uniforms,mat=sea.mesh.material;
  Object.assign(uniforms,atmosphere.uniforms);
  const illumination={value:1};uniforms.uIncidentScale=illumination;
  const optics=makeWaterOptics(sea);
  // sea.uniforms exposes shared values, but ShaderMaterial owns a separate
  // dictionary that also includes Three's lights. Register new sampler keys in
  // both dictionaries; otherwise GLSL leaves them on texture unit zero.
  Object.assign(mat.uniforms,atmosphere.uniforms,{uIncidentScale:illumination,uBottomAlbedoScale:optics.bottomUniform});
  function replaceOnce(source,from,to) {
    if(source.split(from).length!==2)throw new Error('Sea illumination interface changed: '+from.slice(0,60));
    return source.replace(from,to);
  }
  let shader=mat.fragmentShader;
  shader=replaceOnce(shader,'uniform float uSunLum, uDusk, uNight, uSkyGain;',
    'uniform float uSunLum, uDusk, uNight, uSkyGain;\nuniform float uIncidentScale,uBottomAlbedoScale;');
  shader=replaceOnce(shader,'vec3(0.30, 0.30, 0.28) * (0.35 + 0.65 * max(uSunDir.y, 0.0))',
    'vec3(0.30, 0.30, 0.28) * (0.35 + 0.65 * max(uSunDir.y, 0.0)) * uIncidentScale * uBottomAlbedoScale');
  shader=replaceOnce(shader,'+ uZenith * uSkyGain * 0.42 + vec3(0.05)',
    '+ uZenith * uSkyGain * 0.42 + vec3(0.05) * uIncidentScale');
  shader=bindWaterReflectionShader(shader);
  const start=shader.indexOf('  vec3 hDir = normalize(vec3(rayW.x, 0.0, rayW.z));');
  const end=shader.indexOf('\n\n  bool ok =',start);
  if(start<0||end<0)throw new Error('Sea aerial-perspective interface changed');
  shader=shader.slice(0,start)+'  col = atAerial(col, rayW * camD, cameraPosition);'+shader.slice(end);
  mat.fragmentShader=shader;mat.needsUpdate=true;
  return {
    optics,
    update(sun) {
      const lunar=sun.moonIntensity>sun.sunIntensity;
      const intensity=lunar?sun.moonIntensity:sun.sunIntensity;
      uniforms.uSunDir.value.copy(lunar?sun.moonDir:sun.dir);
      uniforms.uSunCol.value.copy(lunar?sun.moonCol:sun.sunCol);
      uniforms.uSunLum.value=intensity*.10;
      // Day/night is not a switch in the water BRDF. A weak moon is reflected
      // by exactly the same surface response as the sun.
      uniforms.uNight.value=0;uniforms.uDusk.value=0;
      illumination.value=Math.max(0,sun.ghi)/20;
      const sky=atmosphere.radiometry.skyIrradiance;
      const es=sun.sunIntensity*Math.max(0,sun.dir.y),em=sun.moonIntensity*Math.max(0,sun.moonDir.y);
      optics.illuminate({
        r:sky.r+sun.sunCol.r*es+sun.moonCol.r*em,
        g:sky.g+sun.sunCol.g*es+sun.moonCol.g*em,
        b:sky.b+sun.sunCol.b*es+sun.moonCol.b*em,
      });
    },
  };
}
