import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=11', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const { THREE, scene, plan } = window.__world;
  const out = [];
  // (138,-68)〜(146,-62) の柱状領域にある三角形を数え、y の範囲を出す
  const v = new THREE.Vector3(), tri = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const boxes = {};
  scene.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh) return;
    const g = o.geometry; const pos = g.attributes.position; if (!pos) return;
    g.computeBoundingBox();
    const bb = g.boundingBox.clone().applyMatrix4(o.matrixWorld);
    if (bb.max.x < 132 || bb.min.x > 150 || bb.max.z < -72 || bb.min.z > -58) return;
    // 実際にその範囲に頂点があるか
    let n = 0, ylo = 1e9, yhi = -1e9;
    const idx = g.index;
    const cnt = idx ? idx.count : pos.count;
    for (let i = 0; i < cnt; i += 3) {
      let hit = false;
      for (let k = 0; k < 3; k++) {
        const j = idx ? idx.getX(i + k) : i + k;
        v.fromBufferAttribute(pos, j).applyMatrix4(o.matrixWorld);
        tri[k].copy(v);
        if (v.x > 134 && v.x < 148 && v.z > -71 && v.z < -60 && v.y > 18 && v.y < 28) hit = true;
      }
      if (hit) { n++; for (const t of tri) { if (t.y < ylo) ylo = t.y; if (t.y > yhi) yhi = t.y; } }
    }
    if (n > 0) {
      const key = o.name || (o.material?.customProgramCacheKey ? String(o.material.customProgramCacheKey()).slice(0, 22) : 'mesh') + '/' + pos.count;
      out.push(`${key}  三角 ${n}  y ${ylo.toFixed(1)}〜${yhi.toFixed(1)}  col=${o.material?.color?.getHexString?.()}`);
    }
  });
  return out.join('\n') || 'なし';
}));
await b.close();
