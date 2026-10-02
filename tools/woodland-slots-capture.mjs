import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Replace only the leaf or static stream manager. Every model, shader, density
// setting, camera and time is common to the two independent page loads.
export async function woodlandSlotsStudy(page,{name,dir,rows,errors,args,staticStreams=false}) {
  const sourceFile=staticStreams?'instance-lod.js':'woodland-leaf-lod.js';
  const baseline=execFileSync('git',['show',`${staticStreams?'c6ae107':'32cdc85'}:src/${sourceFile}`],{encoding:'utf8'});
  const kind=staticStreams?'static-streams':'leaf-slots';
  const hidpi=args.includes('--slots-hidpi')||args.includes('--static-hidpi'),before=new Map();let mode='before';
  if(hidpi)await page.setViewport({width:1280,height:800,deviceScaleFactor:2});
  const handler=request=>mode==='before'&&new URL(request.url()).pathname===`/src/${sourceFile}`
    ? request.respond({status:200,contentType:'text/javascript',body:baseline}) : request.continue();
  await page.setCacheEnabled(false);await page.setRequestInterception(true);page.on('request',handler);
  const canonical=[];
  for(const raw of readFileSync('tools/campaign.txt','utf8').split('\n')) {
    const m=raw.replace(/\s+#.*$/,'').trim().match(/^view\s+(\S+)\s+(.+)$/);if(!m)continue;
    const [x,z,yaw,pitch,extra='']=m[2].split(':');
    const params=Object.fromEntries(new URLSearchParams(`x=${x}&z=${z}&yaw=${yaw}&pitch=${pitch}${extra}`));
    for(const time of [7.9,12.87,19.3,21.2])canonical.push({id:m[1],time,canonical:true,
      ...Object.fromEntries(Object.entries(params).map(([key,value])=>[key,+value]))});
  }
  const targets=JSON.parse(readFileSync('docs/september-tree-views.json','utf8'));
  try {
    for(mode of ['before','after']) {
      await page.goto('http://localhost:8765/?shot=1&hud=0&time=7.9',{waitUntil:'domcontentloaded'});
      await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:120000});
      const stations=await page.evaluate(({canonical,targets,hidpi})=>{
        const w=window.__world,out=hidpi?[]:[...canonical];
        for(const t of targets)for(const time of hidpi?[7.9,12.87,19.3]:[7.9]) {
          const [tx,ty,tz]=t.base,d=t.height*1.8,x=tx+d*.3,z=tz+d*.95,gy=w.plan.outsideHeight(x,z);
          out.push({id:t.species,time,x,z,gy,yaw:Math.atan2(x-tx,z-tz),pitch:Math.atan2(ty+t.height*.52-gy-1.62,Math.hypot(x-tx,z-tz))});
        }
        // Small forward/backward steps exercise sparse changes between captures.
        const a=w.plan.wallPts[5],b=w.plan.wallPts[6],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
        for(const [step,distance] of [0,1,2,3,4,5,6,7,7,6,5,4,3,2,1,0].entries()) {
          const t=12/34-distance*.7/length,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
          const g=w.plan.groundAt(x,z,a[2]+(b[2]-a[2])*t);
          out.push({id:`north-${step}`,time:7.9,x,z,gy:g.y,zone:g.zone,yaw:Math.atan2(a[0]-b[0],a[1]-b[1]),pitch:-.05});
        }
        // Both culling and density can be disabled and restored after reordering.
        const roof=canonical.find(s=>s.id==='v3_roofs'&&s.time===12.87);
        for(const [id,culling,density] of [['full',false,false],['density',false,true],['restored',true,true]])
          out.push({...roof,id,culling,density});
        return out;
      },{canonical,targets,hidpi});
      for(const s of stations) {
        const result=await page.evaluate(async ({s,staticStreams})=>{
          const w=window.__world,p=w.player,leaves=w.instanceLOD.batches.filter(b=>b.mesh.userData.woodlandLeaves);
          Object.assign(p,{x:s.x,z:s.z,groundY:s.gy,smoothY:s.gy,zone:s.zone||'outside',yaw:s.yaw,pitch:s.pitch,vx:0,vz:0,bobAmp:0,frozen:true});
          if(s.canonical) {
            p.teleport(s.x,s.z,s.yaw,s.pitch);const g=p.floorAt(s.x,s.z,s.gy??500);
            Object.assign(p,{groundY:g.y,smoothY:g.y,zone:g.zone});
          }
          w.camera.fov=s.fov||54;w.camera.updateProjectionMatrix();w.worldState.time=s.time;
          w.instanceLOD.enabled=s.culling??true;w.instanceLOD.vegetationDetailEnabled=s.density??true;
          let n=0;do{await window.__captureFrame();n++;}while((n<4||w.lighting.environment.pending)&&n<40);
          if(w.lighting.environment.pending)throw new Error('Unfinished stream comparison lighting');
          const png=await window.__captureFrame(),again=await window.__captureFrame();
          return {png,stable:png===again,stats:{...window.__RENDER_STATS},gpuError:w.renderer.getContext().getError(),
            version:staticStreams ? (w.instanceLOD.batches.filter(b=>b.constructor.name==='StaticInstanceLOD')
              .every(b=>b.update.toString().includes('firstChanged'))?'after':'before') : leaves.every(b=>b.slots)?'after':'before',counts:leaves.map(b=>b.mesh.count),
            slotBytes:leaves.reduce((sum,b)=>sum+(b.slots?b.slots.slotOf.byteLength+b.slots.sourceAt.byteLength+b.slots.dirty.byteLength+(b.slots.touched?.byteLength||0):0),0)};
        },{s,staticStreams});
        const {png,...data}=result,key=`${s.id}-${s.time}`,buffer=Buffer.from(png.split(',')[1],'base64');
        const hash=createHash('sha256').update(buffer).digest('hex');
        writeFileSync(new URL(`${name}-${key}-${mode}.png`,dir),buffer);
        if(mode==='before')before.set(key,{hash,...data});
        else {
          const reference=before.get(key),exact=reference.hash===hash;
          const sameCounts=reference.stats.triangles===data.stats.triangles&&reference.stats.instances===data.stats.instances&&reference.stats.drawCalls===data.stats.drawCalls;
          // Diagnose draw-order differences without changing the acceptance
          // criterion. This image must still match exactly to pass.
          let canonicalOrderMatches=null;
          if(!exact&&!staticStreams) {
            const sorted=await page.evaluate(async()=>{
              for(const b of window.__world.instanceLOD.batches)if(b.slots) {
                b.slots.rebuild(b.groups,b.next,b.detail);b.slots.upload();b.mesh.count=b.slots.count;
              }
              return window.__captureFrame();
            });
            const canonical=Buffer.from(sorted.split(',')[1],'base64');
            writeFileSync(new URL(`${name}-${key}-canonical.png`,dir),canonical);
            canonicalOrderMatches=createHash('sha256').update(canonical).digest('hex')===reference.hash;
          }
          rows.push({view:kind,id:s.id,time:s.time,station:s,...data,hash,before:reference,exact,sameCounts,canonicalOrderMatches});
          console.log(`${key}: pixels=${exact} counts=${sameCounts} calls=${data.stats.drawCalls}`);
          if(!exact||!sameCounts)errors.push(`${kind} image/count mismatch: ${key}`);
        }
        if(!data.stable||data.version!==mode||data.gpuError||data.stats.drawCalls>200||data.stats.dpr!==(hidpi?1.6:1))
          errors.push(`${kind} source/stability/GPU/budget failure: ${key}/${mode}`);
      }
    }
  } finally {page.off('request',handler);await page.setRequestInterception(false);await page.setCacheEnabled(true);}
}

