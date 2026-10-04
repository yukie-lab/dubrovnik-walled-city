import * as THREE from 'three';
import {entryDoorTarget} from './entry-door.js';

export function makeEntryControls({doors,canvas,camera,player,ui,auto,keys,available}) {
  const button=document.getElementById('entryAction'),reticle=document.getElementById('entryReticle');
  const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();
  let transition=null;
  function target(event) {
    if(!available()||transition)return null;
    pointer.set(0,0);
    if(event&&document.pointerLockElement!==canvas) {
      const rect=canvas.getBoundingClientRect();
      pointer.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);
    }
    // A shortcut/turn can precede the next animation frame. Select from the
    // current player pose, never from the camera left at the previous door.
    player.pose(camera);camera.updateMatrixWorld();ray.setFromCamera(pointer,camera);
    return entryDoorTarget(doors,ray.ray,player.groundY);
  }
  function activate(hit) {
    if(!hit||transition)return false;
    if(auto.active)auto.stop('建物へ');
    keys.clear();player.vx=player.vz=0;
    hit.door.open=true;
    transition={...hit,elapsed:0,faded:false,moved:false};
    ui.hint(hit.inside?'通りへ戻ります':`${hit.door.layout.name} — 扉を開けています`,1800);
    return true;
  }
  button.addEventListener('click',e=>{e.stopPropagation();activate(target());});
  canvas.addEventListener('pointermove',e=>{
    canvas.style.cursor=target(e)?'pointer':'';
  });
  canvas.addEventListener('pointerleave',()=>{canvas.style.cursor='';});
  const controls={
    get busy(){return !!transition;},
    interact(){return activate(target());},
    click(event){return activate(target(event));},
    cancel(){transition=null;keys.clear();player.vx=player.vz=0;ui.fade(false);},
    update(dt){
      for(const door of doors)door.update(dt);
      if(transition) {
        const t=transition,r=t.door.layout;t.elapsed+=dt;
        if(t.elapsed>=.55&&!t.faded){t.faded=true;ui.fade(true);}
        if(t.elapsed>=1.2&&!t.moved) {
          t.moved=true;
          player.teleport(r.doorX,t.inside?r.z1+1.05:r.z1-1.65,t.inside?Math.PI:0,0,r.floor);
          player.bobAmp=0;ui.fade(false);
          ui.hint(t.inside?'通りへ戻りました':`${r.name} — 自由に歩けます。出口でもクリック / F`,5000);
        }
        if(t.elapsed>=1.4){keys.clear();transition=null;}
      }
      const current=target();
      button.hidden=!current;
      reticle.hidden=!current||document.pointerLockElement!==canvas;
      if(current) {
        const label=`${current.door.layout.name} · ${current.inside?'外へ出る':'中へ入る'}`;
        if(button.dataset.label!==label) {
          button.dataset.label=label;button.querySelector('span').textContent=label;
          button.setAttribute('aria-label',label+'（F キーでも操作できます）');
        }
      }
      if(!available()||transition)canvas.style.cursor='';
    },
  };
  return controls;
}
