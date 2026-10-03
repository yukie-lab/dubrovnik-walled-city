import {writeFileSync} from 'node:fs';

export async function cafeChecks(page,{name,dir,rows,errors}) {
  await page.goto('http://localhost:8765/?shot=1&time=12.87&flow=0',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:180000});
  // Exercise the visible discoverability control and real browser keyboard.
  await page.click('#btnCafe');
  await page.waitForFunction(()=>Math.abs(window.__world.player.x-window.__world.cafe.layout.doorX)<.001);
  await page.evaluate(()=>{window.__world.player.frozen=false;});
  await page.keyboard.down('w');
  await page.waitForFunction(()=>window.__world.player.z<window.__world.cafe.layout.z1-3,{timeout:45000});
  await page.keyboard.up('w');
  await page.evaluate(()=>{const p=window.__world.player;p.frozen=true;p.vx=0;p.vz=0;p.bobAmp=0;});
  const entered=await page.evaluate(()=>{const p=window.__world.player;return {x:p.x,z:p.z,y:p.groundY,zone:p.zone};});
  if(entered.zone!=='interior')errors.push('Café keyboard entry failed');
  // Inspect the entrance, room and return view at day, sunset and night.
  for(const time of [12.87,19.3,22.5])for(const pose of ['entry','room','exit']) {
    const result=await page.evaluate(async ({time,pose})=>{
      const w=window.__world,r=w.cafe.layout,p=w.player;
      const x=pose==='room'?r.house.x+.1:r.doorX;
      const z=pose==='entry'?r.z1+2.3:pose==='exit'?r.z0+2.3:r.z1-1.65;
      const g=w.plan.walkingGroundAt(x,z,r.floor);
      Object.assign(p,{x,z,groundY:g.y,smoothY:g.y,zone:g.zone,stair:null,stairBlend:0,
        frozen:true,vx:0,vz:0,bobAmp:0,yaw:pose==='exit'?Math.PI:pose==='room'?.12:0,pitch:-.06});
      w.worldState.time=time;w.camera.fov=68;w.camera.updateProjectionMatrix();
      let n=0;do{await window.__captureFrame();n++;}while((n<5||w.lighting.environment.pending)&&n<80);
      const png=await window.__captureFrame(),again=await window.__captureFrame();
      return {png,stable:png===again,stats:{...window.__RENDER_STATS},zone:p.zone,
        exposure:w.lighting.state.exposure,meter:w.lighting.state.meterIlluminance,
        gpuError:w.renderer.getContext().getError()};
    },{time,pose});
    const {png,...data}=result;
    writeFileSync(new URL(`${name}-${pose}-${time}.png`,dir),Buffer.from(png.split(',')[1],'base64'));
    rows.push({view:'cafe',time,pose,...data});
    if(!data.stable||data.gpuError||data.stats.drawCalls>200||!Number.isFinite(data.exposure))errors.push(`Café render failure: ${pose}/${time}`);
    console.log(`${pose}/${time}: calls=${data.stats.drawCalls} stable=${data.stable} zone=${data.zone}`);
  }
  // Leave at night, then travel away and back with C. Neither action may
  // retain an indoor floor or meter. Normal exposure adaptation is below.
  await page.evaluate(()=>{
    const w=window.__world,p=w.player;p.frozen=false;p.yaw=Math.PI;
  });
  await page.keyboard.down('w');
  await page.waitForFunction(()=>window.__world.player.z>window.__world.cafe.layout.z1+1,{timeout:45000});
  await page.keyboard.up('w');
  const exited=await page.evaluate(()=>{const w=window.__world,p=w.player;p.frozen=true;return {x:p.x,z:p.z,y:p.groundY,zone:p.zone,meter:w.lighting.state.interiorMeter};});
  if(exited.zone==='interior'||exited.meter!==null)errors.push('Café keyboard exit did not restore outdoor state');
  await page.keyboard.press('1');
  await page.waitForFunction(()=>Math.abs(window.__world.player.x-window.__world.cafe.layout.doorX)>10);
  await page.keyboard.press('c');
  await page.waitForFunction(()=>Math.abs(window.__world.player.x-window.__world.cafe.layout.doorX)<.001);
  rows.push({view:'cafe-walk',entered,exited,buttonAndShortcut:true});
  await page.screenshot({path:new URL(`${name}-discovery.png`,dir).pathname});
  // A second, ordinary session verifies the real 5-second dark adaptation;
  // SHOT deliberately snaps exposure and cannot establish this behaviour.
  await page.goto('http://localhost:8765/?time=22.5&flow=0',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY',{timeout:180000});
  await page.click('#btnStart');
  await page.waitForFunction(()=>document.getElementById('title').classList.contains('hidden'),{timeout:20000});
  await page.keyboard.press('c');
  await page.waitForFunction(()=>Math.abs(window.__world.player.x-window.__world.cafe.layout.doorX)<.001);
  await page.keyboard.down('w');
  await page.waitForFunction(()=>window.__world.player.z<window.__world.cafe.layout.z1-3,{timeout:45000});
  await page.keyboard.up('w');
  const adaptation=await page.evaluate(async()=>{
    const w=window.__world,l=w.lighting.state,values=[];
    for(let i=0;i<100;i++) {
      await new Promise(requestAnimationFrame);
      values.push({exposure:l.exposure,target:l.targetExposure,meter:l.meterIlluminance,indoor:!!l.interiorMeter});
    }
    return {snap:l.snap,values,zone:w.player.zone};
  });
  if(adaptation.snap||adaptation.zone!=='interior'||adaptation.values.some(v=>!Number.isFinite(v.exposure)||v.exposure<=0||!v.indoor))
    errors.push('Ordinary café adaptation failed');
  await page.screenshot({path:new URL(`${name}-normal-night.png`,dir).pathname});
  await page.evaluate(()=>{window.__world.player.yaw=Math.PI;});
  await page.keyboard.down('w');
  await page.waitForFunction(()=>window.__world.player.z>window.__world.cafe.layout.z1+1,{timeout:45000});
  await page.keyboard.up('w');
  const restored=await page.evaluate(()=>({zone:window.__world.player.zone,meter:window.__world.lighting.state.interiorMeter}));
  if(restored.zone==='interior'||restored.meter)errors.push('Ordinary café exit failed');
  rows.push({view:'cafe-normal-play',adaptation,restored});
}
