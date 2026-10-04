import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {chainMaterialShader} from './material-patch.js';
import {smoothstep, tagMesh} from './util.js';
import {furnishSponza} from './sponza-gallery.js';

// Excavate only beneath the masonry footprint. Preserve every original vertex
// and triangle outside it, interpolating all terrain attributes at the cut.
export function excavateCafe(ground,r) {
  if(!r)return;
  // Plaza/street paving used to run beneath the sealed monument. Remove that
  // layer too: it has a different lighting model and lies only millimetres
  // below the room floor. Keep all geometry outside the masonry footprint.
  for(const name of ['ground.near','ground.paving','ground.stradun']) {
  const mesh=ground.group.getObjectByName(name);if(!mesh)continue;
  const g=mesh.geometry;
  const names=Object.keys(g.attributes),arrays=names.map(n=>Array.from(g.attributes[n].array));
  const attrs=names.map(n=>g.attributes[n]),pos=g.attributes.position,indices=[];
  const planes=[[0,r.x0+.12,1],[0,r.x1-.12,-1],[2,r.z0+.12,1],[2,r.z1-.12,-1]];
  const positionIndex=names.indexOf('position');
  const load=i=>attrs.map(a=>Array.from({length:a.itemSize},(_,k)=>a.getComponent(i,k)));
  const append=v=>{
    const id=arrays[positionIndex].length/3;
    v.forEach((a,i)=>arrays[i].push(...a));return id;
  };
  for(let i=0;i<(g.index?.count??pos.count);i+=3) {
    const ids=[0,1,2].map(k=>g.index?g.index.getX(i+k):i+k);
    if(Math.max(...ids.map(i=>pos.getX(i)))<=r.x0+.12||Math.min(...ids.map(i=>pos.getX(i)))>=r.x1-.12||
       Math.max(...ids.map(i=>pos.getZ(i)))<=r.z0+.12||Math.min(...ids.map(i=>pos.getZ(i)))>=r.z1-.12) {
      indices.push(...ids);continue;
    }
    let poly=ids.map(load);
    for(const [axis,bound,sign] of planes) {
      const inside=[],outside=[];
      for(let j=0;j<poly.length;j++) {
        const a=poly[j],b=poly[(j+1)%poly.length];
        const da=(a[positionIndex][axis]-bound)*sign,db=(b[positionIndex][axis]-bound)*sign;
        (da>=0?inside:outside).push(a);
        if((da>=0)!==(db>=0)) {
          const t=da/(da-db),v=a.map((q,k)=>q.map((n,l)=>n+(b[k][l]-n)*t));
          inside.push(v);outside.push(v);
        }
      }
      if(outside.length>=3) {
        const vi=outside.map(append);
        for(let j=1;j<vi.length-1;j++)indices.push(vi[0],vi[j],vi[j+1]);
      }
      poly=inside;if(poly.length<3)break;
    }
  }
  const next=new THREE.BufferGeometry();
  names.forEach((n,i)=>next.setAttribute(n,new THREE.BufferAttribute(new attrs[i].array.constructor(arrays[i]),attrs[i].itemSize,attrs[i].normalized)));
  next.setIndex(indices);next.userData={...g.userData};mesh.geometry=next;g.dispose();
  }
}

