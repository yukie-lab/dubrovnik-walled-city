import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';

export async function entryChecks(page,{name,dir,rows,errors}) {
  await page.goto('http://localhost:8765/?shot=1&time=12.87&flow=0',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:180000});
  assert.equal(await page.$('#btnCafe'),null,'Do not restore the removed café link');
  const visit=async key=>{
    await page.keyboard.press(key);
    await page.waitForFunction(key=>{
      const w=window.__world,r=(key==='c'?w.cafe:w.sponza).layout;
      return Math.abs(w.player.x-r.approach.x)<.001&&Math.abs(w.player.z-r.approach.z)<.001;
    },{},key);
    await page.waitForFunction(()=>!document.getElementById('entryAction').hidden);
    await page.waitForFunction(()=>Number(getComputedStyle(document.getElementById('fade')).opacity)<.01);
  };
  const settled=()=>page.waitForFunction(()=>window.__world.player.zone==='interior'&&!window.__world.entryControls.busy,{timeout:20000});
  for(const [id,key] of [['stradun-cafe','c'],['sponza-gallery','j']]) {
    await page.evaluate(()=>{window.__world.worldState.time=12.87;});
    await visit(key);
    await page.screenshot({path:new URL(`${name}-${id}-door.png`,dir).pathname});
    const spot=await page.evaluate(id=>{
      const w=window.__world,r=w.entryDoors.find(d=>d.layout.id===id).layout;
      const p=new w.THREE.Vector3(r.doorX+.25,r.floor+1.25,r.z1-.1).project(w.camera);
      return {x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2};
    },id);
    await page.mouse.click(spot.x,spot.y);await settled();
    // Repeated clicks cannot re-enter or immediately leave during transition.
    assert.equal(await page.evaluate(()=>!!window.__world.lighting.state.interiorMeter),true);
    await page.evaluate(()=>{const p=window.__world.player;p.yaw=Math.PI;p.pitch=0;});
    await page.waitForFunction(()=>!document.getElementById('entryAction').hidden);
    await page.keyboard.press('f');
    await page.waitForFunction(()=>window.__world.player.zone!=='interior'&&!window.__world.entryControls.busy);
    assert.equal(await page.evaluate(()=>window.__world.lighting.state.interiorMeter),null);
    // An unlocked pointer may activate the HTML button as well as the mesh.
    await visit(key);await page.click('#entryAction');await settled();
    await page.evaluate(()=>{document.exitPointerLock?.();const p=window.__world.player;p.frozen=true;p.vx=p.vz=p.bobAmp=0;});
    rows.push({view:'entry-interaction',id,meshClick:true,keyboardExit:true,buttonEntry:true,outdoorMeterRestored:true});
    for(const time of [12.87,19.3,22.5])for(const pose of ['room','exhibits','exit']) {
      const result=await page.evaluate(async ({id,time,pose})=>{
        const w=window.__world,r=w.entryDoors.find(d=>d.layout.id===id).layout,p=w.player;
        const x=pose==='exhibits'?r.house.x+.1:r.doorX;
        const z=pose==='exit'?r.z0+2.3:pose==='exhibits'&&r.kind==='gallery'?r.z1-5:r.z1-1.65;
        p.teleport(x,z,pose==='exit'?Math.PI:pose==='exhibits'?.60:0,pose==='exhibits'?-.12:.03,r.floor);
        p.frozen=true;p.bobAmp=0;w.worldState.time=time;
        let n=0;do{await window.__captureFrame();n++;}while((n<8||w.lighting.environment.pending)&&n<80);
        const png=await window.__captureFrame(),again=await window.__captureFrame();
        return {png,stable:png===again,stats:{...window.__RENDER_STATS},zone:p.zone,
          exposure:w.lighting.state.exposure,gpuError:w.renderer.getContext().getError()};
      },{id,time,pose});
      const {png,...data}=result;
      writeFileSync(new URL(`${name}-${id}-${pose}-${time}.png`,dir),Buffer.from(png.split(',')[1],'base64'));
      rows.push({view:'interior',id,time,pose,...data});
      if(!data.stable||data.gpuError||data.stats.drawCalls>210||!Number.isFinite(data.exposure))errors.push(`Interior render failure: ${id}/${pose}/${time}`);
      console.log(`${id}/${pose}/${time}: calls=${data.stats.drawCalls} stable=${data.stable}`);
    }
  }
  // F cannot activate a door through the map or from another floor/distance.
  await visit('j');await page.keyboard.press('m');await page.keyboard.press('f');
  assert.equal(await page.evaluate(()=>window.__world.entryControls.busy),false);
  await page.keyboard.press('m');
  await page.evaluate(()=>{const w=window.__world,r=w.sponza.layout;w.player.teleport(r.doorX,r.z1+10,0,0,r.floor);});
  await page.keyboard.press('f');
  assert.equal(await page.evaluate(()=>window.__world.entryControls.busy),false);
  // Ordinary play exercises locked-pointer clicks and unsnapped exposure.
  await page.goto('http://localhost:8765/?time=22.5&flow=0',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY',{timeout:180000});
  await page.click('#btnStart');
  await page.waitForFunction(()=>document.getElementById('title').classList.contains('hidden'),{timeout:20000});
  await visit('j');
  const locked=await page.evaluate(()=>document.pointerLockElement===document.querySelector('#app canvas'));
  assert(locked,'Starting ordinary play must acquire pointer lock for this test');
  await page.mouse.click(800,500);await page.mouse.click(800,500);await settled();
  const adaptation=await page.evaluate(async()=>{
    const w=window.__world,values=[];
    for(let i=0;i<80;i++) {
      await new Promise(requestAnimationFrame);
      values.push({exposure:w.lighting.state.exposure,indoor:!!w.lighting.state.interiorMeter});
    }
    return {snap:w.lighting.state.snap,values,zone:w.player.zone};
  });
  assert(!adaptation.snap&&adaptation.zone==='interior'&&adaptation.values.every(v=>v.indoor&&Number.isFinite(v.exposure)));
  await page.screenshot({path:new URL(`${name}-normal-sponza-night.png`,dir).pathname});
  // Actual movement into the hall and back through the open door.
  await page.keyboard.down('w');
  await page.waitForFunction(()=>window.__world.player.z<window.__world.sponza.layout.z1-4,{timeout:20000});
  await page.keyboard.up('w');await page.evaluate(()=>{window.__world.player.yaw=Math.PI;});
  await page.keyboard.down('w');
  await page.waitForFunction(()=>window.__world.player.z>window.__world.sponza.layout.z1+.6,{timeout:30000});
  await page.keyboard.up('w');
  await page.waitForFunction(()=>window.__world.lighting.state.interiorMeter===null);
  rows.push({view:'entry-normal-play',lockedPointer:true,repeatedClickGuard:true,mapGuard:true,distanceGuard:true,walkInOut:true,adaptation});
}
