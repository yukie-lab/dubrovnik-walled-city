import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

// Alternate old/new growth in one Chrome process. Only this source module is
// intercepted; lighting, materials, camera, resolution and leaf budget match.
export async function pineCrownBenchmark(page,{rows,errors}) {
  const source=execFileSync('git',['show','2ae8104:src/woodland-growth.js'],{encoding:'utf8'});
  let mode='before';
  const handler=request=>{
    if(mode==='before'&&new URL(request.url()).pathname==='/src/woodland-growth.js')
      request.respond({status:200,contentType:'text/javascript',body:source});
    else request.continue();
  };
  await page.setCacheEnabled(false);await page.setRequestInterception(true);page.on('request',handler);
  try {
    for(mode of ['before','after','after','before','before','after']) {
      await page.goto('http://localhost:8765/?shot=1&hud=0&time=12.87&x=58&z=-88&gy=24&yaw=-2.303&pitch=-.02&fov=54',{waitUntil:'domcontentloaded'});
      await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:120000});
      const data=await page.evaluate(async()=>{
        const {growPine}=await import('/src/woodland-growth.js');
        const growthVersion=growPine.toString().includes('crownT')?'after':'before';
        const w=window.__world,frame=()=>new Promise(requestAnimationFrame),frames=[];
        w.worldState.time=12.87;let last=performance.now();
        for(let i=0;i<45;i++){w.worldState.time+=.0003;await frame();last=performance.now();}
        for(let i=0;i<180;i++) {
          w.worldState.time+=.0003;await frame();const now=performance.now();
          frames.push({ms:now-last,calls:window.__RENDER_STATS.drawCalls});last=now;
        }
        const ms=frames.map(f=>f.ms).sort((a,b)=>a-b);
        return {growthVersion,fps:180000/frames.reduce((sum,f)=>sum+f.ms,0),p95:ms[Math.floor(ms.length*.95)],
          maxCalls:Math.max(...frames.map(f=>f.calls)),frames,gpuError:w.renderer.getContext().getError()};
      });
      rows.push({view:'pine-crown-benchmark',mode,...data});
      const {frames,...summary}=rows.at(-1);console.log(JSON.stringify(summary));
      if(data.growthVersion!==mode||data.gpuError||data.maxCalls>200)errors.push('Crown benchmark source/GPU/budget failure');
    }
  } finally {page.off('request',handler);await page.setRequestInterception(false);await page.setCacheEnabled(true);}
}

// Inspect the same crown from three sides at the application's HiDPI cap.
export async function pineCrownCapture(page,{name,dir,rows,errors}) {
  const tree=JSON.parse(readFileSync(new URL('../docs/september-tree-views.json',import.meta.url),'utf8')).find(t=>t.species==='aleppoPine');
  await page.setViewport({width:1280,height:800,deviceScaleFactor:2});
  await page.goto('http://localhost:8765/?shot=1&hud=0&time=7.9',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:120000});
  for(let side=0;side<3;side++)for(const time of [7.9,12.87,19.3]) {
    const result=await page.evaluate(async({tree,side,time})=>{
      const w=window.__world,p=w.player,[tx,ty,tz]=tree.base,d=tree.height*1.8;
      const a=Math.atan2(.3,.95)+side*Math.PI*2/3;
      const x=tx+Math.sin(a)*d*Math.hypot(.3,.95),z=tz+Math.cos(a)*d*Math.hypot(.3,.95),gy=w.plan.outsideHeight(x,z);
      const yaw=Math.atan2(x-tx,z-tz),pitch=Math.atan2(ty+tree.height*.52-gy-1.62,Math.hypot(x-tx,z-tz));
      Object.assign(p,{x,z,groundY:gy,smoothY:gy,zone:'outside',yaw,pitch,vx:0,vz:0,bobAmp:0,frozen:true});
      w.camera.fov=54;w.camera.updateProjectionMatrix();w.worldState.time=time;
      let n=0;do{await window.__captureFrame();n++;}while((n<4||w.lighting.environment.pending)&&n<40);
      if(w.lighting.environment.pending)throw new Error('Unfinished crown lighting');
      const images=[];for(let f=0;f<6;f++)images.push(await window.__captureFrame());
      return {station:{x,z,gy,yaw,pitch},stableFrames:new Set(images).size===1,png:images.at(-1),
        stats:{...window.__RENDER_STATS},gpuError:w.renderer.getContext().getError()};
    },{tree,side,time});
    const {png,...data}=result;writeFileSync(new URL(`${name}-pine-${side}-${time}.png`,dir),Buffer.from(png.split(',')[1],'base64'));
    rows.push({view:'pine-crown',side,time,...data});console.log(JSON.stringify(rows.at(-1)));
    if(!data.stableFrames||data.gpuError||data.stats.drawCalls>200||data.stats.dpr!==1.6)errors.push('Crown HiDPI capture failed');
  }
}
