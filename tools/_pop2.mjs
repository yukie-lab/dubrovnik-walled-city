import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'], protocolTimeout: 300000 });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&hud=0&x=-147&z=0.3&yaw=-1.5708&pitch=0.02&time=7.1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
await new Promise(r => setTimeout(r, 1200));
await p.evaluate(() => { window.__popdbg = { applied: 0, visible: 0, deferred: 0, noCam: 0 }; });
for (let k = 1; k <= 24; k++) {
  await p.evaluate((t) => { window.__world.worldState.time = t; }, 7.1 + k * 0.08);
  await new Promise(r => setTimeout(r, 260));
}
console.log(await p.evaluate(() => JSON.stringify(window.__popdbg)));
await b.close();