export function makeCafe(r,tex) {
  if(!r)return null;
  const group=new THREE.Group(),room=new THREE.Group();group.add(room);
  const gallery=r.kind==='gallery';
  const lamps=gallery?[-3.5,3.5].flatMap(dx=>[r.z0+4,r.z1-3.5].map(z=>new THREE.Vector3(r.house.x+dx,r.ceiling-1.1,z))):
    [new THREE.Vector3(r.house.x,r.ceiling-.60,r.z0+2.3),new THREE.Vector3(r.doorX,r.ceiling-.60,r.z1-1.8)];
  // Finite warm pendants (250 cd in the café, 700 cd in the larger gallery),
  // in the same 5,000-lux units as the
  // city. Their materials are confined to this room, so light cannot leak
  // through its masonry or add point-light slots to every city shader.
  const lampColour=new THREE.Color(0xffd4a0),lampPower=gallery?.14:.05;
  const batches=new Map();
  const materials={
    plaster:new THREE.MeshStandardMaterial({map:tex.plaster.map,normalMap:tex.plaster.normalMap,roughness:.94,vertexColors:true}),
    stone:new THREE.MeshStandardMaterial({map:tex.dressed.map,normalMap:tex.dressed.normalMap,roughness:.8,vertexColors:true}),
    wood:new THREE.MeshStandardMaterial({map:tex.wood.map,normalMap:tex.wood.normalMap,roughness:.7,vertexColors:true}),
    objects:new THREE.MeshStandardMaterial({roughness:.5,metalness:.15,vertexColors:true}),
    floor:new THREE.MeshStandardMaterial({map:tex.paving.map,normalMap:tex.paving.normalMap,roughness:.7,vertexColors:true}),
  };
  function lightMaterial(mat,key) {
    chainMaterialShader(mat,`room-${r.id}-${key}-v2`,sh=>{
      sh.uniforms.uCafeLamps={value:lamps};sh.uniforms.uCafeLampColour={value:lampColour};
      sh.vertexShader=sh.vertexShader.replace('#include <common>',`#include <common>
        varying vec3 vCafePosition; varying vec3 vCafeNormal;`)
        .replace('#include <begin_vertex>',`#include <begin_vertex>
          vCafePosition=(modelMatrix*vec4(position,1.0)).xyz;
          vCafeNormal=normalize(mat3(modelMatrix)*normal);`);
      sh.fragmentShader=sh.fragmentShader.replace('#include <common>',`#include <common>
        varying vec3 vCafePosition; varying vec3 vCafeNormal;
        uniform vec3 uCafeLamps[${lamps.length}]; uniform vec3 uCafeLampColour;`)
        .replace('#include <aomap_fragment>',`#include <aomap_fragment>
          float depth=max(0.0,${r.z1.toFixed(8)}-vCafePosition.z);
          float opening=.035+.13*exp(-depth*.55);
          reflectedLight.indirectDiffuse*=opening;
          reflectedLight.indirectSpecular*=opening;
          vec3 cafeIrradiance=vec3(0.0);
          for(int j=0;j<${lamps.length};j++) {
            vec3 delta=uCafeLamps[j]-vCafePosition;
            float d2=max(.10,dot(delta,delta));
            cafeIrradiance+=uCafeLampColour*${lampPower}*max(0.0,dot(normalize(delta),normalize(vCafeNormal)))/d2;
          }
          // First diffuse return from the pale walls. It has finite energy
          // from the pendants; it is independent of the outdoor exposure.
          cafeIrradiance+=uCafeLampColour*.0012;
          float contact=mix(.58,1.0,smoothstep(0.0,.25,vCafePosition.y-${r.floor.toFixed(8)}));
          reflectedLight.indirectDiffuse+=diffuseColor.rgb*cafeIrradiance*RECIPROCAL_PI*contact;
          ${key==='floor'?`vec2 tile=vCafePosition.xz/0.44;
            float edge=min(min(fract(tile.x),1.0-fract(tile.x)),min(fract(tile.y),1.0-fract(tile.y)));
            float grout=1.0-smoothstep(.014,.025,edge);
            float checker=mod(floor(tile.x)+floor(tile.y),2.0);
            float tileTone=mix(.62,1.0,checker)*(1.0-.28*grout);
            reflectedLight.directDiffuse*=tileTone;reflectedLight.indirectDiffuse*=tileTone;`:''}`);
    });
  }
  for(const [key,mat] of Object.entries(materials)) {
    batches.set(key,[]);lightMaterial(mat,key);
  }
  const add=(key,g,colour=0xffffff)=>{
    const c=new THREE.Color(colour),p=g.attributes.position,n=g.attributes.normal;
    const colors=new Float32Array(p.count*3),uv=g.attributes.uv;
    for(let i=0;i<p.count;i++) {
      colors.set([c.r,c.g,c.b],i*3);
      if(uv)uv.setXY(i,(Math.abs(n.getX(i))>.5?p.getZ(i):p.getX(i))*.65,
        (Math.abs(n.getY(i))>.5?p.getZ(i):p.getY(i))*.65);
    }
    g.setAttribute('color',new THREE.BufferAttribute(colors,3));
    batches.get(key).push(g);
  };
  const box=(key,w,h,d,x,y,z,col)=>{
    const g=new THREE.BoxGeometry(w,h,d);g.translate(x,y,z);add(key,g,col);
  };
  const cylinder=(key,rt,rb,h,x,y,z,col,n=16)=>{
    const g=new THREE.CylinderGeometry(rt,rb,h,n);g.translate(x,y,z);add(key,g,col);
  };
  const floor=r.floor,top=r.ceiling,back=r.z0+r.wall,front=r.z1-r.wall;
  const left=r.x0+r.wall,right=r.x1-r.wall,width=right-left,depth=front-back;
  box('floor',r.house.w,.16,r.house.d+.16,r.house.x,floor-.08,r.house.z+.08,0xc6b798);
  box('plaster',width,.15,depth,r.house.x,top+.075,r.house.z,0xd9cab0);
  // Interior linings sit 2 cm proud of the structural stone, without coplanar
  // faces; they also cover the backs of decorative exterior windows.
  box('plaster',.04,top-floor,depth,left+.02,(floor+top)/2,r.house.z,0xd7c5a5);
  box('plaster',.04,top-floor,depth,right-.02,(floor+top)/2,r.house.z,0xd7c5a5);
  box('plaster',width,top-floor,.04,r.house.x,(floor+top)/2,back+.02,0xd7c5a5);
  for(const [a,b] of [[left,r.doorX-r.doorHalf],[r.doorX+r.doorHalf,right]])
    box('plaster',b-a,top-floor,.04,(a+b)/2,(floor+top)/2,front-.02,0xd7c5a5);
  box('plaster',2*r.doorHalf,top-floor-r.spring-r.doorHalf,.04,r.doorX,
    (top+floor+r.spring+r.doorHalf)/2,front-.02,0xd7c5a5);
  for(const x of [left+.05,right-.05])box('wood',.08,.18,depth,x,floor+.09,r.house.z,0x69533d);
  box('wood',width,.18,.08,r.house.x,floor+.09,back+.05,0x69533d);
  for(let z=back+.5;z<front;z+=1.5)box('wood',width,.20,.16,r.house.x,top-.10,z,0x645039);

  if(gallery)furnishSponza(r,{box,cylinder,add});
  else {
  const c=r.counter;
  box('wood',c.w,c.h,c.d,c.x,floor+c.h/2,c.z,0x917054);
  box('stone',c.w+.08,.085,c.d+.1,c.x,floor+c.h+.04,c.z,0xbeb6a3);
  for(let z=c.z-c.d/2+.14;z<c.z+c.d/2;z+=.25)
    box('wood',.035,.78,.027,c.x+c.w/2+.012,floor+.47,z,0x514c3e);
  // Espresso machine, cup rail, saucers and a folded linen on the counter.
  box('objects',.42,.39,.59,c.x,floor+c.h+.27,c.z-.55,0x456462);
  box('objects',.46,.07,.66,c.x,floor+c.h+.50,c.z-.55,0xbabdb7);
  box('objects',.11,.045,.45,c.x+.23,floor+c.h+.17,c.z-.55,0x323838);
  const cup=(x,y,z)=>{
    cylinder('objects',.078,.078,.017,x,y+.008,z,0xe8deca);
    cylinder('objects',.049,.038,.073,x,y+.05,z,0xe8deca);
    cylinder('objects',.041,.041,.005,x,y+.088,z,0x423126);
    const handle=new THREE.TorusGeometry(.027,.008,6,12);handle.translate(x+.05,y+.053,z);add('objects',handle,0xe8deca);
  };
  for(const z of [c.z+.32,c.z+.65])cup(c.x+.1,floor+c.h+.086,z);
  box('objects',.29,.008,.39,c.x,floor+c.h+.087,c.z+1.03,0xcdbb95);
  for(const y of [floor+1.65,floor+2.25]) {
    box('wood',.25,.045,2.5,left+.14,y,c.z,0x795d40);
    for(let j=0;j<7;j++)cylinder('objects',.055,.067,.18,left+.16,y+.115,c.z-1.05+j*.32,[0x9fa68c,0xbc9b71,0xddcfad][j%3]);
  }
  for(const t of r.tables) {
    cylinder('wood',.44,.44,.055,t.x,floor+.745,t.z,0x9a7952,32);
    cylinder('objects',.055,.07,.69,t.x,floor+.36,t.z,0x343f3c);
    cylinder('objects',.25,.25,.035,t.x,floor+.018,t.z,0x343f3c);
    cup(t.x+.1,floor+.773,t.z);
    for(const dz of [-.76,.76]) {
      box('wood',.44,.05,.42,t.x,floor+.45,t.z+dz,0x887054);
      const sign=Math.sign(dz);
      for(const dx of [-.18,.18]) {
        for(const z of [-.17,.17])box('wood',.037,.44,.037,t.x+dx,floor+.22,t.z+dz+z,0x594c3d);
        box('wood',.038,.43,.038,t.x+dx,floor+.69,t.z+dz+sign*.18,0x594c3d);
      }
      box('wood',.42,.12,.035,t.x,floor+.85,t.z+dz+sign*.18,0x887054);
    }
  }
  // A wall bench and a small plant leave a clear central aisle to the door.
  box('wood',1.4,.065,.43,r.house.x,floor+.45,back+.3,0x81674b);
  for(const x of [r.house.x-.58,r.house.x+.58])box('wood',.09,.42,.32,x,floor+.21,back+.3,0x594c3d);
  r.colliders.push({x0:r.house.x-.7,x1:r.house.x+.7,z0:back+.08,z1:back+.52,y0:floor,y1:floor+1.7});
  cylinder('objects',.17,.12,.28,left+.34,floor+.14,front-.55,0xa96c49);
  for(let i=0;i<9;i++) {
    const g=new THREE.SphereGeometry(.11,8,5),angle=i*2.4;
    g.scale(1,2.0,.28);g.rotateZ(Math.sin(angle)*.7);
    g.translate(left+.34+Math.cos(angle)*.12,floor+.38+i*.02,front-.55+Math.sin(angle)*.12);add('objects',g,0x586b43);
  }
  }
  for(const l of lamps) {
    cylinder('objects',.009,.009,top-l.y-.08,l.x,(top+l.y+.08)/2,l.z,0x333c38,8);
    cylinder('objects',.11,.30,.22,l.x,l.y+.14,l.z,0x345550,24);
    const bulb=new THREE.Mesh(new THREE.SphereGeometry(.072,12,8),new THREE.MeshBasicMaterial({color:new THREE.Color(.45,.29,.13)}));
    bulb.position.copy(l);room.add(tagMesh(bulb,'interior.pendant',{noCollide:true}));
  }
  for(const [key,parts] of batches) {
    const source=parts.map(g=>g.index?g.toNonIndexed():g),geo=mergeGeometries(source);
    for(const g of new Set([...source,...parts]))g.dispose();
    const mesh=new THREE.Mesh(geo,materials[key]);mesh.castShadow=true;mesh.receiveShadow=true;
    room.add(tagMesh(mesh,'interior.'+key,{solid:true}));
  }
  // Exterior arch and readable nameplate remain visible from the street.
  const shape=new THREE.Shape(),cw=r.doorHalf,spr=r.spring;
  shape.moveTo(-cw-.19,0);shape.lineTo(-cw,0);shape.lineTo(-cw,spr);
  shape.absarc(0,spr,cw,Math.PI,0,true);shape.lineTo(cw,0);shape.lineTo(cw+.19,0);shape.lineTo(cw+.19,spr);
  shape.absarc(0,spr,cw+.19,0,Math.PI,false);shape.closePath();
  const archGeo=new THREE.ExtrudeGeometry(shape,{depth:.24,bevelEnabled:false,curveSegments:16});
  archGeo.translate(r.doorX,floor,r.z1+.035);
  const arch=new THREE.Mesh(archGeo,new THREE.MeshStandardMaterial({color:0xbcb19b,map:tex.dressed.map,normalMap:tex.dressed.normalMap,roughness:.8}));
  arch.castShadow=true;arch.receiveShadow=true;group.add(tagMesh(arch,'interior.entryArch',{solid:true}));
  function placard(label,sub,w,h,x,y,z,interior=false) {
    const canvas=document.createElement('canvas');canvas.width=768;canvas.height=384;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#23433c';ctx.fillRect(0,0,768,384);
    ctx.strokeStyle='#c7b58a';ctx.lineWidth=3;ctx.strokeRect(18,18,732,348);
    ctx.textAlign='center';ctx.fillStyle='#eee1bd';ctx.font='52px Georgia';ctx.fillText(label,384,174);
    ctx.font='23px Georgia';ctx.fillText(sub,384,242);
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
    const mat=new THREE.MeshStandardMaterial({map,roughness:.8});
    if(interior)lightMaterial(mat,'sign');
    const board=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);board.position.set(x,y,z);board.receiveShadow=true;
    (interior?room:group).add(tagMesh(board,'interior.sign',{noCollide:true}));
  }
  placard(gallery?'SPONZA':'KAVANA',gallery?'RAGUSA  ·  GALLERY':'STRADUN  ·  WELCOME',gallery?1.8:1.38,.52,
    r.doorX,floor+(gallery?3.82:3.38),r.z1+.06);
  if(gallery) {
    placard('RAGUSA','THE CITY  ·  THE SEA',3.2,1.15,r.house.x,floor+3.25,back+.05,true);
    placard('ARCHIVUM','BOOKS  ·  MAPS  ·  VOYAGES',2.3,.6,r.house.x,floor+1.7,back+.05,true);
  }else placard('KAVA  ·  ČAJ','ESPRESSO     /     TEA',1.25,.65,r.house.x,floor+2.0,back+.045,true);
  return {group,room,layout:r,lamps,
    update(sun,eye){room.visible=Math.hypot(eye.x-r.house.x,eye.z-r.house.z)<45;},
    meterAt(eye){
      if(!r.contains(eye.x,eye.z)||eye.y>r.ceiling)return null;
      const depth=Math.max(0,r.z1-eye.z),blend=smoothstep(.15,1.4,depth);
      let local=.0012;
      for(const l of lamps) {
        const dx=l.x-eye.x,dy=l.y-r.floor,dz=l.z-eye.z,d2=dx*dx+dy*dy+dz*dz;
        local+=lampPower*(lampColour.r*.2126+lampColour.g*.7152+lampColour.b*.0722)*dy/Math.pow(d2,1.5);
      }
      return {sky:1-blend+blend*(.035+.13*Math.exp(-depth*.55)),local:local*blend};
    },
  };
}
