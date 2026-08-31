// 雲の板が **地形や建物を切っていないか**。雲を消した絵の id マスクで
// 「その画素の持ち主」を確かめ、雲が空以外の上に塗った画素だけを数える。
//   node tools/_cloudcut.mjs "<url query>"
import puppeteer from 'puppeteer-core';
const q = process.argv[2] || '';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--window-size=1240,800','--no-sandbox'], protocolTimeout: 300000 });
const p = await b.newPage();
await p.setViewport({ width: 1200, height: 760, deviceScaleFactor: 1 });
await p.goto(`http://localhost:8765/index.html?shot=1&hud=0${q}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
await new Promise(r => setTimeout(r, 1300));
console.log(await p.evaluate(async () => {
  const w = window.__world, T = w.THREE, gl = w.renderer.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const read = () => { const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const cl = []; w.scene.traverse(o => { if (o.name === 'sky.clouds') cl.push(o); });
  await frame();
  const withC = read().slice();
  cl.forEach(o => { o.visible = false; });
  await frame();
  const noC = read().slice();
  // 雲を消した状態で id マスクを撮る = 「雲が無ければ誰の画素か」
  const saved = [], tm = w.renderer.toneMapping, fog = w.scene.fog;
  w.renderer.toneMapping = T.NoToneMapping; w.scene.fog = null;
  const names = []; let n = 0;
  w.scene.traverse(o => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    saved.push([o, o.material, o.instanceColor]);
    if (o.instanceColor) o.instanceColor = null;
    const id = ++n; names.push(o.name || '(無名)');
    const m = new T.MeshBasicMaterial({ fog: false, side: o.material?.side ?? T.FrontSide, transparent: false });
    m.color.setRGB((id & 255) / 255, ((id >> 8) & 255) / 255, 0, T.SRGBColorSpace);
    o.material = m;
  });
  w.renderer.setRenderTarget(null); w.renderer.render(w.scene, w.camera);
  const mask = read().slice();
  for (const [o, m, ic] of saved) { o.material = m; if (ic) o.instanceColor = ic; }
  w.renderer.toneMapping = tm; w.scene.fog = fog;
  cl.forEach(o => { o.visible = true; });
  await frame();
  const cnt = new Map(); let cut = 0, skyPix = 0;
  for (let i = 0; i < withC.length; i += 4) {
    const d = Math.max(Math.abs(withC[i]-noC[i]), Math.abs(withC[i+1]-noC[i+1]), Math.abs(withC[i+2]-noC[i+2]));
    if (d <= 6) continue;
    const id = mask[i] + (mask[i+1] << 8);
    const nm = id === 0 ? '(背景)' : (names[id - 1] || '(不明)');
    if (/^sky\./.test(nm) || nm === '(背景)') { skyPix++; continue; }
    cut++; cnt.set(nm, (cnt.get(nm) || 0) + 1);
  }
  const tot = W * H;
  return `雲が塗った画素: 空の上 ${(100*skyPix/tot).toFixed(2)}%(正しい) / **空以外の上 ${(100*cut/tot).toFixed(2)}%**\n`
    + ([...cnt.entries()].sort((a,c)=>c[1]-a[1]).slice(0,8)
        .map(([k,c]) => `  ${k.padEnd(22)} ${(100*c/tot).toFixed(2)}%`).join('\n') || '  (無し)');
}));
await b.close();
