// life.parasol だけを残して撮る。anim を変えた 2 枚で、パラソル自身が
// 動いているかを切り分ける(他の物の動きや影が混ざらない)。
//   node tools/_onlypar.mjs <出力名> <anim> [名前]
import puppeteer from 'puppeteer-core';
const [out, anim = '40', keep = 'life.parasol'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--window-size=1640,1060','--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
await p.goto(`http://localhost:8765/index.html?shot=1&hud=0&x=-113&z=-1.5&yaw=3.1416&pitch=0.02&time=12.6&fov=50&anim=${anim}`,
  { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
await p.evaluate((keep) => {
  window.__world.scene.traverse(o => {
    if ((o.isMesh || o.isInstancedMesh) && o.name !== keep) o.visible = false;
  });
}, keep);
await new Promise(r => setTimeout(r, 1200));
await p.screenshot({ path: `shots/cv/${out}.png` });
await b.close();
console.log('shot', out);
