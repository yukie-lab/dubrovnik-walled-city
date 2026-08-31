// 店の日除け(shop.awning)とパラソル(life.parasol)が食い込んでいないか。
// 傘の笠は半径 1.30m・高さ 2.24〜2.58m の円錐。日除けは箱。重なりを数える。
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=12.87', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate(() => {
  const w = window.__world, T = w.THREE;
  const grab = (name) => {
    let mesh = null; w.scene.traverse(o => { if (o.name === name) mesh = o; });
    if (!mesh) return { mesh: null, list: [] };
    const m = new T.Matrix4(), v = new T.Vector3(), q = new T.Quaternion(), sc = new T.Vector3();
    const list = [];
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m); m.decompose(v, q, sc); mesh.localToWorld(v);
      const e = new T.Euler().setFromQuaternion(q);
      list.push({ i, x: v.x, y: v.y, z: v.z, sx: sc.x, sy: sc.y, sz: sc.z, rotY: e.y });
    }
    mesh.geometry.computeBoundingBox();
    return { mesh, list, bb: mesh.geometry.boundingBox };
  };
  const A = grab('shop.awning'), P = grab('life.parasol');
  if (!A.mesh || !P.mesh) return '(日除けか傘が無い)';
  const ab = A.bb;                       // 素の幾何の箱(スケール前)
  const hits = [];
  for (const a of A.list) {
    // 日除けの世界での広がり(回転は Y のみ)。半径で近似する。
    const ex = Math.abs(ab.max.x - ab.min.x) * a.sx / 2;
    const ez = Math.abs(ab.max.z - ab.min.z) * a.sz / 2;
    const ar = Math.hypot(ex, ez);
    const ay0 = a.y + ab.min.y * a.sy, ay1 = a.y + ab.max.y * a.sy;
    for (const q2 of P.list) {
      const RIM = 1.30, PY0 = q2.y + 2.24, PY1 = q2.y + 2.58;
      if (ay1 < PY0 - 0.05 || ay0 > PY1 + 0.05) continue;      // 高さが被らない
      const d = Math.hypot(a.x - q2.x, a.z - q2.z);
      if (d > ar + RIM) continue;
      hits.push(`日除け#${a.i} (${a.x.toFixed(1)}, ${a.z.toFixed(1)}) y ${ay0.toFixed(2)}〜${ay1.toFixed(2)}  ×  傘#${q2.i} (${q2.x.toFixed(1)}, ${q2.z.toFixed(1)}) y ${PY0.toFixed(2)}〜${PY1.toFixed(2)}  水平の食い込み ${(ar + RIM - d).toFixed(2)}m`);
    }
  }
  return `日除け ${A.list.length} 枚 / 傘 ${P.list.length} 本  **重なり ${hits.length} 組**\n` + hits.slice(0, 12).join('\n');
}));
await b.close();
