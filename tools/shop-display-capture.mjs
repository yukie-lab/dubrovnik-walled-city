import {writeFileSync} from 'node:fs';

export async function shopDisplayChecks(page,{name,dir,rows,errors,args=[]}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&time=12.87',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:180000});
  const inventory=await page.evaluate(()=>{
    const w=window.__world,m=w.scene.getObjectByName('arcade.shadow');
    const all=m.userData.displays;
    const selected=Array.from({length:8},(_,kind)=>all.filter(s=>s.kind===kind&&s.hasSign)
      .sort((a,b)=>Math.abs(a.x+95)-Math.abs(b.x+95))[0]);
    selected.push(all.filter(s=>s.z>0).sort((a,b)=>Math.abs(a.x+105)-Math.abs(b.x+105))[0]);
    const signs=w.scene.getObjectByName('shop.sign').userData.shops;
    const mismatches=signs.filter(sign=>!all.some(s=>Math.abs(s.x-sign.x)<.0001&&Math.abs(s.z-sign.z)<.0001&&s.kind===sign.trade&&s.icon===sign.icon));
    return {count:all.length,selected,kinds:[...new Set(all.map(s=>s.kind))],signs:signs.length,mismatches,
      counts:Object.fromEntries(Array.from({length:8},(_,kind)=>[all.find(s=>s.kind===kind)?.trade,all.filter(s=>s.kind===kind).length])),
      hasCafeLink:!!document.getElementById('btnCafe')};
  });
  if(inventory.hasCafeLink||inventory.kinds.length!==8||inventory.selected.some(s=>!s)||inventory.mismatches.length)throw new Error('Shop inventory / sign correspondence / removed UI failure');
  rows.push({view:'shop-inventory',...inventory});
  for(const [index,s] of inventory.selected.entries()) {
    if(args.includes('--shop-trade')&&s.trade!==args[args.indexOf('--shop-trade')+1])continue;
    const poses=index<8?[[-.35,2.2,12.87],[-1.25,1.7,12.87],[.55,1.7,12.87]]:[[-.35,2.2,12.87]];
    if(index===2||index===3)poses.push([-.35,2.2,19.3],[-.35,2.2,22.5]);
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
        // Inspect the live, possibly compacted GPU instance streams. The
        // rendered atlas row must agree with the rendered merchandise kind.
        const mismatches=[];
        for(const tag of ['shop.sign','arcade.shadow']) {
          const mesh=w.scene.getObjectByName(tag),a=mesh.instanceMatrix.array;
          for(let i=0;i<mesh.count;i++) {
            const x=a[i*16+12],z=a[i*16+14];
            const item=w.scene.getObjectByName('arcade.shadow').userData.displays.find(s=>Math.abs(s.x-x)<.0001&&Math.abs(s.z-z)<.0001);
            const attr=mesh.geometry.attributes;
            const kind=tag==='shop.sign'?Math.round(attr.aUvOff.getX(i)*4)+(1-Math.round(attr.aUvOff.getY(i)*2))*4:attr.aDisplayKind.getX(i);
            if(!item||item.kind!==kind)mismatches.push({tag,x,z,kind,expected:item?.kind});
          }
        }
        return {png,stable:png===again,stats:{...window.__RENDER_STATS},exposure:w.lighting.state.exposure,mismatches,
          groundY:p.groundY,camera:w.camera.position.toArray(),gpuError:w.renderer.getContext().getError()};
      },{s,lat,dist,time});
      const {png,...result}=data;
      const file=`${name}-${index}-${lat}-${time}.png`;
      writeFileSync(new URL(file,dir),Buffer.from(png.split(',')[1],'base64'));
      rows.push({view:'shop-display',shop:s,lat,dist,time,file,...result});
      if(!result.stable||result.gpuError||result.mismatches.length||result.stats.drawCalls>200||!Number.isFinite(result.exposure))errors.push(`Shop rendering failed: ${file}`);
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
