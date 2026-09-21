import {writeFileSync} from 'node:fs';

export async function lightHistoryCheck(page,{name,dir,rows,errors}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&x=-138&z=-1.2&yaw=-1.62&time=12.87',
    {waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
  const snapshots=[];
  for(const time of [12.87,7.9,19.3,7.9,12.87]) {
    await page.evaluate(t=>{window.__world.worldState.time=t;},time);
    for(let i=0;i<3;i++)await page.evaluate(()=>window.__captureFrame());
    snapshots.push(await page.evaluate(()=>{
      const w=window.__world,s=w.lighting.sun.shadow;
      return {time:w.worldState.time,radius:s.camera.right,near:s.camera.near,far:s.camera.far,
        bias:s.bias,normalBias:s.normalBias,position:w.lighting.sun.position.toArray(),
        target:w.lighting.sun.target.position.toArray(),gpuError:w.renderer.getContext().getError()};
    }));
  }
  const keys=['radius','near','far','bias','normalBias'];
  const differences=[[1,3],[0,4]].map(([a,b])=>({time:snapshots[a].time,
    fields:keys.filter(k=>Math.abs(snapshots[a][k]-snapshots[b][k])>1e-10)}));
  const report={snapshots,differences,historyIndependent:differences.every(d=>!d.fields.length)};
  rows.push({view:'light-history',...report});writeFileSync(new URL(name+'-history.json',dir),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  if(snapshots.some(s=>s.gpuError)||!report.historyIndependent)errors.push('Shadow setup depends on the previously visited time');
}
