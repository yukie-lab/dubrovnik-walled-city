import {writeFileSync} from 'node:fs';

export async function shopDisplayChecks(page,{name,dir,rows,errors}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&time=12.87',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:180000});
  const inventory=await page.evaluate(()=>{
    const w=window.__world,m=w.scene.getObjectByName('arcade.shadow');
    const all=m.userData.displays;
    const selected=[0,1,2].map(kind=>all.filter(s=>s.kind===kind&&s.z<0)
      .sort((a,b)=>Math.abs(a.x+95)-Math.abs(b.x+95))[0]);
    selected.push(all.filter(s=>s.z>0).sort((a,b)=>Math.abs(a.x+105)-Math.abs(b.x+105))[0]);
    return {count:all.length,selected,kinds:[...new Set(all.map(s=>s.kind))],
      hasCafeLink:!!document.getElementById('btnCafe')};
  });
  if(inventory.hasCafeLink||inventory.kinds.length!==3||inventory.selected.some(s=>!s))errors.push('Shop inventory / removed UI failure');
  rows.push({view:'shop-inventory',...inventory});
  for(const [index,s] of inventory.selected.entries()) {
    const poses=index<3?[[-.35,2.2,12.87],[-1.25,1.7,12.87],[.55,1.7,12.87],[-.35,2.2,19.3],[-.35,2.2,22.5]]:[[-.35,2.2,12.87]];
    for(const [lat,dist,time] of poses) {
      const data=await page.evaluate(async ({s,lat,dist,time})=>{
        const w=window.__world,p=w.player,c=Math.cos(s.rotY),sn=Math.sin(s.rotY);
        const x=s.x+c*lat+sn*dist,z=s.z-sn*lat+c*dist;
        const targetX=s.x-c*.35-sn*.9,targetZ=s.z+sn*.35-c*.9;
        const floor=w.plan.walkingGroundAt(x,z,s.y);
        Object.assign(p,{x,z,yaw:Math.atan2(x-targetX,z-targetZ),pitch:.04,groundY:floor.y,smoothY:floor.y,
          zone:floor.zone,stair:null,stairBlend:0,frozen:true,vx:0,vz:0,bobAmp:0});
        w.worldState.time=time;w.camera.fov=52;w.camera.updateProjectionMatrix();
        let n=0;do{await window.__captureFrame();n++;}while((n<4||w.lighting.environment.pending)&&n<80);
        const png=await window.__captureFrame(),again=await window.__captureFrame();
        return {png,stable:png===again,stats:{...window.__RENDER_STATS},exposure:w.lighting.state.exposure,
          groundY:p.groundY,camera:w.camera.position.toArray(),gpuError:w.renderer.getContext().getError()};
      },{s,lat,dist,time});
      const {png,...result}=data;
      const file=`${name}-${index}-${lat}-${time}.png`;
      writeFileSync(new URL(file,dir),Buffer.from(png.split(',')[1],'base64'));
      rows.push({view:'shop-display',shop:s,lat,dist,time,file,...result});
      if(!result.stable||result.gpuError||result.stats.drawCalls>200||!Number.isFinite(result.exposure))errors.push(`Shop rendering failed: ${file}`);
      console.log(`${file}: calls=${result.stats.drawCalls} stable=${result.stable}`);
    }
  }
  // Verify ordinary street travel still reaches the café with the retained C
  // shortcut; removal of the UI link must not leave an event-handler error.
  await page.keyboard.press('c');
  await page.waitForFunction(()=>Math.abs(window.__world.player.x-window.__world.cafe.layout.doorX)<.001);
  const cafe=await page.evaluate(()=>({x:window.__world.player.x,z:window.__world.player.z,
    zone:window.__world.player.zone,removed:document.querySelector('#btnCafe')===null}));
  rows.push({view:'cafe-shortcut-without-link',...cafe});
  if(!cafe.removed||cafe.zone==='interior')errors.push('Café shortcut / removed link failure');
  await page.evaluate(()=>{document.getElementById('hud').style.display='';});
  await page.screenshot({path:new URL(`${name}-ui.png`,dir).pathname});
}
