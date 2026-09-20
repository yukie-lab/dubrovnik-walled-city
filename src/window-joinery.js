import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {chamferedBlock} from './joinery.js';
import {chainMaterialShader} from './material-patch.js';

export const WINDOW_OPENING={width:.92,height:1.66};

function collection() {
  const pieces=[],ranges=[];
  let triangles=0;
  return {
    block(name,w,h,d,x,y,z,bevel,horizontal=false) {
      const g=chamferedBlock(w,h,d,x,y,z,bevel);
      // Each triangle has one true planar chart, including the small chamfers.
      // Interpolated bevel normals would bend that chart before instancing.
      g.computeVertexNormals();
      const count=g.attributes.position.count,id=pieces.length,a=new Float32Array(count*4);
      for(let i=0;i<count;i++)a.set([id,x,y,horizontal?1:0],i*4);
      g.setAttribute('aWindowPart',new THREE.BufferAttribute(a,4));
      const half=new Float32Array(count*3);
      for(let i=0;i<count;i++)half.set([w/2,h/2,d/2],i*3);
      g.setAttribute('aWindowHalf',new THREE.BufferAttribute(half,3));
      ranges.push({name,from:triangles,to:triangles+count/3});triangles+=count/3;
      pieces.push(g);
    },
    finish() {
      const g=mergeGeometries(pieces);g.userData.windowParts=ranges;
      pieces.forEach(p=>p.dispose());return g;
    },
  };
}

export function windowStoneGeometry() {
  const {width:w,height:h}=WINDOW_OPENING,c=collection(),depth=.22,z=depth/2-.075;
  // Jambs end at the opening, where the lintel and sill start. Their original
  // extra .30m produced coplanar overlapping front faces at both upper corners.
  for(const s of [-1,1])c.block(s<0?'jamb-left':'jamb-right',.17,h,depth,s*(w/2+.085),0,z,.005);
  c.block('lintel',w+.34,.17,depth,0,h/2+.085,z,.006);
  c.block('sill',w+.40,.12,.23,0,-h/2-.06,.025,.005);
  c.block('drip',w+.34,.045,.055,0,-h/2-.12-.045/2,.11,.0018);
  return c.finish();
}

export function windowSashGeometry() {
  const {width:w,height:h}=WINDOW_OPENING,c=collection(),edge=.042,stile=.058;
  const innerH=h-2*edge,halfSpan=w/2-edge-stile/2,z=.062,depth=.055;
  // Closed rebated timber pieces meet at their ends, so the glazing bars do
  // not float inside a stone opening or overlap each other's visible faces.
  for(const s of [-1,1]) {
    c.block(s<0?'sash-left':'sash-right',edge,innerH,depth,s*(w-edge)/2,0,z,.0015);
    c.block(s<0?'sash-bottom':'sash-top',w,edge,depth,0,s*(h-edge)/2,z,.0015,true);
  }
  c.block('meeting-stile',stile,innerH,depth,0,0,z,.0015);
  for(const [name,y,barH] of [['upper',h*.12,.052],['lower',-h*.26,.046]])for(const s of [-1,1])
    c.block(`${name}-${s<0?'left':'right'}`,halfSpan,barH,depth,s*(stile+halfSpan)/2,y,z,.0015,true);
  return c.finish();
}

export function windowSeeds(geometry,windows) {
  geometry.setAttribute('aWindowSeed',new THREE.InstancedBufferAttribute(Float32Array.from(windows,w=>w.seed),1));
}

