// ============================================================================
// aim.mjs — 「この建物を、ここから撮れ」を自動で探す。
//   node tools/aim.mjs <名前> <tx> <tz> <ty> [最短m] [最長m] [time] [fov]
// 街路・広場・路地の上に候補点を撒き、屋内でなく・壁に近すぎず・対象まで
// 視線が通る点の中から、対象が画角にちょうど収まる一点を選んで spec を出す。
// ============================================================================
import puppeteer from 'puppeteer-core';
const [name, tx, tz, ty, dMin = 14, dMax = 40, time = 11, fov = 52] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--headless=new', '--use-angle=metal'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto(`http://localhost:8765/index.html?shot=1&hud=0&time=${time}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY === true', { timeout: 30000 });
const best = await page.evaluate(([tx, tz, ty, dMin, dMax]) => {
  const w = window.__world, T = new w.THREE.Vector3(tx, ty, tz);
  const cand = [];
  const push = (x, z, y) => cand.push({ x, z, y });
  for (const s of w.plan.streets) {
    for (let i = 1; i < s.pts.length; i++) {
      const [x0, z0] = s.pts[i - 1], [x1, z1] = s.pts[i];
      const L = Math.hypot(x1 - x0, z1 - z0);
      for (let d = 0; d < L; d += 2.5) {
        const t = d / L;
        push(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, null);
      }
    }
  }
  for (const p of w.plan.PLAZAS) {
    for (let x = p.x0 + 1.5; x < p.x1; x += 2) for (let z = p.z0 + 1.5; z < p.z1; z += 2) push(x, z, p.y);
  }
  const rc = new w.THREE.Raycaster();
  const out = [];
  for (const c of cand) {
    const g = w.plan.groundAt(c.x, c.z, (c.y ?? 4) + 1);
    const gy = (g ? g.y : c.y ?? 2.6) + 1.62;
    const dist = Math.hypot(c.x - tx, c.z - tz);
    if (dist < dMin || dist > dMax) continue;
    const inside = w.plan.houses.some(h => c.x > h.x - h.w / 2 && c.x < h.x + h.w / 2
      && c.z > h.z - h.d / 2 && c.z < h.z + h.d / 2 && gy > h.yBase && gy < h.eaves);
    if (inside) continue;
    const from = new w.THREE.Vector3(c.x, gy, c.z);
    const dir = T.clone().sub(from).normalize();
    rc.set(from, dir);
    const hit = rc.intersectObjects(w.solids, true)[0];
    const clear = !hit || hit.distance > from.distanceTo(T) - 3.0;
    if (!clear) continue;
    // 正面性: 対象の主軸に対して 25〜55° 斜めが最も立体に見える
    out.push({ x: +c.x.toFixed(1), z: +c.z.toFixed(1), gy: +gy.toFixed(2), dist: +dist.toFixed(1),
      yaw: +Math.atan2(-(tx - c.x), -(tz - c.z)).toFixed(4),
      pitch: +Math.atan2(ty - gy, dist).toFixed(3) });
  }
  out.sort((a, b) => Math.abs(a.dist - (dMin + dMax) / 2) - Math.abs(b.dist - (dMin + dMax) / 2));
  return out.slice(0, 6);
}, [+tx, +tz, +ty, +dMin, +dMax]);
if (!best.length) console.log('候補なし — 距離の範囲を広げてください');
for (const b of best) {
  console.log(`${name}:${b.x}:${b.z}:${b.yaw}:${b.pitch}:${time}:&fov=${fov}    (距離 ${b.dist}m, 目線 ${b.gy}m)`);
}
await browser.close();
