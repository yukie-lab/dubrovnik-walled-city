import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {tagMesh} from './util.js';
import {makeFacadeSupport} from './facade-support.js';

// Annular solids: the metal has an inner surface and a closed rim, while the
// bore remains open. All longitudinal edges share actual indexed vertices.
export function pipeShell(outer=.055,inner=.051,height=1,segments=12) {
  const p=[],uv=[],ix=[],profile=[[outer,0],[outer,height],[inner,height],[inner,0]];
  for(const [r,y] of profile)for(let k=0;k<segments;k++) {
    const a=k/segments*Math.PI*2;p.push(Math.cos(a)*r,y,Math.sin(a)*r);uv.push(k/segments,y);
  }
  for(let j=0;j<profile.length;j++)for(let k=0;k<segments;k++) {
    const a=j*segments+k,b=j*segments+(k+1)%segments,c=((j+1)%profile.length)*segments+k,d=((j+1)%profile.length)*segments+(k+1)%segments;
    ix.push(a,c,b,b,c,d);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();return g;
}

export function pipeBracketGeometry() {
  const ring=pipeShell(.0615,.055,.028,8);ring.translate(0,-.014,0);
  const strap=new THREE.BoxGeometry(.030,.037,.075);strap.translate(0,0,-.0745);
  const plate=new THREE.BoxGeometry(.064,.104,.013);plate.translate(0,0,-.088);
  const parts=[ring,strap,plate];
  for(const y of [-.034,.034]){const bolt=pipeBoltGeometry();bolt.translate(0,y,0);parts.push(bolt);}
  parts.forEach((g,i)=>{
    const p=g.attributes.position;g.setAttribute('aRainAnchor',new THREE.Float32BufferAttribute(Array.from({length:p.count},(_,k)=>
      i===0 ? 0 : i===1 ? Math.max(0,Math.min(1,(-.037-p.getZ(k))/.075)) : 1),1));
  });
  const out=mergeGeometries(parts);parts.forEach(g=>g.dispose());return out;
}

export function pipeBoltGeometry() {
  const bolt=new THREE.CylinderGeometry(.008,.008,.007,6);bolt.rotateX(Math.PI/2);bolt.translate(0,0,-.078);
  bolt.setAttribute('aRainAnchor',new THREE.Float32BufferAttribute(new Float32Array(bolt.attributes.position.count).fill(1),1));return bolt;
}

export function seatDownpipes(proposals,support) {
  return proposals.map(p=>{
    const top=p.y+p.h;let lo=Infinity,hi=-Infinity;
    // A drain enters the street. The entire ring must reach the real paving,
    // including a riser or sloped triangle crossing one side of the pipe.
    for(let k=0;k<24;k++) {
      const a=k*Math.PI/12,h=support.sample(p.x+Math.cos(a)*.055,p.z+Math.sin(a)*.055,top+.1);
      if(!h)throw new Error('Downpipe has no rendered street at its existing site');
      lo=Math.min(lo,h.y);hi=Math.max(hi,h.y);
    }
    const y=lo-.020;
    if(top-hi<.5)throw new Error('Downpipe upper connection is below its street');
    return {...p,sourceY:p.y,y,h:top-y,top,supportLow:lo,supportHigh:hi};
  });
}

export function patchRainwareMaterial(material,{depth=false}={}) {
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey.bind(material);
  material.onBeforeCompile=(sh,r)=>{
    previous(sh,r);
    sh.vertexShader=sh.vertexShader.replace('#include <common>',`#include <common>
      attribute vec3 aRainware;attribute float aRainAnchor;attribute float aRainGap;
      varying vec3 vRainware;varying vec3 vRainPos;`)
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        transformed.z-=aRainAnchor*aRainGap;
        vRainware=aRainware;vRainPos=transformed;vRainPos.y*=aRainware.y;`);
    if(depth)return;
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>',`#include <common>
      varying vec3 vRainware;varying vec3 vRainPos;
      float rainHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float rainNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(rainHash(i),rainHash(i+vec2(1,0)),f.x),mix(rainHash(i+vec2(0,1)),rainHash(i+vec2(1,1)),f.x),f.y);}`)
      .replace('#include <color_fragment>',`#include <color_fragment>
        vec2 rainUv=vec2(vRainPos.x+vRainPos.z*.61,vRainPos.y);
        float rainFine=rainNoise(rainUv*vec2(203.0,87.0)+vRainware.x*17.0);
        float rainPatch=rainNoise(rainUv*vec2(52.0,3.7)+vRainware.x*39.0);
        float rainOxide=clamp(mix(.76,.65,vRainware.z)+vRainware.x*.12
          +smoothstep(.23,.77,rainPatch*.72+rainFine*.28)*mix(.11,.22,vRainware.z),0.0,1.0);
        vec3 rainOxideColor=mix(vec3(.155,.164,.158),vec3(.087,.033,.012),vRainware.z);
        diffuseColor.rgb=mix(diffuseColor.rgb,rainOxideColor,rainOxide);
        diffuseColor.rgb*=.97+.06*rainFine;`)
      .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
        roughnessFactor=mix(.46,.91,rainOxide);`)
      .replace('#include <metalnessmap_fragment>',`#include <metalnessmap_fragment>
        metalnessFactor=1.0-rainOxide;`);
  };
  material.customProgramCacheKey=()=>key()+'-rainware-3-'+depth;return material;
}

