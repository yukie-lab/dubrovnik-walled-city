import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

function merge(parts) {
  const geometry=mergeGeometries(parts.map(g=>g.index ? g.toNonIndexed() : g));
  for(const g of parts)g.dispose();
  return geometry;
}

// A solid block with chamfered arrises. Dimensions describe its outer bounds,
// so changing the bevel never makes a door penetrate its stone rebate.
export function chamferedBlock(w,h,d,x=0,y=0,z=0,bevel=.006) {
  const b=Math.min(bevel,w*.15,h*.15,d*.24),shape=new THREE.Shape();
  shape.moveTo(-w/2+b,-h/2+b);shape.lineTo(w/2-b,-h/2+b);
  shape.lineTo(w/2-b,h/2-b);shape.lineTo(-w/2+b,h/2-b);shape.closePath();
  const g=new THREE.ExtrudeGeometry(shape,{depth:d-2*b,bevelEnabled:true,bevelSize:b,bevelThickness:b,bevelSegments:1,steps:1});
  g.translate(x,y,z-d/2+b);return g;
}

export function doorLeafGeometry() {
  const parts=[];
  for(const sign of [-1,1]) {
    const x=sign*.2515;
    parts.push(chamferedBlock(.489,2.115,.050,x,1.1425,.030,.004));
    // Recessed panel fields, raised mouldings and meeting stiles. Each is a
    // closed piece seated into the leaf, including the normally hidden back.
    for(const [y,h] of [[.43,.44],[1.10,.62],[1.83,.55]]) {
      parts.push(chamferedBlock(.328,h,.018,x,y,.054,.006));
      parts.push(chamferedBlock(.287,h-.042,.012,x,y,.063,.004));
    }
  }
  parts.push(chamferedBlock(.037,2.105,.022,0,1.143,.060,.003));
  const geometry=merge(parts),p=geometry.attributes.position,uv=geometry.attributes.uv;
  for(let i=0;i<p.count;i++)uv.setXY(i,p.getX(i)*2+.5,p.getY(i)*.47);
  return geometry;
}

export function wornThresholdGeometry(width=1.4) {
  const p=[],uv=[],ix=[],nx=24,nz=6,depth=.28,base=-.035;
  const vertex=(x,y,z)=>{const i=p.length/3;p.push(x,y,z);uv.push(x/.8,z/.8);return i;};
  for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++) {
    const u=i/nx*2-1,v=j/nz*2-1,x=u*width/2,z=v*depth/2+.015;
    const hollow=.016*Math.pow(Math.max(0,1-(u/.73)**2),2)*(1-.30*v*v);
    const edge=.008*Math.pow(Math.abs(v),8);
    vertex(x,.075-hollow-edge,z);
  }
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++) {
    const a=j*(nx+1)+i,b=a+1,c=a+nx+1,d=c+1;ix.push(a,c,b,b,c,d);
  }
  // Boundary in the same winding as the upward top. Side faces join a bottom
  // ring one-to-one, avoiding T-junctions along the subdivided worn edge.
  const ring=[];
  for(let j=0;j<=nz;j++)ring.push(j*(nx+1));
  for(let i=1;i<=nx;i++)ring.push(nz*(nx+1)+i);
  for(let j=nz-1;j>=0;j--)ring.push(j*(nx+1)+nx);
  for(let i=nx-1;i>0;i--)ring.push(i);
  const bottom=ring.map(i=>vertex(p[i*3],base,p[i*3+2]));
  const middle=vertex(0,base,.015);
  for(let i=0;i<ring.length;i++) {
    const j=(i+1)%ring.length,a=ring[i],b=ring[j],c=bottom[i],d=bottom[j];
    ix.push(a,c,b,b,c,d,middle,d,c);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();
  return g;
}

