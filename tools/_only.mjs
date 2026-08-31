// 指定の部位だけを残して撮る。何が模様を作っているかを切り分けるため。
//   node tools/_only.mjs <出力名> <残す名前> "<url query>"
import puppeteer from 'puppeteer-core';
const [OUT, KEEP, Q] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--window-size=1640,1060','--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
await p.goto(`http://localhost:8765/index.html?shot=1&hud=0${Q}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
await p.evaluate((keep) => {
  window.__world.scene.traverse(o => {
    if ((o.isMesh || o.isInstancedMesh) && o.name !== keep) o.visible = false;
  });
}, KEEP);
await new Promise(r => setTimeout(r, 1300));
await p.screenshot({ path: `shots/cv/${OUT}.png` });
console.log('shot', OUT, '(', KEEP, 'だけ )');
await b.close();
