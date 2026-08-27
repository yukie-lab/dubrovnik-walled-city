// ============================================================================
// lightprobe.mjs — 光のモデルを「数字」で出す計器。絵ではなく放射照度で議論する。
//   node tools/lightprobe.mjs 7.90 12.87 19.30 21.20
// 各時刻について、太陽・半球光・IBL・霧・露出の実値と、そこから導かれる
// 「日向の水平石 / 日陰の垂直石」の放射照度と比を出す。
// 比 = 面の向きが読めるかどうか。地中海の晴天は水平面で 5:1〜8:1。
// ============================================================================
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8765';
const times = process.argv.slice(2).map(Number);
if (!times.length) times.push(7.90, 12.87, 19.30, 21.20);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--use-angle=metal', '--window-size=520,340'],
});
const page = await browser.newPage();
await page.setViewport({ width: 480, height: 300, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));

for (const t of times) {
  await page.goto(`${BASE}/index.html?shot=1&hud=0&x=0&z=103&yaw=3.1416&pitch=-0.1&time=${t}&gy=16.0`,
    { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction('window.__READY === true', { timeout: 25000 });
  await new Promise(r => setTimeout(r, 900));
  const m = await page.evaluate(() => {
    const w = window.__world, T = w.THREE;
    const s = w.sunState ?? w.sun;                       // sunState(time) の結果
    const L = w.lighting, sun = L.sun, hemi = L.hemi;
    const Y = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const v3 = c => [+c.r.toFixed(4), +c.g.toFixed(4), +c.b.toFixed(4)];
    // 半球光の放射照度: mix(ground, sky, 0.5+0.5*dot(N,up)) * intensity
    const hemiAt = (ny) => {
      const k = 0.5 + 0.5 * ny;
      return new T.Color(
        hemi.groundColor.r + (hemi.color.r - hemi.groundColor.r) * k,
        hemi.groundColor.g + (hemi.color.g - hemi.groundColor.g) * k,
        hemi.groundColor.b + (hemi.color.b - hemi.groundColor.b) * k,
      ).multiplyScalar(hemi.intensity);
    };
    // 太陽の放射照度(面の法線 N に対して)
    const sunAt = (nx, ny, nz) => {
      const d = sun.position.clone().sub(sun.target.position).normalize();
      const nl = Math.max(0, nx * d.x + ny * d.y + nz * d.z);
      return sun.color.clone().multiplyScalar(sun.intensity * nl);
    };
    const env = w.scene.environmentIntensity ?? 1;
    // IBL の放射照度。**これを数えないと計器が嘘をつく。**
    // 半球光は sky.js の pow(sin el, k) で太陽高度に追随するのに、IBL はしない。
    // 黄金時間には IBL が半球光の 2.7 倍になり、「影の落ちない第二の太陽」として
    // 立面の日向:日陰を潰す。それが計測から丸ごと抜けていた。
    // three の getIBLIrradiance は PI × (roughness=1 の畳み込み) = ∫L cosθ dω。
    // 拡散 IBL は uSunAmt=0 で焼いてある(light.js)ので、太陽芯は入れない。
    const eu = L.envUniforms;
    const sd = eu.uSunDir.value;
    const sm = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
    const envRad = (dx, dy, dz) => {
      const zen = eu.uZenith.value, hoS = eu.uHorizon.value, hoF = eu.uHorizonFar.value, gnd = eu.uGround.value;
      const w = sm(-0.4, 0.9, dx * sd.x + dy * sd.y + dz * sd.z);
      const hr = hoF.r + (hoS.r - hoF.r) * w, hg = hoF.g + (hoS.g - hoF.g) * w, hb = hoF.b + (hoS.b - hoF.b) * w;
      if (dy > 0) {
        const hw = Math.pow(1 - Math.min(1, dy), 3.2);
        return [zen.r + (hr - zen.r) * hw, zen.g + (hg - zen.g) * hw, zen.b + (hb - zen.b) * hw];
      }
      const k = Math.pow(-dy, 0.5);
      return [hr + (gnd.r - hr) * k, hg + (gnd.g - hg) * k, hb + (gnd.b - hb) * k];
    };
    // フィボナッチ球で ∫L·max(0,N·d) dω を積分(4096 方向)
    const iblAt = (nx, ny, nz) => {
      const N = 4096, GA = Math.PI * (3 - Math.sqrt(5));
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < N; i++) {
        const dy = 1 - (2 * i + 1) / N, rad = Math.sqrt(Math.max(0, 1 - dy * dy)), th = GA * i;
        const dx = Math.cos(th) * rad, dz = Math.sin(th) * rad;
        const nl = nx * dx + ny * dy + nz * dz;
        if (nl <= 0) continue;
        const c = envRad(dx, dy, dz);
        r += c[0] * nl; g += c[1] * nl; b += c[2] * nl;
      }
      const w4 = (4 * Math.PI / N) * env;
      return new T.Color(r * w4, g * w4, b * w4);
    };
    const up = hemiAt(1), side = hemiAt(0);
    const sunUp = sunAt(0, 1, 0);
    // 太陽の方位の水平成分(日向の立面)と、その反対(日陰の立面)
    const d = sun.position.clone().sub(sun.target.position).normalize();
    const hx = d.x, hz = d.z, hl = Math.hypot(hx, hz) || 1;
    const sunFace = sunAt(hx / hl, 0, hz / hl);
    const iblFace = iblAt(hx / hl, 0, hz / hl);
    const flat = c => +Y(c).toFixed(4);
    const iblUp = iblAt(0, 1, 0);
    return {
      el: +s.el.toFixed(2), az: +s.az.toFixed(1), am: +s.am.toFixed(2),
      dusk: +s.dusk.toFixed(3), night: +s.night.toFixed(3),
      sunI: +sun.intensity.toFixed(3), sunCol: v3(sun.color),
      hemiI: +hemi.intensity.toFixed(3), hemiSky: v3(hemi.color), hemiGnd: v3(hemi.groundColor),
      envI: +env.toFixed(3),
      fogD: +w.scene.fog.density.toFixed(6), fogCol: v3(w.scene.fog.color), fogY: flat(w.scene.fog.color),
      expo: +w.renderer.toneMappingExposure.toFixed(4),
      // 放射照度(リニア輝度)。天空 = 半球光 + IBL。**両方数える。**
      E_up_sun: flat(sunUp), E_up_hemi: flat(up), E_up_ibl: flat(iblUp),
      E_face_sun: flat(sunFace), E_face_hemi: flat(side), E_face_ibl: flat(iblFace),
      ratio_up: +((flat(sunUp) + flat(up) + flat(iblUp)) / Math.max(1e-5, flat(up) + flat(iblUp))).toFixed(2),
      ratio_face: +((flat(sunFace) + flat(side) + flat(iblFace)) / Math.max(1e-5, flat(side) + flat(iblFace))).toFixed(2),
      iblOverHemi: +((flat(iblFace)) / Math.max(1e-5, flat(side))).toFixed(2),
      shadeBR: +((side.b + iblFace.b) / Math.max(1e-5, side.r + iblFace.r)).toFixed(3),
      sunBR: +(sun.color.b / Math.max(1e-5, sun.color.r)).toFixed(3),
      shadowR: +(w.lighting.sun.shadow.camera.right).toFixed(1),
      bias: +w.lighting.sun.shadow.bias.toExponential(2),
      nbias: +w.lighting.sun.shadow.normalBias.toFixed(4),
    };
  });
  console.log(`\n=== t=${t}  el ${m.el}°  az ${m.az}°  am ${m.am}  dusk ${m.dusk}  night ${m.night}`);
  console.log(`  太陽   I=${m.sunI}  col=${m.sunCol}  B/R ${m.sunBR}`);
  console.log(`  半球   I=${m.hemiI}  sky=${m.hemiSky}  gnd=${m.hemiGnd}  影のB/R ${m.shadeBR}`);
  console.log(`  IBL    envI=${m.envI}    露出 ${m.expo}`);
  console.log(`  霧     d=${m.fogD}  col=${m.fogCol}  Y=${m.fogY}`);
  console.log(`  影     半径 ${m.shadowR}m  bias ${m.bias}  normalBias ${m.nbias}`);
  console.log(`  放射照度 水平: 直射 ${m.E_up_sun} / 半球 ${m.E_up_hemi} + IBL ${m.E_up_ibl}  → 日向:日陰 ${m.ratio_up}:1`);
  console.log(`          立面: 直射 ${m.E_face_sun} / 半球 ${m.E_face_hemi} + IBL ${m.E_face_ibl}  → 日向:日陰 ${m.ratio_face}:1   IBL/半球 ${m.iblOverHemi}`);
}
await browser.close();
