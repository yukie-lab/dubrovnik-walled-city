import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=11', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const plan = window.__world.plan;
  const out = [];
  const pts = plan.wallPts;
  // 中心線を 1m 刻みで進み、その点で「歩廊の内外どちらへも寄れるか」を測る。
  // 前へ 0.5m 進もうとして 0.25m 未満しか進めない点を詰まりとする。
  let stuck = [], narrow = [];
  for (let i = 1; i < pts.length; i++) {
    const A = pts[i - 1], B = pts[i];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (len < 0.5) continue;
    const dx = (B[0] - A[0]) / len, dz = (B[1] - A[1]) / len;
    const nx = -dz, nz = dx;
    for (let d = 0; d < len; d += 1.0) {
      const t = d / len;
      const cx = A[0] + (B[0] - A[0]) * t, cz = A[1] + (B[1] - A[1]) * t;
      const gy = A[2] + (B[2] - A[2]) * t;
      // 歩廊の横断方向で、立てる帯の幅を測る
      let lo = null, hi = null;
      for (let o = -2.6; o <= 2.6; o += 0.1) {
        const x = cx + nx * o, z = cz + nz * o;
        const g = plan.groundAt(x, z, gy + 1.0);
        if (!g || Math.abs(g.y - gy) > 1.6) continue;
        const c = plan.collide(x, z, 0.35, g.y + 1.0);
        if (Math.hypot(c.x - x, c.z - z) > 0.06) continue;
        if (lo === null) lo = o; hi = o;
      }
      const w = (lo === null) ? 0 : hi - lo + 0.1;
      if (w < 0.75) stuck.push([cx.toFixed(1), cz.toFixed(1), gy.toFixed(1), w.toFixed(2), i]);
      else if (w < 1.35) narrow.push([cx.toFixed(1), cz.toFixed(1), gy.toFixed(1), w.toFixed(2), i]);
    }
  }
  out.push(`歩廊が塞がれている点(有効幅 < 0.75m): ${stuck.length}`);
  for (const s of stuck.slice(0, 24)) out.push(`   (${s[0]}, ${s[1]}) y=${s[2]} 幅 ${s[3]}m  区間${s[4]}`);
  out.push(`狭い点(0.75〜1.35m): ${narrow.length}`);
  for (const s of narrow.slice(0, 14)) out.push(`   (${s[0]}, ${s[1]}) y=${s[2]} 幅 ${s[3]}m  区間${s[4]}`);
  return out.join('\n');
}));
await b.close();
