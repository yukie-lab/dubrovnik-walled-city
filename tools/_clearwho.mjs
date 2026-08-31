// この視点で「半透明の物が何を汚しているか」を、1 クラスずつ消した差で数える。
//   node tools/_clearwho.mjs "<url query>"
import puppeteer from 'puppeteer-core';
const q = process.argv[2] || '';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--window-size=1640,1060','--no-sandbox'], protocolTimeout: 300000 });
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
await p.goto(`http://localhost:8765/index.html?shot=1&hud=0${q}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
await new Promise(r => setTimeout(r, 1300));
console.log(await p.evaluate(async () => {
  const w = window.__world, T = w.THREE, gl = w.renderer.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const read = () => { const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  await frame();
  const base = read().slice();
  // 半透明の物を名前ごとに集める
  const groups = new Map();
  w.scene.traverse(o => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const m = o.material;
    if (!m || (!m.transparent && !(m.opacity < 1))) return;
    const k = o.name || '(無名)';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  });
  const out = [];
  for (const [name, list] of groups) {
    const vis = list.map(o => o.visible);
    list.forEach(o => { o.visible = false; });
    await frame();
    const cur = read();
    let n = 0, mx = 0;
    for (let i = 0; i < base.length; i += 4) {
      const d = Math.max(Math.abs(base[i] - cur[i]), Math.abs(base[i+1] - cur[i+1]), Math.abs(base[i+2] - cur[i+2]));
      if (d > 6) { n++; if (d > mx) mx = d; }
    }
    list.forEach((o, i) => { o.visible = vis[i]; });
    if (n) out.push(`${name.padEnd(24)} この物が塗っている画素 ${(100 * n / (W * H)).toFixed(2)}%  最大の濃さ ${mx}/255`);
  }
  await frame();
  return out.sort((a, c) => parseFloat(c.split('画素 ')[1]) - parseFloat(a.split('画素 ')[1])).join('\n') || '(半透明の物は何も塗っていない)';
}));
await b.close();
