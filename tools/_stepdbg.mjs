import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=12.87', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate((pts) => {
  const w = window.__world, T = w.THREE, rc = new T.Raycaster();
  const out = [];
  for (const [x, z] of pts) {
    rc.set(new T.Vector3(x, 40, z), new T.Vector3(0, -1, 0));
    const hit = rc.intersectObjects(w.solids, true).filter(h => h.object.name === 'steps')[0];
    let info = '段に当たらない';
    if (hit) {
      const m = new T.Matrix4(); hit.object.getMatrixAt(hit.instanceId, m);
      const pos = new T.Vector3().setFromMatrixPosition(m);
      const sc = new T.Vector3().setFromMatrixScale(m);
      info = `踏面 中心(${pos.x.toFixed(2)}, ${pos.z.toFixed(2)}) y=${pos.y.toFixed(3)} 寸法 ${sc.x.toFixed(2)}×${sc.z.toFixed(2)} 当たり y=${hit.point.y.toFixed(3)}`;
    }
    // いちばん近い路地の情報
    let al = null;
    for (const s of w.plan.streets) {
      if (s.kind !== 'alley') continue;
      const q = w.plan.__near ? null : null;
      const dx = s.pts[0][0] - x, dz = s.pts[0][1] - z;
      const d = Math.abs(dx);
      if (!al || d < al.d) al = { id: s.id, w: s.w, d };
    }
    out.push(`(${x}, ${z})  pavedY=${(w.plan.pavedY(x, z) ?? NaN).toFixed(3)}  ${info}  近い路地 ${al ? al.id + ' w=' + al.w.toFixed(2) : '—'}`);
  }
  return out.join('\n');
}, [[-115.149, -41.785], [-112.651, -17.804], [-83.621, -8.326]]));
await b.close();
