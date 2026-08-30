// ヘッドレス実ピクセル検証。使い方:
//   node tools/shot.mjs name:x:z:yaw:pitch:time [name2:...]
// 例: node tools/shot.mjs stradun:-147:0.3:-1.5708:0.02:8.2
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8765';
mkdirSync(new URL('../shots', import.meta.url).pathname, { recursive: true });

const specs = process.argv.slice(2).map(s => {
  const [name, x, z, yaw, pitch, time, extra] = s.split(':');
  return { name, x, z, yaw, pitch, time, extra: extra || '' };
});
if (!specs.length) {
  console.error('no specs');
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--headless=new', '--use-angle=metal', '--window-size=1640,1060'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
page.on('console', m => {
  const t = m.type();
  if (t === 'error' || t === 'warning') console.log(`[${t}]`, m.text().slice(0, 300));
});
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 500)));

for (const s of specs) {
  const url = `${BASE}/index.html?shot=1${s.extra}&hud=0&x=${s.x}&z=${s.z}&yaw=${s.yaw}&pitch=${s.pitch}&time=${s.time}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  try {
    await page.waitForFunction('window.__READY === true', { timeout: 25000 });
  } catch {
    console.log(`[timeout] ${s.name} — __READY にならない`);
  }
  await new Promise(r => setTimeout(r, 1400));
  // 1400ms の固定待ちだけでは足りないことがある。第7パスで 64 枚中 1 枚
  // (v4_srd_t4dusk)が、手前の wall.curtain だけ落ち着く前の明るさで焼かれ、
  // 「変化した画素 7.90%」という **修正と無関係の差** を調和の門に出した
  // (同じコードで撮り直すと再現しない = 比較が原理的に成立していない)。
  // 固定の秒数ではなく **絵が止まったこと** を待つ。連続 2 フレームが
  // 画素単位で一致したら落ち着いたとみなす。
  const settled = await page.evaluate(async () => {
    const w = window.__world, gl = w.renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    // 全画素は重いので 16 画素ごとに間引いて比べる(異常は面で出るので拾える)
    const grab = () => { const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const out = new Uint8Array(((W * H) >> 4) * 3 + 3);
      for (let i = 0, j = 0; i < W * H; i += 16, j += 3) {
        out[j] = px[i * 4]; out[j + 1] = px[i * 4 + 1]; out[j + 2] = px[i * 4 + 2];
      }
      return out; };
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    let prev = grab();
    for (let k = 0; k < 30; k++) {          // 上限 30 フレーム(≒0.5s)
      await frame();
      const cur = grab();
      let same = true;
      for (let i = 0; i < cur.length; i++) if (cur[i] !== prev[i]) { same = false; break; }
      if (same) return k;
      prev = cur;
    }
    return -1;                               // 止まらなかった
  });
  if (settled < 0) console.log(`[未静定] ${s.name} — 30 フレーム待っても絵が止まらない`);
  await page.screenshot({ path: new URL(`../shots/${s.name}.png`, import.meta.url).pathname });
  const m = await page.evaluate(() => {
    const w = window.__world;
    // カメラが家の体積の中にいないか(屋内から撮ると、背面カリングで壁が消え、
    // 向こう側の窓枠だけが宙に浮いて見える — 「バグ」の最も多い誤検出源)
    const c = w.camera.position;
    const inside = w.plan.houses.find(h => c.x > h.x - h.w / 2 && c.x < h.x + h.w / 2
      && c.z > h.z - h.d / 2 && c.z < h.z + h.d / 2 && c.y > h.yBase && c.y < h.eaves);
    // 視線方向 5 本のレイで「壁に鼻先をつけていないか」も見る
    const rc = new w.THREE.Raycaster();
    let near = 1e9;
    for (const ox of [-0.6, -0.3, 0, 0.3, 0.6]) {
      rc.setFromCamera(new w.THREE.Vector2(ox, 0), w.camera);
      const hit = rc.intersectObjects(w.solids, true)[0];
      if (hit) near = Math.min(near, hit.distance);
    }
    return {
      near: +near.toFixed(1),
      fps: window.__FPS?.toFixed(0), calls: window.__CALLS, tris: window.__TRIS,
      inside: inside ? `${inside.x.toFixed(1)},${inside.z.toFixed(1)}` : null,
      cam: [+c.x.toFixed(1), +c.y.toFixed(2), +c.z.toFixed(1)],
    };
  });
  console.log(`shot: ${s.name}  calls=${m.calls} tris=${(m.tris / 1e3 | 0)}k fps=${m.fps} y=${m.cam[1]} 視線先=${m.near}m`
    + (m.inside ? `  ★屋内 (家 ${m.inside}) — 構図として無効` : '')
    + (!m.inside && m.near < 2.2 ? '  ★壁に近すぎ — 構図として無効' : ''));
}
await browser.close();
