import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=11', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const plan = window.__world.plan;
  const out = ['塔          節点y   galleryY  topY   迫元(=gal+2)  歩廊との差'];
  for (const [k, t] of Object.entries(plan.TOWERS)) {
    let best = 1e9, by = 0, bi = -1;
    plan.wallPts.forEach((q, i) => { const d = Math.hypot(q[0]-t.x, q[1]-t.z); if (d < best) { best = d; by = q[2]; bi = i; } });
    const gal = t.galleryY ?? t.topY;
    out.push(`${k.padEnd(10)} ${by.toFixed(2)}  ${gal.toFixed(2)}    ${t.topY.toFixed(2)}  ${(gal+2).toFixed(2)}        ${(gal + 2 - by).toFixed(2)}   (節点${bi} d=${best.toFixed(1)})`);
  }
  return out.join('\n');
}));
await b.close();
