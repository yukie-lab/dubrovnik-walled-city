// 指定の場所の近くで「歩廊の床がある点」を探す。
import puppeteer from 'puppeteer-core';
const [X, Z, Y] = process.argv.slice(2).map(Number);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=10.4', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate(([X, Z, Y]) => {
  const plan = window.__world.plan, out = [];
  for (let dx = -10; dx <= 10; dx += 2) for (let dz = -14; dz <= 14; dz += 2) {
    const g = plan.groundAt(X + dx, Z + dz, Y);
    if (!g || g.zone !== 'wall') continue;
    out.push(`(${(X+dx).toFixed(0)}, ${(Z+dz).toFixed(0)}) y=${g.y.toFixed(2)}`);
  }
  return out.slice(0, 24).join('  ');
}, [X, Z, Y]));
await b.close();
