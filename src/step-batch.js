import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {makeStepStone} from './step-stone.js';
import {patchSkyVisInstanced} from './skyvis.js';
import {tagMesh} from './util.js';
import {chainMaterialShader} from './material-patch.js';

export function makeStepBatch(items,tex,skyAt,stairLayouts=new Map(),stairShadows=null) {
  const pieces=[],solids=[],tint=new THREE.Color();let from=0;
  for(let i=0;i<items.length;i++) {
    const q=items[i],g=makeStepStone(q,{coverM:tex.paving.coverM}),c=g.attributes.color;
    tint.setHSL(.10,q.wallStair?.075:.15,(q.wallStair?.91:.775)*q.tint,THREE.SRGBColorSpace);
    for(let j=0;j<c.count;j++)c.setXYZ(j,c.getX(j)*tint.r,c.getY(j)*tint.g,c.getZ(j)*tint.b);
    // Preserve the existing scalar sky response. A merged stone stores the
    // same value on its vertices instead of an instance attribute.
    const sky=skyAt ? skyAt(q.x,q.z,q.y+.25,0,1,0) : 1;
    const localSky=q.wallStair&&stairLayouts.get(q.wallStair.id)?.skyAt;
    const visibility=new Float32Array(c.count).fill(sky);
    if(q.wallStair?.enclosed&&localSky) {
      const p=g.attributes.position,n=g.attributes.normal;
      for(let j=0;j<c.count;j++)visibility[j]*=localSky(p.getX(j),p.getZ(j),p.getY(j)+.025,n.getX(j),n.getY(j),n.getZ(j));
    }
    g.setAttribute('aSkyI',new THREE.Float32BufferAttribute(visibility,1));
    const room=q.wallStair?stairLayouts.get(q.wallStair.id)?.shadowRoom||0:0;
    g.setAttribute('aStairRoom',new THREE.Float32BufferAttribute(new Float32Array(c.count).fill(room),1));
    const to=from+g.index.count/3;
    solids.push({id:i,kind:'step',x:q.x,z:q.z,from,to});from=to;pieces.push(g);
  }
  const geometry=mergeGeometries(pieces);geometry.userData.solids=solids;pieces.forEach(g=>g.dispose());
  const material=new THREE.MeshStandardMaterial({
    map:tex.paving.map,normalMap:tex.paving.normalMap,roughnessMap:tex.paving.roughnessMap,
    vertexColors:true,roughness:.70,metalness:0,envMapIntensity:.55,
  });
  material.onBeforeCompile=sh=>{
    sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute float aWear; varying float vStepWear;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvStepWear=aWear*clamp(normal.y,0.0,1.0);');
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying float vStepWear;')
      .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor*=mix(1.0,.60,vStepWear);');
  };
  material.customProgramCacheKey=()=>'wornStepStone';patchSkyVisInstanced(material);
  chainMaterialShader(material,'wallTreadStone-v3-metric',sh=>{
    sh.uniforms.uStairMap={value:tex.dressed.map};sh.uniforms.uStairNormal={value:tex.dressed.normalMap};
    sh.uniforms.uStairCover={value:tex.dressed.coverM};
    // Merged street steps retain paving UVs. Convert those UVs back to metres
    // before sampling the wall stair's dressed stone (not five-metre stone).
    sh.uniforms.uStairSourceCover={value:tex.paving.coverM};
    sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute vec4 aStair; varying vec4 vStair;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvStair=aStair;');
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>',`#include <common>
      varying vec4 vStair; uniform sampler2D uStairMap; uniform sampler2D uStairNormal; uniform float uStairCover, uStairSourceCover;
      float stepHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float stepNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(stepHash(i),stepHash(i+vec2(1,0)),f.x),mix(stepHash(i+vec2(0,1)),stepHash(i+1.0),f.x),f.y);}`)
      .replace('#include <map_fragment>',`#ifdef USE_MAP
        diffuseColor*=mix(texture2D(map,vMapUv),texture2D(uStairMap,vMapUv*uStairSourceCover/uStairCover),vStair.x);
        if(vStair.x>.5){
          vec2 stoneMetres=vMapUv*uStairSourceCover;
          float grain=stepNoise(stoneMetres*83.0),mineral=stepNoise(stoneMetres*7.3),weather=stepNoise(stoneMetres*2.4+11.9);
          float grit=vStair.z*smoothstep(.39,.68,grain);
          float moss=vStair.w*smoothstep(.34,.72,mineral);
          float pits=smoothstep(.73,.89,grain)*(1.0-.85*vStair.y);
          diffuseColor.rgb*=1.0+.22*(mineral-.5)+.16*(weather-.5)-.065*vStair.y-.18*pits;
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.20,.178,.135),grit*.46);
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.065,.081,.035),moss*.72);
        }
      #endif`)
      .replace('#include <normal_fragment_maps>',THREE.ShaderChunk.normal_fragment_maps.replaceAll(
        'texture2D( normalMap, vNormalMapUv ).xyz',
        'mix(texture2D(normalMap,vNormalMapUv).xyz,mix(texture2D(uStairNormal,vNormalMapUv*uStairSourceCover/uStairCover).xyz,vec3(.5,.5,1.0),.78*vStair.y),vStair.x)'))
      .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
        roughnessFactor=mix(roughnessFactor,mix(.89,.40,vStair.y)*(1.0+.09*vStair.z),vStair.x);`)
      .replace('roughnessFactor*=mix(1.0,.60,vStepWear);','roughnessFactor*=mix(1.0,.60,vStepWear*(1.0-vStair.x));');
  });
  stairShadows?.patch(material);
  const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;
  return tagMesh(mesh,'steps',{solid:true,masonry:true,groundContact:true,buriedBase:true,steps:items});
}
