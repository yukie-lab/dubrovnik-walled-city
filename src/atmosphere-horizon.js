// Far ocean at the spherical Earth's horizon. The detailed water mesh ends at
// 4 km, while an eye on the parapet sees the geometric horizon ~15 km away.
// This is its unresolved background continuation, behind all scene geometry.
// It uses the existing water's scattering/extinction ratio and Fresnel F0; no
// painted horizon blend, new water colour or change to the near wave spectrum.
export const OCEAN_HORIZON_GLSL=/* glsl */`
uniform vec3 uAtOceanInscat;
uniform float uAtOceanF0;
vec3 atOceanHorizon(vec3 d,vec3 sky) {
  vec3 origin=vec3(0.0,AT_R+uAtHeight,0.0);
  bool ground;float distanceKm=atBoundary(origin,d,ground);
  if(!ground)return sky;
  vec3 n=normalize(origin+d*distanceKm);
  vec3 reflected=reflect(d,n);
  // Match the protected surface's unresolved reflection cone at grazing angles.
  reflected.y=max(reflected.y,.008);
  vec3 reflectedSky=atSkyRadiance(normalize(reflected));
  float cosTheta=clamp(dot(-d,n),0.0,1.0);
  float fresnel=uAtOceanF0+(1.0-uAtOceanF0)*pow(1.0-cosTheta,5.0);
  vec3 water=mix(uAtOceanInscat,reflectedSky,fresnel);
  return atAerial(water,d*distanceKm*1000.0,cameraPosition);
}`;
