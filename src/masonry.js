import * as THREE from 'three';
import {rngFor} from './seed.js';

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
function hash(x,y,seed) {
  let n=Math.imul(x|0,374761393)^Math.imul(y|0,668265263)^seed;
  n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;
}
function noise(x,y,seed) {
  const ix=Math.floor(x),iy=Math.floor(y),u=smooth(0,1,x-ix),v=smooth(0,1,y-iy);
  return mix(mix(hash(ix,iy,seed),hash(ix+1,iy,seed),u),mix(hash(ix,iy+1,seed),hash(ix+1,iy+1,seed),u),v);
}

// The rows and every cyclic row of stones close at the texture boundary.
// All channels come from the same stone mask and physical relief (metres).
// This generator owns its RNG; adding a chip cannot change roofs, clouds or sea.
export function masonryFields({size=1024,coverM=3.2,courseM=.26,stoneM=.65,fort=false,tone=0,roughCut=fort ? .85 : 0,salt=0x51a50}={}) {
  const rng=rngFor(salt),px=size/coverM,rows=Math.max(2,Math.round(coverM/courseM));
  const rowHeights=Array.from({length:rows},()=>.82-roughCut*.22+rng()*(.36+roughCut*.44)),total=rowHeights.reduce((a,b)=>a+b,0);
  const color=new Uint8ClampedArray(size*size*4),height=new Float32Array(size*size),roughness=new Uint8ClampedArray(size*size*4);
  const ids=new Uint16Array(size*size),stones=[],rgb=new THREE.Color();
  let y0=0;
  for(let row=0;row<rows;row++) {
    const h=rowHeights[row]/total*size;
    const count=Math.max(3,Math.round(coverM/stoneM)+(rng()<.30 ? 1 : 0));
    const widths=Array.from({length:count},()=>.62+rng()*.78),sum=widths.reduce((a,b)=>a+b,0);
    let x0=-rng()*size;
    for(let k=0;k<count;k++) {
      const w=widths[k]/sum*size,id=stones.length+1,seed=(rng()*4294967296)>>>0;
      const wear=Math.pow(rng(),.65),joint=(.006+rng()*.007+roughCut*.005)*px;
      const bevel=(.0012+wear*.0032)*(1+roughCut*.5)*px;
      const level=.0025+rng()*.002+roughCut*.0025,lit=(fort ? .682 : .704)+tone*.023+(rng()-.5)*.13;
      // Neutral calcite, occasional iron staining. Variation stays within the
      // local limestone palette and is independent of how rounded the stone is.
      rgb.setHSL((40+(rng()-.5)*5)/360,.045+rng()*.070,lit,THREE.SRGBColorSpace).convertLinearToSRGB();
      const base=[rgb.r,rgb.g,rgb.b],rough=.78+rng()*.15;
      const ang=rng()*Math.PI,cang=Math.cos(ang),sang=Math.sin(ang),stained=rng()<.22;
      const corners=Array.from({length:4},()=>px*(.004+roughCut*(.008+rng()*.025))*wear);
      const faceRough=roughCut*(.22+.78*Math.pow(rng(),.7));
      const erosion=(distance,side)=>{
        const broad=Math.max(0,noise(distance/(px*.15),side,seed+71)-.52);
        const cell=Math.floor(distance/(px*.08)),chance=hash(cell,side,seed+73);
        const center=(cell+.15+hash(cell,side,seed+79)*.7)*px*.08;
        const halfWidth=px*(.006+hash(cell,side,seed+83)*.016);
        const notch=chance<.08+roughCut*.13 ? Math.max(0,1-Math.abs(distance-center)/halfWidth) : 0;
        const depth=.003+hash(cell,side,seed+89)*(.005+roughCut*.012);
        return wear*px*broad*broad*(.006+roughCut*.021)+wear*wear*notch*depth*px;
      };
      stones.push({id,x:x0/px,y:y0/px,w:w/px,h:h/px,wear,joint:joint/px,bevel:bevel/px,seed,roughness:rough});
      const xEnd=Math.ceil(x0+w-.5),yEnd=Math.ceil(y0+h-.5);
      for(let iy=Math.ceil(y0-.5);iy<yEnd;iy++)for(let ix=Math.ceil(x0-.5);ix<xEnd;ix++) {
        const dx=ix+.5-x0,dy=iy+.5-y0,wx=((ix%size)+size)%size,wy=((iy%size)+size)%size;
        const i=wy*size+wx,o=i*4;
        // Edge erosion is correlated over centimetres. It narrows the stone;
        // adjacent blocks keep their own edge and the joint never protrudes.
        const edge=Math.min(dx-joint*.5-erosion(dy,0),w-dx-joint*.5-erosion(dy,1),
          dy-joint*.5-erosion(dx,2),h-dy-joint*.5-erosion(dx,3),
          (dx+dy-corners[0])/1.414,(w-dx+dy-corners[1])/1.414,(dx+h-dy-corners[2])/1.414,(w-dx+h-dy-corners[3])/1.414);
        const face=smooth(0,Math.max(.8,bevel),edge);
        const grain=hash(ix,iy,seed),fine=noise(dx*.38,dy*.38,seed+3)-.5;
        const patch=noise(dx/(px*.09),dy/(px*.12),seed+13)-.5;
        const weather=noise(dx/(px*.23),dy/(px*.16),seed+17)-.5;
        const fracture=noise(dx/(px*.016),dy/(px*.024),seed+19)-.5;
        const cx=Math.floor(dx/(px*.030)),cy=Math.floor(dy/(px*.030));
        const pitSeed=hash(cx,cy,seed+29),cellX=dx/(px*.030)-cx,cellY=dy/(px*.030)-cy;
        const pit=pitSeed<.20 ? (1-smooth(.05,.15,Math.hypot(cellX-.25-hash(cx,cy,seed+37)*.5,cellY-.25-hash(cx,cy,seed+41)*.5))) : 0;
        const toolCoord=(dx*cang+dy*sang)/(px*.009);
        const tool=Math.pow(Math.max(0,Math.cos(toolCoord*6.28318+patch*4)),10)*smooth(.10,.5,grain);
        const crown=Math.sin(dx/w*Math.PI)*Math.sin(dy/h*Math.PI);
        const relief=level+patch*(.0011+faceRough*.0048)+fine*(.00030+faceRough*.0006)+(grain-.5)*.00010
          +fracture*faceRough*.0015+crown*roughCut*.003-pit*(.0007+wear*.001)-tool*.00018;
        const jointRelief=-.0015+fine*.0002;
        height[i]=mix(jointRelief,relief,face);
        const crust=stained ? smooth(.01,.30,weather)*.10 : 0;
        const dirtyEdge=(1-smooth(0,px*.055,edge))*smooth(-.2,.3,weather)*roughCut;
        const patina=1+patch*(.09+roughCut*.12)+weather*(.09+roughCut*.13)+fine*.018+fracture*roughCut*.045
          -pit*.12-tool*.014-crust-dirtyEdge*.16;
        const border=(1-smooth(0,bevel+px*.004,edge))*face;
        const mortar=.60+patch*.045+(grain-.5)*.023;
        for(let c=0;c<3;c++) {
          const stone=base[c]*patina+border*.014;
          const cement=mortar*[1.018,1,.965][c];
          color[o+c]=255*clamp(mix(cement,stone,smooth(-.4,.8,edge)));
        }
        color[o+3]=255;
        const r=255*clamp(mix(.98,rough+wear*.035+patch*.08+pit*.05,face),.72,1);
        roughness[o]=roughness[o+1]=roughness[o+2]=r;roughness[o+3]=255;ids[i]=id;
      }
      x0+=w;
    }
    y0+=h;
  }
  const normal=new Uint8ClampedArray(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const i=y*size+x,o=i*4;
    const dx=(height[y*size+(x+1)%size]-height[y*size+(x+size-1)%size])*px*.5;
    const dy=(height[((y+1)%size)*size+x]-height[((y+size-1)%size)*size+x])*px*.5;
    const inv=1/Math.hypot(dx,dy,1);
    normal[o]=255*(.5-dx*inv*.5);normal[o+1]=255*(.5+dy*inv*.5);normal[o+2]=255*(.5+inv*.5);normal[o+3]=255;
  }
  return {size,coverM,color,height,normal,roughness,ids,stones};
}

