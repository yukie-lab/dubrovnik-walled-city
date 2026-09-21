import { ATM } from './atmosphere-model.js';
const v3 = v => `vec3(${v.map(x => x.toFixed(9)).join(',')})`;
export const ATMOSPHERE_GLSL = /* glsl */`
const float AT_PI=3.141592653589793;
const float AT_R=${ATM.radius.toFixed(1)}, AT_TOP=${ATM.top.toFixed(1)};
const vec3 AT_RAY=${v3(ATM.rayleigh)}, AT_OZONE=${v3(ATM.ozone)};
const float AT_MIE_S=${ATM.mieScattering}, AT_MIE_E=${ATM.mieExtinction};
uniform sampler2D uAtTrans, uAtMulti, uAtSky;
uniform vec3 uAtSun, uAtMoon;
uniform float uAtHeight;

vec3 atDensity(float h) {
  return vec3(exp(-max(h,0.0)/8.0),exp(-max(h,0.0)/1.2),max(0.0,1.0-abs(h-25.0)/15.0));
}
void atMedium(vec3 p,out vec3 scatter,out vec3 extinct,out vec3 ray,out vec3 mie) {
  vec3 density=atDensity(length(p)-AT_R);
  ray=AT_RAY*density.x; mie=vec3(AT_MIE_S*density.y);
  scatter=ray+mie;
  extinct=ray+vec3(AT_MIE_E*density.y)+AT_OZONE*density.z;
}
float atRayPhase(float mu) { return 3.0*(1.0+mu*mu)/(16.0*AT_PI); }
float atMiePhase(float mu) {
  float g=${ATM.mieG};
  return 3.0*(1.0-g*g)*(1.0+mu*mu)/(8.0*AT_PI*(2.0+g*g)*pow(1.0+g*g-2.0*g*mu,1.5));
}
float atTopDistance(float r,float mu) {
  return -r*mu+sqrt(max(0.0,r*r*mu*mu+(AT_TOP-r)*(AT_TOP+r)));
}
float atBoundary(vec3 p,vec3 d,out bool ground) {
  float r=length(p), b=dot(p,d), discr=b*b-(r-AT_R)*(r+AT_R);
  ground=b<0.0&&discr>=0.0;
  return ground?max(0.0,-b-sqrt(max(0.0,discr))):atTopDistance(r,b/r);
}
vec2 atTransUV(float r,float mu) {
  float H=sqrt((AT_TOP-AT_R)*(AT_TOP+AT_R));
  float rho=sqrt(max(0.0,(r-AT_R)*(r+AT_R)));
  float lo=AT_TOP-r, hi=rho+H;
  vec2 q=vec2((atTopDistance(r,mu)-lo)/max(.0001,hi-lo),rho/H);
  return (.5+clamp(q,0.0,1.0)*vec2(255.0,63.0))/vec2(256.0,64.0);
}
vec3 atTransmittance(vec3 p,vec3 d) {
  float r=length(p), mu=dot(p,d)/r;
  float horizon=-sqrt(max(0.0,1.0-(AT_R/r)*(AT_R/r)));
  if(mu<horizon) return vec3(0.0);
  return texture2D(uAtTrans,atTransUV(r,mu)).rgb;
}
vec3 atSunTrans(vec3 p,vec3 d) {
  float r=length(p), mu=dot(p,d)/r;
  float horizon=-sqrt(max(0.0,1.0-(AT_R/r)*(AT_R/r)));
  float x=clamp((mu-horizon)/${ATM.sunRadius},-1.0,1.0);
  float visible=(acos(-x)+x*sqrt(max(0.0,1.0-x*x)))/AT_PI;
  return texture2D(uAtTrans,atTransUV(r,max(mu,horizon+.000001))).rgb*visible;
}
vec3 atMulti(vec3 p,vec3 lightDir) {
  float r=length(p), mu=dot(p,lightDir)/r;
  float x=.5+.5*sign(mu)*sqrt(abs(mu));
  float y=sqrt(clamp((r-AT_R)/(AT_TOP-AT_R),0.0,1.0));
  return texture2D(uAtMulti,(.5+vec2(x,y)*vec2(127.0,47.0))/vec2(128.0,48.0)).rgb;
}
vec3 atSunE() { return vec3(${ATM.solarIlluminance.toFixed(1)}); }
vec3 atMoonE() { return vec3(1.06,1.0,.91)*${ATM.lunarIlluminance.toFixed(8)}; }
vec3 atSource(vec3 p,vec3 d,vec3 ray,vec3 mie,vec3 scattering) {
  float cs=dot(d,uAtSun), cm=dot(d,uAtMoon);
  vec3 solar=atSunTrans(p,uAtSun)*(ray*atRayPhase(cs)+mie*atMiePhase(cs));
  vec3 lunar=atSunTrans(p,uAtMoon)*(ray*atRayPhase(cm)+mie*atMiePhase(cm));
  return atSunE()*(solar+scattering*atMulti(p,uAtSun))
    +atMoonE()*(lunar+scattering*atMulti(p,uAtMoon));
}
// Equirectangular azimuth and signed sqrt(elevation) concentrate samples at
// the optical horizon. Both sky and water call this very same lookup.
vec2 atSkyUV(vec3 d) {
  float a=asin(clamp(d.y,-1.0,1.0));
  float v=.5+.5*sign(a)*sqrt(abs(a)/(AT_PI*.5));
  return vec2(fract(atan(d.z,d.x)/(2.0*AT_PI)+.5),clamp(v,.5/192.0,191.5/192.0));
}
vec3 atSkyRadiance(vec3 d) { return texture2D(uAtSky,atSkyUV(normalize(d))).rgb; }

// An analytic homogeneous-segment integral with the density/light sampled at
// the midpoint. Four segments retain vertical density variation over the city's
// first 6 km. Unlike exponential-squared fog, RGB extinction is Beer–Lambert
// and the source term is exactly the one used by the sky integrator.
vec3 atAerial(vec3 radiance,vec3 viewVector,vec3 eye) {
  float distanceKm=length(viewVector)*.001;
  vec3 d=normalize(viewVector), origin=vec3(0.0,AT_R+max(.001,eye.y*.001),0.0);
  vec3 T=vec3(1.0), L=vec3(0.0);
  float ds=distanceKm*.25;
  for(int i=0;i<4;i++) {
    vec3 p=origin+d*(float(i)+.5)*ds;
    if(length(p)<AT_R+.0001) p=normalize(p)*(AT_R+.0001);
    vec3 scattering,extinct,ray,mie;
    atMedium(p,scattering,extinct,ray,mie);
    vec3 stepT=exp(-extinct*ds);
    L+=T*atSource(p,d,ray,mie,scattering)*(vec3(1.0)-stepT)/max(extinct,vec3(.000001));
    T*=stepT;
  }
  return radiance*T+L;
}
`;

