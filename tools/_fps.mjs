// 決まった視点で 120 フレーム回して実測 fps を出す(shot.mjs の fps は捕捉時の
// マシン負荷に左右されて 24〜60 に振れるので、比較には使えない)。
import puppeteer from 'puppeteer-core';
const a = process.argv.slice(2);
const url = `http://localhost:8765/index.html?shot=1&hud=0&fov=54&gy=24.0&x=58&z=-88&yaw=-2.303&pitch=-0.02&time=${a[0] || 12.87}`;
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--window-size=1640,1060'] });
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
await p.goto(url, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
await new Promise(r => setTimeout(r, 2000));
console.log(await p.evaluate(async () => {
  const w = window.__world;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  for (let i = 0; i < 30; i++) await frame();          // 暖機
  const t0 = performance.now();
  for (let i = 0; i < 120; i++) await frame();   // アプリ自身のループが 1 rAF に 1 回描く
  const dt = performance.now() - t0;
  return `120 フレーム ${dt.toFixed(0)}ms = ${(120000 / dt).toFixed(1)} fps  calls=${window.__CALLS}`;
}));
await b.close();
