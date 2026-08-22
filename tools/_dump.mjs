import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const page = await browser.newPage();
await page.goto('http://localhost:8765/index.html?shot=1&hud=0', { waitUntil:'domcontentloaded' });
await page.waitForFunction('window.__READY === true', { timeout: 30000 });
const out = await page.evaluate(() => {
  const p = window.__world.plan;
  return {
    wallPts: p.wallPts.map(a=>a.map(v=>Math.round(v*10)/10)),
    kinds: p.wallKinds,
    plazas: p.PLAZAS,
    routes: window.__world.routes.length,
    sky: (()=>{ const o=[]; window.__world.scene.children.forEach((c,i)=>{ c.traverse(m=>{ if(m.isMesh) o.push({i, type:m.geometry.type, n:m.geometry.attributes.position.count, mat:m.material.type, side:m.material.side, vis:m.visible, sc:[m.scale.x,m.scale.y,m.scale.z], pos:[Math.round(m.position.x),Math.round(m.position.y),Math.round(m.position.z)]}); }); }); return o.filter(q=>q.i>=5&&q.i<=6); })(),
  };
});
console.log(JSON.stringify(out));
await browser.close();
