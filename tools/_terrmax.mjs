import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=12.87', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate(() => {
  const w = window.__world, T = w.THREE, box = new T.Box3();
  const out = [];
  w.scene.traverse(o => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    if (!/^ground\.far|^surround\./.test(o.name || '')) return;
    box.setFromObject(o);
    if (!isFinite(box.max.y)) return;
    out.push(`${o.name.padEnd(24)} y ${box.min.y.toFixed(0)}〜${box.max.y.toFixed(0)}  水平 ${Math.max(Math.abs(box.min.x), Math.abs(box.max.x)).toFixed(0)}m`);
  });
  return out.join('\n');
}));
await b.close();
