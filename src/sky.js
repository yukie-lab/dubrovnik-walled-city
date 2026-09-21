// Physical atmosphere: no painted dome, colour ramps, brush warp or sky grade.
import * as THREE from 'three';
import { clamp, smoothstep, tagMesh } from './util.js';
import { ATM, solarPosition, directIrradiance, luminance } from './atmosphere-model.js';
import { ATMOSPHERE_GLSL } from './atmosphere-glsl.js';

export const SUNRISE=6, SUNSET=19.74, NOON=12.87, SKY_GAIN=1;
export function sunState(time) {
  const t=clamp(time,4.6,23.7),s=solarPosition(t);
  const dir=new THREE.Vector3(...s.dir),moonDir=dir.clone().negate();
  const solar=directIrradiance(.02,dir.y),lunar=directIrradiance(.02,moonDir.y,'moon');
  const sunIntensity=luminance(solar),moonIntensity=luminance(lunar);
  const sunCol=new THREE.Color(...solar).multiplyScalar(1/Math.max(sunIntensity,1e-20));
  const moonCol=new THREE.Color(...lunar).multiplyScalar(1/Math.max(moonIntensity,1e-20));
  const night=smoothstep(-3,-18,s.el),dusk=smoothstep(12,-1,s.el);
  return {time:t,el:s.el,az:s.az,dir,moonDir,sunCol,sunIntensity,moonCol,moonIntensity,
    night,dusk,glow:1-night,warm:dusk*(1-night),am:1/Math.max(.025,dir.y),
    zenith:new THREE.Color(0,0,0),horizon:new THREE.Color(0,0,0),horizonFar:new THREE.Color(0,0,0),
    hemiSky:new THREE.Color(0,0,0),hemiGround:new THREE.Color(0,0,0),
    fogCol:new THREE.Color(0,0,0),fogFar:new THREE.Color(0,0,0),ghi:0,starAlpha:night};
}

// Compatibility with the protected water shader. Its reflection now samples
// the atmosphere itself; the water BRDF still owns the resolved solar glint.
export const SKY_RADIANCE_GLSL=ATMOSPHERE_GLSL+/* glsl */`
vec3 skyRadiance(vec3 d,vec3 zen,vec3 hor,vec3 horFar,vec3 sunDir,vec3 sunCol,float dusk,float sunK) {
  return atSkyRadiance(d);
}`;

const vertexShader=/* glsl */`
  varying vec3 vDir;
  void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_Position.z=gl_Position.w;}`;
