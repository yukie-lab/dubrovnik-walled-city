import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--headless=new','--use-angle=metal','--window-size=400,300'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&hud=0&x=0&z=103&yaw=3.14&pitch=-0.1&time=12.87&gy=16', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 25000 });
console.log(await p.evaluate(() => {
  const out = [];
  window.__world.scene.traverse(o => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    let k = null, q = o;
    while (q) { if (q.userData && q.userData.kind) { k = q.userData.kind; break; } q = q.parent; }
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    out.push(`${k || '-'} | ${o.name || '(no name)'} | mat=${m?.name || '-'} | ${o.isInstancedMesh ? 'inst×' + o.count : 'mesh'} | tri=${(o.geometry?.index ? o.geometry.index.count : o.geometry?.attributes.position.count) / 3 | 0}`);
  });
  return out.join('\n');
}));
await b.close();
