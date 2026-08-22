import puppeteer from 'puppeteer-core';
const url = 'http://localhost:8765/index.html?shot=1&hud=0&x=177&z=-2&yaw=2.35&pitch=0.14&time=10.6&fov=64';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new',
  args:['--headless=new','--use-angle=metal','--window-size=1600,1000'] });
const p = await b.newPage();
await p.setViewport({ width:1600, height:1000, deviceScaleFactor:1 });
await p.goto(url, { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
for (const mode of ['noshadow','nonormal']) {
  await p.evaluate((m) => {
    const { scene, THREE } = window.__world;
    if (m === 'noshadow') scene.traverse(o => { if (o.isDirectionalLight) o.castShadow = false; });
    if (m === 'nonormal') scene.traverse(o => { if (o.isMesh && o.material && o.material.normalMap) { o.material.normalMap = null; o.material.needsUpdate = true; } });
  }, mode);
  await new Promise(r => setTimeout(r, 900));
  await p.screenshot({ path: `shots/_dbg_${mode}.png` });
}
await b.close();