export const TRANSMITTANCE_FRAGMENT = /* glsl */`
varying vec2 vUv;
${ATMOSPHERE_GLSL}
void main() {
  vec2 q=clamp((vUv*vec2(256.0,64.0)-.5)/vec2(255.0,63.0),0.0,1.0);
  float H=sqrt((AT_TOP-AT_R)*(AT_TOP+AT_R)), rho=q.y*H;
  float r=sqrt(rho*rho+AT_R*AT_R);
  float lo=AT_TOP-r, hi=rho+H, distance=lo+q.x*(hi-lo);
  float mu=distance<.00001?1.0:clamp(((AT_TOP-r)*(AT_TOP+r)-distance*distance)/(2.0*r*distance),-1.0,1.0);
  vec3 od=vec3(0.0);
  for(int i=0;i<128;i++) {
    float a=float(i)/128.0, b=float(i+1)/128.0;
    float t0=distance*a*a, t1=distance*b*b, t=(t0+t1)*.5;
    float h=sqrt(r*r+t*t+2.0*r*mu*t)-AT_R;
    vec3 den=atDensity(h);
    od+=(AT_RAY*den.x+vec3(AT_MIE_E*den.y)+AT_OZONE*den.z)*(t1-t0);
  }
  gl_FragColor=vec4(exp(-od),1.0);
}`;

