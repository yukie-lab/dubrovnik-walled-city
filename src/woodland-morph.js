import * as THREE from 'three';

export const woodlandMorphGLSL=`
attribute vec2 aLeafGrowth;
uniform sampler2D uLeafMorph;
uniform vec2 uLeafMorphSize;
vec3 woodlandLeafPosition(vec3 p) {
  vec2 uv=(vec2(mod(aLeafGrowth.x,uLeafMorphSize.x),floor(aLeafGrowth.x/uLeafMorphSize.x))+.5)/uLeafMorphSize;
  vec2 state=texture2D(uLeafMorph,uv).rg;
  float parity=mod(floor(aLeafGrowth.y/state.x),2.0);
  float scale=sqrt(state.x*(1.0+state.y*(1.0-2.0*parity)));
  return (p+vec3(0,.5,0))*scale-vec3(0,.5,0);
}
`;

export function makeLeafMorph(mesh,trees) {
  const width=Math.ceil(Math.sqrt(trees.length)),height=Math.ceil(trees.length/width),data=new Float32Array(width*height*4);
  for(let i=0;i<width*height;i++)data[i*4]=1;
  const texture=new THREE.DataTexture(data,width,height,THREE.RGBAFormat,THREE.FloatType);
  texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
  const ids=new Float32Array(mesh.count*2);
  trees.forEach((t,id)=>{for(let i=t.leafFrom;i<t.leafTo;i++){ids[i*2]=id;ids[i*2+1]=i-t.leafFrom;}});
  mesh.geometry.setAttribute('aLeafGrowth',new THREE.InstancedBufferAttribute(ids,2));
  const morph={texture,width,height,data};
  for(const material of [mesh.material,mesh.customDepthMaterial]) {
    const previous=material.onBeforeCompile,key=material.customProgramCacheKey.bind(material);
    material.onBeforeCompile=(sh,r)=>{
      previous(sh,r);sh.uniforms.uLeafMorph={value:texture};sh.uniforms.uLeafMorphSize={value:new THREE.Vector2(width,height)};
      sh.vertexShader=sh.vertexShader.replace('#include <common>',`#include <common>\n${woodlandMorphGLSL}`)
        .replaceAll('instanceMatrix*vec4(position,1.0)','instanceMatrix*vec4(woodlandLeafPosition(position),1.0)');
    };
    material.customProgramCacheKey=()=>key()+'-leaf-morph-1';material.userData.leafMorph=morph;
  }
  mesh.userData.leafMorph=morph;return morph;
}
