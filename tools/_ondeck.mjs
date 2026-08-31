// 「街路に置くはずの物」が歩廊・階段・塔の天端に載っていないか。
// curY に 200 を渡す呼び出しが残っていないかを、置かれた結果から確かめる。
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=21.2', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate(() => {
  const w = window.__world, T = w.THREE, plan = w.plan;
  const m = new T.Matrix4(), v = new T.Vector3();
  const rows = [];
  w.scene.traverse(o => {
    if (!o.isInstancedMesh || !o.name) return;
    if (!/^life\.(lampArm|lampGlass|lampPool|flowerPot|table|chair|stall)|^house\.(grimeBand|plinth)|^shop\./.test(o.name)) return;
    let n = 0; const where = [];
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m); v.setFromMatrixPosition(m); o.localToWorld(v);
      if (v.lengthSq() === 0) continue;
      const g = plan.groundAt(v.x, v.z, v.y + 0.5);
      if (!g || (g.zone !== 'wall' && g.zone !== 'stair' && g.zone !== 'shaft')) continue;
      n++;
      if (where.length < 3) where.push(`(${v.x.toFixed(1)}, ${v.z.toFixed(1)}) y=${v.y.toFixed(1)} zone=${g.zone}`);
    }
    if (n) rows.push(`${o.name.padEnd(20)} ${String(n).padStart(4)} 個が歩廊・階段の上  ${where.join(' / ')}`);
  });
  return rows.join('\n') || '街路の物が歩廊・階段の上に載っている例は無い';
}));
await b.close();
