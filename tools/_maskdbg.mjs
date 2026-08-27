import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--headless=new','--use-angle=metal','--window-size=840,560'] });
const p = await b.newPage();
await p.setViewport({ width: 800, height: 520, deviceScaleFactor: 1 });
await p.goto('http://localhost:8765/index.html?shot=1&gy=24.0&fov=54&hud=0&x=58&z=-88&yaw=-2.303&pitch=-0.02&time=12.87', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 25000 });
await new Promise(r => setTimeout(r, 1200));
console.log(await p.evaluate(async () => {
  const w = window.__world, T = w.THREE, gl = w.renderer.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const saved = [], tm = w.renderer.toneMapping, fog = w.scene.fog;
  w.renderer.toneMapping = T.NoToneMapping; w.scene.fog = null;
  // 名前ごとに違う色を配って、どの名前が何画素かを数える
  const names = []; let i = 0;
  w.scene.traverse(o => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    saved.push([o, o.material, o.instanceColor]); const id = i++;
    if (o.instanceColor) o.instanceColor = null;   // 屋根の橙の個体差が id 色に掛かる
    names.push(o.name || '(none)');
    o.material = new T.MeshBasicMaterial({ color: (id + 1) * 0x010101 % 0x1000000, fog: false, side: o.material?.side ?? T.FrontSide });
    o.material.color.setRGB(((id + 1) & 255) / 255, (((id + 1) >> 8) & 255) / 255, 0, T.SRGBColorSpace);
  });
  w.renderer.setRenderTarget(null); w.renderer.render(w.scene, w.camera);
  const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  for (const [o, m, ic] of saved) { o.material = m; if (ic) o.instanceColor = ic; }
  w.renderer.toneMapping = tm; w.scene.fog = fog;
  const cnt = new Map();
  for (let k = 0; k < W * H * 4; k += 4) { const id = px[k] + (px[k+1] << 8); cnt.set(id, (cnt.get(id) || 0) + 1); }
  return [...cnt.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 16)
    .map(([id, n]) => `${((100*n)/(W*H)).toFixed(2)}%  id=${id}  ${id === 0 ? '(背景/空?)' : names[id - 1]}`).join('\n');
}));
await b.close();
