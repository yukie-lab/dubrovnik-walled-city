import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=12', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const plan = window.__world.plan;
  const out = [];
  for (const [x,z] of [[150,-50],[150,-56],[152,-50],[146,-50],[156,-50]]) {
    const g = plan.groundAt(x, z, 3.0);
    out.push(`(${x},${z}) groundAt=${JSON.stringify(g)}  terrain=${plan.terrainHeight(x,z).toFixed(2)}  outside=${plan.outsideHeight(x,z).toFixed(2)}`);
  }
  out.push('PAVED_FLATS/PLAZAS 近傍:');
  for (const q of plan.PLAZAS) if (Math.abs((q.x0+q.x1)/2 - 152) < 40 && Math.abs((q.z0+q.z1)/2 + 50) < 40) out.push(`  plaza ${q.id} x[${q.x0},${q.x1}] z[${q.z0},${q.z1}] y=${q.y}`);
  for (const s of plan.streets) {
    let best = 1e9;
    for (let i = 1; i < s.pts.length; i++) {
      const A = s.pts[i-1], B = s.pts[i];
      const vx = B[0]-A[0], vz = B[1]-A[1], L2 = vx*vx+vz*vz || 1;
      let t = ((150-A[0])*vx + (-50-A[1])*vz)/L2; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(150-(A[0]+vx*t), -50-(A[1]+vz*t));
      if (d < best) best = d;
    }
    out.push(`  street ${s.id} kind=${s.kind} w=${s.w} d=${best.toFixed(1)} y0=${plan.streetY(s, s.pts[0][0], s.pts[0][1]).toFixed(1)}`);
  }
  return out.join('\n');
}));
await b.close();
