// 路地に届く光を、露出に依らない物理量で測る。
//   天空率 SVF = その点から半球へ飛ばした射線のうち、何も当たらずに空へ抜けた割合
//   直射 = 太陽の方向へ飛ばした 1 本が抜けるか
// 実在のドゥブロヴニクの路地は SVF 0.05〜0.15、ストラドゥンは 0.35〜0.45。
// 使い方: node tools/alleylight.mjs [--walk] [--time 12.87]
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8765';
const argv = process.argv.slice(2);
const ti = argv.indexOf('--time');
const TIME = ti >= 0 ? Number(argv[ti + 1]) : 12.87;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--use-angle=metal'], protocolTimeout: 600000 });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
await page.goto(`${BASE}/index.html?shot=1&time=${TIME}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__world !== undefined', { timeout: 60000 });

const out = await page.evaluate((TIME) => {
  const W = window.__world, THREE = W.THREE, plan = W.plan;
  const sun = W.sunState;
  const rc = new THREE.Raycaster(); rc.far = 260;
  // 建物・城壁・地形・記念建築。木は葉が透けるので入れない(別に数える)。
  const solids = W.solids;
  // フィボナッチ半球 96 方向
  const DIRS = [];
  const N = 96, GA = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = (i + 0.5) / N;                  // 0..1 = sin(仰角)
    const r = Math.sqrt(1 - y * y), th = GA * i;
    DIRS.push(new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r));
  }
  function svf(x, z, up = 1.6) {
    const o = new THREE.Vector3(x, plan.groundAt(x, z).y + up, z);
    let open = 0, cosSum = 0, cosOpen = 0;
    for (const d of DIRS) {
      rc.set(o, d);
      const hit = rc.intersectObjects(solids, true).filter(h => h.distance > 0.15);
      cosSum += d.y;
      if (!hit.length) { open++; cosOpen += d.y; }
    }
    // 幾何的な開空率と、コサイン重み(水平面が実際に受ける割合)の両方
    return { geo: open / N, cos: cosOpen / cosSum };
  }
  function sunHit(x, z, up = 1.6) {
    if (sun.el <= 0) return 0;
    const o = new THREE.Vector3(x, plan.groundAt(x, z).y + up, z);
    rc.set(o, sun.dir.clone().normalize());
    return rc.intersectObjects(solids, true).filter(h => h.distance > 0.15).length ? 0 : 1;
  }
  const zoneAt = (x, z) => plan.groundAt(x, z).zone;

  // --- A: ストラドゥンから路地へ入る歩き(x = -98.4 の南路地に入る)
  const walk = [];
  const alleys = plan.streets.filter(s => s.kind === 'alley');
  // v2_alley の定点 (-98.4, -30) を含む北路地を探す
  let target = null, best = 1e9;
  for (const s of alleys) {
    const x0 = s.pts[0][0];
    if (Math.abs(x0 - (-98.4)) < best) { best = Math.abs(x0 - (-98.4)); target = s; }
  }
  const ax = target.pts[0][0];
  for (let z = 4; z >= -46; z -= 2) {
    const x = Math.abs(z) < 5 ? ax : (plan.alleyXAt ? plan.alleyXAt(target, z) : ax);
    const s1 = svf(x, z), sh = sunHit(x, z);
    walk.push({ z, x: +x.toFixed(2), zone: zoneAt(x, z), geo: s1.geo, cos: s1.cos, sun: sh,
      y: +plan.groundAt(x, z).y.toFixed(2) });
  }
  // --- B: 路地の代表点
  // 幾何中央を 1 点だけ取ると、東西街路との交差点に立つ。72.5m の北路地の中央
  // z=-37.75 はプリイェコ(z=-36、舗装リボン半幅 2.10m)の中。実際そうなっていて、
  // 「路地の半分が街路ゾーン」という虚偽の所見を出した。6 点に増やし、
  // 東西街路の中心線 ±(w/2 + 2.6m) に落ちた標本は捨てる。
  const crossers = plan.streets.filter(s => s.kind === 'street' || s.kind === 'stradun');
  const inCross = z => crossers.some(c => Math.abs(z - c.pts[0][1]) < c.w / 2 + 2.6);
  const spots = [];
  for (const s of alleys) {
    const z0 = s.pts[0][1], z1 = s.pts[s.pts.length - 1][1];
    const got = [];
    for (const t of [0.15, 0.28, 0.42, 0.58, 0.72, 0.86]) {
      const z = z0 + (z1 - z0) * t;
      if (inCross(z)) continue;
      const x = plan.alleyXAt ? plan.alleyXAt(s, z) : s.pts[0][0];
      got.push({ geo: svf(x, z).geo, cos: svf(x, z).cos, sun: sunHit(x, z), zone: zoneAt(x, z) });
    }
    if (!got.length) continue;
    const md = k => got.map(g => g[k]).sort((a, b) => a - b)[got.length >> 1];
    spots.push({ id: s.id, n: got.length, geo: md('geo'), cos: md('cos'),
      sun: got.reduce((a, g) => a + g.sun, 0) / got.length,
      zone: got.map(g => g.zone).sort()[got.length >> 1],
      zones: got.map(g => g.zone) });
  }
  // --- C: 参照(ストラドゥン中央・ルジャ広場・城壁歩廊)
  const refs = [];
  for (const [nm, x, z, up] of [['ストラドゥン', -60, 0, 1.6], ['ルジャ広場', 152, 10, 1.6],
                                ['プリイェコ通り', -60, -36, 1.6], ['城壁歩廊', 58, -88, 1.6]]) {
    const s1 = svf(x, z, up);
    refs.push({ nm, geo: s1.geo, cos: s1.cos, sun: sunHit(x, z, up), zone: zoneAt(x, z) });
  }
  return { walk, spots, refs, el: sun.el, ghi: sun.ghi, time: TIME };
}, TIME);
await browser.close();

console.log(`# 天空率 — 時刻 ${out.time} (太陽高度 ${out.el.toFixed(1)}°, GHI ${out.ghi.toFixed(2)})`);
console.log('# geo = 半球 96 方向のうち空へ抜けた割合 / cos = 水平面が受ける割合 / 直射 = 太陽が見えるか');
console.log('\n## 参照点');
for (const r of out.refs) console.log(`  ${r.nm.padEnd(8)} ${String(r.zone).padEnd(8)} geo ${r.geo.toFixed(3)}  cos ${r.cos.toFixed(3)}  直射 ${r.sun}`);
console.log('\n## ストラドゥンから路地へ入る(2m ごと)');
console.log('   z    x      ゾーン    地面y   geo    cos   直射');
for (const w of out.walk) console.log(
  `  ${String(w.z).padStart(4)} ${String(w.x).padStart(7)}  ${String(w.zone).padEnd(8)} ${String(w.y).padStart(6)}  ${w.geo.toFixed(3)}  ${w.cos.toFixed(3)}   ${w.sun}`);
const sp = out.spots.slice().sort((a, b) => a.cos - b.cos);
const med = a => a[a.length >> 1];
console.log(`\n## 路地 ${out.spots.length} 本の中ほど`);
console.log(`  cos 天空率  最小 ${sp[0].cos.toFixed(3)} (${sp[0].id}) / 中央 ${med(sp).cos.toFixed(3)} / 最大 ${sp[sp.length-1].cos.toFixed(3)} (${sp[sp.length-1].id})`);
console.log(`  直射が当たる標本の割合 ${(out.spots.reduce((a,s)=>a+s.sun,0)/out.spots.length*100).toFixed(0)}%  (路地の何割かに日が差す本数 ${out.spots.filter(s=>s.sun>0).length}/${out.spots.length})`);
const zc = {}; for (const s of out.spots) for (const z of s.zones) zc[z] = (zc[z] || 0) + 1;
console.log(`  ゾーンの内訳(標本 ${out.spots.reduce((a,s)=>a+s.n,0)} 点) ${JSON.stringify(zc)}`);
