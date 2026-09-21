import {writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {solarPosition} from '../src/atmosphere-model.js';
export async function moonChecks(page,{name,dir,rows,errors}) {
  const time=22,solar=solarPosition(time),moon=solar.dir.map(v=>-v);
  const yaw=Math.atan2(-moon[0],-moon[2]);
  const poses=[['moonwater',`x=0&z=103&gy=16&yaw=${yaw}&pitch=.18&fov=60`],
    ['roofs','x=58&z=-88&yaw=-2.303&pitch=-.02&gy=24&fov=54'],
    ['street','x=-138&z=-1.2&yaw=-1.62&pitch=.015&fov=52']];
  for(const [view,q]of poses) {
    await page.goto(`http://localhost:8765/index.html?shot=1&hud=0&time=${time}&${q}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
    const capture=async suffix=>{
      let png;for(let i=0;i<6;i++)png=await page.evaluate(()=>window.__captureFrame());
      const path=new URL(`${name}-${view}-${suffix}.png`,dir);writeFileSync(path,Buffer.from(png.split(',')[1],'base64'));return path;
    };
    const shadow=capture('shadow');await shadow;
    const data=await page.evaluate(()=>{
      const w=window.__world,L=w.lighting,s=w.sunState;
      window.__savedLightUpdate=L.update;
      L.update=function(...args){const r=window.__savedLightUpdate(...args);L.sun.castShadow=false;return r;};
      return {moonLux:s.moonIntensity*5000,solarLux:s.sunIntensity*5000,sky:s.zenith,
        keyIntensity:L.sun.intensity,exposure:w.renderer.toneMappingExposure,stats:{...window.__RENDER_STATS}};
    });
    const noShadow=await capture('unshadowed');
    const diff=spawnSync(process.execPath,[new URL('./_imgdiff.mjs',import.meta.url).pathname,(await shadow).pathname,noShadow.pathname],{encoding:'utf8'});
    if(diff.status!==0)throw new Error(diff.stderr||diff.stdout);
    data.shadowDifference=diff.stdout.split('\n')[0];data.view=view;
    data.gpuError=await page.evaluate(()=>window.__world.renderer.getContext().getError());rows.push(data);
    console.log(JSON.stringify(data));
    if(data.gpuError||data.solarLux!==0||data.keyIntensity<=0)errors.push('Invalid lunar lighting: '+view);
    await page.evaluate(()=>{window.__world.lighting.update=window.__savedLightUpdate;window.__world.lighting.sun.castShadow=true;});
  }
}
