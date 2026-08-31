// 汚れ帯は「壁の足元の汚れ」。**背中に石が無い帯**は宙に浮いた黒い板になる。
// 帯の向き(rotY)の裏側 0.6m に石があるかを全数で撃つ。
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'], protocolTimeout: 300000 });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=12.87', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate(() => {
  const w = window.__world, T = w.THREE;
  const m = new T.Matrix4(), v = new T.Vector3(), q = new T.Quaternion(), sc = new T.Vector3();
  const rc = new T.Raycaster();
  let mesh = null;
  w.scene.traverse(o => { if (o.name === 'house.grimeBand') mesh = o; });
  if (!mesh) return '(汚れ帯が無い)';
  const bad = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m); m.decompose(v, q, sc); mesh.localToWorld(v);
    const e = new T.Euler().setFromQuaternion(q);
    // 面の法線(外向き)。dummy.rotation.set(0, rotY, 0) の板は +z を向く。
    const nx = Math.sin(e.y), nz = Math.cos(e.y);
    // 帯の中ほどの高さから、背中(法線の逆)へ 0.8m 撃つ
    // **始点をずらさない。** 0.05m 前へ出すと、0.03m 先にある壁を追い越して
    // 「表にも何も無い」= 宙に浮いていると誤判定する(実測 181 枚が偽陽性)。
    const o0 = new T.Vector3(v.x, v.y + sc.y * 0.5, v.z);
    rc.set(o0, new T.Vector3(-nx, 0, -nz)); rc.far = 0.9;
    const h = rc.intersectObjects(w.solids, true).filter(x => x.object !== mesh && x.object.name);
    rc.set(o0, new T.Vector3(nx, 0, nz)); rc.far = 0.9;
    const h2 = rc.intersectObjects(w.solids, true).filter(x => x.object !== mesh && x.object.name);
    if (h.length) continue;                       // 背中に石 = 正しい
    bad.push({ x: v.x, y: v.y, z: v.z, w: sc.x, h: sc.y,
      kind: h2.length ? '裏返し(石は表側 ' + h2[0].distance.toFixed(2) + 'm)' : '**宙に浮いている**' });
  }
  bad.sort((a, c) => c.w * c.h - a.w * a.h);
  const flo = bad.filter(o => o.kind.startsWith('**'));
  return `汚れ帯 ${mesh.count} 枚  背中に石が無い ${bad.length} 枚\n`
    + `  うち **宙に浮いている ${flo.length} 枚** / 裏返し ${bad.length - flo.length} 枚\n`
    + flo.slice(0, 12).map(o => `  浮き (${o.x.toFixed(1)}, ${o.y.toFixed(1)}, ${o.z.toFixed(1)}) ${o.w.toFixed(1)}×${o.h.toFixed(1)}m`).join('\n');
}));
await b.close();
