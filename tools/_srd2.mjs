import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=13', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const { scene, THREE } = window.__world;
  const rc = new THREE.Raycaster();
  const at = (x, z) => {
    rc.set(new THREE.Vector3(x, 1200, z), new THREE.Vector3(0, -1, 0));
    const h = rc.intersectObject(scene, true).filter(q => q.object.isMesh)[0];
    return h ? h.point.y : null;
  };
  const rows = [];
  let best = { y: -1 };
  for (let z = -1050; z <= -820; z += 42) {
    const row = [];
    for (let x = -220; x <= 260; x += 60) {
      const y = at(x, z);
      row.push((y ?? -1).toFixed(0).padStart(5));
      if (y > best.y) best = { y, x, z };
    }
    rows.push(`z=${String(z).padStart(5)}: ${row.join('')}`);
  }
  rows.push('x = -220 .. 260 を 60 刻み');
  rows.push(`最高点 (${best.x}, ${best.z}) y=${best.y.toFixed(1)}`);
  return rows.join('\n');
}));
await b.close();
