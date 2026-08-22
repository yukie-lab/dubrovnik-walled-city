import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=12', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const plan = window.__world.plan;
  const w = plan.OUTSIDE_WALKS.find(o => o.id === 'ploceBridge');
  const out = [`ploceBridge: ${w ? 'あり' : 'なし'}`];
  if (w) {
    for (const [x, z] of [[157,-50],[161,-48.5],[165.8,-46.9],[166.7,-46.4],[168,-45.6]]) {
      const inRect = x > w.x0 && x < w.x1 && z > w.z0 && z < w.z1;
      out.push(`  (${x},${z}) rect=${inRect} has=${w.has(x,z)} yAt=${w.yAt(x,z).toFixed(2)} 地形=${plan.outsideHeight(x,z).toFixed(2)} groundAt=${JSON.stringify(plan.groundAt(x,z,2.9))}`);
    }
  }
  return out.join('\n');
}));
await b.close();
