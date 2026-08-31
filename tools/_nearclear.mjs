// 指定の場所の近くにある「半透明の物」を列挙する。宙に浮いた薄い板の犯人探し。
//   node tools/_nearclear.mjs x z [半径]
import puppeteer from 'puppeteer-core';
const [X, Z, R = '30'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=15.1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate(([x, z, r]) => {
  const w = window.__world, T = w.THREE;
  const box = new T.Box3(), out = [];
  w.scene.traverse(o => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const m = o.material;
    if (!m || (!m.transparent && !(m.opacity < 1) && !(m.blending && m.blending !== T.NormalBlending))) return;
    box.setFromObject(o);
    if (!isFinite(box.min.x)) return;
    const cx = Math.max(box.min.x, Math.min(x, box.max.x));
    const cz = Math.max(box.min.z, Math.min(z, box.max.z));
    const d = Math.hypot(cx - x, cz - z);
    if (d > r) return;
    out.push(`${(o.name || '(無名)').padEnd(24)} 距離 ${d.toFixed(1)}m  y ${box.min.y.toFixed(1)}〜${box.max.y.toFixed(1)}  `
      + `x ${box.min.x.toFixed(0)}〜${box.max.x.toFixed(0)} z ${box.min.z.toFixed(0)}〜${box.max.z.toFixed(0)}  `
      + `${o.isInstancedMesh ? o.count + '個' : '1個'} opacity=${m.opacity} depthWrite=${m.depthWrite}`);
  });
  return out.join('\n') || '(半透明の物は無い)';
}, [Number(X), Number(Z), Number(R)]));
await b.close();