const fragmentShader=/* glsl */`
  varying vec3 vDir;
  ${ATMOSPHERE_GLSL}
  void main(){
    vec3 d=normalize(vDir),p=vec3(0.0,AT_R+uAtHeight,0.0);
    vec3 L=atSkyRadiance(d);
    float aa=max(length(fwidth(d)),.000015);
    float sunAngle=acos(clamp(dot(d,uAtSun),-1.0,1.0));
    float moonAngle=acos(clamp(dot(d,uAtMoon),-1.0,1.0));
    float sunDisc=1.0-smoothstep(${ATM.sunRadius}-aa,${ATM.sunRadius}+aa,sunAngle);
    float moonDisc=1.0-smoothstep(${ATM.moonRadius}-aa,${ATM.moonRadius}+aa,moonAngle);
    // The disk solid angle converts irradiance to radiance. Extinction applies
    // along the actual pixel ray, so Earth occludes each edge continuously.
    vec3 T=atTransmittance(p,d);
    L+=T*(atSunE()*sunDisc/(AT_PI*${ATM.sunRadius ** 2})
      +atMoonE()*moonDisc/(AT_PI*${ATM.moonRadius ** 2}));
    gl_FragColor=vec4(L,1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function starCatalogue() {
  // Seeded distribution follows N(<m) proportional to 10^(0.45m); magnitude
  // controls flux, never arbitrary alpha. 4,200 naked-eye stars in a single draw.
  let seed=730891;
  const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const P=[],C=[],F=[];
  for(let i=0;i<4200;i++) {
    const y=2*rand()-1,a=rand()*Math.PI*2,r=Math.sqrt(1-y*y);
    P.push(Math.cos(a)*r*4500,y*4500,Math.sin(a)*r*4500);
    const magnitude=Math.log10(1+rand()*(10**(6.5*.45)-1))/.45;
    // Three representative stellar continua, weighted toward F/G/K stars.
    const temperature=rand(),colour=temperature<.20?[1,.58,.30]:temperature>.82?[.68,.81,1]:[1,.91,.77];
    const Y=luminance(colour);C.push(...colour.map(c=>c/Y));
    F.push(2.54e-6/ATM.luxPerUnit*10**(-.4*magnitude));
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));
  g.setAttribute('color',new THREE.Float32BufferAttribute(C,3));g.setAttribute('aFlux',new THREE.Float32BufferAttribute(F,1));
  return g;
}
export function makeSky() {
  const group=new THREE.Group();
  const uniforms={};
  const mat=new THREE.ShaderMaterial({uniforms,vertexShader,fragmentShader,side:THREE.BackSide,
    depthWrite:false,fog:false});
  const dome=new THREE.Mesh(new THREE.SphereGeometry(5200,32,20),mat);
  dome.frustumCulled=false;dome.renderOrder=-20;
  group.add(tagMesh(dome,'sky.dome',{thin:true,reason:'atmospheric radiance at infinity',noCollide:true,backdrop:true}));
  const starUniforms={uStarPixel:{value:1e-6},uStarDPR:{value:1},uSidereal:{value:0}};
  const stars=new THREE.Points(starCatalogue(),new THREE.ShaderMaterial({uniforms:starUniforms,
    vertexColors:true,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,fog:false,
    vertexShader:/* glsl */`
      attribute float aFlux;
      uniform float uStarPixel,uStarDPR,uSidereal;
      varying vec3 vStarL;
      ${ATMOSPHERE_GLSL}
      void main(){
        // Rotate about the actual north celestial pole at 42.6407° latitude.
        vec3 axis=vec3(0.0,.6774,-.7356),d=normalize(position);
        d=d*cos(uSidereal)+cross(axis,d)*sin(uSidereal)+axis*dot(axis,d)*(1.0-cos(uSidereal));
        vec3 p=vec3(0.0,AT_R+uAtHeight,0.0);
        vec3 T=atTransmittance(p,d);
        vStarL=color*T*aFlux/max(uStarPixel,1e-10);
        gl_Position=projectionMatrix*viewMatrix*vec4(cameraPosition+d*4500.0,1.0);
        gl_PointSize=3.2*uStarDPR;
      }`,
    fragmentShader:/* glsl */`
      varying vec3 vStarL;uniform float uStarDPR;
      void main(){vec2 p=(gl_PointCoord-.5)*3.2*uStarDPR;
        float sigma=.48*uStarDPR;
        float psf=exp(-dot(p,p)/(2.0*sigma*sigma))/(6.2831853*sigma*sigma);
        gl_FragColor=vec4(vStarL*psf,1.0);
      }`}));
  stars.frustumCulled=false;stars.renderOrder=-19;
  group.add(tagMesh(stars,'sky.stars',{thin:true,reason:'unresolved astronomical sources',noCollide:true,backdrop:true}));
  function bindAtmosphere(u) {Object.assign(uniforms,u);Object.assign(starUniforms,u);}
  function update(sun,elapsed,camPos,camera,renderer) {
    dome.position.copy(camPos);
    starUniforms.uSidereal.value=(sun.time-NOON)*Math.PI/12;
    if(renderer&&camera) {
      const size=renderer.getDrawingBufferSize(new THREE.Vector2());
      starUniforms.uStarPixel.value=(2*Math.tan(camera.fov*Math.PI/360)/size.y)**2;
      starUniforms.uStarDPR.value=renderer.getPixelRatio();
    }
  }
  return {group,update,bindAtmosphere,uniforms};
}
