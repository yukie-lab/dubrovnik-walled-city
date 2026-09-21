// Horizontal irradiance from the actual finite city lights at the viewer's
// ground position. Units match the sun/sky: one = 5,000 lux. No night tint,
// hand-selected street ID, or minimum ambient illumination is introduced.
export function localHorizontalIlluminance(lights,eye,groundY) {
  let E=0;
  for(const light of lights) {
    if(!light.visible||light.intensity<=0)continue;
    const dx=light.position.x-eye.x,dy=light.position.y-groundY,dz=light.position.z-eye.z;
    if(dy<=0)continue;
    const d2=Math.max(.04,dx*dx+dy*dy+dz*dz),distance=Math.sqrt(d2);
    const cutoff=light.distance>0?Math.max(0,1-(distance/light.distance)**4)**2:1;
    const Y=light.color.r*.2126+light.color.g*.7152+light.color.b*.0722;
    E+=Y*light.intensity*cutoff*(dy/distance)/d2;
  }
  return E;
}
