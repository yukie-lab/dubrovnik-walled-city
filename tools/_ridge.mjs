import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=13', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const { THREE, scene, plan } = window.__world;
  const out = [];
  // ridgeMat の InstancedMesh を見つける
  let rm = null;
  scene.traverse(o => { if (o.isInstancedMesh && o.material?.color?.getHexString?.() === 'a05a38') rm = o; });
  if (!rm) return 'ridge mesh not found';
  const roofHouses = plan.houses.filter(h => !h.garden);
  const m = new THREE.Matrix4(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), q = new THREE.Quaternion();
  let worst = 0, worstI = -1;
  roofHouses.forEach((h, i) => {
    rm.getMatrixAt(i, m); m.decompose(pos, q, sc);
    const apex = h.eaves + h.roofH;
    const dy = pos.y - apex;
    if (Math.abs(dy) > Math.abs(worst)) { worst = dy; worstI = i; }
  });
  out.push(`棟瓦と屋根頂点のずれ 最大 ${worst.toFixed(3)}m (i=${worstI})`);
  // 記念建築だけ抜き出す
  for (const nm of ['cathedral','stBlaise','sponza','rector','jesuit']) {
    const M2 = plan.MONUMENTS[nm];
    const i = roofHouses.findIndex(h => Math.abs(h.x - M2.x) < 0.6 && Math.abs(h.z - M2.z) < 0.6);
    if (i < 0) { out.push(`${nm}: 家レコード無し`); continue; }
    const h = roofHouses[i];
    rm.getMatrixAt(i, m); m.decompose(pos, q, sc);
    out.push(`${nm}: 軒 ${h.eaves.toFixed(2)} roofH ${h.roofH.toFixed(2)} 頂点 ${(h.eaves+h.roofH).toFixed(2)} / 棟瓦 y ${pos.y.toFixed(2)} 長さ ${sc.x.toFixed(2)} (w ${h.w} d ${h.d} axis ${h.ridgeAxis})`);
  }
  return out.join('\n');
}));
await b.close();
