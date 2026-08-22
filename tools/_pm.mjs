import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=12', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const plan = window.__world.plan;
  const out = ['outsideHeight x 176..206 を 3 刻み(聖ヨハネ東)'];
  for (let z = 38; z <= 62; z += 3) {
    const row = [];
    for (let x = 176; x <= 206; x += 3) row.push(plan.outsideHeight(x, z).toFixed(1).padStart(6));
    out.push(`z=${String(z).padStart(4)}:${row.join('')}`);
  }
  return out.join('\n');
}));
await b.close();
