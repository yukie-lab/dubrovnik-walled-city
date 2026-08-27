// 半球光(2 ローブの近似)と IBL(実際の空の分布)は同じ空を二度数えている。
// 半球光を切り、IBL を上げて平均輝度を合わせたとき、絵の「形」は増えるか減るか。
//   node tools/_hemitest.mjs <time> <x> <z> <yaw> <pitch> <extra>
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const a = process.argv.slice(2);
const time = a[0] || '12.87', x = a[1] || '-98.4', z = a[2] || '-30';
const yaw = a[3] || '-0.12', pitch = a[4] || '0.18', extra = a[5] || '&fov=44';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--use-angle=metal', '--window-size=840,560'] });
const p = await b.newPage();
await p.setViewport({ width: 800, height: 520, deviceScaleFactor: 1 });
await p.goto(`http://localhost:8765/index.html?shot=1${extra}&hud=0&x=${x}&z=${z}&yaw=${yaw}&pitch=${pitch}&time=${time}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 25000 });
await new Promise(r => setTimeout(r, 1300));
const rows = await p.evaluate(async () => {
  const w = window.__world, gl = w.renderer.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const s2l = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const stat = () => {
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0, s = 0, s2 = 0, dr = 0, db = 0, dn = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i] / 255, g = px[i + 1] / 255, bb = px[i + 2] / 255;
      const Y = 0.2126 * s2l(r) + 0.7152 * s2l(g) + 0.0722 * s2l(bb);
      s += Y; s2 += Y * Y; n++;
      if (Y < 0.08 && Y > 0.004) { dr += r; db += bb; dn++; }
    }
    const m = s / n, sd = Math.sqrt(Math.max(0, s2 / n - m * m));
    return { mean: +m.toFixed(4), sd: +sd.toFixed(4), cv: +(sd / m).toFixed(3),
      shadeBR: dn ? +(db / dr).toFixed(3) : 0, shadePct: +(100 * dn / n).toFixed(1) };
  };
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const out = [];
  await frame();
  out.push(['そのまま(半球光 + IBL 0.66)', stat()]);
  w.lighting.hemi.visible = false;
  for (const k of [0.66, 1.2, 1.6, 2.0, 2.4, 2.8]) {
    w.scene.environmentIntensity = k;
    await frame();
    out.push([`半球光なし envI=${k}`, stat()]);
  }
  return out;
});
for (const [k, v] of rows) {
  console.log(`${k.padEnd(28)} 平均Y ${String(v.mean).padEnd(7)} 標準偏差 ${String(v.sd).padEnd(7)} 変動係数 ${String(v.cv).padEnd(6)} 影のB/R ${v.shadeBR}  影の割合 ${v.shadePct}%`);
}
await b.close();
