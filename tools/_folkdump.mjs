// folk を「どこに・どの姿勢で」立っているかごと吐く。消えた人を場所で特定するため。
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8765';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--use-angle=metal', '--no-sandbox'], protocolTimeout: 300000 });
const p = await b.newPage();
await p.goto(`${BASE}/index.html?shot=1&time=12.87`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(JSON.stringify(await p.evaluate(() =>
  (window.__world.life.folk || []).map(f => ({
    x: +f.x.toFixed(2), z: +f.z.toFixed(2), y: +(f.y ?? 0).toFixed(2),
    sit: f.sit ?? 0, walk: !!(f.route || f.path || f.spd),
  })))));
await b.close();
