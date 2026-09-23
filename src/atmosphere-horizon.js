// Far ocean at the spherical Earth's horizon. The detailed water mesh ends at
// 4 km, while an eye on the parapet sees the geometric horizon ~15 km away.
// This is its unresolved background continuation, behind all scene geometry.
// It uses the existing water's scattering/extinction ratio and Fresnel F0; no
// painted horizon blend, new water colour or change to the near wave spectrum.
import {WATER_REFLECTION_GLSL} from './water-reflection.js';
export const OCEAN_HORIZON_GLSL=WATER_REFLECTION_GLSL+/* glsl */`
uniform vec3 uAtOceanInscat;
uniform float uAtOceanF0;
vec3 atOceanHorizon(vec3 d,vec3 sky) {
  vec3 origin=vec3(0.0,AT_R+uAtHeight,0.0);
  bool ground;float distanceKm=atBoundary(origin,d,ground);
  if(!ground)return sky;
  vec3 n=normalize(origin+d*distanceKm);
  // Same unresolved GGX and masking as the detailed sea. At the horizon the
  // open-water wind field tends to .42+.78*.5+.34*.5=.98 on a pixel footprint.
  vec4 reflected=waterSkyReflection(-d,n,.42/.98,uAtOceanF0);
  vec3 water=uAtOceanInscat*(1.0-reflected.a)+reflected.rgb;
  return atAerial(water,d*distanceKm*1000.0,cameraPosition);
}`;
