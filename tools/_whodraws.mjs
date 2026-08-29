// 「この画素を描いているのは誰か」を、メッシュを 1 つずつ隠して差分で当てる。
//   node tools/_whodraws.mjs "<query>" x,y
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const q = process.argv[2];
const [SX, SY] = process.argv[3].split(',').map(Number);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--use-angle=metal', '--window-size=1640,1060'] });
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
await p.goto(`http://localhost:8765/index.html?shot=1&hud=0${q}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 40000 });
await new Promise(r => setTimeout(r, 1400));
console.log(await p.evaluate(async (sx, sy) => {
  const w = window.__world, gl = w.renderer.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const px = new Uint8Array(4);
  const readAt = () => { gl.readPixels(Math.round(sx * W / 1600), H - 1 - Math.round(sy * H / 1000), 1, 1,
    gl.RGBA, gl.UNSIGNED_BYTE, px); return `${px[0]},${px[1]},${px[2]}`; };
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  await frame(); const base = readAt();
  const list = []; w.scene.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && o.visible) list.push(o); });
  const out = [`基準色 ${base}(${list.length} メッシュを 1 つずつ隠す)`];
  for (const o of list) {
    o.visible = false; await frame(); const c = readAt(); o.visible = true;
    if (c !== base) out.push(`  ★ ${o.name || '?'} を隠すと ${base} → ${c}`);
  }
  await frame();
  return out.join('\n');
}, SX, SY));
await b.close();
