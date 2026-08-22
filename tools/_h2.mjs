import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=11', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const plan = window.__world.plan;
  const h = plan.houses.find(q => Math.abs(q.x - 127) < 0.6 && Math.abs(q.z + 64) < 0.6);
  const wide = plan.houses.filter(q => q.w > 18).map(q => ({x:+q.x.toFixed(1), z:+q.z.toFixed(1), w:+q.w.toFixed(1), d:+q.d.toFixed(1), band:q.band, eaves:+q.eaves.toFixed(1)}));
  return JSON.stringify({ h, wideCount: wide.length, wide: wide.slice(0,12) }, null, 1);
}));
await b.close();
