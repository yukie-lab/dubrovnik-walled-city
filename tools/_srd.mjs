import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=13', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const { scene, THREE } = window.__world;
  const out = [];
  // 遠景地形の高さを (-40,-880) 周辺で拾う: レイを真下に落とす
  const rc = new THREE.Raycaster();
  for (const [x, z] of [[-40,-880],[-60,-880],[-20,-880],[-40,-900],[-40,-860],[60,-905],[40,-905],[80,-905]]) {
    rc.set(new THREE.Vector3(x, 900, z), new THREE.Vector3(0, -1, 0));
    const h = rc.intersectObject(scene, true).filter(q => q.object.isMesh)[0];
    out.push(`(${x}, ${z}) 地面 y=${h ? h.point.y.toFixed(1) : '--'}  (${h ? h.object.geometry.attributes.position.count : ''}頂点)`);
  }
  return out.join('\n');
}));
await b.close();
