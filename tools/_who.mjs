import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=11', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const { THREE, scene } = window.__world;
  const out = []; const bb = new THREE.Box3();
  scene.traverse(o => {
    if (!o.isMesh) return;
    const n = o.geometry?.attributes?.position?.count;
    if (n !== 348) return;
    o.geometry.computeBoundingBox();
    bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    if (bb.min.x > 200 || bb.max.x < 150) return;
    out.push({ n, inst: o.isInstancedMesh ? o.count : null,
      min: bb.min.toArray().map(v=>+v.toFixed(1)), max: bb.max.toArray().map(v=>+v.toFixed(1)),
      mat: o.material?.type, col: o.material?.color?.getHexString?.() });
  });
  return JSON.stringify(out);
}));
await b.close();
