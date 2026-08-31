// 城壁の歩廊に居る人が歩く体を持っているか。広場と同じ穴が空いていないか。
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=12.87', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate(() => {
  const w = window.__world, F = w.life.folk || [], plan = w.plan;
  const zone = f => { const g = plan.groundAt(f.x, f.z, f.y + 0.6); return g ? g.zone : '—'; };
  const byZone = new Map();
  for (const f of F) {
    const z = zone(f);
    if (!byZone.has(z)) byZone.set(z, { n: 0, walk: 0, sit: 0 });
    const b2 = byZone.get(z);
    b2.n++; if (f.walk) b2.walk++; if (f.sit) b2.sit++;
  }
  // 歩く経路の両端が歩廊から外れていないか
  let off = 0, drop = 0;
  for (const f of F) {
    if (!f.walk) continue;
    const g0 = plan.groundAt(f.x, f.z, f.y + 0.6);
    if (!g0 || g0.zone !== 'wall') continue;
    for (const u of [-0.5, 0.5]) {
      const x = f.x + f.walk.tx * f.walk.span * u, z = f.z + f.walk.tz * f.walk.span * u;
      const g = plan.groundAt(x, z, f.y + 0.6);
      if (!g) { off++; continue; }
      if (g.zone !== 'wall' && g.zone !== 'stair' && g.zone !== 'gate') off++;
      if (Math.abs(g.y - f.y) > 1.2) drop++;
    }
  }
  const extra = `\n歩廊の人の経路: 端が歩廊の外 ${off} / 高さが 1.2m 超ずれる ${drop}`;
  return [...byZone.entries()].sort((a, c) => c[1].n - a[1].n)
    .map(([k, v]) => `${(k || '—').padEnd(10)} ${String(v.n).padStart(4)} 人  歩く体 ${String(v.walk).padStart(4)}  座 ${String(v.sit).padStart(3)}`)
    .join('\n') + `\n合計 ${F.length} 人  歩く体 ${F.filter(f => f.walk).length}` + extra;
}));
await b.close();
