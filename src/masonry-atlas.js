import * as THREE from 'three';
import {masonryFields,masonryFinishes} from './masonry.js';
import {chainMaterialShader} from './material-patch.js';

const columns=8,rows=8,tileWidth=256,tileHeight=128,pad=4;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));

// Store individual quarry stones instead of repeating a whole wall. Colour,
// relief and roughness keep the same mask, chips, grain and physical dimensions.
// The runtime chooses a stone per unbounded masonry cell, never per object ID.
export function masonryAtlasFields() {
  const source=masonryFields(masonryFinishes.fortStone),n=source.size,px=n/source.coverM;
  const width=columns*tileWidth,height=rows*tileHeight;
  const color=new Uint8ClampedArray(width*height*4),normal=new Uint8ClampedArray(color.length),roughness=new Uint8ClampedArray(color.length);
  const stones=Array.from({length:columns*rows},(_,i)=>source.stones[i%source.stones.length]);
  for(let k=0;k<stones.length;k++) {
    const stone=stones[k],ox=k%columns*tileWidth,oy=Math.floor(k/columns)*tileHeight;
    for(let y=0;y<tileHeight;y++)for(let x=0;x<tileWidth;x++) {
      const u=clamp((x-pad)/(tileWidth-2*pad-1)),v=clamp((y-pad)/(tileHeight-2*pad-1));
      const sx=(stone.x+u*stone.w)*px-.5,sy=(stone.y+v*stone.h)*px-.5;
      const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
      const index=(x,y)=>(((y%n+n)%n)*n+(x%n+n)%n)*4;
      const corners=[index(ix,iy),index(ix+1,iy),index(ix,iy+1),index(ix+1,iy+1)];
      const weights=[(1-fx)*(1-fy),fx*(1-fy),(1-fx)*fy,fx*fy],offset=((oy+y)*width+ox+x)*4;
      for(const [input,output] of [[source.color,color],[source.normal,normal]])for(let c=0;c<3;c++) {
        let value=0;for(let j=0;j<4;j++)value+=input[corners[j]+c]*weights[j];output[offset+c]=value;
      }
      let rough=0;for(let j=0;j<4;j++)rough+=source.roughness[corners[j]+1]*weights[j];
      // R/B are unused by Three's roughness map. Carry metre dimensions there
      // so normal slopes retain their depth when a stone's outline is fitted.
      roughness[offset]=255*clamp(stone.w/2);roughness[offset+1]=rough;
      roughness[offset+2]=255*clamp(stone.h/.8);
      color[offset+3]=normal[offset+3]=roughness[offset+3]=255;
    }
  }
  return {width,height,color,normal,roughness,stones,coverM:source.coverM};
}

const chartGLSL=/* glsl */`
  float msHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float msCourse(float r){return (r+(msHash(vec2(29.0,r))-.5)*.25)*.29;}
  float msJoint(float c,float r,float shift){return (c+(msHash(vec2(c,r))-.5)*.32)*.69+shift;}
  struct MsChart {vec2 uv;vec2 dx;vec2 dy;vec2 size;float flip;float quarry;};
  MsChart msChart(vec2 p){
    float row=floor(p.y/.29);
    if(p.y<msCourse(row))row-=1.0;else if(p.y>=msCourse(row+1.0))row+=1.0;
    float bottom=msCourse(row),top=msCourse(row+1.0),shift=msHash(vec2(row,73.0))*.69;
    float column=floor((p.x-shift)/.69);
    if(p.x<msJoint(column,row,shift))column-=1.0;
    else if(p.x>=msJoint(column+1.0,row,shift))column+=1.0;
    float left=msJoint(column,row,shift),right=msJoint(column+1.0,row,shift);
    vec2 identity=vec2(column,row),size=vec2(right-left,top-bottom),local=(p-vec2(left,bottom))/size;
    float variant=floor(msHash(identity+vec2(17.0,109.0))*64.0);
    float flip=msHash(identity+vec2(43.0,11.0))>.5?-1.0:1.0;
    if(flip<0.0)local.x=1.0-local.x;
    // Canvas textures are uploaded with Y flipped. The variant row below is
    // in texture coordinates; its local stone still runs bottom to top.
    vec2 origin=vec2(mod(variant,8.0)*256.0,floor(variant/8.0)*128.0);
    vec2 span=vec2(247.0,119.0),atlas=vec2(2048.0,1024.0);
    MsChart c;c.uv=(origin+4.5+local*span)/atlas;c.size=size;c.flip=flip;
    c.dx=dFdx(p)/size*vec2(flip,1.0)*span/atlas;
    c.dy=dFdy(p)/size*vec2(flip,1.0)*span/atlas;
    c.quarry=1.0+(msHash(identity+vec2(91.0,7.0))-.5)*.08;
    return c;
  }
`;

