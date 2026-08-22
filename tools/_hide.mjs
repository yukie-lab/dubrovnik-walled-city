import puppeteer from 'puppeteer-core';
const url = 'http://localhost:8765/index.html?shot=1&hud=0&x=-146&z=2&yaw=-2.304&pitch=0.10&time=10.6&fov=50';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new',
  args:['--headless=new','--use-angle=metal','--window-size=1600,1000'] });
const p = await b.newPage();
await p.setViewport({ width:1600, height:1000, deviceScaleFactor:1 });
await p.goto(url, { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
const info = await p.evaluate(() => {
  const { scene, THREE } = window.__world;
  // 画面 (700,205) を通る視線と交わるメッシュを、名前ではなく「隠して差分」で特定する
  const cands = [];
  scene.traverse(o => { if (o.isMesh && o.visible) cands.push(o); });
  return cands.length;
});
// binary search by hiding halves
async function shot(name) { await new Promise(r=>setTimeout(r,450)); return p.screenshot({ encoding:'base64', clip:{x:600,y:170,width:220,height:80} }); }
const base = await shot();
let lo = 0, hi = info;
const res = await p.evaluate(() => {
  const { scene } = window.__world;
  const list = []; scene.traverse(o => { if (o.isMesh) list.push(o); });
  window.__LIST = list; return list.length;
});
async function tryHide(a, b2) {
  await p.evaluate(([a2, b3]) => { window.__LIST.forEach((o, i) => { o.visible = !(i >= a2 && i < b3); }); }, [a, b2]);
  return shot();
}
while (hi - lo > 1) {
  const mid = (lo + hi) >> 1;
  const img = await tryHide(lo, mid);
  if (img !== base) { hi = mid; } else { lo = mid; }
}
await p.evaluate(() => window.__LIST.forEach(o => { o.visible = true; }));
console.log(await p.evaluate((i) => {
  const o = window.__LIST[i];
  const g = o.geometry; g.computeBoundingBox();
  return JSON.stringify({ i, inst: o.isInstancedMesh ? o.count : null, verts: g.attributes.position.count,
    bb: [g.boundingBox.min.toArray().map(v=>+v.toFixed(1)), g.boundingBox.max.toArray().map(v=>+v.toFixed(1))],
    mat: o.material?.type, col: o.material?.color?.getHexString?.() });
}, lo));
await b.close();
