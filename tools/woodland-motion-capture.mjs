import {writeFileSync} from 'node:fs';

// Compare actual walking at the expensive north wall with the same camera,
// density, resolution, time and renderer. Count real WebGL buffer transfers,
// across the whole scene, without copies or GPU timer-query overhead.
export async function woodlandMotionChecks(page,{name,dir,rows,errors,args}) {
  await page.evaluateOnNewDocument(()=>{
    const prototype=WebGL2RenderingContext.prototype,original=prototype.bufferSubData;
    window.__bufferTraffic={calls:0,bytes:0};
    prototype.bufferSubData=function(target,destination,data,sourceOffset=0,length) {
      if(ArrayBuffer.isView(data)) {
        const bytes=data.BYTES_PER_ELEMENT||1;
        window.__bufferTraffic.calls++;
        window.__bufferTraffic.bytes+=(length===undefined || length===0 ? data.byteLength-sourceOffset*bytes : length*bytes);
      }
      return Reflect.apply(original,this,arguments);
    };
  });
  await page.goto('http://localhost:8765/?shot=1&hud=0&x=-84&z=-90.05882&gy=27.85&yaw=-1.4827&pitch=-0.05&time=7.9&fov=54',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY && window.__captureFrame',{timeout:60000});
  await page.evaluate(()=>{
    const lod=window.__world.instanceLOD,original=lod.update.bind(lod);
    window.__lodTimes=[];
    lod.update=(...a)=>{const start=performance.now();original(...a);window.__lodTimes.push(performance.now()-start);};
  });
  for(let run=0;run<3;run++) {
    const station=await page.evaluate(()=>{
      const w=window.__world,a=w.plan.wallPts[5],b=w.plan.wallPts[6],t=12/34;
      const x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t,g=w.plan.groundAt(x,z,a[2]+(b[2]-a[2])*t);
      const p=w.player;
      Object.assign(p,{x,z,groundY:g.y,smoothY:g.y,zone:g.zone,yaw:Math.atan2(a[0]-b[0],a[1]-b[1]),pitch:-.05,vx:0,vz:0,bobAmp:0,frozen:true});
      return {x,z,y:g.y,zone:g.zone};
    });
    for(let i=0;i<6;i++)await page.evaluate(()=>window.__captureFrame());
    if(run===0) {
      const png=await page.evaluate(()=>window.__captureFrame());
      writeFileSync(new URL(`${name}-north-start.png`,dir),Buffer.from(png.split(',')[1],'base64'));
    }
    await page.evaluate(()=>{window.__world.player.frozen=false;});
    await page.keyboard.down('KeyW');
    const motion=await page.evaluate(async()=>{
      const ticks=[];let start=performance.now(),last=start;
      while(performance.now()-start<1000)await new Promise(requestAnimationFrame);
      window.__lodTimes.length=0;window.__bufferTraffic={calls:0,bytes:0};
      const leaves=window.__world.instanceLOD.batches.filter(b=>b.mesh.userData.woodlandLeaves);
      const before=leaves.map(b=>({compactions:b.compactions||0,scheduled:b.transferredBytes||0}));
      start=last=performance.now();
      while(performance.now()-start<6000) {
        const now=await new Promise(requestAnimationFrame);ticks.push(now-last);last=now;
      }
      const p=window.__world.player,sorted=[...ticks].sort((a,b)=>a-b),cpu=window.__lodTimes.slice().sort((a,b)=>a-b);
      return {fps:ticks.length*1000/ticks.reduce((a,b)=>a+b,0),p95ms:sorted[Math.floor(sorted.length*.95)],
        lodMs:cpu.reduce((a,b)=>a+b,0)/cpu.length,lodP95ms:cpu[Math.floor(cpu.length*.95)],
        bufferTraffic:{...window.__bufferTraffic},leafChanges:leaves.map((b,i)=>({name:b.mesh.name,compactions:(b.compactions||0)-before[i].compactions,scheduledBytes:(b.transferredBytes||0)-before[i].scheduled})),
        x:p.x,z:p.z,y:p.groundY,zone:p.zone,...window.__RENDER_STATS};
    });
    await page.keyboard.up('KeyW');await page.evaluate(()=>{window.__world.player.frozen=true;});
    const png=await page.evaluate(()=>window.__captureFrame());
    writeFileSync(new URL(`${name}-north-end-${run}.png`,dir),Buffer.from(png.split(',')[1],'base64'));
    rows.push({view:'moving-north',mode:args.includes('--leaf-cpu')?'cpu':'gpu',run,station,motion});
    console.log(`NORTH ${run}: ${motion.fps.toFixed(1)}fps p95 ${motion.p95ms.toFixed(1)}ms LOD ${motion.lodMs.toFixed(2)}ms buffer ${(motion.bufferTraffic.bytes/1e6).toFixed(1)}MB, (${motion.x.toFixed(2)},${motion.y.toFixed(2)},${motion.z.toFixed(2)}) calls=${motion.drawCalls}`);
    if(motion.x-station.x<8 || !motion.zone.startsWith('wall') || motion.drawCalls>200 || motion.dpr!==1)errors.push('North-wall movement, resolution or draw budget failed');
    if(errors.length)throw new Error(errors.join('\n'));
  }
}
