import {readFileSync,writeFileSync} from 'node:fs';

export async function foliageNormalStudy(page,{name,dir,rows,errors,args}) {
  if(args.includes('--foliage-hidpi'))await page.setViewport({width:1280,height:800,deviceScaleFactor:2});
  await page.goto('http://localhost:8765/?shot=1&hud=0&time=7.9&x=58&z=-88&gy=24&yaw=-2.303&pitch=-.02&fov=54',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:120000});
  if(args.includes('--foliage-normal-gpu')) {
    const {foliageNormalGPUCheck}=await import('./foliage-normal-gpu-check.mjs');
    await foliageNormalGPUCheck(page,{name,dir,rows,errors});return;
  }
  if(args.includes('--foliage-benchmark')) {
    for(const time of [12.87,19.65]) {
      const result=await page.evaluate(async time=>{
        const w=window.__world,leaves=[],frame=()=>new Promise(requestAnimationFrame),runs=[];
        w.scene.traverse(o=>{if(o.name==='surround.foliage')leaves.push(o);});
        for(const flat of [false,true,true,false,false,true]) {
          for(const o of leaves){o.material.flatShading=flat;o.material.needsUpdate=true;}
          w.worldState.time=time;let last=performance.now();
          for(let i=0;i<45;i++){w.worldState.time+=.0003;await frame();last=performance.now();}
          const frames=[];
          for(let i=0;i<180;i++) {
            w.worldState.time+=.0003;await frame();const now=performance.now();
            frames.push({ms:now-last,calls:window.__RENDER_STATS.drawCalls});last=now;
          }
          const ms=frames.map(f=>f.ms).sort((a,b)=>a-b);
          runs.push({flat,fps:180000/frames.reduce((sum,f)=>sum+f.ms,0),p95:ms[Math.floor(ms.length*.95)],
            maxCalls:Math.max(...frames.map(f=>f.calls)),frames});
        }
        return {runs,gpuError:w.renderer.getContext().getError()};
      },time);
      rows.push({view:'foliage-benchmark',time,...result});
      console.log(JSON.stringify({time,runs:result.runs.map(({frames,...r})=>r),gpuError:result.gpuError}));
      if(result.gpuError||result.runs.some(r=>r.maxCalls>200))errors.push('Foliage benchmark GPU/budget failure');
    }
    return;
  }
  const targets=JSON.parse(readFileSync('docs/september-tree-views.json','utf8'));
  let stations=await page.evaluate(targets=>{
    const out=[{id:'roofs',x:58,z:-88,gy:24,yaw:-2.303,pitch:-.02}];
    for(const t of targets) {
      const [tx,ty,tz]=t.base,d=t.height*1.8,x=tx+d*.3,z=tz+d*.95,gy=window.__world.plan.outsideHeight(x,z);
      out.push({id:t.species,x,z,gy,yaw:Math.atan2(x-tx,z-tz),pitch:Math.atan2(ty+t.height*.52-gy-1.62,Math.hypot(x-tx,z-tz))});
    }
    return out;
  },targets);
  if(args.includes('--foliage-sweep')) {
    stations=[];
    for(const raw of readFileSync('tools/campaign.txt','utf8').split('\n')) {
      const m=raw.replace(/\s+#.*$/,'').trim().match(/^view\s+(\S+)\s+(.+)$/);if(!m)continue;
      const [x,z,yaw,pitch,extra='']=m[2].split(':');
      const params=Object.fromEntries(new URLSearchParams(`x=${x}&z=${z}&yaw=${yaw}&pitch=${pitch}${extra}`));
      stations.push({id:m[1],canonical:true,...Object.fromEntries(Object.entries(params).map(([k,v])=>[k,+v]))});
    }
  }
  for(const s of stations)for(const time of args.includes('--foliage-sweep')?[7.9,12.87,19.3,21.2]:[7.9,12.87,19.3]) {
    const result=await page.evaluate(async({s,time})=>{
      const w=window.__world,p=w.player,leaves=[];
      w.scene.traverse(o=>{if(o.name==='surround.foliage')leaves.push(o);});
      Object.assign(p,{x:s.x,z:s.z,groundY:s.gy,smoothY:s.gy,zone:s.id==='roofs'?'wall':'outside',
        yaw:s.yaw,pitch:s.pitch,vx:0,vz:0,bobAmp:0,frozen:true});
      if(s.canonical) {
        p.teleport(s.x,s.z,s.yaw,s.pitch);const g=p.floorAt(s.x,s.z,s.gy??500);
        Object.assign(p,{groundY:g.y,smoothY:g.y,zone:g.zone});
      }
      w.camera.fov=s.fov||54;w.camera.updateProjectionMatrix();w.worldState.time=time;
      const images={},telemetry={};
      for(const [mode,flat]of [['before',false],['after',true],['restored',false]]) {
        for(const o of leaves){o.material.flatShading=flat;o.material.needsUpdate=true;}
        let n=0;do{await window.__captureFrame();n++;}while((n<4||w.lighting.environment.pending)&&n<40);
        if(w.lighting.environment.pending)throw new Error('Unfinished foliage comparison lighting');
        images[mode]=await window.__captureFrame();
        telemetry[mode]={...window.__RENDER_STATS};
      }
      for(const o of leaves){o.material.flatShading=true;o.material.needsUpdate=true;}
      return {images,restored:images.before===images.restored,telemetry,stats:telemetry.after,gpuError:w.renderer.getContext().getError()};
    },{s,time});
    for(const mode of ['before','after'])writeFileSync(new URL(`${name}-${s.id}-${time}-${mode}.png`,dir),Buffer.from(result.images[mode].split(',')[1],'base64'));
    const {images,...data}=result;rows.push({view:'foliage-normal',id:s.id,time,station:s,...data});console.log(JSON.stringify(rows.at(-1)));
    if(!data.restored||data.gpuError||data.telemetry.before.triangles!==data.telemetry.after.triangles||
      data.telemetry.before.instances!==data.telemetry.after.instances||data.stats.drawCalls>200)
      errors.push(`Foliage normal comparison unstable or changed geometry: ${s.id}/${time}`);
  }
  await page.evaluate(()=>window.__captureFrame());
}
