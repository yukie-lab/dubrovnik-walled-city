import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=12', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const plan = window.__world.plan;
  const out = [];
  out.push('街路で (150,-56) 付近を通るもの:');
  for (const s of plan.streets) {
    const n = plan.nearestOnPolyline ? null : null;
    // 自前で距離
    let best = 1e9;
    for (let i = 1; i < s.pts.length; i++) {
      const A = s.pts[i-1], B = s.pts[i];
      const vx = B[0]-A[0], vz = B[1]-A[1], L2 = vx*vx+vz*vz || 1;
      let t = ((150-A[0])*vx + (-56-A[1])*vz)/L2; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(150-(A[0]+vx*t), -56-(A[1]+vz*t));
      if (d < best) best = d;
    }
    if (best < 14) out.push(`  ${s.id} kind=${s.kind} w=${s.w} d=${best.toFixed(1)} pts=${JSON.stringify(s.pts.map(q=>[+q[0].toFixed(0),+q[1].toFixed(0)]))}`);
  }
  out.push('高さ地図 (x 144..168, z -60..-38) 2m 刻み:');
  for (let z = -60; z <= -38; z += 2) {
    const row = [];
    for (let x = 144; x <= 168; x += 2) {
      const g = plan.groundAt(x, z, 3.0);
      row.push((g ? g.y : -99).toFixed(1).padStart(6));
    }
    out.push(`z=${String(z).padStart(4)}:${row.join('')}`);
  }
  return out.join('\n');
}));
await b.close();
