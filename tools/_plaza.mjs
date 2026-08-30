// 広場ごとに「何人いて、何人が歩く体か」。棒立ちの広場を名指しで出す。
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=12.87', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate(() => {
  const w = window.__world, F = w.life.folk || [], PL = w.plan.PLAZAS || [];
  const out = [];
  let inAny = 0;
  for (const q of PL) {
    const g = F.filter(f => f.x > q.x0 && f.x < q.x1 && f.z > q.z0 && f.z < q.z1);
    inAny += g.length;
    out.push(`${(q.id || '(無名)').padEnd(14)} ${String(g.length).padStart(4)} 人  歩く体 ${String(g.filter(f => f.walk).length).padStart(4)}  座 ${String(g.filter(f => f.sit).length).padStart(3)}`);
  }
  out.push(`--- 街全体 ${F.length} 人  歩く体 ${F.filter(f => f.walk).length}  座 ${F.filter(f => f.sit).length}`);
  return out.join('\n');
}));
await b.close();
