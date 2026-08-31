// 半透明メッシュの **インスタンス単位** で、指定の場所の近くにある物を挙げる。
//   node tools/_nearinst.mjs x z [半径] [高さ下限] [高さ上限]
import puppeteer from 'puppeteer-core';
const [X, Z, R = '18', Y0 = '-5', Y1 = '40'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=15.1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate(([x, z, r, y0, y1]) => {
  const w = window.__world, T = w.THREE;
  const m = new T.Matrix4(), v = new T.Vector3(), sc = new T.Vector3(), q = new T.Quaternion();
  const out = [];
  w.scene.traverse(o => {
    if (!o.isInstancedMesh && !o.isMesh) return;
    const mat = o.material;
    if (!mat || (!mat.transparent && !(mat.opacity < 1))) return;
    const n = o.isInstancedMesh ? o.count : 1;
    for (let i = 0; i < n; i++) {
      if (o.isInstancedMesh) o.getMatrixAt(i, m); else m.copy(o.matrixWorld);
      m.decompose(v, q, sc);
      if (o.isInstancedMesh) o.localToWorld(v);
      if (v.y < y0 || v.y > y1) continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d > r) continue;
      const e = new T.Euler().setFromQuaternion(q);
      out.push(`${(o.name || '(無名)').padEnd(22)} #${String(i).padStart(4)} 距離${d.toFixed(1).padStart(5)}m  (${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})  `
        + `寸法 ${sc.x.toFixed(1)}×${sc.y.toFixed(1)}×${sc.z.toFixed(1)}  回転 ${(e.x*57.3).toFixed(0)}/${(e.y*57.3).toFixed(0)}/${(e.z*57.3).toFixed(0)}°`);
    }
  });
  return out.slice(0, 40).join('\n') || '(近くに半透明の物は無い)';
}, [Number(X), Number(Z), Number(R), Number(Y0), Number(Y1)]));
await b.close();
