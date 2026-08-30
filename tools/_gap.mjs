// 「床の下に地面があるか」を格子で撃って調べる。上から射線を落とし、
// 当たった面を上から順に並べて、一枚目と二枚目の間隔を出す。
//   node tools/_gap.mjs x0 x1 z0 z1 [刻み]
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [x0, x1, z0, z1, step = 1.5] = process.argv.slice(2).map(Number);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--use-angle=metal', '--no-sandbox'], protocolTimeout: 300000 });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=12.87', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate(([x0, x1, z0, z1, step]) => {
  const w = window.__world, T = w.THREE;
  const rc = new T.Raycaster();
  const down = new T.Vector3(0, -1, 0);
  const rows = [];
  let worst = null;
  for (let z = z0; z <= z1; z += step) {
    let line = '';
    for (let x = x0; x <= x1; x += step) {
      rc.set(new T.Vector3(x, 60, z), down);
      const hits = rc.intersectObjects(w.solids, true).filter(h => h.object.name);
      if (!hits.length) { line += ' ·'; continue; }
      const top = hits[0];
      // 一枚目が舗装で、その下の面まで離れていたら「浮いた床」
      const second = hits.find(h => h.object !== top.object && h.point.y < top.point.y - 0.02);
      const gap = second ? top.point.y - second.point.y : Infinity;
      const isPave = /^ground\.(paving|stradun)/.test(top.object.name);
      if (isPave && gap > 0.35) {
        line += gap > 2 ? ' █' : gap > 1 ? ' ▓' : ' ▒';
        if (!worst || gap > worst.gap) worst = { x, z, gap, y: top.point.y,
          under: second ? second.object.name : '(無し)', uy: second ? second.point.y : null };
      } else line += isPave ? ' .' : ' -';
    }
    rows.push(`z${String(z).padStart(5)} ${line}`);
  }
  return rows.join('\n') + (worst
    ? `\n\n最悪: (${worst.x}, ${worst.z}) 床 y=${worst.y.toFixed(2)} / 下の面 ${worst.under} y=${worst.uy === null ? '—' : worst.uy.toFixed(2)} / 隙間 ${worst.gap.toFixed(2)}m`
    : '\n\n浮きなし');
}, [x0, x1, z0, z1, step]));
await b.close();
