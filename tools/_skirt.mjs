// 広場の擁壁の高さを縁に沿って測る。7m の擁壁が街の真ん中に立っていないか。
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'], protocolTimeout: 300000 });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=12.87', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate(() => {
  const w = window.__world, oh = (x, z) => w.plan.surfaceAt(x, z);
  const out = [`${'広場'.padEnd(15)} ${'標本'.padStart(4)} ${'壁あり'.padStart(6)} ${'中央'.padStart(6)} ${'最大'.padStart>=0?'最大'.padStart(6):''}  最大の場所`];
  for (const q of w.plan.PLAZAS) {
    const yTop = q.y + 0.02;
    const ring = [[q.x0, q.z1], [q.x1, q.z1], [q.x1, q.z0], [q.x0, q.z0], [q.x0, q.z1]];
    const hs = []; let mx = 0, at = '', n = 0;
    for (let e = 0; e < 4; e++) {
      const [ax, az] = ring[e], [bx, bz] = ring[e + 1];
      const L = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / L, dz = (bz - az) / L, nx = -dz, nz = dx;
      const steps = Math.max(1, Math.ceil(L / 1.5));
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) * L / steps;
        const ex = ax + dx * t, ez = az + dz * t;
        n++;
        const h = yTop - oh(ex + nx * 0.6, ez + nz * 0.6);
        if (h < 0.30) continue;
        if (h <= 0) continue;
        hs.push(h);
        if (h > mx) { mx = h; at = `(${ex.toFixed(1)}, ${ez.toFixed(1)})`; }
      }
    }
    hs.sort((a, c) => a - c);
    const med = hs.length ? hs[hs.length >> 1] : 0;
    out.push(`${q.id.padEnd(15)} ${String(n).padStart(4)} ${String(hs.length).padStart(6)} ${med.toFixed(2).padStart(6)}m ${mx.toFixed(2).padStart(6)}m  ${at}`);
  }
  return out.join('\n');
}));
await b.close();