export function applyMasonryAtlas(root,stoneTexture) {
  const materials=new Set();
  root.traverse(o=>{for(const m of [o.material].flat())
    if(m?.map===stoneTexture.map&&!m.userData.individualMasonry)materials.add(m);});
  if(!materials.size)return {materials:0,variants:columns*rows};
  const fields=masonryAtlasFields();
  const coverM=fields.coverM,oldTextures=new Set();
  for(const material of materials)for(const t of [material.map,material.normalMap,material.roughnessMap])if(t)oldTextures.add(t);
  const texture=(data,srgb=false)=>{
    const canvas=document.createElement('canvas');canvas.width=fields.width;canvas.height=fields.height;
    const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(fields.width,fields.height);
    pixels.data.set(data);ctx.putImageData(pixels,0,0);
    const t=new THREE.CanvasTexture(canvas);t.anisotropy=16;
    if(srgb)t.colorSpace=THREE.SRGBColorSpace;return t;
  };
  const map=texture(fields.color,true),normalMap=texture(fields.normal),roughnessMap=texture(fields.roughness);
  for(const material of materials) {
    Object.assign(material,{map,normalMap,roughnessMap});
    chainMaterialShader(material,'individualFortStones-v1',shader=>{
      for(const chunk of ['map_fragment','normal_fragment_maps','roughnessmap_fragment'])
        shader.fragmentShader=shader.fragmentShader.replace('#include <'+chunk+'>',THREE.ShaderChunk[chunk]);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+chartGLSL);
      const before='void main() {';
      if(!shader.fragmentShader.includes(before))throw new Error('Masonry shader entry point changed');
      shader.fragmentShader=shader.fragmentShader.replace(before,`${before}
        MsChart ms=msChart(vMapUv*${coverM.toFixed(1)});
        vec4 msColor=textureGrad(map,ms.uv,ms.dx,ms.dy);msColor.rgb*=ms.quarry;
        vec4 msNormal=textureGrad(normalMap,ms.uv,ms.dx,ms.dy);
        vec4 msRough=textureGrad(roughnessMap,ms.uv,ms.dx,ms.dy);
        msNormal.xy=((msNormal.xy*2.0-1.0)*msRough.rb*vec2(2.0,.8)/ms.size*vec2(ms.flip,1.0)+1.0)*.5;
      `);
      for(const [name,uv,value] of [['map','vMapUv','msColor'],['normalMap','vNormalMapUv','msNormal'],['roughnessMap','vRoughnessMapUv','msRough']]) {
        const expression=new RegExp('texture2D\\(\\s*'+name+'\\s*,\\s*'+uv+'\\s*\\)','g');
        shader.fragmentShader=shader.fragmentShader.replace(expression,value);
      }
    });
    material.userData.individualMasonry=true;material.needsUpdate=true;
  }
  Object.assign(stoneTexture,{map,normalMap,roughnessMap,individualMasonry:true});
  for(const t of oldTextures)t.dispose();
  return {materials:materials.size,variants:fields.stones.length,width:fields.width,height:fields.height};
}
