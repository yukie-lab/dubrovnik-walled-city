// 間接光の内訳 — 半球光 / IBL / バウンス加算 のどれが日陰を作っているか。
// 同じ定点を 4 回描き、日陰の画素の平均リニア輝度を比べる。
//   node tools/_ambsplit.mjs <time> [x z yaw pitch extra]
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8765';
const [time = '12.87', x = '-98.4', z = '-30', yaw = '-0.12', pitch = '0.18', extra = '&fov=44'] = process.argv.slice(2);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--use-angle=metal', '--window-size=840,560'] });
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 520, deviceScaleFactor: 1 });
await page.goto(`${BASE}/index.html?shot=1${extra}&hud=0&x=${x}&z=${z}&yaw=${yaw}&pitch=${pitch}&time=${time}`,
  { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction('window.__READY === true', { timeout: 25000 });
await new Promise(r => setTimeout(r, 1200));

const res = await page.evaluate(async () => {
  const w = window.__world;
  const L = w.lighting, hemi = L.hemi, sun = L.sun;
  const hemiI = hemi.intensity, envI = w.scene.environmentIntensity, sunI = sun.intensity;
  const mean = () => {
    const gl = w.renderer.getContext();
    const px = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const s2l = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    let s = 0, n = 0;
    for (let i = 0; i < px.length; i += 16) {
      s += 0.2126 * s2l(px[i] / 255) + 0.7152 * s2l(px[i + 1] / 255) + 0.0722 * s2l(px[i + 2] / 255); n++;
    }
    return s / n;
  };
  // intensity を書き換えても毎フレーム lighting.update() が sunState から
  // 上書きし直す(実測: 寄与 0.0% と出る)。visible は update が触らない。
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const out = {};
  await frame(); out.all = mean();
  hemi.visible = false; await frame(); out.noHemi = mean();
  hemi.visible = true; w.scene.environmentIntensity = 0; await frame(); out.noEnv = mean();
  w.scene.environmentIntensity = envI; sun.visible = false; await frame(); out.noSun = mean();
  hemi.visible = false; w.scene.environmentIntensity = 0; await frame(); out.ambOnly = mean();
  sun.visible = true; await frame(); out.sunOnly = mean();
  hemi.visible = true; w.scene.environmentIntensity = envI;
  return { ...out, hemiI, envI, sunI };
});
const f = v => v.toFixed(4);
console.log(`全部 ${f(res.all)}`);
console.log(`  半球光を切る  ${f(res.noHemi)}  (寄与 ${(100 * (res.all - res.noHemi) / res.all).toFixed(1)}%)  hemiI=${res.hemiI.toFixed(2)}`);
console.log(`  IBL を切る    ${f(res.noEnv)}  (寄与 ${(100 * (res.all - res.noEnv) / res.all).toFixed(1)}%)  envI=${res.envI.toFixed(2)}`);
console.log(`  太陽を切る    ${f(res.noSun)}  (寄与 ${(100 * (res.all - res.noSun) / res.all).toFixed(1)}%)  sunI=${res.sunI.toFixed(2)}`);
console.log(`  太陽だけ      ${f(res.sunOnly)}   (半球光も IBL も切った状態)`);
await browser.close();
