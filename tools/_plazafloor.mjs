// 広場ごとに「床の下に地面があるか」を数える。浮いている面積と最大の隙間。
//   node tools/_plazafloor.mjs
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'], protocolTimeout: 300000 });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=12.87', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate(() => {
  const w = window.__world, T = w.THREE;
  const rc = new T.Raycaster(), down = new T.Vector3(0, -1, 0);
  const S = 0.75, cell = S * S;
  const out = [`${'広場'.padEnd(15)} ${'床y'.padStart(5)} ${'標本'.padStart(5)} ${'浮き'.padStart(5)} ${'浮き面積'.padStart(9)} ${'最大隙間'.padStart(9)}  最大の場所`];
  for (const q of w.plan.PLAZAS) {
    let n = 0, bad = 0, mx = 0, at = '';
    for (let x = q.x0 + S / 2; x < q.x1; x += S) for (let z = q.z0 + S / 2; z < q.z1; z += S) {
      rc.set(new T.Vector3(x, 60, z), down);
      const hits = rc.intersectObjects(w.solids, true).filter(h => h.object.name);
      if (!hits.length) continue;
      const top = hits[0];
      if (!/^ground\.(paving|stradun)/.test(top.object.name)) continue;
      n++;
      const second = hits.find(h => h.object !== top.object && h.point.y < top.point.y - 0.02);
      const gap = second ? top.point.y - second.point.y : Infinity;
      if (gap > 0.35) { bad++; if (gap > mx) { mx = gap; at = `(${x.toFixed(1)}, ${z.toFixed(1)})`; } }
    }
    out.push(`${q.id.padEnd(15)} ${q.y.toFixed(2).padStart(5)} ${String(n).padStart(5)} ${String(bad).padStart(5)} ${(bad * cell).toFixed(1).padStart(8)}㎡ ${(mx === Infinity ? '∞' : mx.toFixed(2)).padStart(8)}m  ${at}`);
  }
  return out.join('\n');
}));
await b.close();
