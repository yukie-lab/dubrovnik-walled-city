import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=12', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const plan = window.__world.plan;
  const out = ['プロチェ門 → 石橋 → 対岸(門の法線に沿って)'];
  const A = [150.6, -47.3], B = [176, -62];
  const L = Math.hypot(B[0]-A[0], B[1]-A[1]);
  let prev = null, curY = 3.4;
  for (let d = 0; d <= L; d += 1.0) {
    const t = d / L;
    const x = A[0] + (B[0]-A[0])*t, z = A[1] + (B[1]-A[1])*t;
    const g = plan.groundAt(x, z, curY + 1.0);
    const y = g ? g.y : null;
    if (y !== null) curY = y;
    const jump = (prev !== null && y !== null) ? Math.abs(y - prev) : 0;
    out.push(`  d=${d.toFixed(0).padStart(3)} (${x.toFixed(1)},${z.toFixed(1)}) y=${y===null?'--':y.toFixed(2)} ${g?.zone ?? ''} 段差 ${jump.toFixed(2)}${jump>0.4?'  ❌':''}`);
    prev = y;
  }
  return out.join('\n');
}));
await b.close();
