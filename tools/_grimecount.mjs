// 汚れ帯の数と、床の上に立っている帯(壁の足元でない物)の数。
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=12.87', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate(() => {
  const w = window.__world, T = w.THREE, plan = w.plan;
  const m = new T.Matrix4(), v = new T.Vector3();
  let n = 0, high = 0, onDeck = 0;
  w.scene.traverse(o => {
    if (o.name !== 'house.grimeBand') return;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m); v.setFromMatrixPosition(m); o.localToWorld(v);
      n++;
      if (v.y > 8) high++;
      const g = plan.groundAt(v.x, v.z, v.y + 0.5);
      if (g && (g.zone === 'wall' || g.zone === 'stair')) onDeck++;
    }
  });
  return `汚れ帯 ${n} 枚  うち y>8m ${high} 枚  歩廊・階段の上に立っている ${onDeck} 枚`;
}));
await b.close();
