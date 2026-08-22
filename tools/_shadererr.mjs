import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--use-gl=angle','--use-angle=metal','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage();
p.on('console', m => { const t = m.text(); if (/ERROR|THREE|shader/i.test(t)) console.log(t.slice(0, 6000)); });
p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 2000)));
await p.goto('http://localhost:8080/index.html?shot=1&hud=0&x=196&z=63.4&yaw=2.4&pitch=-0.12&time=13&gy=1.5', { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise(r => setTimeout(r, 6000));
await b.close();
