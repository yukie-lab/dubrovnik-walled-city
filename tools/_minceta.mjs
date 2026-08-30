import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&hud=0&time=12.87', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 40000 });
console.log(await p.evaluate(() => {
  const w = window.__world, T = w.THREE;
  const out = [];
  for (const [x, z] of [[-122,-82],[-118,-78],[-115,-75],[-112,-72]]) {
    const rc = new T.Raycaster(new T.Vector3(x, 80, z), new T.Vector3(0,-1,0));
    const hits = rc.intersectObjects(w.solids, true).slice(0,4)
      .map(h => `${h.object.name}@${h.point.y.toFixed(1)}`);
    out.push(`(${x},${z}) ${hits.join('  ')}`);
  }
  return out.join('\n');
}));
await b.close();
