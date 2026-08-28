import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--window-size=600,400'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&hud=0', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate(async () => {
  const m = await import('/src/tex.js');
  const t = [];
  for (let i = 0; i < 1; i++) { const t0 = performance.now(); m.makeTextures(); t.push(performance.now() - t0); }
  return `makeTextures: ${t.map(v => v.toFixed(0)).join(', ')} ms`;
}));
await b.close();
