import puppeteer from 'puppeteer-core';
const url = 'http://localhost:8765/index.html?shot=1&hud=0&x=-146&z=2&yaw=-2.304&pitch=0.10&time=10.6&fov=50';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new',
  args:['--headless=new','--use-angle=metal','--window-size=1600,1000'] });
const p = await b.newPage();
await p.setViewport({ width:1600, height:1000, deviceScaleFactor:1 });
await p.goto(url, { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
const D='/private/tmp/claude-501/-Users-yukie-Desktop-test-dubrovnik-walled-city/044b1f30-0f89-43d0-9979-795cd7e03418/scratchpad/';
for (const tag of ['all','noawn','nosign','nocloth','noroof']) {
  await p.evaluate((t) => {
    const { scene } = window.__world;
    scene.traverse(o => {
      if (!o.isMesh) return;
      if (o.__v0 === undefined) o.__v0 = o.visible;
      o.visible = o.__v0;
      const k = o.material?.customProgramCacheKey ? String(o.material.customProgramCacheKey()) : '';
      if (t === 'noawn' && k === 'awning') o.visible = false;
      if (t === 'nosign' && k === 'signatlas') o.visible = false;
      if (t === 'nocloth' && o.material?.map && k.includes('aPhase')) o.visible = false;
      if (t === 'noroof' && k.includes('uRowH')) o.visible = false;
    });
  }, tag);
  await new Promise(r=>setTimeout(r,600));
  await p.screenshot({ path: `${D}h_${tag}.png`, clip:{x:520,y:150,width:400,height:130} });
}
await b.close();
console.log('done');
