import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {materialProgramAudit} from './material-program-audit.mjs';
import {atmosphereGPUCheck} from './atmosphere-gpu-check.mjs';
export async function skyCycleChecks(page,{name,dir,rows,errors,args}) {
  const quick=args.includes('--quick');
  const times=quick?[12.87,19.3,19.75,20,20.5,21,21.7,23.5]:
    [...new Set([4.7,5,5.5,6,7.9,10,12.87,15,17,18,18.5,19,
      ...Array.from({length:85},(_,i)=>Number((19.3+i*.05).toFixed(3))),23.6])];
  const poses=[
    ['seaward',{x:0,z:103,gy:16,yaw:3.14159265,pitch:-.14,fov:52}],
    ['west',{x:-172,z:2.2,gy:22,yaw:1.25,pitch:.05,fov:58}],
  ];
  const q=new URLSearchParams({...poses[0][1],shot:1,hud:0,time:times[0]});
  await page.goto('http://localhost:8765/index.html?'+q,{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
  for(const [view,pose]of poses) {
    await page.evaluate(p=>{
      const w=window.__world;w.player.teleport(p.x,p.z,p.yaw,p.pitch);
      const g=w.player.floorAt(p.x,p.z,p.gy);
      Object.assign(w.player,{groundY:g.y,smoothY:g.y,zone:g.zone,bobAmp:0,frozen:true});
      w.camera.fov=p.fov;w.camera.updateProjectionMatrix();
    },pose);
    for(const time of times) {
      const updateCalls=await page.evaluate(async t=>{
        const w=window.__world;w.worldState.time=t;let peak=0,frames=0;
        do {
          await window.__captureFrame();peak=Math.max(peak,window.__RENDER_STATS.drawCalls);frames++;
        }while((frames<4||w.lighting.environment?.pending)&&frames<30);
        if(w.lighting.environment?.pending)throw new Error('Environment queue did not finish');
        return peak;
      },time);
      const png=Buffer.from((await page.evaluate(()=>window.__captureFrame())).split(',')[1],'base64');
      const compare=Buffer.from((await page.evaluate(()=>window.__captureFrame())).split(',')[1],'base64');
      const hash=b=>createHash('sha256').update(b).digest('hex');
      const result=await page.evaluate(()=>{
        const w=window.__world,s=w.sunState,gl=w.renderer.getContext();
        const rgb=c=>[c.r,c.g,c.b],lum=c=>c.r*.2126+c.g*.7152+c.b*.0722;
        return {time:s.time,elevation:s.el,phase:s.el>=0?'day':s.el>=-6?'civil':s.el>=-12?'nautical':s.el>=-18?'astronomical':'night',
          zenithRadiance:rgb(s.zenith),zenithCd:lum(s.zenith)*5000,horizonRadiance:rgb(s.horizon),
          skyIrradiance:rgb(w.atmosphere.radiometry.skyIrradiance),ghiLux:s.ghi*5000,
          solarLux:s.sunIntensity*5000,lunarLux:s.moonIntensity*5000,exposure:w.renderer.toneMappingExposure,
          keyLight:w.lighting.sun.position.toArray(),stats:{...window.__RENDER_STATS},gpuError:gl.getError()};
      });
      const stem=`${name}-${view}-${time.toFixed(3).replace('.','_')}`;
      writeFileSync(new URL(stem+'.png',dir),png);
      result.view=view;result.updateCalls=updateCalls;result.stable=hash(png)===hash(compare);rows.push(result);
      console.log(`${view} ${time.toFixed(3)} el=${result.elevation.toFixed(2)} ${result.phase} sky=${result.zenithCd.toExponential(3)}cd/m2 E=${result.ghiLux.toExponential(3)}lux exp=${result.exposure.toFixed(2)} calls=${result.stats.drawCalls} GL=${result.gpuError}`);
      if(result.gpuError||!result.stable||errors.length)throw new Error('Sky cycle GPU / stability failure: '+JSON.stringify(result));
    }
  }
  await materialProgramAudit(page,{name,dir,strict:true});
  await atmosphereGPUCheck(page,{name,dir});
}
