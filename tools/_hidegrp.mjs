import puppeteer from 'puppeteer-core';
const url = 'http://localhost:8765/index.html?shot=1&hud=0&x=135&z=-71&yaw=-2.181&pitch=0.02&time=18.2&fov=54&gy=19.77';
const D='/private/tmp/claude-501/-Users-yukie-Desktop-test-dubrovnik-walled-city/044b1f30-0f89-43d0-9979-795cd7e03418/scratchpad/';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new',
  args:['--headless=new','--use-angle=metal','--window-size=1600,1000'] });
const p = await b.newPage();
await p.setViewport({ width:1600, height:1000, deviceScaleFactor:1 });
await p.goto(url, { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
const names = ['all','ground','walls','buildings','monuments','steps'];
for (let k = 0; k < names.length; k++) {
  await p.evaluate((i) => {
    const s = window.__world.solids;
    s.forEach((g, j) => { g.visible = !(i >= 1 && j === i - 1); });
  }, k);
  await new Promise(r=>setTimeout(r,600));
  await p.screenshot({ path: `${D}g_${names[k]}.png`, clip:{x:560,y:520,width:520,height:300} });
}
await b.close(); console.log('done');
