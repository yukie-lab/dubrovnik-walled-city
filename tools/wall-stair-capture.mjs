import {writeFileSync} from 'node:fs';

// Follow the fixed stair centreline with the real Player.update and W input.
// Only the starting pose is assigned. A failed corner is recorded, never
// skipped or teleported across. Video recording is not a performance benchmark.
export async function wallStairChecks(page,{name,dir,rows,errors,args}) {
  const option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
  await page.goto('http://localhost:8765/?shot=1&hud=0&time=12.87',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY && window.__captureFrame',{timeout:60000});
  const ids=await page.evaluate(()=>window.__world.plan.WALL_STAIRS.map(s=>s.id));
  const selected=ids.filter(id=>!args.includes('--stair-id')||id===option('--stair-id'));
  const times=args.includes('--stair-times')?option('--stair-times').split(',').map(Number):args.includes('--stair-quick')?[12.87]:[7.9,12.87];
  if(times.some(t=>!Number.isFinite(t)||t<0||t>24))throw new Error('Invalid stair inspection time');
  for(const hour of times)for(const id of selected) {
    const station=await page.evaluate(({id,hour})=>{
      const w=window.__world,p=w.player,st=w.plan.WALL_STAIRS.find(s=>s.id===id),path=st.pts.map(p=>p.slice());
      w.auto.stop();w.worldState.time=hour;w.instanceLOD.enabled=true;
      const end=path.at(-1),landing=w.plan.landings.find(l=>Math.hypot(l.x-end[0],l.z-end[1])<.01);
      if(landing)path.push([landing.x+landing.ux*landing.len,landing.z+landing.uz*landing.len,landing.y]);
      else if(st.spiral) {
        const tower=Object.values(w.plan.TOWERS).filter(t=>Math.abs(t.topY-end[2])<.5)
          .sort((a,b)=>Math.hypot(a.x-end[0],a.z-end[1])-Math.hypot(b.x-end[0],b.z-end[1]))[0];
        if(tower)path.push([end[0]+(tower.x-end[0])*.22,end[1]+(tower.z-end[1])*.22,tower.topY]);
      }
      const [x,z,y]=path[0],g=(w.plan.walkingGroundAt||w.plan.groundAt)(x,z,y);
      Object.assign(p,{x,z,groundY:g.y,smoothY:g.y,zone:g.zone,stair:g.stair??null,stairLift:null,stairBlend:g.stair?1:0,
        yaw:Math.atan2(x-path[1][0],z-path[1][1]),pitch:.045,vx:0,vz:0,bobAmp:0,frozen:true});
      w.camera.fov=60;w.camera.updateProjectionMatrix();
      const distances=[0];for(let i=1;i<path.length;i++)distances.push(distances.at(-1)+Math.hypot(path[i][0]-path[i-1][0],path[i][1]-path[i-1][1]));
      return {id,hour,enclosed:st.enclosed,spiral:!!st.spiral,path,distances};
    },{id,hour});
    for(let i=0;i<4;i++)await page.evaluate(()=>window.__captureFrame());
    if(errors.length)throw new Error('Cannot inspect an ascent with a renderer error: '+errors.at(-1));
    const stem=`${name}-${id}-${String(hour).replace('.','_')}`,frames=[],lightSamples=[];
    const saveFrame=async label=>{
      const png=await page.evaluate(()=>window.__captureFrame()),file=stem+'-'+label+'.png';
      const gpuError=await page.evaluate(()=>window.__world.renderer.getContext().getError());
      if(gpuError)throw new Error('GPU rejected an ascent draw: '+gpuError+' at '+stem+'-'+label);
      writeFileSync(new URL(file,dir),Buffer.from(png.split(',')[1],'base64'));frames.push(file);
      lightSamples.push({label,...await page.evaluate(()=>{
        const w=window.__world,l=w.lighting.state,s=w.sunState;
        return {exposure:l.exposure,targetExposure:l.targetExposure,meterIlluminance:l.meterIlluminance,
          localIlluminance:l.localIlluminance,ghi:s.ghi,moonIntensity:s.moonIntensity,
          sunElevation:s.el,position:w.camera.position.toArray(),zone:w.player.zone};
      })});
    };
    await saveFrame('bottom');
    const recorder=args.includes('--no-video')?null:await page.screencast({path:new URL(stem+'.webm',dir).pathname,
      ffmpegPath:'/opt/homebrew/bin/ffmpeg',fps:20,scale:.75,overwrite:true});
    await page.evaluate(station=>{
      const w=window.__world,p=w.player,original=p.update.bind(p),path=station.path;
      const run={trace:[],index:1,progress:0,done:false,failed:null,elapsed:0,stuck:0,lastDistance:Infinity,peakDrawCalls:0};
      window.__stairAscent=run;window.__stairRestore=()=>{p.update=original;p.frozen=true;};
      const empty=new Set();p.frozen=false;
      p.update=(dt,keys)=>{
        if(run.done)return original(dt,empty);
        run.elapsed+=dt;
        run.peakDrawCalls=Math.max(run.peakDrawCalls,window.__RENDER_STATS.drawCalls);
        const target=path[run.index],dx=target[0]-p.x,dz=target[1]-p.z,distance=Math.hypot(dx,dz);
        const turn=Math.atan2(Math.sin(Math.atan2(-dx,-dz)-p.yaw),Math.cos(Math.atan2(-dx,-dz)-p.yaw));
        p.yaw+=Math.max(-dt*1.9,Math.min(dt*1.9,turn));
        original(dt,Math.abs(turn)<.55?keys:empty);
        if(distance<.18) {
          run.index++;run.lastDistance=Infinity;run.stuck=0;
          if(run.index===path.length){run.done=true;p.vx=p.vz=0;p.frozen=true;}
        }else {
          run.stuck=distance>run.lastDistance-.001?run.stuck+dt:0;run.lastDistance=distance;
          if(run.stuck>7 || run.elapsed>100){run.failed='Blocked before waypoint '+run.index;run.done=true;p.frozen=true;}
        }
        const segment=Math.min(run.index,path.length-1),a=path[segment-1],b=path[segment],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
        const t=Math.max(0,Math.min(1,((p.x-a[0])*(b[0]-a[0])+(p.z-a[1])*(b[1]-a[1]))/(len*len)));
        run.progress=(station.distances[segment-1]+len*t)/station.distances.at(-1);
        run.trace.push({t:run.elapsed,x:p.x,z:p.z,y:p.groundY,eyeBase:p.smoothY,zone:p.zone,progress:run.progress,waypoint:run.index,
          stairKey:p.stair?.key??null,drawCalls:window.__RENDER_STATS.drawCalls});
      };
    },station);
    await page.keyboard.down('KeyW');
    try {
      for(const threshold of [.20,.40,.60,.80,1]) {
        await page.waitForFunction(t=>window.__stairAscent.done||window.__stairAscent.progress>=t,{timeout:120000},threshold);
        await saveFrame('p'+Math.round(threshold*100));
        const done=await page.evaluate(()=>window.__stairAscent.done);if(done)break;
      }
      const completed=await page.evaluate(()=>window.__stairAscent.done&&!window.__stairAscent.failed);
      if(completed&&!args.includes('--no-emergence')) {
        await page.keyboard.up('KeyW');
        await page.evaluate(async()=>{
          const w=window.__world,p=w.player,run=window.__stairAscent;
          const from=p.yaw,to=Math.atan2(p.x,p.z),turn=Math.atan2(Math.sin(to-from),Math.cos(to-from)),pitch=p.pitch;
          const start=performance.now();p.frozen=false;
          for(;;) {
            const now=await new Promise(requestAnimationFrame),elapsed=(now-start)/1000,t=Math.max(0,Math.min(1,(elapsed-1.2)/5.5));
            const ease=t*t*(3-2*t);p.yaw=from+turn*ease;p.pitch=pitch+(-.11-pitch)*ease;
            run.peakDrawCalls=Math.max(run.peakDrawCalls,window.__RENDER_STATS.drawCalls);
            if(elapsed>=7.2)break;
          }
          p.frozen=true;
        });
        await saveFrame('emerged-city');
      }
    } finally {
      await page.keyboard.up('KeyW');await page.evaluate(()=>window.__stairRestore());if(recorder)await recorder.stop();
    }
    const result=await page.evaluate(()=>({...window.__stairAscent,stats:{...window.__RENDER_STATS}}));
    writeFileSync(new URL(stem+'-trace.json',dir),JSON.stringify({station,lightSamples,...result},null,2)+'\n');
    const row={view:'wall-stair-ascent',id,hour,frames,video:recorder?stem+'.webm':null,completed:!result.failed&&result.done,
      failure:result.failed,elapsed:result.elapsed,samples:result.trace.length,progress:result.progress,peakDrawCalls:result.peakDrawCalls,...result.stats};
    rows.push(row);console.log(JSON.stringify(row));
    if(args.includes('--stair-strict')&&!row.completed)errors.push(stem+': '+row.failure);
  }
}
