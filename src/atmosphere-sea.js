// The water's intrinsic optics stay in sea.js. This adapter replaces only the
// old illumination floors and camera-to-water fog with the shared atmospheric
// radiometry. The user-authorized colour calibration supplies live extinction
// and volume scattering coefficients. Fresnel, waves, GGX and foam stay in sea.js.
import {makeWaterOptics} from './water-optics.js';
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
  // The former far-field lookup mixed two sky directions with fixed colour
  // weights. Integrate the actual sky over the unresolved reflection lobe.
  // Fresnel, the resolved normal, wave amplitudes and the solar glitter lobe
  // remain owned by sea.js. This replaces incident radiance only.
  shader=replaceOnce(shader,'void main() {',/* glsl */`
vec3 waterSkyAverage(vec3 direction,float alpha) {
  vec3 r=normalize(direction);
  vec3 tangent=normalize(cross(abs(r.y)<.99?vec3(0,1,0):vec3(1,0,0),r));
  vec3 bitangent=cross(r,tangent),sum=vec3(0.0);float weight=0.0;
  for(int i=0;i<12;i++) {
    float u=(float(i)+.5)/12.0,phi=float(i)*2.39996323;
    float c=sqrt((1.0-u)/(1.0+(alpha*alpha-1.0)*u));
    float s=sqrt(max(0.0,1.0-c*c));
    vec3 h=tangent*(cos(phi)*s)+bitangent*(sin(phi)*s)+r*c;
    vec3 l=reflect(-r,h);float w=max(0.0,dot(r,l));
    if(l.y>0.0) {sum+=atSkyRadiance(l)*w;weight+=w;}
  }
  return weight>0.0?sum/weight:atSkyRadiance(r);
}
void main() {`);
  shader=replaceOnce(shader,
    'vec3 skyAvg = mix(uHorizonFar, uZenith, 0.30) * uSkyGain * 0.88;',
    `float skyRoughness=clamp(mix(.115,.42,smoothstep(30.0,2500.0,camD))/max(wind,.55),.09,.62);
    vec3 skyAvg=waterSkyAverage(R,skyRoughness);`);
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