export function masonryTextures(options) {
  const f=masonryFields(options);
  const texture=(data,srgb)=>{
    const c=document.createElement('canvas');c.width=c.height=f.size;
    const ctx=c.getContext('2d'),pixels=ctx.createImageData(f.size,f.size);pixels.data.set(data);ctx.putImageData(pixels,0,0);
    const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=16;
    if(srgb)t.colorSpace=THREE.SRGBColorSpace;
    return t;
  };
  return {map:texture(f.color,true),normalMap:texture(f.normal,false),roughnessMap:texture(f.roughness,false),
    coverM:f.coverM,physicalRelief:true,stones:f.stones};
}

export const masonryFinishes={
    wallStone:{roughCut:.10},
    wallRubble:{stoneM:.52,roughCut:1,salt:0x51a51},
    monumentStone:{coverM:5,courseM:.46,stoneM:1.4,roughCut:.1,tone:1,salt:0x51a54},
    fortStone:{coverM:4.2,courseM:.29,stoneM:.69,fort:true,salt:0x51a55},
};

export function replaceMasonryTextures(tex) {
  for(const [key,options] of Object.entries(masonryFinishes)) {
    // The preceding legacy texture pass consumes the original shared RNG in
    // its original order. Discard only these maps after that pass; all other
    // generated textures retain their exact source pixels.
    tex[key]?.map.dispose();tex[key]?.normalMap.dispose();
    tex[key]=masonryTextures(options);
  }
  return tex;
}

export function stoneFinish(tex,roughness,normalScale=1) {
  return {roughness:tex.physicalRelief ? 1 : roughness,roughnessMap:tex.roughnessMap || null,
    normalScale:new THREE.Vector2(...(tex.physicalRelief ? [1,1] : [normalScale,normalScale]))};
}

// The prestigious dressed fronts and rubble in domestic side streets share a
// draw. Assign the material family to every closed subvolume of the same house.
export function masonryFinishAttribute(geometry,houses) {
  const bySite=new Map(houses.map(h=>[`${h.x},${h.z}`,h]));
  const finish=new Float32Array(geometry.attributes.position.count);
  for(const range of geometry.userData.solids) {
    const h=bySite.get(`${range.x},${range.z}`),rough=h && !(h.stradunFront || h.monument) ? 1 : 0;
    for(let k=range.from*3;k<range.to*3;k++)finish[geometry.index.getX(k)]=rough;
  }
  return new THREE.BufferAttribute(finish,1);
}
