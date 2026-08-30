import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=12.87', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate((pts) => {
  const w = window.__world, T = w.THREE, rc = new T.Raycaster();
  return pts.map(([x, z]) => {
    const g = w.plan.groundAt(x, z, 4.0);
    const sa = w.plan.surfaceAt ? w.plan.surfaceAt(x, z) : null;
    rc.set(new T.Vector3(x, 12, z), new T.Vector3(0, -1, 0));
    const hits = rc.intersectObjects(w.solids, true).filter(h => h.object.name).slice(0, 3);
    return `(${x}, ${z})  groundAt ${g && g.y !== undefined ? g.y.toFixed(2) : '—'}  surfaceAt ${sa === null ? '—' : sa.toFixed(2)}  描かれた面: ${hits.map(h => `${h.object.name}@${h.point.y.toFixed(2)}`).join(' / ')}`;
  }).join('\n');
}, [[133.9, 8.3], [118, -4.2], [-52, -4.2], [60, 4.0]]));
await b.close();
