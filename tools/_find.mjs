import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=-146&z=2&yaw=0&pitch=0&time=11', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const { THREE, scene } = window.__world;
  const out = [];
  const m4 = new THREE.Matrix4(), v = new THREE.Vector3();
  scene.traverse(o => {
    if (!o.isMesh) return;
    const key = o.material?.customProgramCacheKey ? o.material.customProgramCacheKey() : '';
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m4); v.setFromMatrixPosition(m4).applyMatrix4(o.matrixWorld);
        if (v.y > 11 && v.y < 22 && Math.abs(v.x + 138) < 16 && Math.abs(v.z - 6) < 16) {
          out.push({ inst: i, key, pos: v.toArray().map(q=>+q.toFixed(1)), name: o.name || o.geometry.attributes.position.count });
        }
      }
    }
  });
  return JSON.stringify(out.slice(0, 24));
}));
await b.close();
