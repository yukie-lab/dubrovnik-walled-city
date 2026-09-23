import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

export async function skyDepthOrderCheck(page,{name,dir,rows,errors}) {
  const poses=[];
  for(const raw of readFileSync('tools/campaign.txt','utf8').split('\n')) {
    const m=raw.replace(/\s+#.*$/,'').trim().match(/^view\s+(\S+)\s+(.+)$/);if(!m)continue;
    const [x,z,yaw,pitch,extra='']=m[2].split(':');
    poses.push([m[1],Object.fromEntries(new URLSearchParams(`x=${x}&z=${z}&yaw=${yaw}&pitch=${pitch}${extra}`))]);
  }
  await page.goto('http://localhost:8765/?shot=1&hud=0&time=12.87',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:120000});
  for(const [id,params] of poses)for(const time of [7.9,12.87,19.3,22]) {
    const result=await page.evaluate(async({params,time})=>{
      const w=window.__world,p=w.player,sky=w.scene.getObjectByName('sky.dome');
      p.teleport(+params.x,+params.z,+params.yaw,+params.pitch);
      const ground=p.floorAt(p.x,p.z,params.gy===undefined?500:+params.gy);
      Object.assign(p,{groundY:ground.y,smoothY:ground.y,zone:ground.zone,bobAmp:0,frozen:true});
      w.camera.fov=+(params.fov||60);w.camera.updateProjectionMatrix();w.worldState.time=time;
      sky.renderOrder=-20;
      let count=0;do{await window.__captureFrame();count++;}while((count<14||w.lighting.environment.pending)&&count<40);
      const before=await window.__captureFrame();sky.renderOrder=20;
      const after=await window.__captureFrame();
      return {before,after,...window.__RENDER_STATS,gpuError:w.renderer.getContext().getError()};
    },{params,time});
    const {before,after,...stats}=result,b=Buffer.from(before.split(',')[1],'base64'),a=Buffer.from(after.split(',')[1],'base64');
    const hash=x=>createHash('sha256').update(x).digest('hex');
    const equal=hash(b)===hash(a);
    writeFileSync(new URL(`${name}-${id}-${time}.png`,dir),a);
    if(!equal)writeFileSync(new URL(`${name}-${id}-${time}-before.png`,dir),b);
    rows.push({view:'sky-depth-order',id,time,pixelIdentical:equal,...stats});console.log(JSON.stringify(rows.at(-1)));
    if(!equal||stats.gpuError)errors.push(`Sky depth order changed image: ${id}/${time}`);
  }
}
