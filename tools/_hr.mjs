import puppeteer from 'puppeteer-core';
const url = 'http://localhost:8765/index.html?shot=1&hud=0&x=169&z=30&yaw=1.616&pitch=0.06&time=13.2&fov=58&gy=13.4';
const D='/private/tmp/claude-501/-Users-yukie-Desktop-test-dubrovnik-walled-city/044b1f30-0f89-43d0-9979-795cd7e03418/scratchpad/';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new',
  args:['--headless=new','--use-angle=metal','--window-size=1600,1000'] });
const p = await b.newPage();
await p.setViewport({ width:1600, height:1000, deviceScaleFactor:1 });
await p.goto(url, { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
const modes = ['all','noridge','nofin','noroof'];
for (const mo of modes) {
  await p.evaluate((m) => {
    const { scene } = window.__world;
    scene.traverse(o => {
      if (!o.isMesh) return;
      if (o.__v0 === undefined) o.__v0 = o.visible;
      o.visible = o.__v0;
      const c = o.material?.color?.getHexString?.();
      const k = o.material?.customProgramCacheKey ? String(o.material.customProgramCacheKey()) : '';
      if (m === 'noridge' && c === 'a05a38') o.visible = false;
      if (m === 'nofin' && c === 'a9a08d' && !o.isInstancedMesh) o.visible = false;
      if (m === 'noroof' && k.includes('uRowH')) o.visible = false;
    });
  }, mo);
  await new Promise(r=>setTimeout(r,600));
  await p.screenshot({ path: `${D}r_${mo}.png`, clip:{x:250,y:330,width:450,height:190} });
}
await b.close(); console.log('done');
