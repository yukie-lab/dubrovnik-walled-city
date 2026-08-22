import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=11', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const plan = window.__world.plan;
  const out = [];
  // 城壁の歩廊(walkHalf+余裕)に食い込む家を全部あげる
  const near = [];
  for (const h of plan.houses) {
    const ovX = h.w / 2 + 0.30, ovZ = h.d / 2 + 0.25;
    let dmin = 1e9, wy = 0;
    for (const [ex, ez] of [[-ovX,-ovZ],[ovX,-ovZ],[-ovX,ovZ],[ovX,ovZ],[0,-ovZ],[0,ovZ],[-ovX,0],[ovX,0]]) {
      const q = plan.nearestOnPolyline ? null : null;
    }
    // nearestOnPolyline は export されていないので自前で
    const segD = (px, pz) => {
      let best = 1e9, by = 0;
      for (let i = 1; i < plan.wallPts.length; i++) {
        const A = plan.wallPts[i-1], B = plan.wallPts[i];
        const vx = B[0]-A[0], vz = B[1]-A[1];
        const L2 = vx*vx+vz*vz || 1;
        let t = ((px-A[0])*vx + (pz-A[1])*vz) / L2;
        t = Math.max(0, Math.min(1, t));
        const cx = A[0]+vx*t, cz = A[1]+vz*t;
        const d = Math.hypot(px-cx, pz-cz);
        if (d < best) { best = d; by = A[2] + (B[2]-A[2])*t; }
      }
      return [best, by];
    };
    for (const [ex, ez] of [[-ovX,-ovZ],[ovX,-ovZ],[-ovX,ovZ],[ovX,ovZ],[0,-ovZ],[0,ovZ],[-ovX,0],[ovX,0]]) {
      const [d, y] = segD(h.x+ex, h.z+ez);
      if (d < dmin) { dmin = d; wy = y; }
    }
    if (dmin < 3.8 && h.eaves > wy - 0.4) near.push({ x:+h.x.toFixed(1), z:+h.z.toFixed(1), w:h.w, d:h.d, eaves:+h.eaves.toFixed(1), wallY:+wy.toFixed(1), dmin:+dmin.toFixed(2), garden: !!h.garden });
  }
  out.push(`歩廊面より高い石が歩廊帯(3.8m)に食い込む家: ${near.length}`);
  for (const n of near) out.push(`   (${n.x}, ${n.z}) ${n.w}x${n.d} 軒${n.eaves} 歩廊${n.wallY} 距離${n.dmin} garden=${n.garden}`);
  return out.join('\n');
}));
await b.close();
