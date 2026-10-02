import {execFileSync} from 'node:child_process';

// Switch only the actual static-selection methods in a shared world. Geometry,
// source streams, compiled shaders and camera paths are common to both modes.
export async function staticStreamsBenchmark(page,{rows,errors}) {
  const baseline=execFileSync('git',['show','c6ae107:src/instance-lod.js'],{encoding:'utf8'});
  const handler=request=>new URL(request.url()).pathname==='/src/__static_stream_baseline.js'
    ? request.respond({status:200,contentType:'text/javascript',body:baseline}) : request.continue();
  await page.evaluateOnNewDocument(()=>{
    const original=WebGL2RenderingContext.prototype.bufferSubData;
    window.__staticArrays=new WeakSet();
    window.__staticTraffic={calls:0,bytes:0,staticCalls:0,staticBytes:0};
    WebGL2RenderingContext.prototype.bufferSubData=function(target,destination,data,sourceOffset=0,length) {
      if(ArrayBuffer.isView(data)) {
        const bytes=(length===undefined||length===0?data.length-sourceOffset:length)*(data.BYTES_PER_ELEMENT||1);
        const t=window.__staticTraffic;t.calls++;t.bytes+=bytes;
        if(window.__staticArrays.has(data)){t.staticCalls++;t.staticBytes+=bytes;}
      }
      return Reflect.apply(original,this,arguments);
    };
  });
  await page.setCacheEnabled(false);await page.setRequestInterception(true);page.on('request',handler);
  try {
    await page.goto('http://localhost:8765/?shot=1&hud=0&time=7.9',{waitUntil:'domcontentloaded'});
    await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:120000});
    await page.evaluate(async()=>{
      const before=await import('/src/__static_stream_baseline.js'),after=await import('/src/instance-lod.js');
      window.__staticAlgorithms={before:before.StaticInstanceLOD.prototype,after:after.StaticInstanceLOD.prototype};
      const w=window.__world,lod=w.instanceLOD,p=w.player;
      window.__staticBatches=lod.batches.filter(b=>b.constructor.name==='StaticInstanceLOD');
      for(const b of window.__staticBatches)for(const s of b.streams)window.__staticArrays.add(s.attribute.array);
      window.__staticCpu={lod:[],staticMs:0,staticCalls:0};
      const update=lod.update;
      lod.update=function(...args){const start=performance.now();try{return Reflect.apply(update,this,args);}
        finally{window.__staticCpu.lod.push(performance.now()-start);}};
      // Initialize noon-dependent visibility before the first timed route.
      p.teleport(58,-88,-2.303,-.02);const g=p.floorAt(58,-88,24);
      Object.assign(p,{groundY:g.y,smoothY:g.y,zone:g.zone,vx:0,vz:0,bobAmp:0,frozen:true});
      w.camera.fov=54;w.camera.updateProjectionMatrix();w.worldState.time=12.924;
      for(let i=0;i<45;i++)await new Promise(requestAnimationFrame);
    });
    const references=new Map();
    for(const mode of ['before','after','after','before','before','after']) {
      await page.evaluate(mode=>{
        const algorithm=window.__staticAlgorithms[mode];
        for(const b of window.__staticBatches) {
          // Flush a full source reset during warmup. Pending partial ranges
          // from the preceding mode must never narrow a baseline full upload.
          for(const {attribute,source} of b.streams) {
            attribute.array.set(source);attribute.clearUpdateRanges();
            attribute.addUpdateRange(0,source.length);attribute.needsUpdate=true;
          }
          for(let i=0;i<b.capacity;i++)b.ids[i]=i;
          b.mesh.count=b.capacity;b.restore=algorithm.restore;b.__benchmarkAlgorithm=algorithm.update;
          b.update=function(...args){const start=performance.now();try{return Reflect.apply(algorithm.update,this,args);}
            finally{const cpu=window.__staticCpu;cpu.staticMs+=performance.now()-start;cpu.staticCalls++;}};
        }
      },mode);
      for(const scene of ['north','roofs']) {
        const data=await page.evaluate(async scene=>{
          const w=window.__world,p=w.player,frame=()=>new Promise(requestAnimationFrame),frames=[];
          const a=w.plan.wallPts[5],b=w.plan.wallPts[6],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
          const place=distance=>{
            const t=12/34-distance/length,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
            const g=w.plan.groundAt(x,z,a[2]+(b[2]-a[2])*t);
            Object.assign(p,{x,z,groundY:g.y,smoothY:g.y,zone:g.zone,yaw:Math.atan2(a[0]-b[0],a[1]-b[1]),pitch:-.05,
              vx:0,vz:0,bobAmp:0,frozen:true});
          };
          if(scene==='north')place(0);
          else {
            p.teleport(58,-88,-2.303,-.02);const g=p.floorAt(58,-88,24);
            Object.assign(p,{groundY:g.y,smoothY:g.y,zone:g.zone,vx:0,vz:0,bobAmp:0,frozen:true});
          }
          w.camera.fov=54;w.camera.updateProjectionMatrix();w.worldState.time=scene==='north'?7.9:12.87;
          for(let i=0;i<45;i++)await frame();
          if(w.lighting.environment.pending)throw new Error('Static benchmark lighting not ready');
          window.__staticTraffic={calls:0,bytes:0,staticCalls:0,staticBytes:0};
          window.__staticCpu={lod:[],staticMs:0,staticCalls:0};let last=performance.now();
          const count=scene==='north'?240:180;
          for(let i=0;i<count;i++) {
            if(scene==='north')place((i+1)*10/count);else w.worldState.time+=.0003;
            await frame();const now=performance.now(),stats=window.__RENDER_STATS;
            frames.push({ms:now-last,calls:stats.drawCalls,instances:stats.instances,triangles:stats.triangles,
              staticCounts:window.__staticBatches.map(b=>b.mesh.count)});last=now;
          }
          const sorted=frames.map(f=>f.ms).sort((a,b)=>a-b),total=frames.reduce((sum,f)=>sum+f.ms,0);
          const cpu=window.__staticCpu,lod=[...cpu.lod].sort((a,b)=>a-b),algorithms=window.__staticAlgorithms;
          const version=window.__staticBatches.every(b=>b.__benchmarkAlgorithm===algorithms.before.update)?'before':
            window.__staticBatches.every(b=>b.__benchmarkAlgorithm===algorithms.after.update)?'after':'unknown';
          // Compare actual retained source IDs at each scene endpoint outside
          // the timed loop, in addition to per-frame submitted geometry counts.
          const ids=window.__staticBatches.map(b=>({name:b.mesh.name,ids:Array.from(b.ids.subarray(0,b.mesh.count))}));
          return {version,fps:count*1000/total,p95ms:sorted[Math.floor(count*.95)],
            over50ms:frames.filter(f=>f.ms>50).length,maxCalls:Math.max(...frames.map(f=>f.calls)),
            lodMs:cpu.lod.reduce((a,b)=>a+b,0)/cpu.lod.length,lodP95ms:lod[Math.floor(lod.length*.95)],
            staticMs:cpu.staticMs/count,staticCalls:cpu.staticCalls,
            bufferTraffic:{...window.__staticTraffic},dpr:window.__RENDER_STATS.dpr,
            endpoint:{x:p.x,z:p.z,y:p.groundY,zone:p.zone},gpuError:w.renderer.getContext().getError(),ids,frames};
        },scene);
        rows.push({view:'static-stream-benchmark',mode,scene,...data});
        const {frames,ids,...summary}=rows.at(-1);console.log(JSON.stringify(summary));
        if(data.version!==mode||data.gpuError||data.maxCalls>200||data.dpr!==1)errors.push(`Static benchmark failure: ${mode}/${scene}`);
        const signature=JSON.stringify({endpoint:data.endpoint,ids:data.ids,
          geometry:data.frames.map(f=>[f.calls,f.instances,f.triangles,f.staticCounts])});
        if(!references.has(scene))references.set(scene,signature);
        else if(references.get(scene)!==signature)errors.push(`Static benchmark changed geometry/IDs/path: ${mode}/${scene}`);
      }
    }
  } finally {page.off('request',handler);await page.setRequestInterception(false);await page.setCacheEnabled(true);}
}

