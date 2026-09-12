import {writeFileSync} from 'node:fs';

// Exercise the product's real steering, collision and adaptive resolution at
// normal walking speed. A skipped waypoint is a failure, not a completed walk.
export async function tourChecks(page,{name,dir,rows,errors,args}) {
  const routeId=args[args.indexOf('--tour')+1]||'walls',warnings=[];
  const listener=m=>{if(m.type()==='warn' && m.text().startsWith('auto: skip'))warnings.push(m.text());};
  page.on('console',listener);
  try {
    await page.goto('http://localhost:8765/?flow=0',{waitUntil:'domcontentloaded'});
    await page.waitForFunction('window.__READY',{timeout:60000});
    await page.click('#btnStart');
    await page.waitForFunction(()=>document.getElementById('title').classList.contains('hidden'),{timeout:15000});
    const times=args.includes('--quick') ? [['am',7.9]] : [['am',7.9],['noon',12.87],['gold',19.3],['dusk',21.2]];
    for(const [time,hour] of times) {
      const route=await page.evaluate(({routeId,hour})=>{
        const w=window.__world,r=w.routes.find(r=>r.id===routeId);
        if(!r)throw new Error('Unknown walking route '+routeId);
        w.worldState.paused=true;w.player.frozen=false;w.auto.start({...r,time:hour});
        return {id:r.id,count:r.wps.length,length:r.wps.slice(1).reduce((n,p,i)=>n+Math.hypot(p.x-r.wps[i].x,p.z-r.wps[i].z),0)};
      },{routeId,hour});
      const start=Date.now(),samples=[];let previous=-1,lastCapture=0,lastLog=0;
      console.log(`TOUR ${routeId} ${time}: ${route.count} waypoints, ${route.length.toFixed(1)} m`);
      while(true) {
        const sample=await page.evaluate(async()=>{
          await new Promise(r=>setTimeout(r,1000));
          const w=window.__world,p=w.player;
          return {active:w.auto.active,wp:w.auto.wpIdx,x:p.x,y:p.groundY,z:p.z,zone:p.zone,
            stuck:w.auto.stuckT,fps:window.__FPS,...window.__RENDER_STATS};
        });
        sample.seconds=(Date.now()-start)/1000;samples.push(sample);
        if(sample.wp!==previous || Date.now()-lastCapture>30000) {
          const stem=`${name}-${time}-wp${String(sample.wp).padStart(2,'0')}-${Math.round(sample.seconds)}`;
          // Normal play does not expose the frozen-shot framebuffer hook.
          // Capture the compositor, including the product's live controls.
          await page.screenshot({path:new URL(stem+'.png',dir).pathname});
          sample.capture=stem+'.png';lastCapture=Date.now();previous=sample.wp;
        }
        if(Date.now()-lastLog>20000 || !sample.active) {
          console.log(`TOUR ${time}: ${sample.seconds.toFixed(0)}s wp=${sample.wp}/${route.count} ${sample.zone} (${sample.x.toFixed(1)},${sample.y.toFixed(1)},${sample.z.toFixed(1)}) ${sample.fps.toFixed(1)}fps dpr=${sample.dpr} calls=${sample.drawCalls}`);
          lastLog=Date.now();
        }
        if(warnings.length || errors.length || sample.drawCalls>200 || sample.dpr>2 || sample.seconds>1800) {
          errors.push(`Continuous tour failed: ${warnings.join(',')||'render budget / runtime'}`);break;
        }
        if(!sample.active)break;
      }
      const result={view:`tour-${routeId}-${time}`,route,samples,warnings:[...warnings],
        completed:samples.at(-1)?.wp>=route.count && !warnings.length};
      rows.push(result);writeFileSync(new URL(`${name}-${time}.json`,dir),JSON.stringify(result,null,2)+'\n');
      if(!result.completed && !errors.length)errors.push(`Incomplete tour ${time}`);
      if(errors.length)break;
    }
  } finally {page.off('console',listener);}
}
