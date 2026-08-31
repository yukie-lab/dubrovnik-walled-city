// 広場の擁壁に物が刺さっていないか。壁の定義は **plan.plazaWall 一本**
// (計器が自前で作り直すと、本体と食い違って嘘を出す)。
//   node tools/_wallhit.mjs [半径=0.45]
import puppeteer from 'puppeteer-core';
const R = Number(process.argv[2] || 0.45);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=12.87', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate((R) => {
  const w = window.__world, T = w.THREE, plan = w.plan;
  const m = new T.Matrix4(), v = new T.Vector3();
  const hits = new Map(), rows = [];
  w.scene.traverse(o => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    if (!o.name || !/^life\.|^surround\.bollard|^steps$/.test(o.name)) return;
    const n = o.isInstancedMesh ? o.count : 1;
    for (let i = 0; i < n; i++) {
      if (o.isInstancedMesh) o.getMatrixAt(i, m); else m.copy(o.matrixWorld);
      v.setFromMatrixPosition(m);
      if (o.isInstancedMesh) o.localToWorld(v);
      if (v.lengthSq() === 0) continue;
      const pw = plan.plazaWall(v.x, v.z, R);
      if (!pw) continue;
      if (v.y >= pw.yTop - 0.05) continue;      // 壁の天端に載っているのは正しい
      if (v.y < pw.yBot - 0.6) continue;        // 壁よりずっと下は無関係
      hits.set(o.name, (hits.get(o.name) || 0) + 1);
      if (rows.length < 20) rows.push(`  ${o.name.padEnd(20)} #${i} (${v.x.toFixed(1)}, ${v.z.toFixed(1)}) y=${v.y.toFixed(2)}  壁 ${pw.yBot.toFixed(2)}→${pw.yTop.toFixed(2)}`);
    }
  });
  return ([...hits.entries()].sort((a,c)=>c[1]-a[1]).map(([k,c]) => `${k.padEnd(20)} ${c} 個`).join('\n') || '壁に刺さっている物は無い')
    + (rows.length ? '\n' + rows.join('\n') : '');
}, R));
await b.close();
