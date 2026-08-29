// ブラウザ側で Raycaster を飛ばし、当たった物の名前とワールド座標を返す。
//   node tools/_ray.mjs "<query>" x,y [x,y …]
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const q = process.argv[2];
const pts = process.argv.slice(3).map(s => s.split(',').map(Number));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--use-angle=metal', '--window-size=1640,1060'] });
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
await p.goto(`http://localhost:8765/index.html?shot=1&hud=0${q}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 40000 });
await new Promise(r => setTimeout(r, 1200));
console.log(await p.evaluate((PTS) => {
  const w = window.__world, T = w.THREE;
  const rc = new T.Raycaster();
  const out = [];
  for (const [sx, sy] of PTS) {
    rc.setFromCamera(new T.Vector2(sx / 1600 * 2 - 1, -(sy / 1000 * 2 - 1)), w.camera);
    const hits = rc.intersectObject(w.scene, true).filter(h => h.object.isMesh || h.object.isInstancedMesh);
    const l = hits.slice(0, 3).map(h => `${h.object.name || '?'}@${h.distance.toFixed(1)}m (${h.point.x.toFixed(1)},${h.point.y.toFixed(2)},${h.point.z.toFixed(1)})`);
    out.push(`(${sx},${sy}) ${l.join('  |  ') || '—'}`);
  }
  return out.join('\n');
}, pts));
await b.close();
