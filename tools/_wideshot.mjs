// 好きな縦横比で撮る。横長の窓でしか出ない物を捕まえるため。
//   node tools/_wideshot.mjs <名前> <w> <h> "<url query>"
import puppeteer from 'puppeteer-core';
const [NAME, W, H, Q] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal',`--window-size=${+W+40},${+H+60}`,'--no-sandbox'], protocolTimeout: 300000 });
const p = await b.newPage();
await p.setViewport({ width: +W, height: +H, deviceScaleFactor: 1 });
await p.goto(`http://localhost:8765/index.html?shot=1&hud=0${Q}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
await new Promise(r => setTimeout(r, 1600));
await p.screenshot({ path: `shots/cv/${NAME}.png` });
console.log('shot', NAME, W + 'x' + H);
await b.close();
