// ============================================================================
// _depth.mjs — 定点ごとに「線形距離バッファ」を書き出す(6巡目レビュー用)。
//   node tools/_depth.mjs s01_stradun_w:-138:-1.2:-1.62:0.015:10.6:&fov=52 ...
// 出力: shots/_depth/<name>.bin  (Float32 400x250, カメラからの距離[m])
// 用途: 近景/中景/遠景の「情報量(勾配エネルギー)」を距離で分けて測る。
// ============================================================================
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8765';
const OUT = new URL('../shots/_depth/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const specs = process.argv.slice(2).map(s => {
  const [name, x, z, yaw, pitch, time, extra] = s.split(':');
  return { name, x, z, yaw, pitch, time, extra: extra || '' };
});

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--use-angle=metal', '--window-size=1640,1060'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });

for (const s of specs) {
  const url = `${BASE}/index.html?shot=1${s.extra}&hud=0&x=${s.x}&z=${s.z}&yaw=${s.yaw}&pitch=${s.pitch}&time=${s.time}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction('window.__READY === true', { timeout: 25000 });
  await new Promise(r => setTimeout(r, 1200));
  const data = await page.evaluate(() => {
    const { THREE, scene, camera } = window.__world;
    const W = 400, H = 250;
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType });
    // three の MeshDepthMaterial は instancing / morph を自前で処理する
    const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    const r = new THREE.WebGLRenderer({ antialias: false });
    r.setSize(W, H, false);
    const prevOv = scene.overrideMaterial, prevBg = scene.background, prevEnv = scene.environment, prevFog = scene.fog;
    scene.overrideMaterial = dm; scene.background = null; scene.environment = null; scene.fog = null;
    r.setRenderTarget(rt);
    r.render(scene, camera);
    const buf = new Uint8Array(W * H * 4);
    r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    r.setRenderTarget(null);
    scene.overrideMaterial = prevOv; scene.background = prevBg; scene.environment = prevEnv; scene.fog = prevFog;
    const near = camera.near, far = camera.far;
    const out = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      // unpackRGBAToDepth (three: UnpackFactors4 = vec4(255/256 / (1,256,65536), 1/16777216))
      const d = (buf[i * 4] / 255) * (255 / 256)
        + (buf[i * 4 + 1] / 255) * (255 / 256) / 256
        + (buf[i * 4 + 2] / 255) * (255 / 256) / 65536
        + (buf[i * 4 + 3] / 255) * (1 / 16777216);
      // perspectiveDepthToViewZ
      const viewZ = (near * far) / ((far - near) * d - far);
      out[i] = -viewZ;
    }
    rt.dispose(); r.forceContextLoss(); r.dispose();
    return Array.from(out);
  });
  const f32 = Float32Array.from(data);
  writeFileSync(OUT + s.name + '.bin', Buffer.from(f32.buffer));
  const fin = [...f32].filter(v => v > 0 && v < 4000);
  fin.sort((a, b) => a - b);
  console.log(`${s.name.padEnd(20)} 距離 中央値 ${fin[fin.length >> 1].toFixed(1)}m  p10 ${fin[fin.length * 0.1 | 0].toFixed(1)}m  p90 ${fin[fin.length * 0.9 | 0].toFixed(1)}m`);
}
await browser.close();
