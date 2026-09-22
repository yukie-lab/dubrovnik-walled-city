import {readFileSync,writeFileSync} from 'node:fs';

export async function seaCalibrationCapture(page,{name,dir,rows,errors,args}) {
  const option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
  const config=JSON.parse(readFileSync(option('--sea-config','docs/sea-calibration.json'),'utf8'));
  const pose=config.pose;
  await page.setViewport({width:1200,height:800,deviceScaleFactor:1});
  await page.goto('http://localhost:8765/?shot=1&hud=0&time='+pose.time,{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
  await page.evaluate(pose=>{
    const w=window.__world,p=w.player;
    p.pose=camera=>{
      camera.position.fromArray(pose.position);camera.up.set(0,1,0);
      camera.lookAt(...pose.target);camera.updateMatrixWorld();
    };
    p.groundY=p.smoothY=pose.position[1]-1.62;p.zone='wall';p.frozen=true;
    w.camera.fov=pose.fov;w.camera.updateProjectionMatrix();
    // A time change schedules a fresh IBL after the new eye altitude is active.
    // This does not alter geographic records or the ordinary walking camera.
    w.worldState.time=pose.time+.03;
  },pose);
  await page.evaluate(async()=>{do{await window.__captureFrame();}while(window.__world.lighting.environment.pending);});
  await page.evaluate(async time=>{
    window.__world.worldState.time=time;
    do{await window.__captureFrame();}while(window.__world.lighting.environment.pending);
  },pose.time);
  const sea=await page.evaluate(()=>{
    const w=window.__world,m=w.scene.getObjectByName('sea.surface'),s=w.sunState,T=w.THREE;
    const landmarks={fort:[176,15,57.8],cathedral:[130,27,52],quay:[174,1.7,16],bell:[147,31,-3.2]};
    const projected=Object.fromEntries(Object.entries(landmarks).map(([k,p])=>{
      const v=new T.Vector3(...p).project(w.camera);return [k,[(v.x+1)*600,(1-v.y)*400]];
    }));
    const points=[];
    for(let py=16;py<800;py+=32)for(let px=16;px<1200;px+=32) {
      const v=new T.Vector3(px/600-1,1-py/400,.5).unproject(w.camera).sub(w.camera.position).normalize();
      if(v.y>=0)continue;
      const t=-w.camera.position.y/v.y,q=w.camera.position.clone().addScaledVector(v,t);
      points.push({px,py,x:q.x,z:q.z,depth:-w.plan.outsideHeight(q.x,q.z),angle:Math.asin(-v.y)*180/Math.PI});
    }
    return {sun:{time:s.time,elevation:s.el,azimuth:s.az,dir:s.dir.toArray(),ghiLux:s.ghi*5000},
      sigma:m.material.uniforms.uSigma.value.toArray(),inscattering:m.material.uniforms.uInscat.value.toArray(),
      exposure:w.renderer.toneMappingExposure,projected,points};
  });
  const diagnostics=args.includes('--sea-diagnostics')?[0,...config.protectedDiagnostics]:[0];
  for(const mode of diagnostics) {
    await page.evaluate(mode=>{window.__world.scene.getObjectByName('sea.surface').material.uniforms.uDebug.value=mode;},mode);
    const png=Buffer.from((await page.evaluate(()=>window.__captureFrame())).split(',')[1],'base64');
    writeFileSync(new URL(`${name}-sea-${mode}.png`,dir),png);
  }
  const result=await page.evaluate(()=>({...window.__RENDER_STATS,gpuError:window.__world.renderer.getContext().getError()}));
  writeFileSync(new URL(name+'-sea-measure.json',dir),JSON.stringify({pose,...sea,...result},null,2)+'\n');
  rows.push({view:'sea-calibration',pose,sun:sea.sun,sigma:sea.sigma,inscattering:sea.inscattering,...result});
  console.log(JSON.stringify(rows.at(-1)));if(result.gpuError)errors.push('Sea calibration GPU failure');
}
