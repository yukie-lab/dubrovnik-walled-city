// ヘッドレス実ピクセル検証。使い方:
//   node tools/shot.mjs name:x:z:yaw:pitch:time [name2:...]
// 例: node tools/shot.mjs stradun:-147:0.3:-1.5708:0.02:8.2
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'fs';

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
let sceneErrors = [];
page.on('console', m => {
  const t = m.type();
  if (t === 'error' || t === 'warning') console.log(`[${t}]`, m.text().slice(0, 300));
  if (t === 'error') sceneErrors.push(m.text());
});
page.on('pageerror', e => { sceneErrors.push(String(e)); console.log('[pageerror]', String(e).slice(0, 500)); });

try { for (const s of specs) {
  sceneErrors = [];
  const url = `${BASE}/index.html?shot=1${s.extra}&hud=0&x=${s.x}&z=${s.z}&yaw=${s.yaw}&pitch=${s.pitch}&time=${s.time}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  try {
    await page.waitForFunction('window.__READY === true', { timeout: 25000 });
  } catch {
    console.log(`[timeout] ${s.name} — __READY にならない`);
  }
  await new Promise(r => setTimeout(r, 1400));
  // The old readPixels check and the later compositor screenshot sampled two
  // different frames. A wall-sized transient escaped that check twice across
  // campaigns. Read and save the SAME completed render, requiring four equal
  // full-frame PNGs rather than two sparsely sampled buffers.
  const direct = await page.evaluate(() => typeof window.__captureFrame === 'function');
  let png = null;
  if (direct) {
    let previous = null, same = 0;
    for (let k = 0; k < 30; k++) {
      png = await page.evaluate(() => window.__captureFrame());
      same = png === previous ? same + 1 : 0;
      if (same >= 3) break;
      previous = png;
    }
    if (same < 3) throw new Error(`${s.name}: image did not settle; refusing to save a comparison frame`);
  }
  if (sceneErrors.length) throw new Error(`${s.name}: ${sceneErrors.join('\n')}`);
  const output = new URL(`../shots/${s.name}.png`, import.meta.url).pathname;
  if (png && new URL(url).searchParams.get('hud') !== '1') {
    writeFileSync(output, Buffer.from(png.split(',')[1], 'base64'));
  } else {
    if (!direct) console.log(`[legacy capture] ${s.name}: no render-frame hook`);
    await page.screenshot({ path: output });
  }
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
      instances: window.__INSTANCES, renderStats: window.__RENDER_STATS,
      inside: inside ? `${inside.x.toFixed(1)},${inside.z.toFixed(1)}` : null,
      cam: [+c.x.toFixed(1), +c.y.toFixed(2), +c.z.toFixed(1)],
    };
  });
  writeFileSync(output.replace(/\.png$/, '.json'), JSON.stringify({ url, ...m }, null, 2) + '\n');
  console.log(`shot: ${s.name}  calls=${m.calls} instances=${m.instances ?? '?'} tris=${(m.tris / 1e3 | 0)}k fps=${m.fps} y=${m.cam[1]} 視線先=${m.near}m`
    + (m.inside ? `  ★屋内 (家 ${m.inside}) — 構図として無効` : '')
    + (!m.inside && m.near < 2.2 ? '  ★壁に近すぎ — 構図として無効' : ''));
} } finally {
  await browser.close();
}
