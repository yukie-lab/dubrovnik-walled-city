// 露店・卓・椅子・鉢が地面から浮いていないか。置いた y と実際の床の高さを比べる。
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'], protocolTimeout: 300000 });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=8.0', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate(() => {
  const w = window.__world, T = w.THREE;
  const rc = new T.Raycaster(), down = new T.Vector3(0, -1, 0);
  const m = new T.Matrix4(), v = new T.Vector3();
  const rows = [];
  w.scene.traverse(o => {
    if (!o.isInstancedMesh || !o.name || !o.userData?.groundContact) return;
    let worst = 0, at = '', n = 0, bad = 0;
    // 先に全インスタンスの位置を取る。**積み重ねた物は床から離れていて正しい**
    // (椅子の上の椅子)。同じメッシュの別インスタンスが真下 0.30〜0.55m に
    // 居るなら、それは積まれているのであって浮いてはいない。
    const P = [];
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m); v.setFromMatrixPosition(m); o.localToWorld(v);
      P.push(v.clone());
    }
    const stacked = (q) => P.some(r => r !== q && Math.abs(r.x - q.x) < 0.15
      && Math.abs(r.z - q.z) < 0.15 && q.y - r.y > 0.08 && q.y - r.y < 0.55);
    for (let i = 0; i < o.count; i++) {
      v.copy(P[i]);
      if (v.lengthSq() === 0) continue;
      if (stacked(v)) continue;
      // 30m 上から撃つと屋根や庇に当たって「−28m めり込み」のような嘘が出る。
      // 物のすぐ上から落とす。
      rc.set(new T.Vector3(v.x, v.y + 0.4, v.z), down);
      const h = rc.intersectObjects(w.solids, true).filter(q => q.object !== o && q.object.name);
      if (!h.length) continue;
      const g = h[0].point.y;
      n++;
      const d = v.y - g;                      // + は浮き、− はめり込み
      if (Math.abs(d) > 0.12) bad++;
      if (Math.abs(d) > Math.abs(worst)) { worst = d; at = `(${v.x.toFixed(1)}, ${v.z.toFixed(1)}) 置き y=${v.y.toFixed(2)} 床 ${g.toFixed(2)}`; }
    }
    if (n) rows.push(`${o.name.padEnd(20)} ${String(n).padStart(4)} 個  ずれ>0.12m ${String(bad).padStart(4)}  最大 ${worst >= 0 ? '+' : ''}${worst.toFixed(2)}m  ${at}`);
  });
  return rows.join('\n');
}));
await b.close();
