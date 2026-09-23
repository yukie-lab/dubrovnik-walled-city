import {writeFileSync} from 'node:fs';

export async function masonryAtlasCapture(page,{name,dir,rows,errors,args}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&time=12.87&x=0&z=103&gy=16&yaw=3.1416',
    {waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
  const stations=await page.evaluate(()=>{
    const w=window.__world;
    const stairs=w.plan.WALL_STAIRS.map(st=>{
      const lengths=st.pts.slice(1).map((b,i)=>Math.hypot(b[0]-st.pts[i][0],b[1]-st.pts[i][1]));
      let distance=lengths.reduce((a,b)=>a+b,0)*.4,i=0;
      while(distance>lengths[i]&&i<lengths.length-1)distance-=lengths[i++];
      const a=st.pts[i],b=st.pts[i+1],t=distance/lengths[i];
      return {id:st.id,x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,gy:a[2]+(b[2]-a[2])*t,
        yaw:Math.atan2(a[0]-b[0],a[1]-b[1]),pitch:.045,fov:60};
    });
    return [
      {id:'parapet-front',x:0,z:103,gy:16,yaw:Math.PI,pitch:-.34,fov:52},
      {id:'parapet-oblique',x:0,z:103,gy:16,yaw:2.45,pitch:-.36,fov:52},
      {id:'fort-distant',x:-172,z:2.2,gy:2.8,yaw:2.457,pitch:.05,fov:54},...stairs];
  });
  let prototype=null;
  if(args.includes('--atlas-prototype'))prototype=await page.evaluate(async()=>{
    const {applyMasonryAtlas}=await import('/src/masonry-atlas.js'),w=window.__world;
    return applyMasonryAtlas(w.scene,{map:w.scene.getObjectByName('wall.curtain').material.map});
  });
  const times=args.includes('--masonry-times')?args[args.indexOf('--masonry-times')+1].split(',').map(Number):[7.9,12.87];
  if(times.some(t=>!Number.isFinite(t)||t<0||t>24))throw new Error('Invalid masonry inspection time');
  for(const time of times)for(const s of stations) {
    const png=await page.evaluate(async({s,time})=>{
      const w=window.__world,p=w.player,g=(w.plan.walkingGroundAt||w.plan.groundAt)(s.x,s.z,s.gy);
      Object.assign(p,{x:s.x,z:s.z,groundY:g.y,smoothY:g.y,zone:g.zone,stair:g.stair??null,
        stairLift:null,stairBlend:g.stair?1:0,yaw:s.yaw,pitch:s.pitch,vx:0,vz:0,bobAmp:0,frozen:true});
      w.camera.fov=s.fov;w.camera.updateProjectionMatrix();w.worldState.time=time;
      let png;do{png=await window.__captureFrame();}while(w.lighting.environment.pending);
      return png;
    },{s,time});
    const file=`${name}-${s.id}-${time}.png`;
    writeFileSync(new URL(file,dir),Buffer.from(png.split(',')[1],'base64'));
    const stats=await page.evaluate(()=>({...window.__RENDER_STATS,gpuError:window.__world.renderer.getContext().getError()}));
    const row={view:'masonry-atlas',id:s.id,time,file,prototype,...stats};rows.push(row);console.log(JSON.stringify(row));
    if(stats.gpuError||stats.drawCalls>200)errors.push('Masonry rendering failure: '+file);
  }
}