// Fixed frame-by-frame travel gives each version precisely the same 10 m
// path and LOD transitions. Actual W-key walking is checked separately.
export async function woodlandSlotsBenchmark(page,{rows,errors}) {
  const baseline=execFileSync('git',['show','32cdc85:src/woodland-leaf-lod.js'],{encoding:'utf8'});
  const handler=request=>new URL(request.url()).pathname==='/src/__leaf_slots_baseline.js'
    ? request.respond({status:200,contentType:'text/javascript',body:baseline}) : request.continue();
  await page.evaluateOnNewDocument(()=>{
    const original=WebGL2RenderingContext.prototype.bufferSubData;
    window.__slotTraffic={calls:0,bytes:0};
    WebGL2RenderingContext.prototype.bufferSubData=function(target,destination,data,sourceOffset=0,length) {
      if(ArrayBuffer.isView(data)) {
        const bytes=data.BYTES_PER_ELEMENT||1;window.__slotTraffic.calls++;
        window.__slotTraffic.bytes+=(length===undefined||length===0?data.byteLength-sourceOffset*bytes:length*bytes);
      }
      return Reflect.apply(original,this,arguments);
    };
  });
  await page.setCacheEnabled(false);await page.setRequestInterception(true);page.on('request',handler);
  try {
    // Reuse one world, its buffers and compiled shaders. Alternate only the
    // selection method from the real old/new classes, avoiding six world
    // rebuilds and their memory/compilation effects during timing comparisons.
    await page.goto('http://localhost:8765/?shot=1&hud=0&time=7.9',{waitUntil:'domcontentloaded'});
    await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:120000});
    await page.evaluate(async()=>{
      const before=await import('/src/__leaf_slots_baseline.js'),after=await import('/src/woodland-leaf-lod.js');
      window.__leafSlotAlgorithms={before:before.WoodlandLeafLOD.prototype.applySelection,after:after.WoodlandLeafLOD.prototype.applySelection};
      // Visit the second scene first: day-state/visibility initialization must
      // precede the first timed run just as it precedes every later repeat.
      const w=window.__world,p=w.player;p.teleport(58,-88,-2.303,-.02);
      const g=p.floorAt(58,-88,24);Object.assign(p,{groundY:g.y,smoothY:g.y,zone:g.zone,vx:0,vz:0,bobAmp:0,frozen:true});
      w.camera.fov=54;w.camera.updateProjectionMatrix();w.worldState.time=12.924;
      for(let i=0;i<45;i++)await new Promise(requestAnimationFrame);
    });
    const referenceFrames=new Map();
    for(const mode of ['before','after','after','before','before','after']) {
      await page.evaluate(mode=>{
        for(const b of window.__world.instanceLOD.batches)if(b.slots) {
          // The old suffix algorithm requires source order. The new method
          // requires consistent slot maps. This untimed reset supplies both.
          b.slots.rebuild(b.groups,b.kept,b.appliedDetail);b.slots.upload();b.mesh.count=b.slots.count;
          b.applySelection=window.__leafSlotAlgorithms[mode];
        }
      },mode);
      for(const scene of ['north','roofs']) {
        const data=await page.evaluate(async scene=>{
          const w=window.__world,p=w.player,frame=()=>new Promise(requestAnimationFrame),frames=[];
          const leaves=w.instanceLOD.batches.filter(b=>b.mesh.userData.woodlandLeaves);
          const a=w.plan.wallPts[5],b=w.plan.wallPts[6],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
          const place=distance=>{
            const t=12/34-distance/length,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
            const g=w.plan.groundAt(x,z,a[2]+(b[2]-a[2])*t);
            Object.assign(p,{x,z,groundY:g.y,smoothY:g.y,zone:g.zone,yaw:Math.atan2(a[0]-b[0],a[1]-b[1]),pitch:-.05,vx:0,vz:0,bobAmp:0,frozen:true});
          };
          if(scene==='north')place(0);
          else {
            p.teleport(58,-88,-2.303,-.02);const g=p.floorAt(58,-88,24);
            Object.assign(p,{groundY:g.y,smoothY:g.y,zone:g.zone,vx:0,vz:0,bobAmp:0,frozen:true});
          }
          w.camera.fov=54;w.camera.updateProjectionMatrix();w.worldState.time=scene==='north'?7.9:12.87;
          for(let i=0;i<45;i++)await frame();
          if(w.lighting.environment.pending)throw new Error('Benchmark lighting not ready');
          const start=leaves.map(l=>({bytes:l.transferredBytes,compactions:l.compactions}));
          window.__slotTraffic={calls:0,bytes:0};let last=performance.now();
          const count=scene==='north'?240:180;
          for(let i=0;i<count;i++) {
            if(scene==='north')place((i+1)*10/count);else w.worldState.time+=.0003;
            await frame();const now=performance.now();
            frames.push({ms:now-last,calls:window.__RENDER_STATS.drawCalls,instances:window.__RENDER_STATS.instances});last=now;
          }
          const sorted=frames.map(f=>f.ms).sort((a,b)=>a-b),total=frames.reduce((sum,f)=>sum+f.ms,0);
          const algorithms=window.__leafSlotAlgorithms;
          const version=leaves.every(b=>b.applySelection===algorithms.before)?'before':leaves.every(b=>b.applySelection===algorithms.after)?'after':'unknown';
          return {version,fps:count*1000/total,p95ms:sorted[Math.floor(count*.95)],
            over50ms:frames.filter(f=>f.ms>50).length,maxCalls:Math.max(...frames.map(f=>f.calls)),
            bufferTraffic:{...window.__slotTraffic},leafChanges:leaves.map((l,i)=>({groups:l.groups.length,
              scheduledBytes:l.transferredBytes-start[i].bytes,compactions:l.compactions-start[i].compactions})),
            dpr:window.__RENDER_STATS.dpr,endpoint:{x:p.x,z:p.z,y:p.groundY,zone:p.zone},
            gpuError:w.renderer.getContext().getError(),frames};
        },scene);
        rows.push({view:'leaf-slots-benchmark',mode,scene,...data});
        const {frames,...summary}=rows.at(-1);console.log(JSON.stringify(summary));
        if(data.version!==mode||data.gpuError||data.maxCalls>200||data.dpr!==1)errors.push(`Leaf slots benchmark failure: ${mode}/${scene}`);
        const signature=JSON.stringify({endpoint:data.endpoint,geometry:data.frames.map(f=>[f.calls,f.instances]),
          compactions:data.leafChanges.map(l=>l.compactions)});
        if(!referenceFrames.has(scene))referenceFrames.set(scene,signature);
        else if(referenceFrames.get(scene)!==signature)errors.push(`Benchmark changed scene geometry/path between runs: ${mode}/${scene}`);
      }
    }
  } finally {page.off('request',handler);await page.setRequestInterception(false);await page.setCacheEnabled(true);}
}