export const MULTIPLE_FRAGMENT = /* glsl */`
varying vec2 vUv;
${ATMOSPHERE_GLSL}
void main() {
  vec2 q=clamp((vUv*vec2(128.0,48.0)-.5)/vec2(127.0,47.0),0.0,1.0);
  float sm=q.x*2.0-1.0; sm=sign(sm)*sm*sm;
  vec3 sourceDir=vec3(sqrt(max(0.0,1.0-sm*sm)),sm,0.0);
  vec3 origin=vec3(0.0,AT_R+.001+q.y*q.y*(AT_TOP-AT_R-.002),0.0);
  vec3 sumL=vec3(0.0),sumF=vec3(0.0);
  for(int j=0;j<64;j++) {
    // Equal-area, deterministic Fibonacci quadrature on the whole sphere.
    float y=1.0-2.0*(float(j)+.5)/64.0, a=float(j)*2.39996323;
    vec3 d=vec3(cos(a)*sqrt(1.0-y*y),y,sin(a)*sqrt(1.0-y*y));
    bool ground; float distance=atBoundary(origin,d,ground);
    vec3 T=vec3(1.0),L=vec3(0.0),F=vec3(0.0);
    for(int i=0;i<32;i++) {
      float a0=float(i)/32.0,a1=float(i+1)/32.0;
      float t0=distance*a0*a0,t1=distance*a1*a1,ds=t1-t0;
      vec3 p=origin+d*(t0+t1)*.5;
      vec3 scatter,extinct,ray,mie;
      atMedium(p,scatter,extinct,ray,mie);
      vec3 stepT=exp(-extinct*ds), integral=(vec3(1.0)-stepT)/max(extinct,vec3(.000001));
      L+=T*scatter*atSunTrans(p,sourceDir)*integral/(4.0*AT_PI);
      F+=T*scatter*integral;
      T*=stepT;
    }
    if(ground) {
      vec3 p=origin+d*distance, n=normalize(p);
      L+=T*${ATM.groundAlbedo}*atSunTrans(n*(AT_R+.001),sourceDir)*max(0.0,dot(n,sourceDir))/AT_PI;
    }
    sumL+=L/64.0; sumF+=F/64.0;
  }
  gl_FragColor=vec4(sumL/(vec3(1.0)-min(sumF,vec3(.999))),1.0);
}`;

export const SKY_VIEW_FRAGMENT = /* glsl */`
varying vec2 vUv;
${ATMOSPHERE_GLSL}
void main() {
  float y=vUv.y*2.0-1.0, elevation=sign(y)*y*y*(AT_PI*.5);
  float az=(vUv.x-.5)*2.0*AT_PI;
  vec3 d=vec3(cos(az)*cos(elevation),sin(elevation),sin(az)*cos(elevation));
  vec3 origin=vec3(0.0,AT_R+uAtHeight,0.0);
  bool ground; float distance=atBoundary(origin,d,ground);
  vec3 T=vec3(1.0),L=vec3(0.0);
  for(int i=0;i<64;i++) {
    float a=float(i)/64.0,b=float(i+1)/64.0;
    float t0=distance*a*a,t1=distance*b*b,ds=t1-t0;
    vec3 p=origin+d*(t0+t1)*.5;
    vec3 scatter,extinct,ray,mie;
    atMedium(p,scatter,extinct,ray,mie);
    vec3 stepT=exp(-extinct*ds);
    L+=T*atSource(p,d,ray,mie,scatter)*(vec3(1.0)-stepT)/max(extinct,vec3(.000001));
    T*=stepT;
  }
  if(ground) {
    vec3 p=normalize(origin+d*distance)*(AT_R+.001),n=normalize(p);
    vec3 E=atSunE()*(atSunTrans(p,uAtSun)*max(0.0,dot(n,uAtSun))+AT_PI*atMulti(p,uAtSun))
      +atMoonE()*(atSunTrans(p,uAtMoon)*max(0.0,dot(n,uAtMoon))+AT_PI*atMulti(p,uAtMoon));
    L+=T*${ATM.groundAlbedo}*E/AT_PI;
  }
  gl_FragColor=vec4(L,1.0);
}`;
