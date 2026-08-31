// 階段の「実効の幅」— 中心線から横へずらしても足が段に乗り続ける範囲。
// 設計幅 w があっても、曲がりや隣の石で実際に歩ける帯はもっと狭い。
//   node tools/_stairwidth.mjs [階段id]
import puppeteer from 'puppeteer-core';
const WANT = process.argv[2];
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=12.87', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate((WANT) => {
  const plan = window.__world.plan;
  const out = [];
  for (const st of plan.WALL_STAIRS) {
    if (WANT && st.id !== WANT) continue;
    const rows = [];
    let minW = 99, minAt = '';
    for (let i = 1; i < st.pts.length; i++) {
      const a = st.pts[i - 1], b2 = st.pts[i];
      const L = Math.hypot(b2[0] - a[0], b2[1] - a[1]);
      const dx = (b2[0] - a[0]) / L, dz = (b2[1] - a[1]) / L;
      const nx = -dz, nz = dx;
      for (let t = 0.1; t <= 0.9; t += 0.2) {
        const cx = a[0] + dx * L * t, cz = a[1] + dz * L * t;
        const cy = a[2] + (b2[2] - a[2]) * t;
        // 中心から左右へ 0.1m ずつ、足が段(または歩廊)に乗り続ける範囲
        const ok = (o) => {
          const x = cx + nx * o, z = cz + nz * o;
          const g = plan.groundAt(x, z, cy + 0.5);
          if (!g || g.y === undefined) return false;
          if (Math.abs(g.y - cy) > 0.55) return false;             // 足が届かない
          const c = plan.collide(x, z, 0.32, g.y + 1.0);           // 体が石に当たる
          return Math.hypot(c.x - x, c.z - z) < 0.12;
        };
        let lo = 0, hi = 0;
        while (lo > -1.6 && ok(lo - 0.1)) lo -= 0.1;
        while (hi < 1.6 && ok(hi + 0.1)) hi += 0.1;
        const wEff = ok(0) ? (hi - lo) : 0;
        if (wEff < minW) { minW = wEff; minAt = `区間${i} t=${t.toFixed(1)} (${cx.toFixed(1)}, ${cz.toFixed(1)})`; }
        rows.push(wEff);
      }
    }
    const med = rows.slice().sort((x, y) => x - y)[rows.length >> 1];
    out.push(`${st.id.padEnd(14)} 設計幅 ${st.w.toFixed(2)}m  実効 中央値 ${med.toFixed(2)}m  最小 ${minW.toFixed(2)}m @ ${minAt}`);
  }
  return out.join('\n');
}, WANT));
await b.close();
