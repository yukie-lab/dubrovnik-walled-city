// 画面座標に「どのメッシュが描かれているか」を GPU の id マスクで答える。
//   node tools/_whatis.mjs "<url query>" x1,y1 x2,y2 …
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const q = process.argv[2];
const pts = process.argv.slice(3).map(s => s.split(',').map(Number));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--use-angle=metal', '--window-size=1640,1060'] });
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
await p.goto(`http://localhost:8765/index.html?shot=1&hud=0${q}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 40000 });
await new Promise(r => setTimeout(r, 1400));
console.log(await p.evaluate(async (PTS) => {
  const w = window.__world, T = w.THREE, gl = w.renderer.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const saved = [], tm = w.renderer.toneMapping, fog = w.scene.fog;
  w.renderer.toneMapping = T.NoToneMapping; w.scene.fog = null;
  const names = []; let i = 0;
  w.scene.traverse(o => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    saved.push([o, o.material, o.instanceColor]);
    if (o.instanceColor) o.instanceColor = null;
    const id = ++i; names.push(o.name || '(no name)');
    const m = new T.MeshBasicMaterial({ fog: false, side: o.material?.side ?? T.FrontSide,
      transparent: o.material?.transparent ?? false, alphaTest: o.material?.alphaTest ?? 0,
      map: o.material?.alphaTest ? o.material.map : null });
    // map を付けると RGB が掛かって **id そのものが壊れる**(葉と松が別の物として
    // 数えられる)。アルファだけを採る。harmony / stonestat の分類マスクも同じ。
    if (o.material?.alphaTest > 0 && o.material.map) m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>',
        'diffuseColor.a *= texture2D( map, vMapUv ).a;');
    };
    m.color.setRGB((id & 255) / 255, ((id >> 8) & 255) / 255, 0, T.SRGBColorSpace);
    o.material = m;
  });
  w.renderer.setRenderTarget(null); w.renderer.render(w.scene, w.camera);
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  for (const [o, m, ic] of saved) { o.material = m; o.instanceColor = ic || null; }
  w.renderer.toneMapping = tm; w.scene.fog = fog;
  const at = (sx, sy) => { const y = H - 1 - Math.round(sy * H / 1000), x = Math.round(sx * W / 1600);
    const k = (y * W + x) * 4; const id = px[k] + (px[k + 1] << 8);
    return `(${sx},${sy}) → ${id === 0 ? '(背景)' : names[id - 1]}`; };
  const out = PTS.map(([x, y]) => at(x, y));
  // 画面全体の内訳も
  const cnt = new Map();
  for (let k = 0; k < W * H * 4; k += 4) { const id = px[k] + (px[k + 1] << 8); cnt.set(id, (cnt.get(id) || 0) + 1); }
  out.push('--- 画面の内訳 ---');
  for (const [id, n] of [...cnt.entries()].sort((a, c) => c[1] - a[1]).slice(0, 12))
    out.push(`${((100 * n) / (W * H)).toFixed(2)}%  ${id === 0 ? '(背景)' : names[id - 1]}`);
  return out.join('\n');
}, pts));
await b.close();
