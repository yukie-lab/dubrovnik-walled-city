import puppeteer from 'puppeteer-core';
const url = 'http://localhost:8765/index.html?shot=1&hud=0&x=177&z=-2&yaw=2.35&pitch=0.14&time=10.6&fov=64';
const D = '/private/tmp/claude-501/-Users-yukie-Desktop-test-dubrovnik-walled-city/044b1f30-0f89-43d0-9979-795cd7e03418/scratchpad/';
const V = [
  ['a_base',   { }],
  ['b_r2',     { r: 2 }],
  ['c_r4',     { r: 4 }],
  ['d_4096',   { ms: 4096 }],
  ['e_4096r2', { ms: 4096, r: 2 }],
  ['f_nb08r2', { nb: 0.08, r: 2 }],
];
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new',
  args:['--headless=new','--use-angle=metal','--window-size=1600,1000'] });
for (const [name, cfg] of V) {
  const p = await b.newPage();
  await p.setViewport({ width:1600, height:1000, deviceScaleFactor:1 });
  await p.goto(url, { waitUntil:'domcontentloaded' });
  await p.waitForFunction('window.__READY === true', { timeout: 30000 });
  await p.evaluate((c) => {
    const { scene } = window.__world;
    const lights = []; scene.traverse(o => { if (o.isDirectionalLight && o.shadow) lights.push(o); });
    window.__CFG = c;
    for (const s of lights) { if (c.ms) { s.shadow.mapSize.set(c.ms, c.ms); s.shadow.map?.dispose(); s.shadow.map = null; } }
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => {
      cb(t);
      for (const s of lights) { if (c.r != null) s.shadow.radius = c.r; if (c.nb != null) s.shadow.normalBias = c.nb; }
    });
  }, cfg);
  await new Promise(r => setTimeout(r, 1200));
  await p.screenshot({ path: `${D}sw_${name}.png` });
  await p.close();
}
await b.close();
console.log('done');
