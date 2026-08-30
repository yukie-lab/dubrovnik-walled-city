import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'] });
const p = await b.newPage();
p.on('pageerror', e => console.log('[pageerror]', String(e.stack || e).slice(0, 900)));
p.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 500)); });
await p.goto('http://localhost:8765/index.html?shot=1&time=12.87', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 12000));
console.log('READY =', await p.evaluate(() => window.__READY === true));
await b.close();
