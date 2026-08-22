import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=12', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const plan = window.__world.plan;
  const near = plan.houses.filter(h => Math.hypot(h.x - 156, h.z + 50) < 26)
    .map(h => `(${h.x.toFixed(0)},${h.z.toFixed(0)}) ${h.w.toFixed(0)}x${h.d.toFixed(0)} 底${h.yBase.toFixed(1)} 軒${h.eaves.toFixed(1)} 距離${Math.hypot(h.x-156,h.z+50).toFixed(1)}${h.garden?' 庭塀':''}`);
  return `門から 26m 以内の家/塀: ${near.length}\n  ` + near.join('\n  ');
}));
await b.close();
