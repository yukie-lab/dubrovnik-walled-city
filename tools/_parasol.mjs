import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=12.87', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate(() => {
  const w = window.__world, T = w.THREE;
  let m = new T.Matrix4(), v = new T.Vector3();
  const out = [];
  w.scene.traverse(o => {
    if (o.name !== 'life.parasol') return;
    for (let i = 0; i < Math.min(o.count, 8); i++) {
      o.getMatrixAt(i, m); v.setFromMatrixPosition(m);
      const sc = new T.Vector3().setFromMatrixScale(m);
      out.push(`#${i} (${v.x.toFixed(1)}, ${v.z.toFixed(1)}) y=${v.y.toFixed(2)} scale ${sc.x.toFixed(2)}`);
    }
    out.push(`合計 ${o.count} 本`);
  });
  return out.join('\n');
}));
await b.close();