// Isolate selection/copy CPU work when renderer/host waits swamp RAF timings.
// Use the real city's bounds and sources, with separate mutable streams for
// each algorithm and frozen inputs captured from real rendered poses.
export async function staticStreamsCPU(page,{rows,errors}) {
  const baseline=execFileSync('git',['show','c6ae107:src/instance-lod.js'],{encoding:'utf8'});
  const handler=request=>new URL(request.url()).pathname==='/src/__static_stream_baseline.js'
    ? request.respond({status:200,contentType:'text/javascript',body:baseline}) : request.continue();
  await page.setCacheEnabled(false);await page.setRequestInterception(true);page.on('request',handler);
  try {
    await page.goto('http://localhost:8765/?shot=1&hud=0&time=7.9',{waitUntil:'domcontentloaded'});
    await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:120000});
    const data=await page.evaluate(async()=>{
      const before=await import('/src/__static_stream_baseline.js'),after=await import('/src/instance-lod.js');
      const algorithms={before:before.StaticInstanceLOD.prototype,after:after.StaticInstanceLOD.prototype};
      const w=window.__world,p=w.player,T=w.THREE,frame=()=>new Promise(requestAnimationFrame);
      const batches=w.instanceLOD.batches.filter(b=>b.constructor.name==='StaticInstanceLOD'),latest=[];
      const copyArgs=args=>args.map((a,i)=>i<2 ? a?.map(p=>p.clone()) : i===2 ? a.clone() : i===6 ?
        {near:a.near,matrixWorld:a.matrixWorld.clone(),matrixWorldInverse:a.matrixWorldInverse.clone()} : a);
      const originals=batches.map(b=>b.update);
      for(const [i,b] of batches.entries())b.update=function(...args){latest[i]=copyArgs(args);return Reflect.apply(originals[i],this,args);};
      const captured={north:[],roofs:[]};
      try {
        for(const scene of ['north','roofs'])for(let step=0;step<24;step++) {
          if(scene==='north') {
            const a=w.plan.wallPts[5],b=w.plan.wallPts[6],length=Math.hypot(b[0]-a[0],b[1]-a[1]),t=12/34-step*10/23/length;
            const x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t,g=w.plan.groundAt(x,z,a[2]+(b[2]-a[2])*t);
            Object.assign(p,{x,z,groundY:g.y,smoothY:g.y,zone:g.zone,yaw:Math.atan2(a[0]-b[0],a[1]-b[1]),pitch:-.05});
          } else {
            p.teleport(58,-88,-2.303,-.02);const g=p.floorAt(58,-88,24);Object.assign(p,{groundY:g.y,smoothY:g.y,zone:g.zone});
          }
          Object.assign(p,{vx:0,vz:0,bobAmp:0,frozen:true});w.camera.fov=54;w.camera.updateProjectionMatrix();
          w.worldState.time=scene==='north'?7.9:12.87+step*.054/23;
          latest.fill(null);await frame();
          if(!latest.every(Boolean))throw new Error('CPU snapshot must contain a fresh input for every static batch');
          captured[scene].push(latest.slice());
        }
      } finally {for(const [i,b] of batches.entries())b.update=originals[i];}
      const clone=b=>Object.assign(Object.create(Object.getPrototypeOf(b)),b,{
        mesh:{count:b.capacity,castShadow:b.mesh.castShadow},ids:Int32Array.from({length:b.capacity},(_,i)=>i),
        nextIds:new Int32Array(b.capacity),groupFlags:new Uint8Array(b.groupFlags.length),
        streams:b.streams.map(s=>({...s,attribute:new T.InstancedBufferAttribute(s.source.slice(),s.size,s.attribute.normalized)}))});
      const fixtures={before:batches.map(clone),after:batches.map(clone)};
      const reset=list=>{for(const b of list){b.mesh.count=b.capacity;for(let i=0;i<b.capacity;i++)b.ids[i]=i;
        for(const s of b.streams){s.attribute.array.set(s.source);s.attribute.clearUpdateRanges();}}};
      const consume=list=>{for(const b of list)for(const s of b.streams)s.attribute.clearUpdateRanges();};
      const select=(mode,scene)=>{const list=fixtures[mode];let ms=0;
        for(const inputs of captured[scene]) {
          const start=performance.now();for(const [i,b] of list.entries())Reflect.apply(algorithms[mode].update,b,inputs[i]);ms+=performance.now()-start;
          // Simulate consumption outside the timed CPU region so the next
          // step has the same pending-range lifecycle as a rendered frame.
          consume(list);
        }
        return {ms,perStepMs:ms/captured[scene].length};
      };
      // Validate in a separate untimed replay. Allocating source-ID snapshots
      // between measured steps could put GC into the following timed step.
      for(const scene of ['north','roofs']) {
        reset(fixtures.before);reset(fixtures.after);
        for(const inputs of captured[scene]) {
          for(const mode of ['before','after'])for(const [i,b] of fixtures[mode].entries())Reflect.apply(algorithms[mode].update,b,inputs[i]);
          for(const [i,a] of fixtures.before.entries()) {
            const b=fixtures.after[i];if(a.mesh.count!==b.mesh.count)throw new Error('CPU fixture count mismatch');
            for(let slot=0;slot<a.mesh.count;slot++)if(a.ids[slot]!==b.ids[slot])throw new Error('CPU study changed actual source IDs');
            for(const [j,s] of a.streams.entries())for(let k=0;k<a.mesh.count*s.size;k++)
              if(s.attribute.array[k]!==b.streams[j].attribute.array[k])throw new Error('CPU fixture stream mismatch');
          }
          consume(fixtures.before);consume(fixtures.after);
        }
      }
      // Warm both functions on the complete pose sequence before measuring.
      for(let pass=0;pass<3;pass++)for(const scene of ['north','roofs'])for(const mode of ['before','after']){reset(fixtures[mode]);select(mode,scene);}
      const runs=[];
      for(const mode of ['before','after','after','before','before','after'])for(const scene of ['north','roofs']) {
        reset(fixtures[mode]);const result=select(mode,scene);
        runs.push({mode,scene,ms:result.ms,perStepMs:result.perStepMs,steps:captured[scene].length});
      }
      // The final fixtures hold each mode's same roof selection. Check all
      // drawn attributes exactly, not just source IDs.
      for(const [i,a] of fixtures.before.entries()) {
        const b=fixtures.after[i];if(a.mesh.count!==b.mesh.count)throw new Error('CPU fixture count mismatch');
        for(const [j,s] of a.streams.entries())for(let k=0;k<a.mesh.count*s.size;k++)
          if(s.attribute.array[k]!==b.streams[j].attribute.array[k])throw new Error('CPU fixture stream mismatch');
      }
      // Count distance operations on one actual pose per scene, untimed.
      const distanceCalls={};
      for(const scene of ['north','roofs']) {
        distanceCalls[scene]={};for(const mode of ['before','after']) {
          const original=Math.hypot;let calls=0;Math.hypot=(...args)=>{calls++;return Reflect.apply(original,Math,args);};
          try {for(const [i,b] of fixtures[mode].entries())Reflect.apply(algorithms[mode].update,b,captured[scene][12][i]);}
          finally {Math.hypot=original;}distanceCalls[scene][mode]=calls;
        }
      }
      return {batches:batches.length,sourceInstances:batches.reduce((n,b)=>n+b.capacity,0),runs,distanceCalls,
        allPerStepSourceIdsEqual:true,allPerStepAttributesEqual:true,endpointAttributesEqual:true,gpuError:w.renderer.getContext().getError()};
    });
    rows.push({view:'static-stream-cpu',...data});console.log(JSON.stringify(data));
    if(data.gpuError)errors.push('Static CPU study GPU error');
  } finally {page.off('request',handler);await page.setRequestInterception(false);await page.setCacheEnabled(true);}
}
