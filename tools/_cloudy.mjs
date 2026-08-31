// 雲の実体を数える。高度・大きさ・街との重なり。
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=15.1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate(() => {
  const w = window.__world, T = w.THREE;
  const out = [];
  w.scene.traverse(o => {
    if (o.name !== 'sky.clouds') return;
    const m = new T.Matrix4(), v = new T.Vector3(), sc = new T.Vector3();
    const rows = [];
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m); v.setFromMatrixPosition(m); sc.setFromMatrixScale(m);
      rows.push({ i, y: v.y, r: Math.hypot(v.x, v.z), sx: sc.x, sy: sc.y, sz: sc.z });
    }
    rows.sort((a, c) => a.y - c.y);
    out.push(`雲 ${o.count} 個  親: ${o.parent?.name || o.parent?.type}  frustumCulled=${o.frustumCulled} renderOrder=${o.renderOrder}`);
    out.push(`材質: depthTest=${o.material.depthTest} depthWrite=${o.material.depthWrite} transparent=${o.material.transparent}`);
    out.push('高度の低い順に 6 個:');
    for (const r of rows.slice(0, 6))
      out.push(`  #${r.i}  y=${r.y.toFixed(1)}  水平距離=${r.r.toFixed(0)}m  スケール ${r.sx.toFixed(0)}×${r.sy.toFixed(0)}×${r.sz.toFixed(0)}`);
    const geo = o.geometry; geo.computeBoundingBox();
    const bb = geo.boundingBox;
    out.push(`素の幾何の箱: y ${bb.min.y.toFixed(2)}〜${bb.max.y.toFixed(2)}  x ${bb.min.x.toFixed(2)}〜${bb.max.x.toFixed(2)}`);
  });
  return out.join('\n');
}));
await b.close();
