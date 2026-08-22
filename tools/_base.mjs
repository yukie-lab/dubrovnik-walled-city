import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=13', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const plan = window.__world.plan, M = plan.MONUMENTS;
  const pb = (x, z) => { let b2 = plan.terrainHeight(x, z);
    for (const q of plan.PLAZAS) if (x > q.x0-2 && x < q.x1+2 && z > q.z0-2 && z < q.z1+2) { b2 = q.y; break; } return b2; };
  const pts = [
    ['スポンザ館', M.sponza.x, M.sponza.z],
    ['鐘楼', 152, 2],
    ['大オノフリオ', -136, 11],
    ['総督邸', M.rector.x, M.rector.z],
    ['フランシスコ回廊', -128, -18],
    ['ドミニコ回廊', 124.5, -52],
    ['フランシスコ鐘塔', M.franciscan.tower.x, M.franciscan.tower.z],
    ['ドミニコ鐘塔', M.dominican.tower.x, M.dominican.tower.z],
    ['大聖堂', M.cathedral.x, M.cathedral.z],
    ['聖ヴラホ', M.stBlaise.x, M.stBlaise.z],
    ['イエズス会', M.jesuit.x, M.jesuit.z],
  ];
  return pts.map(([n,x,z]) => {
    const t = plan.terrainHeight(x,z), b2 = pb(x,z);
    const g = plan.groundAt(x, z, b2 + 1.5);
    return `${n.padEnd(10)} 素地形 ${t.toFixed(2)}  広場基準 ${b2.toFixed(2)}  差 ${(b2-t).toFixed(2)}  実地面 ${g?g.y.toFixed(2):'--'}`;
  }).join('\n');
}));
await b.close();
