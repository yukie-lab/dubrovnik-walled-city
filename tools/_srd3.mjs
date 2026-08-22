import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=13', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const { scene, THREE } = window.__world;
  const rc = new THREE.Raycaster();
  const hitAt = (x, z) => {
    rc.set(new THREE.Vector3(x, 1200, z), new THREE.Vector3(0, -1, 0));
    const hs = rc.intersectObject(scene, true).filter(q => q.object.isMesh);
    return hs.map(h => `${h.point.y.toFixed(1)}(${h.object.geometry.attributes.position.count})`).slice(0,3).join(' / ');
  };
  const out = [];
  for (const [x,z,tag] of [[-80,-1015,'現在の要塞'],[-110,-1046,'候補A'],[-60,-1046,'候補B'],[20,-1042,'十字架']]) {
    out.push(`${tag} (${x},${z}): ${hitAt(x,z)}`);
  }
  return out.join('\n');
}));
await b.close();
