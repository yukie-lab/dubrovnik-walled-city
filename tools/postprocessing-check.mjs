import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

// Compare the observer's full-screen target with/without multisampling while
// retaining four samples on the actual city render. Run both in the same tab.
export async function postprocessingCheck(page,{name,dir,rows,errors,args}) {
  if(args.includes('--post-hidpi'))await page.setViewport({width:1280,height:800,deviceScaleFactor:2});
  await page.goto('http://localhost:8765/?shot=1&hud=0&time=7.9&x=58&z=-88&yaw=-2.303&pitch=-.02&gy=24&fov=54',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:120000});
  const layout=await page.evaluate(async()=>{
    const w=window.__world,r=w.renderer,{composer,bloom}=w.postprocessing;
    const scene=composer.renderTarget2,observer=composer.renderTarget1;
    if(scene.samples!==4||observer.samples!==0||observer.depthBuffer)
      throw new Error('Unexpected scene/observer allocation');
    window.__postStudy={scene,observer,set(enabled){
      observer.dispose();observer.samples=enabled?0:4;observer.depthBuffer=!enabled;
    }};
    // Observe the actual scene draw, not just the settings of an unused target.
    const render=r.render;
    r.render=function(s,c){
      if(s===w.scene&&c.layers.mask===1&&r.getRenderTarget()!==scene)
        throw new Error('City geometry was sent to the observer target');
      return render.call(this,s,c);
    };
    const size=r.getDrawingBufferSize(new w.THREE.Vector2());
    const dimensions=()=>({canvas:[size.x,size.y],scene:[scene.width,scene.height],
      observer:[observer.width,observer.height],bright:[bloom.renderTargetBright.width,bloom.renderTargetBright.height]});
    const before=dimensions();dispatchEvent(new Event('resize'));await window.__captureFrame();
    const after=dimensions();
    if(JSON.stringify(before)!==JSON.stringify(after)||scene.width!==size.x||scene.height!==size.y||
      bloom.renderTargetBright.width!==Math.round(size.x/2)||bloom.renderTargetBright.height!==Math.round(size.y/2))
      throw new Error('Postprocessing dimensions change after an unchanged resize');
    return {dpr:r.getPixelRatio(),...before,sceneSamples:scene.samples,observerSamples:observer.samples,
      observerDepth:observer.depthBuffer,removedMultisampleColourBytes:size.x*size.y*4*8};
  });
  rows.push({view:'postprocessing-layout',...layout});console.log(JSON.stringify(rows.at(-1)));
  if(args.includes('--post-resize')) {
    const original=page.viewport();
    for(const [width,height]of [[1000,750],[800,1000],[original.width,original.height]]) {
      await page.setViewport({...original,width,height});
      const result=await page.evaluate(async()=>{
        await window.__captureFrame();await window.__captureFrame();
        const w=window.__world,r=w.renderer,{composer:c,bloom:b}=w.postprocessing;
        const s=r.getDrawingBufferSize(new w.THREE.Vector2());
        return {dpr:r.getPixelRatio(),canvas:[s.x,s.y],scene:[c.renderTarget2.width,c.renderTarget2.height],
          observer:[c.renderTarget1.width,c.renderTarget1.height],bright:[b.renderTargetBright.width,b.renderTargetBright.height],
          sceneSamples:c.renderTarget2.samples,observerSamples:c.renderTarget1.samples,observerDepth:c.renderTarget1.depthBuffer,
          gpuError:r.getContext().getError()};
      });
      rows.push({view:'postprocessing-resize',width,height,...result});console.log(JSON.stringify(rows.at(-1)));
      if(result.gpuError||result.sceneSamples!==4||result.observerSamples!==0||result.observerDepth||
        result.canvas.some((n,i)=>n!==result.scene[i]||n!==result.observer[i]||Math.round(n/2)!==result.bright[i]))
        errors.push('Postprocessing allocation failed after resize');
    }
  }
  const hash=b=>createHash('sha256').update(b).digest('hex');
  const poses=[];
  for(const raw of readFileSync('tools/campaign.txt','utf8').split('\n')) {
    const m=raw.replace(/\s+#.*$/,'').trim().match(/^view\s+(\S+)\s+(.+)$/);if(!m)continue;
    const [x,z,yaw,pitch,extra='']=m[2].split(':');
    poses.push([m[1],Object.fromEntries(new URLSearchParams(`x=${x}&z=${z}&yaw=${yaw}&pitch=${pitch}${extra}`))]);
  }
  for(const [id,params]of args.includes('--post-benchmark')||args.includes('--post-resize')?[]:poses)for(const time of [7.9,12.87,19.3,21.2]) {
    const result=await page.evaluate(async({params,time})=>{
      const w=window.__world,p=w.player,s=window.__postStudy;
      p.teleport(+params.x,+params.z,+params.yaw,+params.pitch);
      const ground=p.floorAt(p.x,p.z,params.gy===undefined?500:+params.gy);
      Object.assign(p,{groundY:ground.y,smoothY:ground.y,zone:ground.zone,bobAmp:0,frozen:true});
      w.camera.fov=+(params.fov||60);w.camera.updateProjectionMatrix();w.worldState.time=time;
      s.set(false);let count=0;
      do{await window.__captureFrame();count++;}while((count<3||w.lighting.environment.pending)&&count<40);
      const before=await window.__captureFrame();s.set(true);
      const after=await window.__captureFrame(),next=await window.__captureFrame();
      return {before,after,stable:after===next,sceneSamples:s.scene.samples,observerSamples:s.observer.samples,
        ...window.__RENDER_STATS,gpuError:w.renderer.getContext().getError()};
    },{params,time});
    const {before,after,...stats}=result,b=Buffer.from(before.split(',')[1],'base64'),a=Buffer.from(after.split(',')[1],'base64');
    const pixelIdentical=hash(b)===hash(a);
    writeFileSync(new URL(`${name}-${id}-${time}.png`,dir),a);
    if(!pixelIdentical)writeFileSync(new URL(`${name}-${id}-${time}-before.png`,dir),b);
    const row={view:'postprocessing',id,time,pixelIdentical,...stats};rows.push(row);console.log(JSON.stringify(row));
    if(!pixelIdentical||!stats.stable||stats.sceneSamples!==4||stats.gpuError)errors.push(`Observer target changes output: ${id}/${time}`);
  }
  if(args.includes('--post-benchmark'))for(const time of [12.87,19.65]) {
    const result=await page.evaluate(async time=>{
      const w=window.__world,s=window.__postStudy,frame=()=>new Promise(requestAnimationFrame),runs=[];
      for(const enabled of [false,true,true,false,false,true]) {
        w.worldState.time=time;s.set(enabled);let last=performance.now();
        for(let i=0;i<45;i++){w.worldState.time+=.0003;await frame();last=performance.now();}
        const frames=[];
        for(let i=0;i<180;i++) {
          w.worldState.time+=.0003;await frame();const now=performance.now();
          frames.push({ms:now-last,calls:window.__RENDER_STATS.drawCalls});last=now;
        }
        const ms=frames.map(f=>f.ms).sort((a,b)=>a-b);
        runs.push({enabled,fps:180000/frames.reduce((a,b)=>a+b.ms,0),p95:ms[Math.floor(ms.length*.95)],
          maxCalls:Math.max(...frames.map(f=>f.calls)),frames});
      }
      s.set(true);return {runs,gpuError:w.renderer.getContext().getError()};
    },time);
    rows.push({view:'postprocessing-benchmark',time,...result});
    console.log(JSON.stringify({time,runs:result.runs.map(({frames,...r})=>r),gpuError:result.gpuError}));
    if(result.gpuError)errors.push('Postprocessing benchmark GPU error');
  }
  writeFileSync(new URL(name+'-postprocessing.json',dir),JSON.stringify(rows,null,2)+'\n');
}
