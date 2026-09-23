// GGX visible-normal quadrature for reflected atmospheric radiance. The same
// water IOR/F0 and existing unresolved roughness are used; no colour multiplier.
// Smith masking and the visible-normal construction follow PBRT, 4e, ch. 9.6.
export const WATER_REFLECTION_GLSL=/* glsl */`
float waterLambda(float cosine,float alpha) {
  float c=max(cosine,.00001);
  return .5*(sqrt(1.0+alpha*alpha*max(0.0,1.0-c*c)/(c*c))-1.0);
}
vec4 waterSkyReflection(vec3 view,vec3 normal,float alpha,float f0) {
  // A normal-map facet behind the visible geometric surface cannot act as a
  // perfect mirror. Limit its local view to the tangent plane, then integrate
  // the visible distribution instead of clamping its ray onto the bright sky.
  vec3 n=normalize(normal+view*max(0.0,.00001-dot(normal,view)));
  vec3 tx=normalize(cross(abs(n.y)<.99?vec3(0,1,0):vec3(1,0,0),n));
  vec3 ty=cross(n,tx);
  vec3 v=vec3(dot(view,tx),dot(view,ty),max(.00001,dot(view,n)));
  vec3 vh=normalize(vec3(alpha*v.xy,v.z));
  vec3 t1=vh.z<.99999?normalize(cross(vec3(0,0,1),vh)):vec3(1,0,0);
  vec3 t2=cross(vh,t1);
  float lambdaV=waterLambda(v.z,alpha);
  vec4 sum=vec4(0.0);
  for(int i=0;i<12;i++) {
    float radius=sqrt((float(i)+.5)/12.0),phi=float(i)*2.39996323;
    vec2 p=radius*vec2(cos(phi),sin(phi));
    p.y=mix(sqrt(max(0.0,1.0-p.x*p.x)),p.y,(1.0+vh.z)*.5);
    vec3 nh=p.x*t1+p.y*t2+sqrt(max(0.0,1.0-dot(p,p)))*vh;
    vec3 h=normalize(vec3(alpha*nh.xy,max(.000001,nh.z)));
    vec3 l=reflect(-v,h);
    if(l.z<=0.0)continue;
    float fresnel=f0+(1.0-f0)*pow(1.0-clamp(dot(v,h),0.0,1.0),5.0);
    float visibility=(1.0+lambdaV)/(1.0+lambdaV+waterLambda(l.z,alpha));
    float weight=fresnel*visibility/12.0;
    vec3 direction=tx*l.x+ty*l.y+n*l.z;
    // A ray toward another water facet is masked, not reassigned to the sky.
    if(direction.y<=0.0)continue;
    sum+=vec4(atSkyRadiance(direction),1.0)*weight;
  }
  return sum;
}`;

export function bindWaterReflectionShader(source) {
  const main='void main() {';
  if(source.split(main).length!==2)throw new Error('Sea main interface changed');
  source=source.replace(main,WATER_REFLECTION_GLSL+'\n'+main);
  const start=source.indexOf('  vec3 R = reflect(-V, N);');
  const end=source.indexOf('  // 画面空間反射',start);
  if(start<0||end<0)throw new Error('Sea reflected sky interface changed');
  source=source.slice(0,start)+/* glsl */`
  // Keep the interface Fresnel for the protected solar glitter. Only the sky
  // reflection integrates the unresolved, mutually masking wave facets.
  float interfaceF=F;
  float skyRoughness=clamp(mix(.115,.42,smoothstep(30.0,2500.0,camD))/max(wind,.55),.09,.62);
  vec4 reflected=waterSkyReflection(V,N,skyRoughness,.0204);
  F=reflected.a;
  vec3 refl=reflected.rgb/max(F,.000001)*(0.60+0.40*sh);

`+source.slice(end);
  const glitter='uSunLum * dTerm * F * twinkle';
  if(source.split(glitter).length!==2)throw new Error('Sea solar glint interface changed');
  return source.replace(glitter,'uSunLum * dTerm * interfaceF * twinkle');
}
