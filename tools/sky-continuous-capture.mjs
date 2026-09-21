import {writeFileSync} from 'node:fs';

// Uninterrupted ordinary-speed sunset, with real exposure adaptation. Unlike
// the fixed reference series, this must expose any changing-light shader stalls
// and adaptation discontinuities. Recording overhead is not an fps benchmark.
export async function continuousSkyChecks(page,{name,dir,rows,errors}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&x=0&z=103&gy=16&yaw=3.14159265&pitch=-.14&fov=52&time=19.3',
    {waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
  for(let i=0;i<6;i++)await page.evaluate(()=>window.__captureFrame());
  const recording=await page.screencast({path:new URL(name+'-sunset.webm',dir).pathname,
    ffmpegPath:'/opt/homebrew/bin/ffmpeg',fps:20,scale:.75,overwrite:true});
  let result;
  try {
    result=await page.evaluate(async()=>{
      const w=window.__world,L=w.lighting,update=L.update;
      L.update=function(...args){L.state.snap=false;return update(...args);};
      const samples=[];let last=performance.now(),lastSample=last,peak=0;
      try {
        while(w.worldState.time<21.8) {
          const now=await new Promise(requestAnimationFrame),dt=Math.min(.05,Math.max(.001,(now-last)/1000));
          w.worldState.time+=dt*36/3600;last=now;peak=Math.max(peak,window.__RENDER_STATS.drawCalls);
          if(now-lastSample>=200) {
            const s=w.sunState;
            samples.push({time:w.worldState.time,elevation:s.el,exposure:L.state.exposure,target:L.state.targetExposure,
              skyCd:(s.zenith.r*.2126+s.zenith.g*.7152+s.zenith.b*.0722)*5000,
              calls:window.__RENDER_STATS.drawCalls,programs:w.renderer.info.programs.length});
            lastSample=now;
          }
        }
        return {samples,peakDrawCalls:peak,gpuError:w.renderer.getContext().getError()};
      } finally {L.update=update;}
    });
  } finally {await recording.stop();}
  writeFileSync(new URL(name+'-sunset-trace.json',dir),JSON.stringify(result,null,2)+'\n');
  const row={view:'continuous-sunset',samples:result.samples.length,peakDrawCalls:result.peakDrawCalls,
    gpuError:result.gpuError,video:name+'-sunset.webm'};rows.push(row);console.log(JSON.stringify(row));
  if(result.gpuError||result.peakDrawCalls>200)errors.push('Continuous sunset GPU/budget failure');
}
