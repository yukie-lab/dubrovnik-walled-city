// この視点で「どの部位を消すと画が変わるか」を全クラスで測る。
// 半透明の材質に限らない — 乗算合成や暗い板も拾う。
//   node tools/_whopaints.mjs "<url query>"
import puppeteer from 'puppeteer-core';
const q = process.argv[2] || '';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--window-size=1240,800','--no-sandbox'], protocolTimeout: 300000 });
const p = await b.newPage();
await p.setViewport({ width: 1200, height: 760, deviceScaleFactor: 1 });
await p.goto(`http://localhost:8765/index.html?shot=1&hud=0${q}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
await new Promise(r => setTimeout(r, 1400));
console.log(await p.evaluate(async () => {
  const w = window.__world, gl = w.renderer.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const read = () => { const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const groups = new Map();
  w.scene.traverse(o => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const k = o.name || '(無名)';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  });
  await frame();
  const base = read().slice();
  const out = [];
  for (const [name, list] of groups) {
    const vis = list.map(o => o.visible);
    list.forEach(o => { o.visible = false; });
    await frame();
    const cur = read();
    let n = 0, mx = 0, bright = 0;
    for (let i = 0; i < base.length; i += 4) {
      const d = Math.max(Math.abs(base[i]-cur[i]), Math.abs(base[i+1]-cur[i+1]), Math.abs(base[i+2]-cur[i+2]));
      if (d > 8) { n++; if (d > mx) mx = d; if (cur[i] > base[i]) bright++; }
    }
    list.forEach((o, i) => { o.visible = vis[i]; });
    if (n > W * H * 0.002) out.push({ name, n, mx, bright });
  }
  await frame();
  return out.sort((a, c) => c.n - a.n).slice(0, 12).map(o =>
    `${o.name.padEnd(22)} 変わる画素 ${(100*o.n/(W*H)).toFixed(2)}%  最大 ${o.mx}/255  `
    + `消すと明るくなる割合 ${(100*o.bright/o.n).toFixed(0)}%`).join('\n');
}));
await b.close();
