import {readFileSync} from 'node:fs';
export async function skyBudgetCheck(page,{name,dir,rows,errors}) {
  const poses=[];
  for(const raw of readFileSync(new URL('./campaign.txt',import.meta.url),'utf8').split('\n')) {
    const line=raw.replace(/\s+#.*$/,'').trim(),m=line.match(/^view\s+(\S+)\s+(.+)$/);if(!m)continue;
    const [x,z,yaw,pitch,extra='']=m[2].split(':');
    poses.push([m[1],`x=${x}&z=${z}&yaw=${yaw}&pitch=${pitch}${extra}`]);
  }
  await page.goto('http://localhost:8765/?shot=1&hud=0&time=12.87&'+poses[0][1],{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
  for(const [view,q]of poses)for(const time of [7.9,12.87,19.3,22]) {
    const params=Object.fromEntries(new URLSearchParams(q));
    const result=await page.evaluate(async({params,time})=>{
      const w=window.__world,p=w.player;
      p.teleport(+params.x,+params.z,+params.yaw,+params.pitch);
      const ground=p.floorAt(p.x,p.z,params.gy===undefined?500:+params.gy);
      Object.assign(p,{groundY:ground.y,smoothY:ground.y,zone:ground.zone,bobAmp:0,frozen:true});
      w.camera.fov=+(params.fov||60);w.camera.updateProjectionMatrix();
      w.worldState.time=time;
      // Return telemetry in the microtask immediately after this exact frame.
      // A second page.evaluate may observe a later, cheaper static frame.
      await window.__captureFrame();
      return {time,calls:window.__RENDER_STATS.drawCalls,triangles:window.__RENDER_STATS.triangles,
        gpuError:w.renderer.getContext().getError()};
    },{params,time});
    rows.push({view,...result});console.log(JSON.stringify(rows.at(-1)));
    if(result.gpuError||result.calls>200)errors.push(`${view} at ${time}: atmospheric-update budget ${result.calls}`);
  }
}
