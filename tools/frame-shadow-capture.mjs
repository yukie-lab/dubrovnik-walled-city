import {writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

export async function frameShadowChecks(page,{name,dir,rows,errors}) {
  const poses=[
    ['roofs','x=58&z=-88&yaw=-2.303&pitch=-.02&gy=24&fov=54&time=12.87'],
    ['street','x=-138&z=-1.2&yaw=-1.62&pitch=.015&fov=52&time=7.9'],
    ['harbor','x=177&z=52&yaw=-.22&pitch=.05&gy=18&fov=58&time=19.3'],
  ];
  for(const [view,q]of poses) {
    await page.goto('http://localhost:8765/index.html?shot=1&hud=0&'+q,{waitUntil:'domcontentloaded'});
    await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
    const result={view};
    for(const [variant,enabled]of [['shared',true],['original',false]]) {
      await page.evaluate(enabled=>{window.__world.frameShadows.state.enabled=enabled;},enabled);
      let png;for(let i=0;i<6;i++)png=await page.evaluate(()=>window.__captureFrame());
      writeFileSync(new URL(`${name}-${view}-${variant}.png`,dir),Buffer.from(png.split(',')[1],'base64'));
      result[variant]=await page.evaluate(()=>({stats:{...window.__RENDER_STATS},
        shadow:{...window.__world.frameShadows.state},gpuError:window.__world.renderer.getContext().getError()}));
    }
    const diff=spawnSync(process.execPath,[new URL('./_imgdiff.mjs',import.meta.url).pathname,
      new URL(`${name}-${view}-shared.png`,dir).pathname,
      new URL(`${name}-${view}-original.png`,dir).pathname],{encoding:'utf8'});
    if(diff.status!==0)throw new Error(diff.stderr||diff.stdout);
    result.difference=diff.stdout.split('\n')[0];
    result.savedCalls=result.original.stats.drawCalls-result.shared.stats.drawCalls;
    rows.push(result);console.log(JSON.stringify(result));
    if(result.shared.gpuError||result.original.gpuError||result.shared.shadow.passes!==1||result.savedCalls<=0)
      errors.push('Shared shadow regression: '+view);
  }
}
