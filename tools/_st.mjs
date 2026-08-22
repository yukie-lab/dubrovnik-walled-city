import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=12', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const plan = window.__world.plan;
  const st = plan.WALL_STAIRS.find(s => s.id === 'ploceStair');
  return st.pts.map(q => `(${q[0]}, ${q[1]}, y${q[2]})  地形=${plan.outsideHeight(q[0], q[1]).toFixed(2)}  groundAt=${plan.groundAt(q[0], q[1], q[2] + 0.6)?.y.toFixed(2)}`).join('\n');
}));
await b.close();