export function doorFrameGeometry(arched=false) {
  const parts=[wornThresholdGeometry(arched ? 1.5 : 1.4)];
  const inner=arched ? .535 : .50,thick=arched ? .17 : .16,height=arched ? 2.3 : 2.21;
  for(const s of [-1,1])for(let k=0;k<4;k++) {
    const h=height/4-.003;
    parts.push(chamferedBlock(thick,h,.18,s*(inner+thick/2),(k+.5)*height/4,0,.005));
  }
  if(!arched)parts.push(chamferedBlock(1.32,.18,.18,0,2.30,0,.008));
  else {
    const n=13,r0=inner,r1=inner+thick;
    for(let k=0;k<n;k++) {
      const a0=k*Math.PI/n+.0018,a1=(k+1)*Math.PI/n-.0018;
      const shape=new THREE.Shape();
      shape.moveTo(Math.cos(a0)*r0,Math.sin(a0)*r0);
      shape.absarc(0,0,r0,a0,a1,false);shape.lineTo(Math.cos(a1)*r1,Math.sin(a1)*r1);
      shape.absarc(0,0,r1,a1,a0,true);shape.closePath();
      const g=new THREE.ExtrudeGeometry(shape,{depth:.18,bevelEnabled:false,curveSegments:3});
      g.translate(0,2.3,-.09);parts.push(g);
    }
    for(const s of [-1,1])parts.push(chamferedBlock(.225,.058,.21,s*.62,2.283,0,.005));
  }
  parts.forEach((g,i)=>g.setAttribute('aStonePart',new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(i),1)));
  return merge(parts);
}

export function doorArchTopGeometry() {
  const shape=new THREE.Shape();
  shape.moveTo(-.526,2.20);shape.lineTo(.526,2.20);shape.lineTo(.526,2.30);
  shape.absarc(0,2.30,.526,0,Math.PI,false);shape.lineTo(-.526,2.20);shape.closePath();
  const g=new THREE.ExtrudeGeometry(shape,{depth:.050,bevelEnabled:false,curveSegments:16});
  g.translate(0,0,.005);
  const p=g.attributes.position,uv=g.attributes.uv;
  for(let i=0;i<p.count;i++)uv.setXY(i,p.getX(i)*2+.5,p.getY(i)*.47);
  return g;
}

export function doorIronworkGeometry() {
  const parts=[];
  for(const sign of [-1,1]) {
    for(const y of [.40,1.78]) {
      parts.push(chamferedBlock(.125,.040,.012,sign*.422,y,.064,.002));
      const pin=new THREE.CylinderGeometry(.011,.011,.085,8);pin.translate(sign*.48,y,.071);parts.push(pin);
      for(const x of [.379,.432]) {
        const bolt=new THREE.SphereGeometry(.007,6,4);bolt.scale(1,1,.50);bolt.translate(sign*x,y,.073);parts.push(bolt);
      }
    }
    parts.push(chamferedBlock(.046,.11,.014,sign*.098,1.22,.071,.004));
    const ring=new THREE.TorusGeometry(.043,.008,6,16);ring.translate(sign*.098,1.167,.093);parts.push(ring);
    const stud=new THREE.SphereGeometry(.014,8,6);stud.scale(1,1,.65);stud.translate(sign*.098,1.215,.088);parts.push(stud);
  }
  parts.push(chamferedBlock(.040,.066,.012,.052,.985,.070,.004));
  return merge(parts);
}

export function joinerySeeds(geometry,doors) {
  geometry.setAttribute('aJoinerySeed',new THREE.InstancedBufferAttribute(Float32Array.from(doors,d=>d.seed),1));
}

