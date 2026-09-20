import * as THREE from 'three';
import {rngFor} from './seed.js';
import {chainMaterialShader} from './material-patch.js';

export const RUNOFF_IMAGE={width:128,height:256,layers:64};
const fade=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

// Each array slice contains a different set of deposits. Thin, meandering
// cores sit inside diffuse wash, break up on the stone grain, and lose mass
// towards their tails. Array mipmaps cannot bleed into a neighbouring stain.
export function runoffPixels() {
  const {width:w,height:h,layers}=RUNOFF_IMAGE,data=new Uint8Array(w*h*layers*4);
  for(let layer=0;layer<layers;layer++) {
    const rng=rngFor(0x74a19000+layer),deposits=new Float32Array(w*h);
    const channels=5+Math.floor(rng()*5),tone=rng();
    for(let channel=0;channel<channels;channel++) {
      const start=(.08+.84*rng())*w,length=(.27+.69*rng())*h;
      const radius=.65+rng()*1.65,strength=.25+rng()*.50;
      const bend=(rng()-.5)*5,phase=rng()*Math.PI*2,frequency=4+rng()*7;
      for(let y=0;y<length;y++) {
        const s=y/length,centre=start+bend*s+Math.sin(s*frequency+phase)*1.3*s;
        const sigma=radius*(1+.75*s+.2*Math.sin(s*19+phase));
        const tail=Math.pow(1-s,1.05),span=sigma*9;
        for(let x=Math.max(0,Math.floor(centre-span));x<Math.min(w,Math.ceil(centre+span));x++) {
          const d=(x-centre)/sigma;
          const core=Math.exp(-.5*d*d),wash=.30*Math.exp(-.5*d*d/12.96);
          const amount=strength*tail*(core+wash),i=y*w+x;
          deposits[i]=1-(1-deposits[i])*(1-amount);
        }
      }
    }
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      const i=(layer*w*h+y*w+x)*4;
      const grain=.79+.13*Math.sin(x*1.7+y*.9+tone*8)+.16*rng();
      const edge=fade(0,5,x)*fade(0,5,w-1-x)*fade(0,8,h-1-y);
      data[i]=Math.round(67+tone*9);data[i+1]=Math.round(62+tone*7);data[i+2]=Math.round(51+tone*5);
      data[i+3]=Math.round(255*Math.min(.78,deposits[y*w+x]*grain)*edge);
    }
  }
  return data;
}

export function runoffTexture() {
  const {width,height,layers}=RUNOFF_IMAGE;
  const texture=new THREE.DataArrayTexture(runoffPixels(),width,height,layers);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
  texture.generateMipmaps=true;texture.needsUpdate=true;
  return texture;
}

export function runoffTraits(geometry,windows) {
  const a=new Float32Array(windows.length*4),layers=RUNOFF_IMAGE.layers;
  windows.forEach((w,i)=>{
    // Some facade generators reuse a window seed. The source site also owns
    // its deposits; it must not inherit an identical stain from another wall.
    const salt=((w.seed*0x100000000)>>>0)^Math.imul((w.x*4096)|0,73856093)
      ^Math.imul((w.y*4096)|0,19349663)^Math.imul((w.z*4096)|0,83492791);
    const rng=rngFor(salt),first=Math.floor(rng()*layers);
    a.set([first,(first+1+Math.floor(rng()*(layers-1)))%layers,.18+rng()*.64,.72+rng()*.28],i*4);
  });
  geometry.setAttribute('aRunoffTraits',new THREE.InstancedBufferAttribute(a,4));
}

export function patchRunoffMaterial(material) {
  const atlas=runoffTexture();material.userData.runoffAtlas=atlas;
  chainMaterialShader(material,'window-runoff-array-v2',shader=>{
    shader.uniforms.uRunoffAtlas={value:atlas};
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      attribute vec4 aRunoffTraits;varying vec4 vRunoffTraits;varying vec2 vRunoffUv;`)
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        vRunoffTraits=aRunoffTraits;vRunoffUv=vec2(position.x+.5,-position.y);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      uniform highp sampler2DArray uRunoffAtlas;
      varying vec4 vRunoffTraits;varying vec2 vRunoffUv;`)
      .replace('#include <color_fragment>',`#include <color_fragment>
        vec4 runoffA=texture(uRunoffAtlas,vec3(vRunoffUv,vRunoffTraits.x));
        vec4 runoffB=texture(uRunoffAtlas,vec3(1.0-vRunoffUv.x,vRunoffUv.y,vRunoffTraits.y));
        vec4 runoff=mix(runoffA,runoffB,vRunoffTraits.z);
        diffuseColor.rgb*=runoff.rgb;diffuseColor.a*=runoff.a*vRunoffTraits.w;`);
  });
  return material;
}

// Derive the runoff's source from the actual solid and its instance transform.
// A separately repeated nominal sill height drifts whenever joinery changes.
export function windowDripBottoms(frames) {
  const range=frames.geometry.userData.windowParts.find(p=>p.name==='drip');
  if(!range)throw new Error('Runoff needs the generated window drip solid');
  const p=frames.geometry.attributes.position,m=frames.instanceMatrix.array;
  return Float64Array.from({length:frames.count},(_,i)=>{
    let bottom=Infinity;const o=i*16;
    for(let j=range.from*3;j<range.to*3;j++)
      bottom=Math.min(bottom,m[o+1]*p.getX(j)+m[o+5]*p.getY(j)+m[o+9]*p.getZ(j)+m[o+13]);
    return bottom;
  });
}
