import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=11', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const { plan } = window.__world;
  const idx = plan.wallPts.map((p,i)=>[i,p]).filter(([i,p]) => p[0] > 150 && p[1] > -40 && p[1] < 60);
  return JSON.stringify({ pts: idx.map(([i,p])=>[i, p.map(v=>+v.toFixed(2)), plan.wallKinds?.[i], +plan.wallNodeHalf[i].toFixed(2)]) });
}));
await b.close();
