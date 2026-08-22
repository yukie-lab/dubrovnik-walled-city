import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=12', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const { THREE, scene, plan } = window.__world;
  const rc = new THREE.Raycaster();
  rc.far = 30;
  const bad = [];
  const pts = plan.wallPts;
  for (let i = 1; i < pts.length; i++) {
    const A = pts[i - 1], B = pts[i];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (len < 1) continue;
    const dx = (B[0] - A[0]) / len, dz = (B[1] - A[1]) / len;
    let nx = -dz, nz = dx;
    for (let d = 1; d < len; d += 1.5) {
      const t = d / len;
      const cx = A[0] + (B[0] - A[0]) * t, cz = A[1] + (B[1] - A[1]) * t;
      const wy = A[2] + (B[2] - A[2]) * t;
      // 門の開口は除く
      let inGate = false;
      for (const g of plan.GATES) {
        const gx = cx - g.x, gz = cz - g.z;
        if (gx * gx + gz * gz < 100) { inGate = true; break; }
      }
      if (inGate) continue;
      for (const dy of [-2.5, -5, -8, -11]) {
        const y = wy + dy;
        const o = new THREE.Vector3(cx + nx * 11, y, cz + nz * 11);
        rc.set(o, new THREE.Vector3(-nx, 0, -nz));
        const hits = rc.intersectObject(scene, true).filter(h => h.object.isMesh);
        // 内側 11m まで進む間に一度も石に当たらない = 抜けている
        if (!hits.length) bad.push([cx.toFixed(1), cz.toFixed(1), y.toFixed(1), i]);
      }
    }
  }
  const out = [`壁を貫通して抜ける点: ${bad.length}`];
  for (const q of bad.slice(0, 20)) out.push(`  (${q[0]}, ${q[1]}) y=${q[2]} 区間${q[3]}`);
  return out.join('\n');
}));
await b.close();
