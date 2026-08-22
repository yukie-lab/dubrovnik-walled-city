import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=13', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const { THREE, scene, plan } = window.__world;
  let rm = null;
  scene.traverse(o => { if (o.isInstancedMesh && o.geometry?.attributes?.position?.count === 24 && o.material?.map) { /* maybe */ } });
  // roofs: InstancedMesh with roofMat (has uRowH in onBeforeCompile)
  scene.traverse(o => { if (o.isInstancedMesh && o.material && String(o.material.onBeforeCompile).includes('uRowH')) rm = o; });
  if (!rm) return 'roof mesh not found';
  const roofHouses = plan.houses.filter(h => !h.garden);
  const c = new THREE.Color();
  const out = [`屋根メッシュ: count=${rm.count}  頂点${rm.geometry.attributes.position.count}  材質色 ${rm.material.color.getHexString()}`];
  for (const nm of ['cathedral','stBlaise','sponza','jesuit']) {
    const M2 = plan.MONUMENTS[nm];
    const i = roofHouses.findIndex(h => Math.abs(h.x - M2.x) < 0.6 && Math.abs(h.z - M2.z) < 0.6);
    if (i < 0) continue;
    rm.getColorAt(i, c);
    out.push(`${nm}: インスタンス色 #${c.getHexString()}  (linear rgb ${c.r.toFixed(3)},${c.g.toFixed(3)},${c.b.toFixed(3)})`);
  }
  // 普通の家 3 軒
  for (const i of [10, 200, 400]) { rm.getColorAt(i, c); out.push(`家${i}: #${c.getHexString()}`); }
  return out.join('\n');
}));
await b.close();
