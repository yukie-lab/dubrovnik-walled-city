import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
p.on('console', m => { if (m.type()==='error') console.log('[err]', m.text().slice(0,200)); });
await p.goto('http://localhost:8765/?shot=1&x=172.5&z=14&yaw=-1.10&pitch=-0.02&time=11.9&fov=50&gy=1.7', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const { scene, THREE, camera, plan } = window.__world;
  let sea = null;
  scene.traverse(o => { if (o.isMesh && o.material?.uniforms?.uSigma) sea = o; });
  const out = [];
  if (!sea) return '海メッシュが見つからない';
  out.push(`海: visible=${sea.visible} pos=${sea.position.toArray().map(v=>v.toFixed(1))} 頂点=${sea.geometry.attributes.position.count} renderOrder=${sea.renderOrder} layers=${sea.layers.mask}`);
  out.push(`カメラ: ${camera.position.toArray().map(v=>v.toFixed(2))} layers=${camera.layers.mask}`);
  out.push(`uDebug=${sea.material.uniforms.uDebug.value} tScene=${!!sea.material.uniforms.tScene.value} tDepth=${!!sea.material.uniforms.tDepth.value}`);
  // 港の海底
  const hs = [];
  for (const [x,z] of [[180,14],[190,14],[200,14],[178,30],[186,-10],[176,20]]) hs.push(`(${x},${z})=${plan.outsideHeight(x,z).toFixed(2)}`);
  out.push('港の地形: ' + hs.join('  '));
  // 海メッシュへレイを飛ばす
  const rc = new THREE.Raycaster();
  rc.set(camera.position.clone(), new THREE.Vector3(0.891, -0.08, -0.454).normalize());
  const hits = rc.intersectObject(sea, false);
  out.push('海への直接レイ: ' + (hits.length ? hits.slice(0,2).map(h=>h.distance.toFixed(1)+'m '+h.point.toArray().map(v=>v.toFixed(1))).join(' / ') : '当たらない'));
  return out.join('\n');
}));
await b.close();
