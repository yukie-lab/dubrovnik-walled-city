// 路地の実測。目で「暗い」「狭い」と言う代わりに、
//   幅 / 壁の高さ / 縦横比 h:w / 空のリボンが張る角度 / 1m あたりの生活の痕跡
// を数字で出す。使い方: node tools/alleystat.mjs [--geom] [--life]
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8765';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--use-angle=metal'], protocolTimeout: 300000 });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
await page.goto(`${BASE}/index.html?shot=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__world !== undefined', { timeout: 60000 });

const out = await page.evaluate(() => {
  const W = window.__world, plan = W.plan, THREE = W.THREE;
  const alleys = plan.streets.filter(s => s.kind === "alley");
  // 各路地の中心線に沿って station を取り、左右の家の高さと壁面までの距離を測る。
  const rows = [];
  for (const s of alleys) {
    const pts = s.pts || s.poly || [[s.x0, s.z0], [s.x1, s.z1]];
    const z0 = pts[0][1], z1 = pts[pts.length - 1][1];
    const L = Math.abs(z1 - z0);
    const stations = [];
    const N = 9;
    for (let i = 1; i < N; i++) {
      const t = i / N, z = z0 + (z1 - z0) * t;
      const x = plan.alleyXAt ? plan.alleyXAt(s, z) : pts[0][0];
      // 左右へ水平に射線を飛ばし、最初に当たった建物までの距離 = 半幅
      const gy = plan.groundAt(x, z).y;
      // 幅は設計値ではなく **実際に建っている面まで** を射線で測る。
      const rc = new THREE.Raycaster();
      const half = [];
      for (const dir of [-1, 1]) {
        rc.set(new THREE.Vector3(x, gy + 1.6, z), new THREE.Vector3(dir, 0, 0));
        rc.far = 14;
        const hit = rc.intersectObjects(W.solids, true).filter(h => h.distance > 0.05);
        half.push(hit.length ? hit[0].distance : 14);
      }
      // 壁の高さ: 路地の床から、両側の家の軒までの高さ
      let h = 0;
      for (const b of plan.houses) {
        if (Math.abs(b.x - x) < b.w * 0.5 + 2.5 && Math.abs(b.z - z) < b.d * 0.5 + 2.5)
          h = Math.max(h, b.eaves - gy);
      }
      stations.push({ z, x, w: half[0] + half[1], h, y: gy });
    }
    const wAvg = stations.reduce((a, b) => a + b.w, 0) / stations.length;
    const hAvg = stations.reduce((a, b) => a + b.h, 0) / stations.length;
    const ys = stations.map(s2 => s2.y);
    rows.push({ name: s.id, L, plan_w: s.w, w: wAvg, h: hAvg, ratio: hAvg / Math.max(wAvg, 0.01),
      // 空のリボンの半角: atan((w/2)/h)。両側で 2 倍。
      sky: 2 * Math.atan((wAvg / 2) / Math.max(hAvg, 0.01)) * 180 / Math.PI,
      rise: Math.max(...ys) - Math.min(...ys) });
  }
  // 生活の痕跡: life 群の中身を路地の近くで数える
  const near = {}; let total = 0;
  const alleyPts = [];
  for (const s of alleys) {
    const pts = s.pts || s.poly || [[s.x0, s.z0], [s.x1, s.z1]];
    const z0 = pts[0][1], z1 = pts[pts.length - 1][1];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10, z = z0 + (z1 - z0) * t;
      alleyPts.push([plan.alleyXAt ? plan.alleyXAt(s, z) : pts[0][0], z]);
    }
  }
  const isNear = (x, z, r) => alleyPts.some(p => Math.abs(p[0] - x) < r && Math.abs(p[1] - z) < r);
  const v = new THREE.Vector3(), m = new THREE.Matrix4();
  W.scene.traverse(o => {
    const tag = o.name;
    if (!tag || !tag.startsWith('life.')) return;
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m); v.setFromMatrixPosition(m); o.localToWorld(v);
        total++; if (isNear(v.x, v.z, 4.0)) near[tag] = (near[tag] || 0) + 1;
      }
    } else if (o.isMesh) {
      o.getWorldPosition(v); total++; if (isNear(v.x, v.z, 4.0)) near[tag] = (near[tag] || 0) + 1;
    }
  });
  const totalLen = rows.reduce((a, b) => a + b.L, 0);
  return { rows, near, totalLen, nAlley: rows.length };
});
await browser.close();

const r = out.rows.sort((a, b) => a.ratio - b.ratio);
console.log(`# 路地 ${out.nAlley} 本 / 総延長 ${out.totalLen.toFixed(0)}m`);
console.log('名前        長さ  設計/実測幅  壁高  h:w   空の角度 高低差');
for (const a of r) console.log(
  `${a.name.padEnd(10)} ${a.L.toFixed(0).padStart(4)}m ${a.plan_w.toFixed(2).padStart(5)}/${a.w.toFixed(2).padStart(5)}m ` +
  `${a.h.toFixed(1).padStart(5)}m ${a.ratio.toFixed(2).padStart(5)} ` +
  `${a.sky.toFixed(1).padStart(7)}° ${a.rise.toFixed(1).padStart(6)}m`);
const med = k => { const v = r.map(x => x[k]).sort((p, q) => p - q); return v[v.length >> 1]; };
console.log(`\n中央値: 幅 ${med('w').toFixed(2)}m / 壁高 ${med('h').toFixed(1)}m / h:w ${med('ratio').toFixed(2)} / 空 ${med('sky').toFixed(1)}°`);
console.log('\n# 路地から 4m 以内の生活の痕跡');
const ents = Object.entries(out.near).sort((a, b) => b[1] - a[1]);
let sum = 0;
for (const [k, n] of ents) { sum += n; console.log(`  ${k.padEnd(22)} ${String(n).padStart(4)}`); }
console.log(`  ${'合計'.padEnd(21)} ${String(sum).padStart(4)}   = ${(sum / out.totalLen * 100).toFixed(1)} 個 / 路地 100m`);