// A level doorway on a stepped street needs a real stone seat beneath its
// sill. Measure the entire front footprint, not the centre of the house face.
// This resolves every doorway by the same generated-floor contract.
export function seatDoorways(doors,support) {
  for(const d of doors) {
    const scale=d.big ? 1.85 : .95+d.seed*.15,half=d.arch ? .75 : .70;
    const co=Math.cos(d.rotY),si=Math.sin(d.rotY);
    let lo=Infinity,hi=-Infinity;
    for(let i=0;i<=20;i++)for(const v of [.035,.095,.155]) {
      const u=(i/10-1)*half,x=d.x+co*u*scale+si*(.02+v*scale),z=d.z-si*u*scale+co*(.02+v*scale);
      const hit=support.sample(x,z,d.y+1.2);
      if(hit){lo=Math.min(lo,hit.y);hi=Math.max(hi,hit.y);}
    }
    if(!Number.isFinite(lo+hi))throw new Error('Doorway has no rendered street support');
    d.sourceY=d.y;d.y=hi+.006;d.supportLow=lo;d.supportHigh=hi;
  }
}

export function patchJoineryMaterial(material,kind) {
  const previous=material.onBeforeCompile;
  material.onBeforeCompile=(sh,renderer)=>{
    previous.call(material,sh,renderer);
    sh.vertexShader=sh.vertexShader.replace('#include <common>',`#include <common>
      attribute float aJoinerySeed; varying float vJoinerySeed; varying vec3 vJoineryPos;
      ${kind==='stone' ? 'attribute float aStonePart; varying float vStonePart;' : ''}`)
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        vJoinerySeed=aJoinerySeed;vJoineryPos=position;
        ${kind==='stone' ? 'vStonePart=aStonePart;' : ''}`);
    if(kind==='wood')sh.vertexShader=sh.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>
      #ifdef USE_MAP
        vMapUv.x+=aJoinerySeed*13.74;
      #endif
      #ifdef USE_NORMALMAP
        vNormalMapUv.x+=aJoinerySeed*13.74;
      #endif`);
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>',`#include <common>
      varying float vJoinerySeed; varying vec3 vJoineryPos;
      ${kind==='stone' ? 'varying float vStonePart;' : ''}
      float joineryHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float joineryNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(joineryHash(i),joineryHash(i+vec2(1,0)),f.x),
          mix(joineryHash(i+vec2(0,1)),joineryHash(i+vec2(1,1)),f.x),f.y);}`);
    const field=kind==='iron' ? `
      float patina=joineryNoise(vJoineryPos.xy*37.0+vJoinerySeed*19.0)*.65
        +joineryNoise(vJoineryPos.xy*113.0+vJoinerySeed*37.0)*.35;
      float rust=smoothstep(.46,.74,patina)*(.30+.65*vJoinerySeed);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.095,.041,.017),rust*.78);`
      : kind==='stone' ? `
      float stoneTone=joineryHash(vec2(vStonePart*17.0,vJoinerySeed*37.0));
      float patina=joineryNoise(vJoineryPos.xy*12.0+vJoinerySeed*41.0);
      float damp=exp(-max(vJoineryPos.y,0.0)*5.0)*smoothstep(.25,.70,patina);
      diffuseColor.rgb*=mix(.89,1.11,stoneTone)*(1.0-.16*damp);`
      : `
      float patina=joineryNoise(vJoineryPos.xy*vec2(61.0,2.8)+vJoinerySeed*17.0);
      float wear=smoothstep(.48,.80,patina)*(.2+.55*vJoinerySeed);
      diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.21,1.12,1.01),wear);
      diffuseColor.rgb*=1.0-.12*exp(-max(vJoineryPos.y,0.0)*6.0);`;
    sh.fragmentShader=sh.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>${field}`);
    sh.fragmentShader=sh.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      ${kind==='iron' ? 'roughnessFactor=mix(.50,.94,rust);' : kind==='stone' ? 'roughnessFactor=clamp(roughnessFactor+.11*(patina-.4),.66,.93);' : 'roughnessFactor=clamp(roughnessFactor+.12*(patina-.5),.69,.97);'}`);
    if(kind==='iron')sh.fragmentShader=sh.fragmentShader.replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor*=1.0-rust;');
  };
  material.customProgramCacheKey=()=>`joinery-${kind}-v1`;
}
