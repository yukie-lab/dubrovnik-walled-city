import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=13', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const plan = window.__world.plan;
  const near = plan.houses.filter(h => Math.abs(h.x - 68.2) < h.w/2 + 1.5 && Math.abs(h.z + 51) < h.d/2 + 1.5);
  return JSON.stringify(near.map(h => ({x:+h.x.toFixed(1), z:+h.z.toFixed(1), w:+h.w.toFixed(1), d:+h.d.toFixed(1),
    yBase:+h.yBase.toFixed(2), eaves:+h.eaves.toFixed(2), roofH:+(h.roofH??0).toFixed(2), floors:h.floors,
    axis:h.ridgeAxis, garden:!!h.garden, band:h.band})), null, 1);
}));
await b.close();
