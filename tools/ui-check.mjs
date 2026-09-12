export async function uiChecks(page,{name,dir,rows,errors}) {
  await page.setViewport({width:1280,height:800,deviceScaleFactor:3});
  await page.goto('http://localhost:8765/?flow=0',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY',{timeout:60000});
  await page.waitForFunction(()=>[...document.querySelectorAll('#ttlMain span')].length===9 &&
    [...document.querySelectorAll('#ttlMain span')].every(s=>Number(getComputedStyle(s).opacity)>.95));
  await page.screenshot({path:new URL(name+'-title.png',dir).pathname});
  const initial=await page.evaluate(()=>({title:document.getElementById('ttlMain').textContent,
    button:!document.getElementById('btnStart').disabled,dpr:window.__world.renderer.getPixelRatio()}));
  await page.click('#btnKeys');
  await page.waitForFunction(()=>Number(getComputedStyle(document.getElementById('keysCard')).opacity)>.95);
  await page.screenshot({path:new URL(name+'-controls.png',dir).pathname});
  await page.click('#btnKeys');await page.click('#btnStart');
  await page.waitForFunction(()=>document.getElementById('title').classList.contains('hidden'),{timeout:15000});
  await page.evaluate(()=>{window.__world.worldState.paused=true;});
  await page.keyboard.press('KeyM');
  await page.waitForFunction(()=>document.getElementById('map').classList.contains('show'));
  await page.screenshot({path:new URL(name+'-map.png',dir).pathname});
  const map=await page.evaluate(()=>{
    const c=document.getElementById('mapCanvas'),ctx=c.getContext('2d'),samples=[];
    for(let y=100;y<c.height;y+=150)for(let x=100;x<c.width;x+=150)samples.push([...ctx.getImageData(x,y,1,1).data]);
    const box=c.getBoundingClientRect();return {colors:new Set(samples.map(s=>s.join(','))).size,width:box.width,height:box.height,
      withinViewport:box.left>=0 && box.top>=0 && box.right<=innerWidth && box.bottom<=innerHeight};
  });
  await page.keyboard.press('KeyM');await page.keyboard.press('KeyI');
  await page.waitForFunction(()=>getComputedStyle(document.getElementById('debug')).display!=='none');
  await page.screenshot({path:new URL(name+'-debug.png',dir).pathname});
  const before=await page.evaluate(()=>window.__world.worldState.time);
  await page.keyboard.press('KeyT');const earlier=await page.evaluate(()=>window.__world.worldState.time);
  await page.keyboard.press('KeyG');
  const final=await page.evaluate(async()=>{
    const frames=[];let last=await new Promise(requestAnimationFrame);
    for(let i=0;i<90;i++){const now=await new Promise(requestAnimationFrame);frames.push(now-last);last=now;}
    return {time:window.__world.worldState.time,mapClosed:!document.getElementById('map').classList.contains('show'),
      debug:document.getElementById('debug').textContent,dpr:window.__world.renderer.getPixelRatio(),
      fps:frames.length*1000/frames.reduce((a,b)=>a+b,0),...window.__RENDER_STATS};
  });
  const report={view:'ui',initial,map,before,earlier,...final};rows.push(report);console.log(JSON.stringify(report));
  if(!initial.button || initial.dpr>2 || final.dpr>2 || !map.withinViewport || map.colors<20 ||
    !final.mapClosed || Math.abs(before-earlier-.25)>1e-6 || Math.abs(before-final.time)>1e-6 ||
    !/instances [\d,]+ drawn/.test(final.debug) || final.drawCalls>200)errors.push('UI / map / DPR contract failed');
}
