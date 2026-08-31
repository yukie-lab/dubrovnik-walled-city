// 踊り場が歩廊のデッキからどれだけはみ出しているか。
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=10.4', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate(() => {
  const w = window.__world, T = w.THREE, plan = w.plan;
  const rc = new T.Raycaster(), down = new T.Vector3(0, -1, 0);
  return (plan.landings || []).map((l, i) => {
    // 踊り場の外端(階段の頭)の直下に石があるか
    const probes = [];
    for (const t of [0, 0.5, 1.0]) {
      const x = l.x + l.ux * l.len * t, z = l.z + l.uz * l.len * t;
      rc.set(new T.Vector3(x, l.y - 0.05, z), down);
      const h = rc.intersectObjects(w.solids, true).filter(q => q.object.name);
      probes.push(h.length ? `${(l.y - h[0].point.y).toFixed(1)}m下に${h[0].object.name}` : '**下に何も無い**');
    }
    // 歩廊のデッキの半幅と、階段の頭までの距離
    let dinfo = '';
    { const g0 = plan.groundAt(l.x, l.z, l.y);
      const gm = plan.groundAt(l.x + l.ux * l.len * 0.5, l.z + l.uz * l.len * 0.5, l.y);
      dinfo = `頭のzone=${g0 ? g0.zone : '—'} 中央のzone=${gm ? gm.zone : '—'}`; }
    return `#${i} (${l.x.toFixed(1)}, ${l.z.toFixed(1)}) y=${l.y.toFixed(2)} 長さ${l.len.toFixed(2)} ${dinfo}\n`
      + `   外端: ${probes[0]}\n   中央: ${probes[1]}\n   内端: ${probes[2]}`;
  }).join('\n');
}));
await b.close();
