import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=12', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const plan = window.__world.plan;
  const out = [];
  for (const g of plan.GATES.filter(q => q.id !== 'pile')) {
    out.push(`=== 門 ${g.id} (${g.x}, ${g.z}) dir=${g.dir} w=${g.w} y=${g.y}`);
    // 門の軸方向に前後 12m
    const ax = g.dir === 'x' ? 1 : (g.dir === 'xz' ? 0.7 : 0);
    const az = g.dir === 'z' ? 1 : (g.dir === 'xz' ? 0.7 : 0);
    let prev = null;
    for (let t = -12; t <= 12; t += 1.0) {
      const x = g.x + ax * t, z = g.z + az * t;
      const gr = plan.groundAt(x, z, g.y + 1.2);
      const y = gr ? gr.y : null;
      const jump = (prev !== null && y !== null) ? Math.abs(y - prev) : 0;
      out.push(`   t=${t.toFixed(0).padStart(3)} (${x.toFixed(1)},${z.toFixed(1)}) y=${y === null ? '穴' : y.toFixed(2)} zone=${gr?.zone}  段差 ${jump.toFixed(2)}`);
      prev = y;
    }
  }
  return out.join('\n');
}));
await b.close();
