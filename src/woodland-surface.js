// Local foliage porosity and bark grain. The same object-space density field
// clips both color and depth, and follows the tree when its world position bends.
const field=`
varying vec3 vWoodlandP;
varying vec3 vWoodlandGrain;
varying float vWoodlandLeaf;
float woodlandHash(vec3 p) {
  p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);
}
float woodlandNoise(vec3 p) {
  vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(mix(woodlandHash(i),woodlandHash(i+vec3(1,0,0)),f.x),
                 mix(woodlandHash(i+vec3(0,1,0)),woodlandHash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(woodlandHash(i+vec3(0,0,1)),woodlandHash(i+vec3(1,0,1)),f.x),
                 mix(woodlandHash(i+vec3(0,1,1)),woodlandHash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float woodlandDensity(vec3 p) {
  return woodlandNoise(p*13.0)*.72+woodlandNoise(p*37.0)*.28;
}
`;

export function patchWoodlandSurface(mat,{depth=false}={}) {
  const previous=mat.onBeforeCompile,key=mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile=(sh,r)=>{
    previous(sh,r);
    sh.vertexShader=sh.vertexShader.replace('#include <common>',`#include <common>
      attribute float aLeaf;attribute vec3 aGrain;
      varying vec3 vWoodlandP;varying vec3 vWoodlandGrain;varying float vWoodlandLeaf;`)
      .replace('#include <project_vertex>',`vWoodlandP=position+vec3(aTree.z*17.3,0,aTree.z*9.7);
        vWoodlandGrain=aGrain;vWoodlandLeaf=aLeaf;
        #include <project_vertex>`);
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>',`#include <common>\n${field}`)
      .replace('#include <alphatest_fragment>',`
        float foliageDensity=1.0;
        if(vWoodlandLeaf>.5) {
          foliageDensity=woodlandDensity(vWoodlandP);
          // Analytic footprint averaging prevents subpixel leaf holes from
          // flickering as the camera crosses the shore or turns along a wall.
          float footprint=max(length(dFdx(vWoodlandP)),length(dFdy(vWoodlandP)));
          float resolved=1.0-smoothstep(.055,.24,footprint);
          if(mix(.64,foliageDensity,resolved)<.37)discard;
        }
        #include <alphatest_fragment>`);
    if(!depth)sh.fragmentShader=sh.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float woodlandHeight=0.0;
      if(vWoodlandLeaf>.5) {
        float n=woodlandDensity(vWoodlandP);
        float twig=woodlandNoise(vWoodlandP*3.7);
        diffuseColor.rgb*=.57+.50*n+.18*twig;
        woodlandHeight=n*.017;
      } else {
        // Angle is reconstructed from a continuous circle pair; the wrapped
        // UV seam cannot produce the wide stripe of a linear angle attribute.
        float angle=atan(vWoodlandGrain.y,vWoodlandGrain.x);
        float wobble=woodlandNoise(vec3(vWoodlandGrain.xy*5.0,vWoodlandGrain.z*2.7));
        float ridge=sin(angle*19.0+wobble*3.2);
        float plates=woodlandNoise(vec3(vWoodlandGrain.xy*16.0,vWoodlandGrain.z*5.0));
        float fissure=smoothstep(.42,.78,ridge)*(.5+.5*plates);
        diffuseColor.rgb*=.62+.3*plates-.28*fissure;
        woodlandHeight=(1.0-fissure)*.004;
      }`).replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      vec3 woodDx=dFdx(-vViewPosition),woodDy=dFdy(-vViewPosition);
      vec3 woodR1=cross(woodDy,normal),woodR2=cross(normal,woodDx);
      float woodDet=dot(woodDx,woodR1);
      if(abs(woodDet)>1e-12) {
        vec3 gradient=(woodR1*dFdx(woodlandHeight)+woodR2*dFdy(woodlandHeight))/woodDet;
        normal=normalize(normal-clamp(gradient,vec3(-.75),vec3(.75)));
      }`);
  };
  mat.customProgramCacheKey=()=>key()+`-woodland-surface-1-${depth}`;
  return mat;
}
