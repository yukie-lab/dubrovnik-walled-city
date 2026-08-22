import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=12', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const { THREE, scene, plan } = window.__world;
  const out = [];
  const pts = plan.wallPts;
  out.push('区間28/29 のノード: ' + [27,28,29,30].map(i => `${i}:(${pts[i][0]},${pts[i][1]},y${pts[i][2].toFixed(1)}) ${plan.wallKinds[i]}`).join('  '));
  const rc = new THREE.Raycaster(); rc.far = 60;
  const A = pts[28], B = pts[29];
  const len = Math.hypot(B[0]-A[0], B[1]-A[1]);
  const dx = (B[0]-A[0])/len, dz = (B[1]-A[1])/len;
  const nx = -dz, nz = dx;
  const cx = (A[0]+B[0])/2, cz = (A[1]+B[1])/2, wy = (A[2]+B[2])/2;
  out.push(`中点 (${cx.toFixed(1)},${cz.toFixed(1)}) 歩廊y=${wy.toFixed(1)} 法線=(${nx.toFixed(2)},${nz.toFixed(2)})`);
  out.push(`地形 外=${plan.outsideHeight(cx+nx*6, cz+nz*6).toFixed(2)}  内=${plan.outsideHeight(cx-nx*6, cz-nz*6).toFixed(2)}`);
  for (const dy of [-2.5, -5, -8, -11, -13]) {
    const y = wy + dy;
    rc.set(new THREE.Vector3(cx+nx*14, y, cz+nz*14), new THREE.Vector3(-nx, 0, -nz));
    const hits = rc.intersectObject(scene, true).filter(h => h.object.isMesh).slice(0,3);
    out.push(`  y=${y.toFixed(1)}: ${hits.length ? hits.map(h=>`${h.distance.toFixed(1)}m(${h.object.geometry.attributes.position.count})`).join(' / ') : '★抜ける'}`);
  }
  return out.join('\n');
}));
await b.close();
