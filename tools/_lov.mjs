import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=17.3', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const plan = window.__world.plan;
  const out = ['--- ロヴリイェナツ周辺の地形(outsideHeight)'];
  for (let dz = -30; dz <= 30; dz += 15) {
    const row = [];
    for (let dx = -30; dx <= 30; dx += 15) {
      row.push((plan.outsideHeight(-215 + dx, 55 + dz) ?? -99).toFixed(1).padStart(7));
    }
    out.push(`  z=${(55+dz).toString().padStart(4)}: ${row.join('')}`);
  }
  out.push('  (x = -245 .. -185 を 15 刻み)');
  out.push(`  中心 (-215,55) = ${plan.outsideHeight(-215,55).toFixed(2)}  要塞の底 = 22.0`);
  return out.join('\n');
}));
await b.close();
