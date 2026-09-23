import {WATER_REFLECTION_GLSL} from '/src/water-reflection.js';

export function applySeaGlarePrototype(world) {
  const m=world.scene.getObjectByName('sea.surface').material;
  let source=m.fragmentShader;
  const start=source.indexOf('vec3 waterSkyAverage('),end=source.indexOf('void main() {',start);
  if(start<0||end<0)throw new Error('Sky averaging interface changed');
  source=source.slice(0,start)+WATER_REFLECTION_GLSL+'\n'+source.slice(end);
  const a=source.indexOf('  vec3 R = reflect(-V, N);');
  const b=source.indexOf('  // 画面空間反射',a);
  if(a<0||b<0)throw new Error('Sea reflected sky interface changed');
  source=source.slice(0,a)+`
  float interfaceF=F;
  float skyRoughness=clamp(mix(.115,.42,smoothstep(30.0,2500.0,camD))/max(wind,.55),.09,.62);
  vec4 reflected=waterSkyReflection(V,N,skyRoughness,.0204);
  F=reflected.a;
  vec3 refl=reflected.rgb/max(F,.000001)*(0.60+0.40*sh);
  `+source.slice(b);
  // Keep the existing solar glitter bit-for-bit; the revision addresses only
  // the reflected diffuse sky and its transmitted-energy complement.
  source=source.replace('uSunLum * dTerm * F * twinkle','uSunLum * dTerm * interfaceF * twinkle');
  m.fragmentShader=source;m.needsUpdate=true;
}
