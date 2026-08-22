import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=150&z=6&yaw=0.92&pitch=0&time=11', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const { scene, THREE } = window.__world;
  const out = [];
  scene.traverse(o => {
    if (o.isInstancedMesh && o.material && o.material.customProgramCacheKey && o.material.customProgramCacheKey() === 'pigeon|skyvisI') {
      const m = new THREE.Matrix4(); const v = new THREE.Vector3();
      const pos = [];
      for (let i = 0; i < Math.min(o.count, 8); i++) { o.getMatrixAt(i, m); v.setFromMatrixPosition(m); pos.push(v.toArray().map(q=>+q.toFixed(1))); }
      out.push({ count: o.count, visible: o.visible, sample: pos });
    }
  });
  return JSON.stringify(out);
}));
await b.close();
