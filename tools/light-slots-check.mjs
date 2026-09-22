import {writeFileSync} from 'node:fs';
export async function lightSlotsCheck(page,{name,dir,rows,errors}) {
  await page.setViewport({width:1200,height:800,deviceScaleFactor:1});
  await page.goto('http://localhost:8765/?shot=1&hud=0&time=19.3&x=0&z=103&gy=16&yaw=3.14159265&pitch=-.14&fov=52',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
  const samples=[];
  for(const [place,pose]of [['parapet',[0,103,16,Math.PI]],['street',[-138,-1.2,2,-Math.PI/2]],['port',[172.5,14,1.7,-1.10]]]) {
    for(const time of [12.87,19.3,19.59,19.60,19.61,19.62,19.85,20.59,20.61,21.8,22.5,12.87]) {
      const record=await page.evaluate(async({time,pose})=>{
        const w=window.__world,p=w.player,T=w.THREE;
        p.teleport(pose[0],pose[1],pose[3],-.14);
        const g=p.floorAt(pose[0],pose[1],pose[2]);
        Object.assign(p,{groundY:g.y,smoothY:g.y,zone:g.zone,frozen:true,bobAmp:0});w.worldState.time=time;
        const programs=w.renderer.info.programs.length;
        let calls=0,frames=0;
        do {await window.__captureFrame();frames++;calls=Math.max(calls,window.__RENDER_STATS.drawCalls);}
        while(w.lighting.environment.pending&&frames<30);
        const lamps=[];w.scene.traverse(o=>{if(o.isPointLight)lamps.push({visible:o.visible,intensity:o.intensity,position:o.position.toArray()});});
        return {time,lamps,programsBefore:programs,programsAfter:w.renderer.info.programs.length,calls,frames,gpuError:w.renderer.getContext().getError()};
      },{time,pose});
      samples.push({place,...record});
      if(record.lamps.length!==8||record.lamps.some(l=>!l.visible)||record.gpuError||record.calls>200)errors.push('Light slots invalid '+place+' '+time);
      if([19.59,19.60,19.61,19.62,20.59,20.61].includes(time)&&record.programsAfter!==record.programsBefore)
        errors.push('Twilight compiled a new program '+place+' '+time);
      if([12.87,19.61,22.5].includes(time)) {
        const png=Buffer.from((await page.evaluate(()=>window.__captureFrame())).split(',')[1],'base64');
        writeFileSync(new URL(`${name}-${place}-${time}.png`,dir),png);
      }
    }
  }
  const result={view:'stable-local-light-slots',samples,maxCalls:Math.max(...samples.map(s=>s.calls)),
    programCounts:[...new Set(samples.map(s=>s.programsAfter))]};
  rows.push(result);writeFileSync(new URL(name+'-light-slots.json',dir),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({view:result.view,maxCalls:result.maxCalls,programCounts:result.programCounts,samples:samples.length}));
}
