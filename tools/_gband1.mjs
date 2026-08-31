import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=12.87', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate((pts) => {
  const w = window.__world, T = w.THREE, rc = new T.Raycaster();
  const m = new T.Matrix4(), v = new T.Vector3(), q = new T.Quaternion(), sc = new T.Vector3();
  let mesh = null; w.scene.traverse(o => { if (o.name === 'house.grimeBand') mesh = o; });
  const out = [];
  for (const [px, pz] of pts) {
    let best = -1, bd = 9;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m); v.setFromMatrixPosition(m); mesh.localToWorld(v);
      const d = Math.hypot(v.x - px, v.z - pz);
      if (d < bd) { bd = d; best = i; }
    }
    mesh.getMatrixAt(best, m); m.decompose(v, q, sc); mesh.localToWorld(v);
    const e = new T.Euler().setFromQuaternion(q);
    const nx = Math.sin(e.y), nz = Math.cos(e.y);
    const o0 = new T.Vector3(v.x, v.y + sc.y * 0.5, v.z);
    const shoot = (dx, dz, lbl) => {
      rc.set(o0, new T.Vector3(dx, 0, dz)); rc.far = 3;
      const h = rc.intersectObjects(w.solids, true).filter(x => x.object !== mesh && x.object.name).slice(0, 2);
      return `${lbl}: ${h.map(x => x.object.name + '@' + x.distance.toFixed(2) + 'm').join(' / ') || 'なし'}`;
    };
    out.push(`#${best} (${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)}) ${sc.x.toFixed(1)}×${sc.y.toFixed(1)} rotY=${(e.y * 57.3).toFixed(0)}°\n`
      + `   ${shoot(-nx, -nz, '背中')}\n   ${shoot(nx, nz, '表')}\n   ${shoot(nz, -nx, '横+')}  ${shoot(-nz, nx, '横-')}`);
  }
  return out.join('\n');
}, [[-118.1, 79.5], [-123.9, -77.6], [168.5, 42.3]]));
await b.close();
