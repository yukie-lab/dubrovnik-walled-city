export async function environmentConvolverChecks(page,{rows,errors}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&time=12.87&x=0&z=103&gy=16&yaw=3.14159265',
    {waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
  for(const time of [7.9,12.87,19.8,20.5,21.7,23.5]) {
    const result=await page.evaluate(async time=>{
      const w=window.__world,T=w.THREE,R=w.renderer,E=w.lighting.environment;
      w.worldState.time=time;
      const calls=[];
      do {
        await window.__captureFrame();calls.push(window.__RENDER_STATS.drawCalls);
      }while(E.pending&&calls.length<30);
      if(E.pending)throw new Error('Environment did not complete');
      // Compare every stored half-float against an independent, unmodified
      // Three PMREMGenerator running synchronously with the same frozen sky.
      const native=new T.PMREMGenerator(R),reference=native.fromScene(E.scene,.04,.1,100,{size:128});
      const actual=E.target,a=new Uint16Array(actual.width*actual.height*4),b=new Uint16Array(a.length);
      R.readRenderTargetPixels(actual,0,0,actual.width,actual.height,a);
      R.readRenderTargetPixels(reference,0,0,reference.width,reference.height,b);
      let different=0,maxDifference=0,nonzero=0;
      for(let i=0;i<a.length;i++) {
        if(a[i]!==b[i])different++;
        maxDifference=Math.max(maxDifference,Math.abs(T.DataUtils.fromHalfFloat(a[i])-T.DataUtils.fromHalfFloat(b[i])));
        if(i%4!==3&&a[i])nonzero++;
      }
      reference.dispose();native.dispose();
      return {time,frames:calls.length,peakCalls:Math.max(...calls),channels:a.length,different,maxDifference,nonzero,
        gpuError:R.getContext().getError()};
    },time);
    rows.push({view:'environment-equivalence',...result});console.log(JSON.stringify(rows.at(-1)));
    if(result.different||result.gpuError||!result.nonzero||result.peakCalls>200)
      errors.push('Scheduled environment differs at '+time);
  }
}
