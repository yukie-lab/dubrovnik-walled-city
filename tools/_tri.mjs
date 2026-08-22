import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=11', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const { THREE, scene } = window.__world;
  const out = [];
  const v = new THREE.Vector3();
  scene.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh) return;
    const g = o.geometry, pos = g.attributes.position;
    if (!pos || pos.count !== 15608) return;
    const idx = g.index; const cnt = idx ? idx.count : pos.count;
    let n = 0;
    for (let i = 0; i < cnt && n < 26; i += 3) {
      const T = [];
      let hit = false;
      for (let k = 0; k < 3; k++) {
        const j = idx ? idx.getX(i + k) : i + k;
        v.fromBufferAttribute(pos, j).applyMatrix4(o.matrixWorld);
        T.push([+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]);
        if (Math.abs(v.x - 142) < 2.2 && Math.abs(v.z + 66) < 2.2 && v.y > 19.6 && v.y < 22) hit = true;
      }
      if (hit) { out.push(JSON.stringify(T)); n++; }
    }
  });
  return out.join('\n');
}));
await b.close();
