// 海図を実寸で撮る。地図は UI ではなく一枚の紙なので、紙として見る。
import puppeteer from 'puppeteer-core';
const out = process.argv[2] || 'shots/chart.png';
const clip = process.argv[3];   // "x,y,w,h"(版の一部を原寸で見る)
const browser = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless:'new', args:['--headless=new','--use-angle=metal','--window-size=1640,1060'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 400)));
page.on('console', m => console.log('[' + m.type() + ']', m.text().slice(0, 300)));
await page.goto('http://localhost:8765/index.html?shot=1&hud=0&x=-147&z=0.3&yaw=-1.5708&pitch=0.02&time=9', { waitUntil:'domcontentloaded' });
await page.waitForFunction('window.__READY === true', { timeout: 40000 });
const t0 = Date.now();
const buf = await page.evaluate(async (clip) => {
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  const c = document.getElementById('mapCanvas');
  if (clip) {
    const [x, y, w, h] = clip.split(',').map(Number);
    const o = document.createElement('canvas'); o.width = w; o.height = h;
    o.getContext('2d').drawImage(c, x, y, w, h, 0, 0, w, h);
    return o.toDataURL('image/png');
  }
  return c.toDataURL('image/png');
}, clip);
const t1 = Date.now();
const fs = await import('node:fs');
fs.writeFileSync(out, Buffer.from(buf.split(',')[1], 'base64'));
console.log('chart:', out, (t1 - t0) + 'ms');
await browser.close();
