import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=11', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const plan = window.__world.plan;
  const out = [];
  for (const [x,z,tag] of [[170.8,4.9,'bay0中'],[171.5,13.6,'bay1中'],[172.0,22.2,'bay2中'],
                           [170.8,0.0,'柱の中'],[171.0,9.0,'柱の中2'],[173.5,4.9,'岸壁']]) {
    const c = plan.collide(x, z, 0.35, 2.7);
    out.push(`${tag} (${x},${z}) -> (${c.x.toFixed(2)},${c.z.toFixed(2)}) 移動 ${Math.hypot(c.x-x,c.z-z).toFixed(2)}m`);
  }
  return out.join('\n');
}));
await b.close();
