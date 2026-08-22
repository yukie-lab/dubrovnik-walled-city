import puppeteer from 'puppeteer-core';
const url='http://localhost:8765/index.html?shot=1&hud=0&x=0&z=103&yaw=3.1416&pitch=-0.10&time=11.9&fov=54&gy=16.0';
const D='/private/tmp/claude-501/-Users-yukie-Desktop-test-dubrovnik-walled-city/044b1f30-0f89-43d0-9979-795cd7e03418/scratchpad/';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal','--window-size=1600,1000'] });
const p = await b.newPage();
await p.setViewport({ width:1600, height:1000, deviceScaleFactor:1 });
await p.goto(url, { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
for (const mode of ['all','nosea','nolife','nobloom']) {
  await p.evaluate((m) => {
    const { scene } = window.__world;
    scene.traverse(o => { if (o.__v0 === undefined) o.__v0 = o.visible; o.visible = o.__v0; });
    if (m === 'nosea') scene.traverse(o => { if (o.isMesh && o.material?.uniforms?.uSigma) o.visible = false; });
    if (m === 'nolife') { const l = window.__world.life; if (l) l.group.visible = false; }
  }, mode);
  await new Promise(r=>setTimeout(r,700));
  await p.screenshot({ path: `${D}n_${mode}.png`, clip:{x:400,y:370,width:1000,height:90} });
}
await b.close(); console.log('done');
