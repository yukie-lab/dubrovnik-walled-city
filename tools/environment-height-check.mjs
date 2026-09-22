import {writeFileSync} from 'node:fs';
export async function environmentHeightCheck(page,{name,dir,rows,errors}) {
  await page.setViewport({width:1000,height:700,deviceScaleFactor:1});
  await page.goto('http://localhost:8765/?shot=1&hud=0&time=12.87&x=0&z=103&gy=16&yaw=3.14159265',
    {waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
  const samples=[];
  for(const time of [12.87,19.85,22.5])for(const height of [2,20,80,330,2]) {
    const result=await page.evaluate(async({time,height})=>{
      const w=window.__world,T=w.THREE,R=w.renderer,E=w.lighting.environment,p=w.player;
      w.worldState.time=time;p.groundY=p.smoothY=height-1.62;p.zone='wall';
      p.pose=c=>{c.position.set(0,height,103);c.rotation.set(-.14,Math.PI,0);c.updateMatrixWorld();};
      const calls=[];
      do{await window.__captureFrame();calls.push(window.__RENDER_STATS.drawCalls);}while(E.pending&&calls.length<30);
      // A fresh native PMREM from this height/time is the independent reference.
      const ground=w.lighting.envUniforms.uGround.value,oldGround=ground.clone();ground.copy(w.sunState.hemiGround);
      const native=new T.PMREMGenerator(R),reference=native.fromScene(E.scene,.04,.1,100,{size:128});
      ground.copy(oldGround);
      const actual=E.target,a=new Uint16Array(actual.width*actual.height*4),b=new Uint16Array(a.length);
      R.readRenderTargetPixels(actual,0,0,actual.width,actual.height,a);
      R.readRenderTargetPixels(reference,0,0,reference.width,reference.height,b);
      let different=0,maxDifference=0;
      for(let i=0;i<a.length;i++)if(a[i]!==b[i]) {
        different++;maxDifference=Math.max(maxDifference,Math.abs(T.DataUtils.fromHalfFloat(a[i])-T.DataUtils.fromHalfFloat(b[i])));
      }
      reference.dispose();native.dispose();
      return {time,height,sourceHeight:w.atmosphere.uniforms.uAtHeight.value*1000,cachedHeight:E.height??null,
        different,maxDifference,components:a.length,frames:calls.length,calls:Math.max(...calls),gpuError:R.getContext().getError()};
    },{time,height});
    samples.push(result);console.log(JSON.stringify({view:'environment-height',...result}));
    if(result.different||result.gpuError||result.calls>200)errors.push('Height environment mismatch '+time+' '+height);
  }
  writeFileSync(new URL(name+'-environment-height.json',dir),JSON.stringify(samples,null,2)+'\n');
  rows.push({view:'environment-height',samples});
}
