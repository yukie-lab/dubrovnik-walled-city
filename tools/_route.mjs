import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=19.6', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const plan = window.__world.plan;
  const out = [];
  out.push('--- extraColliders(港側)');
  for (const b2 of plan.extraColliders) {
    if (b2.x1 > 160 && b2.z0 > -12 && b2.z0 < 40) {
      out.push(`  x[${b2.x0.toFixed(2)},${b2.x1.toFixed(2)}] z[${b2.z0.toFixed(2)},${b2.z1.toFixed(2)}] y[${b2.y0},${b2.y1.toFixed(2)}]`);
    }
  }
  out.push('--- 経路上の押し戻し(porat)');
  const wps = [[166,-6],[171,-6.5],[176.6,-3.4],[176.6,8],[176.6,20],[176.4,32],[175.2,42],[177.5,46],[180.7,52.5],[180.7,58],[181.5,61.5],[196,61.5],[210,61.5]];
  for (let i = 1; i < wps.length; i++) {
    const [ax, az] = wps[i-1], [bx, bz] = wps[i];
    const L = Math.hypot(bx-ax, bz-az);
    for (let d = 0; d <= L; d += 1.0) {
      const t = d / L;
      const x = ax + (bx-ax)*t, z = az + (bz-az)*t;
      const g = plan.groundAt(x, z, 3.2);
      const c = plan.collide(x, z, 0.35, (g?.y ?? 1.7) + 1.0);
      const push = Math.hypot(c.x - x, c.z - z);
      if (push > 0.05) out.push(`  (${x.toFixed(1)}, ${z.toFixed(1)}) 押し戻し ${push.toFixed(2)}m → (${c.x.toFixed(1)}, ${c.z.toFixed(1)})`);
    }
  }
  out.push('--- 岸壁で空いている x の範囲');
  for (const z of [-6, 0, 6, 12, 18, 24, 30]) {
    let lo = null, hi = null;
    for (let x = 166; x < 182; x += 0.25) {
      const g = plan.groundAt(x, z, 3.2);
      const c = plan.collide(x, z, 0.35, (g?.y ?? 1.7) + 1.0);
      const ok = Math.hypot(c.x - x, c.z - z) < 0.05 && g && Math.abs(g.y - 1.7) < 0.6;
      if (ok) { if (lo === null) lo = x; hi = x; }
    }
    out.push(`  z=${z}: x ${lo} 〜 ${hi}`);
  }
  return out.join('\n');
}));
await b.close();
