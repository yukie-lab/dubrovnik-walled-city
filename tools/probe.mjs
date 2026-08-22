// 一点調査: 指定 XZ の真上から下向きに、当たった三角形を全部並べる。
// 使い方: node tools/probe.mjs x:z [x:z ...]
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8765';
const pts = process.argv.slice(2).map(s => s.split(':').map(Number));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--headless=new', '--use-angle=metal'], protocolTimeout: 300000 });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__world !== undefined', { timeout: 40000 });

const out = await page.evaluate((pts) => {
  const { THREE, solids, plan } = window.__world;
  const rc = new THREE.Raycaster();
  rc.far = 400;
  const meshes = [];
  const TAGS = ['ground', 'walls', 'buildings', 'monuments', 'steps'];
  solids.forEach((root, gi) => root.traverse(o => { if (o.isMesh) { o.userData.__tag = TAGS[gi] || 'g' + gi; meshes.push(o); } }));
  return pts.map(([x, z, yProbe]) => {
    rc.set(new THREE.Vector3(x, 200, z), new THREE.Vector3(0, -1, 0));
    const hits = rc.intersectObjects(meshes, false).map(h => ({
      y: +h.point.y.toFixed(3), tag: h.object.userData.__tag,
      side: h.object.material?.side, ny: h.face ? +h.face.normal.y.toFixed(2) : null,
      inst: h.instanceId ?? null,
    }));
    const g = plan.groundAt(x, z, 200);
    const g0 = plan.groundAt(x, z, 3);
    // 胸の高さ(第3引数があればその高さ)で周囲 2.5m に石があるか — 全方位スキャン
    const near = [];
    {
      const y = yProbe;
      if (y !== undefined && !Number.isNaN(y)) {
        for (let a = 0; a < 24; a++) {
          const th = (a / 24) * Math.PI * 2;
          rc.set(new THREE.Vector3(x, y, z), new THREE.Vector3(Math.cos(th), 0, Math.sin(th)));
          rc.far = 2.5;
          const h0 = rc.intersectObjects(meshes, false)[0];
          if (h0) near.push({ a: +(th * 180 / Math.PI).toFixed(0), d: +h0.distance.toFixed(2), tag: h0.object.userData.__tag, inst: h0.instanceId ?? null });
        }
        rc.far = 400;
      }
    }
    return { x, z, plan: { hi: +g.y.toFixed(2), zoneHi: g.zone, lo: +g0.y.toFixed(2), zoneLo: g0.zone }, hits: hits.slice(0, 10), near };
  });
}, pts);

for (const r of out) {
  console.log(`(${r.x}, ${r.z})  plan: 上層 y${r.plan.hi}[${r.plan.zoneHi}] / 下層 y${r.plan.lo}[${r.plan.zoneLo}]`);
  if (!r.hits.length) console.log('    描画: 当たりなし');
  for (const h of r.hits) console.log(`    描画 y${String(h.y).padStart(8)}  ${h.tag.padEnd(10)} ny=${h.ny} side=${h.side}${h.inst !== null ? ' inst#' + h.inst : ''}`);
  if (r.near?.length) console.log('    周囲: ' + r.near.map(n => `${n.a}°→${n.d}m[${n.tag}${n.inst !== null ? '#' + n.inst : ''}]`).join(' '));
}
await browser.close();
