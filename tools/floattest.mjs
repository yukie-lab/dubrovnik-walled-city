// ============================================================================
// floattest.mjs — 「浮いている物」が本当に水の上にあるかを、真上からのレイで測る。
//
//   node tools/floattest.mjs
//
// `tagMesh(..., { floating: true })` を付けたメッシュの **インスタンス 1 個ずつ**
// について、その位置の真上から下へレイを飛ばし、自分より上に陸(舗装・桟橋・
// 地形の天端)が無いことを確かめる。
//
// 旧港の舫い舟 5 隻が岸壁の 1.0m 下に埋まり、**マストだけが道に突き出た棒の列**
// になっていた(ユーザー報告)。置いた側は岸壁の縁を x≒172 と思っていたが、
// 実測の縁は x≒183.5 だった。**「縁がどこか」を目で決めない。**
// ============================================================================
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8765';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--use-angle=metal', '--window-size=600,400'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
await page.goto(`${BASE}/index.html?shot=1&hud=0&x=172&z=14&yaw=0&pitch=0&time=12.87&gy=1.7`,
  { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction('window.__READY === true', { timeout: 40000 });

const res = await page.evaluate(() => {
  const w = window.__world, T = w.THREE;
  const rc = new T.Raycaster(new T.Vector3(), new T.Vector3(0, -1, 0), 0, 300);
  const bad = [], ok = [];
  const targets = [];
  w.scene.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && o.userData?.floating) targets.push(o); });
  const m = new T.Matrix4(), v = new T.Vector3();
  for (const o of targets) {
    const n = o.isInstancedMesh ? o.count : 1;
    for (let i = 0; i < n; i++) {
      if (o.isInstancedMesh) { o.getMatrixAt(i, m); v.setFromMatrixPosition(m); }
      else v.setFromMatrixPosition(o.matrixWorld);
      o.localToWorld(v.set(v.x, v.y, v.z));
      rc.ray.origin.set(v.x, 80, v.z);
      const hits = rc.intersectObject(w.scene, true)
        .filter(h => (h.object.isMesh || h.object.isInstancedMesh) && h.object !== o);
      const above = hits.filter(h => h.point.y > v.y + 0.05 && !/sea\.surface/.test(h.object.name));
      const rec = { name: o.name, i, x: +v.x.toFixed(1), z: +v.z.toFixed(1), y: +v.y.toFixed(2),
        top: above[0] ? `${above[0].object.name}@${above[0].point.y.toFixed(2)}` : null };
      (above.length ? bad : ok).push(rec);
    }
  }
  return { bad, n: ok.length + bad.length };
});
if (!res.n) { console.log('floating: true のメッシュが見つからない'); process.exit(0); }
if (!res.bad.length) {
  console.log(`✅ 浮き物 ${res.n} 個すべてが水の上にある`);
} else {
  console.log(`❌ ${res.bad.length} / ${res.n} 個が陸に埋まっている(自分より上に陸がある)`);
  for (const b of res.bad) console.log(`   ${b.name}#${b.i} (${b.x}, ${b.z}) y=${b.y} ← 上に ${b.top}`);
}
await browser.close();
process.exit(res.bad.length ? 1 : 0);
