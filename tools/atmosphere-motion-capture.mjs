import {writeFileSync} from 'node:fs';
// Measure the *moving clock*, including sky integrations and environment bakes.
// A static-time screenshot otherwise hides all of their cost from telemetry.
export async function atmosphereMotionChecks(page,{name,dir,rows,errors}) {
  const poses=[['roofs','x=58&z=-88&yaw=-2.303&pitch=-.02&gy=24&fov=54'],
    ['sea','x=0&z=103&yaw=3.1416&pitch=-.14&gy=16&fov=52']];
  for(const [view,q]of poses) {
    await page.goto('http://localhost:8765/index.html?shot=1&hud=0&time=19.65&'+q,{waitUntil:'domcontentloaded'});
    await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
    const result=await page.evaluate(async()=>{
      const w=window.__world,frame=()=>new Promise(r=>requestAnimationFrame(r));
      for(let i=0;i<40;i++)await frame();
      const rows=[];let last=performance.now(),lastDelta=1/60;
      for(let i=0;i<180;i++) {
        // The same 36 game-seconds/real-second rate as ordinary walking.
        w.worldState.time+=Math.min(lastDelta,.05)*36/3600;
        await frame();const now=performance.now();
        rows.push({ms:now-last,calls:window.__RENDER_STATS.drawCalls,exposure:w.renderer.toneMappingExposure,
          time:w.worldState.time,el:w.sunState.el});lastDelta=(now-last)/1000;last=now;
      }
      const ms=rows.map(r=>r.ms).sort((a,b)=>a-b);
      return {frames:rows,fps:180000/rows.reduce((s,r)=>s+r.ms,0),p95:ms[Math.floor(ms.length*.95)],
        maxCalls:Math.max(...rows.map(r=>r.calls)),meanCalls:rows.reduce((s,r)=>s+r.calls,0)/rows.length,
        gpuError:w.renderer.getContext().getError()};
    });
    rows.push({view,...result});writeFileSync(new URL(name+'-'+view+'-motion.json',dir),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify({view,fps:result.fps,p95:result.p95,maxCalls:result.maxCalls,meanCalls:result.meanCalls,gpuError:result.gpuError}));
    if(result.gpuError)errors.push(view+': GPU '+result.gpuError);
  }
}
