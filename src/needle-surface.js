import * as THREE from 'three';
import {mulberry32} from './util.js';

let cached;
export function needleTexture() {
  if(cached)return cached;
  const S=256,rnd=mulberry32(0x70696e65),alpha=new Float32Array(S*S);
  const stroke=(ax,ay,bx,by,width)=>{
    const dx=bx-ax,dy=by-ay,dd=dx*dx+dy*dy;
    for(let y=Math.max(0,Math.floor(Math.min(ay,by)-width-1));y<=Math.min(S-1,Math.ceil(Math.max(ay,by)+width+1));y++)
      for(let x=Math.max(0,Math.floor(Math.min(ax,bx)-width-1));x<=Math.min(S-1,Math.ceil(Math.max(ax,bx)+width+1));x++) {
        const t=Math.max(0,Math.min(1,((x+.5-ax)*dx+(y+.5-ay)*dy)/dd));
        const distance=Math.hypot(x+.5-ax-t*dx,y+.5-ay-t*dy),w=width*(1-t*.65);
        const a=Math.max(0,Math.min(1,w+.65-distance));alpha[y*S+x]=Math.max(alpha[y*S+x],a);
      }
  };
  // Needles grow in pairs along connected shoots. The former uniformly
  // filled mask read as a broad leaf, especially after mip amplification.
  stroke(.5*S,0,.5*S,.78*S,.003*S);
  for(let k=0;k<15;k++) {
    const side=k%2 ? -1 : 1,y=.10+k*.043,angle=side*(.65+rnd()*.25);
    const length=.13+rnd()*.05,dx=Math.sin(angle)*length/.30,dy=Math.cos(angle)*length/.40;
    const ex=.5+dx,ey=y+dy;stroke(.5*S,y*S,ex*S,ey*S,.0018*S);
    for(let i=0;i<18;i++) {
      const t=.06+i/19,x=.5+dx*t,yy=y+dy*t;
      for(const pair of [-1,1]) {
        const a=angle+pair*(.4+rnd()*.30),l=.06+rnd()*.035;
        stroke(x*S,yy*S,(x+Math.sin(a)*l/.30)*S,(yy+Math.cos(a)*l/.40)*S,.0018*S);
      }
    }
  }
  let inside=0,covered=0;
  for(let y=0;y<S;y++)for(let x=0;x<S;x++) {
    const inLeaf=Math.abs((x+.5)/S-.5)+Math.abs((y+.5)/S-.5)<=.5;
    if(inLeaf){inside++;if(alpha[y*S+x]>=.44)covered++;}
  }
  const mips=[];let size=S,level=alpha;
  while(size>=1) {
    const rgba=new Uint8Array(size*size*4);
    for(let i=0;i<level.length;i++){rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=255;rgba[i*4+3]=Math.round(Math.min(1,level[i])*255);}
    mips.push({data:rgba,width:size,height:size});if(size===1)break;
    const next=new Float32Array(size*size/4),n=size/2;
    for(let y=0;y<n;y++)for(let x=0;x<n;x++)next[y*n+x]=(level[(y*2)*size+x*2]+level[(y*2)*size+x*2+1]+
      level[(y*2+1)*size+x*2]+level[(y*2+1)*size+x*2+1])*.25;
    // Match the base cutout coverage at each resolvable mip. Do not apply a
    // cumulative gain: that turns the entire spray into an opaque diamond.
    if(n>=2) {
      const values=[];for(let y=0;y<n;y++)for(let x=0;x<n;x++)
        if(Math.abs((x+.5)/n-.5)+Math.abs((y+.5)/n-.5)<=.5)values.push(next[y*n+x]);
      values.sort((a,b)=>b-a);
      const boundary=values[Math.min(values.length-1,Math.floor(values.length*covered/inside))];
      const gain=.44/Math.max(.025,boundary);
      for(let i=0;i<next.length;i++)next[i]=Math.min(1,next[i]*gain);
    } else next[0]=.5;
    level=next;size=n;
  }
  const tex=new THREE.DataTexture(mips[0].data,S,S,THREE.RGBAFormat);tex.mipmaps=mips;
  tex.generateMipmaps=false;tex.minFilter=THREE.LinearMipmapLinearFilter;tex.magFilter=THREE.LinearFilter;
  tex.userData.coverage=covered/inside;tex.needsUpdate=true;cached=tex;return tex;
}

export function patchNeedleSurface(mat) {
  const previous=mat.onBeforeCompile,key=mat.customProgramCacheKey.bind(mat),texture=needleTexture();
  mat.alphaTest=.44;
  mat.onBeforeCompile=(sh,r)=>{
    previous(sh,r);sh.uniforms.uNeedles={value:texture};
    sh.vertexShader=sh.vertexShader.replace('#include <common>',`#include <common>
      attribute float aNeedle;varying float vNeedle;varying vec2 vNeedleUV;`)
      .replace('#include <begin_vertex>',`vNeedle=aNeedle;vNeedleUV=position.xy+vec2(.5);
        #include <begin_vertex>`);
    // Wind replaces begin_vertex, so use a hook retained by both its color
    // and depth paths. These varyings follow the original leaf coordinates.
    if(!sh.vertexShader.includes('vNeedle=aNeedle;'))sh.vertexShader=sh.vertexShader.replace('mat3 woodlandJ;',
      'vNeedle=aNeedle;vNeedleUV=position.xy+vec2(.5);mat3 woodlandJ;');
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>',`#include <common>
      uniform sampler2D uNeedles;varying float vNeedle;varying vec2 vNeedleUV;`)
      .replace('#include <alphatest_fragment>',`if(vNeedle>.5)diffuseColor.a*=texture2D(uNeedles,vNeedleUV).a;
        #include <alphatest_fragment>`);
  };
  mat.customProgramCacheKey=()=>key()+'-needles-2';return mat;
}