// A face's orthonormal chart must be built *after* anisotropic window scaling.
// Rotation does not change metres; translation must not change its weathering.
export function patchWindowMaterial(material,kind,coverM=.9) {
  chainMaterialShader(material,`window-${kind}-v2:${coverM}`,sh=>{
    sh.vertexShader=sh.vertexShader.replace('#include <common>',`#include <common>
      attribute vec4 aWindowPart; attribute vec3 aWindowHalf; attribute float aWindowSeed;
      varying vec3 vWindowP; varying vec3 vWindowTraits;
      float windowHashV(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}`)
      .replace('#include <uv_vertex>',`#include <uv_vertex>
        vec3 windowScale=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
        vWindowP=position*windowScale;
        vWindowTraits=vec3(aWindowSeed,aWindowPart.x,windowScale.y);
        vec3 windowN=normalize(normal/windowScale);
        vec3 windowU=abs(windowN.y)>.9999 ? vec3(1,0,0) : normalize(vec3(windowN.z,0,-windowN.x));
        vec3 windowV=normalize(cross(windowN,windowU));
        ${kind==='stone'?`
        vec2 windowUV=vec2(dot(vWindowP,windowU),dot(vWindowP,windowV))/${coverM.toFixed(8)};
        windowUV+=vec2(windowHashV(vec2(aWindowSeed*37.0,aWindowPart.x)),
          windowHashV(vec2(aWindowSeed*71.0,aWindowPart.x+17.0)))*7.0;`
        :`
        vec3 grainAxis=aWindowPart.w>.5 ? vec3(1,0,0) : vec3(0,1,0);
        vec3 longGrain=grainAxis-windowN*dot(grainAxis,windowN);
        if(length(longGrain)>.01)windowV=normalize(longGrain);
        windowU=normalize(cross(windowV,windowN));
        vec3 timberP=vWindowP-vec3(aWindowPart.yz,.062)*windowScale;
        float plank=floor(windowHashV(vec2(aWindowSeed*31.0,aWindowPart.x))*6.0);
        // The source has dark end grain at its vertical boundary. Fit one
        // complete member inside it, using its real scaled length and chamfers.
        float halfRun=dot(abs(windowV),aWindowHalf*windowScale)/3.2;
        float endMargin=.075+halfRun;
        float timberCentre=mix(endMargin,1.0-endMargin,
          windowHashV(vec2(aWindowSeed*59.0,aWindowPart.x+29.0)));
        vec2 windowUV=vec2((plank+.5)/6.0+dot(timberP,windowU)/.9,
          dot(timberP,windowV)/3.2+timberCentre);`}
        #ifdef USE_MAP
          vMapUv=(mapTransform*vec3(windowUV,1)).xy;
        #endif
        #ifdef USE_NORMALMAP
          vNormalMapUv=(normalMapTransform*vec3(windowUV,1)).xy;
        #endif`);
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>',`#include <common>
      varying vec3 vWindowP; varying vec3 vWindowTraits;
      float windowHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float windowNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(windowHash(i),windowHash(i+vec2(1,0)),f.x),
          mix(windowHash(i+vec2(0,1)),windowHash(i+vec2(1,1)),f.x),f.y);}`);
    const field=kind==='stone'?`
      float pieceTone=windowHash(vec2(vWindowTraits.x*43.0,vWindowTraits.y*17.0));
      float grain=windowNoise(vWindowP.xy*23.0+vWindowTraits.x*31.0);
      float run=windowNoise(vWindowP.xy*vec2(39.0,2.3)+vWindowTraits.x*73.0);
      float sillY=-${(WINDOW_OPENING.height/2).toFixed(8)}*vWindowTraits.z;
      float sillWear=exp(-abs(vWindowP.y-sillY)*11.0)*smoothstep(.32,.76,run);
      float shelter=exp(-abs(vWindowP.y+sillY)*9.0)*smoothstep(.38,.78,grain);
      float patina=.10*sillWear+.065*shelter;
      diffuseColor.rgb*=mix(.92,1.08,pieceTone)*(1.0-patina);
    `:`
      float grain=windowNoise(vWindowP.xy*vec2(63.0,3.1)+vWindowTraits.x*41.0);
      float patina=smoothstep(.40,.78,grain)*(.15+.45*vWindowTraits.x);
      diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.16,1.12,1.04),patina);
    `;
    sh.fragmentShader=sh.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>${field}`)
      .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
        roughnessFactor=clamp(roughnessFactor+.12*(grain-.5)${kind==='stone'?'+patina*.55':''},.65,.94);`);
  });
}