// Instance-local bounds follow the same connector deformation as color and
// depth. The visibility system transforms these by the instance/world matrix.
export function rainwareBounds(mesh) {
  const g=mesh.geometry,p=g.attributes.position,a=g.attributes.aRainAnchor,boxes=[];
  const point=new THREE.Vector3();
  for(let i=0;i<mesh.count;i++) {
    const box=new THREE.Box3(),gap=g.attributes.aRainGap.getX(i);
    for(let k=0;k<p.count;k++) {
      point.fromBufferAttribute(p,k);point.z-=a.getX(k)*gap;box.expandByPoint(point);
    }
    boxes.push(box.getBoundingSphere(new THREE.Sphere()));
  }
  mesh.userData.instanceBounds=(i,target)=>target.copy(boxes[i]);
}

export function makeRainware(proposals,support,body=null) {
  const facade=body ? makeFacadeSupport(body) : null,rejected=[];
  const routed=proposals.map((p,sourceIndex)=>{
    if(!facade)return p;
    const owner=p.houseX+','+p.houseZ,ground=support.sample(p.x,p.z,p.y+p.h+.1);
    const sections=facade.column(p.x,p.z,p.nx,p.nz,ground.y,p.y+p.h,{owner});
    if(!sections.length)throw new Error('Downpipe has no facade at its existing bay');
    const outer=Math.max(...sections.map(s=>s.front)),distance=outer+.055+.024-(p.x*p.nx+p.z*p.nz);
    const neighbours=facade.column(p.x,p.z,p.nx,p.nz,ground.y+.2,p.y+p.h-.2,{owner,opposite:true});
    if(neighbours.some(s=>s.front<outer+.134 && s.hi-s.lo>.15)) {
      rejected.push({...p,sourceIndex,reason:'No exterior clearance between adjacent solids'});return null;
    }
    return {...p,sourceIndex,sourceX:p.x,sourceZ:p.z,x:p.x+p.nx*distance,z:p.z+p.nz*distance,sections,outerPlane:outer};
  }).filter(Boolean);
  const pipes=seatDownpipes(routed,support),group=new THREE.Group(),brackets=[];
  const bodyGeo=pipeShell(),bracketGeo=pipeBracketGeometry();
  bodyGeo.setAttribute('aRainAnchor',new THREE.Float32BufferAttribute(new Float32Array(bodyGeo.attributes.position.count),1));
  for(const p of pipes) {
    const sections=p.sections||[{lo:p.supportHigh,hi:p.top,front:p.x*p.nx+p.z*p.nz-.09}];
    const valid=sections.flatMap(s=>{
      let intervals=[{...s,lo:Math.max(s.lo+.057,p.supportHigh+.38),hi:Math.min(s.hi-.057,p.top-.32)}];
      // A flat wall behind a projecting course is not an exposed mounting
      // surface. Subtract its entire plate footprint from the hidden plane.
      for(const block of sections)if(block.front>s.front+.0001) {
        const low=block.lo-.057,high=block.hi+.057;
        intervals=intervals.flatMap(r=>high<=r.lo || low>=r.hi ? [r] :
          [{...r,hi:Math.min(r.hi,low)},{...r,lo:Math.max(r.lo,high)}]);
      }
      return intervals.filter(r=>r.hi>r.lo);
    });
    if(!valid.length)throw new Error('No solid interval can hold a pipe bracket');
    const low=Math.min(...valid.map(s=>s.lo)),high=Math.max(...valid.map(s=>s.hi)),count=Math.max(2,Math.ceil((high-low)/1.85)+1),used=[];
    for(let k=0;k<count;k++) {
      const desired=low+(high-low)*k/(count-1),candidate=valid.map(s=>({...s,y:Math.max(s.lo,Math.min(s.hi,desired))}))
        .sort((a,b)=>Math.abs(a.y-desired)-Math.abs(b.y-desired)||b.front-a.front)[0];
      if(used.some(y=>Math.abs(y-candidate.y)<.08))continue;used.push(candidate.y);
      brackets.push({...p,y:candidate.y,mountPlane:candidate.front,gap:p.x*p.nx+p.z*p.nz-candidate.front});
    }
  }
  const material=patchRainwareMaterial(new THREE.MeshStandardMaterial({color:0xffffff,roughness:.58,metalness:1,envMapIntensity:.85}));
  const stems=new THREE.InstancedMesh(bodyGeo,material,pipes.length),fixings=new THREE.InstancedMesh(bracketGeo,material,brackets.length);
  const dummy=new THREE.Object3D(),color=new THREE.Color();
  for(const [mesh,records,iron] of [[stems,pipes,0],[fixings,brackets,1]]) {
    mesh.geometry.setAttribute('aRainware',new THREE.InstancedBufferAttribute(Float32Array.from(records.flatMap(p=>[p.seed,iron ? 1 : p.h,iron])),3));
    mesh.geometry.setAttribute('aRainGap',new THREE.InstancedBufferAttribute(Float32Array.from(records,p=>iron ? p.gap-.09 : 0),1));
    records.forEach((p,i)=>{
      dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(0,Math.atan2(p.nx,p.nz),0);dummy.scale.set(1,iron ? 1 : p.h,1);dummy.updateMatrix();
      mesh.setMatrixAt(i,dummy.matrix);
      // The metallic base stores reflected light in linear space. Applying a
      // dark painted-surface sRGB value here made exposed metal nearly black.
      const reflectance=(iron ? .48 : .60)+p.seed*.065;
      color.setRGB(reflectance,reflectance*1.015,reflectance*1.025);mesh.setColorAt(i,color);
    });
    mesh.castShadow=true;mesh.receiveShadow=true;
    mesh.customDepthMaterial=patchRainwareMaterial(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking}),{depth:true});
  }
  stems.userData.pipeRecords=pipes;stems.userData.sourceRecords=proposals;stems.userData.rejectedPipes=rejected;fixings.userData.pipeRecords=brackets;
  rainwareBounds(fixings);
  group.add(tagMesh(stems,'house.downpipe',{solid:true,small:true,staticDetail:true,groundContact:true,buriedBase:true}),
    tagMesh(fixings,'house.pipeBracket',{solid:true,small:true,staticDetail:true}));
  return {group,pipes,brackets};
}
