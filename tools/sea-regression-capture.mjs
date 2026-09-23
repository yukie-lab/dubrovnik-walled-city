import {writeFileSync} from 'node:fs';
import {captureWaterMask} from './water-mask.mjs';

export async function seaRegressionCapture(page,{name,dir,rows,errors}) {
  await page.setViewport({width:1200,height:800,deviceScaleFactor:1});
  await page.goto('http://localhost:8765/?shot=1&hud=0&time=12.87&x=0&z=103&gy=16&yaw=3.14159265&pitch=-.14&fov=52',
    {waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
  const poses=[['parapet',{position:[0,17.62,103],yaw:Math.PI,pitch:-.14,fov:52}],
    ['shelf',{position:[190,5.62,42],target:[183,-.5,34],fov:54}]];
  for(const [view,pose]of poses)for(const [phase,time]of [['noon',12.87],['gold',19.3],['sunset',19.85],['night',22.5]]) {
    await page.evaluate(({pose,time})=>{
      const w=window.__world,p=w.player;
      p.pose=c=>{
        c.position.fromArray(pose.position);c.up.set(0,1,0);
        if(pose.target)c.lookAt(...pose.target);else c.rotation.set(pose.pitch,pose.yaw,0);
        c.updateMatrixWorld();
      };
      p.groundY=p.smoothY=pose.position[1]-1.62;p.zone='wall';p.frozen=true;
      w.camera.fov=pose.fov;w.camera.updateProjectionMatrix();w.worldState.time=time;
    },{pose,time});
    const result=await page.evaluate(async()=>{
      const w=window.__world;let frames=0,calls=0;
      do{await window.__captureFrame();frames++;calls=Math.max(calls,window.__RENDER_STATS.drawCalls);}
      while((frames<14||w.lighting.environment.pending)&&frames<35);
      return {calls,gpuError:w.renderer.getContext().getError(),sigma:window.__sea.sigma,
        inscattering:window.__sea.inscat,sunElevation:w.sunState.el,exposure:w.renderer.toneMappingExposure};
    });
    // Transport path, Fresnel, normals, foam and glitter have independent
    // diagnostics. Their baseline survives an allowed scattering-colour change.
    for(const mode of [0,1,2,3,4,5,8,9,12]) {
      await page.evaluate(n=>{window.__world.scene.getObjectByName('sea.surface').material.uniforms.uDebug.value=n;},mode);
      const png=Buffer.from((await page.evaluate(()=>window.__captureFrame())).split(',')[1],'base64');
      writeFileSync(new URL(`${name}-${view}-${phase}-${mode}.png`,dir),png);
    }
    const mask=await captureWaterMask(page);
    writeFileSync(new URL(`${name}-${view}-${phase}-mask.png`,dir),Buffer.from(mask.split(',')[1],'base64'));
    rows.push({view:'sea-'+view,phase,time,pose,...result});console.log(JSON.stringify(rows.at(-1)));
    if(result.gpuError||result.calls>200)errors.push('Sea regression GPU/budget failure');
  }
}
