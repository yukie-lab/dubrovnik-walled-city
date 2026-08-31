// 「この画で **何が** 動いているか」を名前で答える。同じ視点・同じ時刻で
// anim だけを変えた 2 枚を撮り、変わった画素を id マスクで部位別に数える。
//   node tools/_whatmoves.mjs "<url query>" [anim0] [anim1]
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const q = process.argv[2], a0 = process.argv[3] || '40', a1 = process.argv[4] || '41';
const hide = (process.argv[5] || '').split(',').filter(Boolean);   // 隠して切り分ける
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--use-angle=metal', '--window-size=1640,1060', '--no-sandbox'], protocolTimeout: 300000 });
const grab = async (anim, withMask) => {
  const p = await b.newPage();
  await p.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await p.goto(`http://localhost:8765/index.html?shot=1&hud=0${q}&anim=${anim}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('window.__READY === true', { timeout: 60000 });
  if (hide.length) await p.evaluate((h) => { window.__world.scene.traverse(o => {
    if ((o.isMesh || o.isInstancedMesh) && o.name && h.some(k => o.name.includes(k))) o.visible = false; }); }, hide);
  await new Promise(r => setTimeout(r, 1300));
  const res = await p.evaluate(async (withMask) => {
    const w = window.__world, T = w.THREE, gl = w.renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const read = () => { const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return Array.from(px); };
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await frame();
    const real = read();
    let mask = null, names = null;
    if (withMask) {
      const saved = [], tm = w.renderer.toneMapping, fog = w.scene.fog;
      w.renderer.toneMapping = T.NoToneMapping; w.scene.fog = null;
      names = []; let i = 0;
      w.scene.traverse(o => {
        if (!o.isMesh && !o.isInstancedMesh) return;
        saved.push([o, o.material, o.instanceColor]);
        if (o.instanceColor) o.instanceColor = null;
        const id = ++i; names.push(o.name || '(無名)');
        const m = new T.MeshBasicMaterial({ fog: false, side: o.material?.side ?? T.FrontSide,
          transparent: false, alphaTest: o.material?.alphaTest ?? 0,
          map: o.material?.alphaTest ? o.material.map : null });
        if (o.material?.alphaTest > 0 && o.material.map) m.onBeforeCompile = (sh) => {
          sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>',
            'diffuseColor.a *= texture2D( map, vMapUv ).a;'); };
        m.color.setRGB((id & 255) / 255, ((id >> 8) & 255) / 255, 0, T.SRGBColorSpace);
        o.material = m;
      });
      w.renderer.setRenderTarget(null); w.renderer.render(w.scene, w.camera);
      mask = read();
      for (const [o, mm, ic] of saved) { o.material = mm; if (ic) o.instanceColor = ic; }
      w.renderer.toneMapping = tm; w.scene.fog = fog;
    }
    return { real, mask, names, W, H };
  }, withMask);
  await p.close();
  return res;
};
const A = await grab(a0, true);
const B = await grab(a1, false);
await b.close();
const s2l = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const cnt = new Map(), tot = new Map();
let changed = 0;
for (let i = 0; i < A.real.length; i += 4) {
  const id = A.mask[i] + (A.mask[i + 1] << 8);
  const nm = id === 0 ? '(背景)' : (A.names[id - 1] || '(不明)');
  tot.set(nm, (tot.get(nm) || 0) + 1);
  const ya = 0.2126*s2l(A.real[i]/255)+0.7152*s2l(A.real[i+1]/255)+0.0722*s2l(A.real[i+2]/255);
  const yb = 0.2126*s2l(B.real[i]/255)+0.7152*s2l(B.real[i+1]/255)+0.0722*s2l(B.real[i+2]/255);
  if (Math.abs(ya - yb) > 0.01) { changed++; cnt.set(nm, (cnt.get(nm) || 0) + 1); }
}
const n = A.real.length / 4;
console.log(`anim ${a0} → ${a1}  変わった画素 ${(100 * changed / n).toFixed(2)}%`);
console.log(`${'部位'.padEnd(22)} ${'変化'.padStart(8)} ${'その部位の画素'.padStart(12)} ${'割合'.padStart(6)}`);
for (const [k, c] of [...cnt.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 12))
  console.log(`${k.padEnd(22)} ${String(c).padStart(8)} ${String(tot.get(k)).padStart(12)} ${(100 * c / tot.get(k)).toFixed(1).padStart(5)}%`);
