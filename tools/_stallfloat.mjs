// 露店・卓・椅子・鉢が地面から浮いていないか。置いた y と実際の床の高さを比べる。
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'], protocolTimeout: 300000 });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&time=8.0', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
const LIST0 = process.argv.includes('--list');
console.log(await p.evaluate((LIST) => {
  const w = window.__world, T = w.THREE;
  const rc = new T.Raycaster(), down = new T.Vector3(0, -1, 0);
  const m = new T.Matrix4(), v = new T.Vector3();
  const rows = [];
  w.scene.traverse(o => {
    if (!o.isInstancedMesh || !o.name || !o.userData?.groundContact) return;
    let worst = 0, at = '', n = 0, bad = 0;
    const why = new Map(); const list = [];
    // 先に全インスタンスの位置を取る。**積み重ねた物は床から離れていて正しい**
    // (椅子の上の椅子)。同じメッシュの別インスタンスが真下 0.30〜0.55m に
    // 居るなら、それは積まれているのであって浮いてはいない。
    const P = [];
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m); v.setFromMatrixPosition(m); o.localToWorld(v);
      P.push(v.clone());
    }
    // 「支えられている」= 同じメッシュの別インスタンスが、すぐ下・すぐ横に居る。
    // 椅子の上の椅子(真上)と、階段の踏面(0.58m 手前・0.16m 下)の両方を拾う。
    // いちばん下の踏面には下に何も無いので、宙に浮いた階段は取りこぼさない。
    // 窓は踏面の実寸(0.58m)より広く取る。0.75 ちょうどで切ると、踏面間隔が
    // ぴったり 0.75m のイエズス会大階段が丸ごと「浮き」と出た(実測 15 枚の
    // 偽陽性。絵で見ると蹴上のある実体の階段だった)。
    const stacked = (q) => P.some(r => r !== q && Math.abs(r.x - q.x) < 0.95
      && Math.abs(r.z - q.z) < 0.95 && q.y - r.y > 0.05 && q.y - r.y < 0.55);
    for (let i = 0; i < o.count; i++) {
      v.copy(P[i]);
      if (v.lengthSq() === 0) continue;
      if (stacked(v)) continue;
      // 30m 上から撃つと屋根や庇に当たって「−28m めり込み」のような嘘が出る。
      // 物のすぐ上から落とす。
      rc.set(new T.Vector3(v.x, v.y + 0.4, v.z), down);
      const all = rc.intersectObjects(w.solids, true).filter(q => q.object !== o && q.object.name);
      // **床への接地と、壁への貫入は別の話。** 床(ground.* と steps)だけを
      // 「立っている面」として見る。躯体や柱に当たるのは相互貫入で、
      // 直し方も別(そちらは tools/piercetest.mjs の領分)。
      // 「立てる面」は地面と段だけではない — 城壁の歩廊・塔・記念建築の天端も床。
      // ただし **柱は床ではない**。柱の上に物は乗らない(巾木が柱を貫いているのは
      // 接地のずれではなく相互貫入で、直し方も別 — tools/piercetest.mjs の領分)。
      // これを外すと歩廊に立つ人が「13.8m 浮いている」と鳴る(実測 49 人)。
      const h = all.filter(q => /^ground\.|^steps$|^wall\.|^monument\.stone$/.test(q.object.name));
      if (!h.length) continue;
      const g = h[0].point.y;
      n++;
      const d = v.y - g;                      // + は浮き、− はめり込み
      if (Math.abs(d) > 0.12) { bad++; const k = h[0].object.name + (d > 0 ? ' に浮き' : ' にめり込み');
        why.set(k, (why.get(k) || 0) + 1);
        if (LIST) list.push(`    ${d >= 0 ? '+' : ''}${d.toFixed(2)}m (${v.x.toFixed(3)}, ${v.z.toFixed(3)}) y=${v.y.toFixed(3)} 床 ${g.toFixed(3)} ${h[0].object.name} pavedY=${(() => { const q = w.plan.pavedY(v.x, v.z); return q === null ? '—' : q.toFixed(3); })()}`); }
      if (Math.abs(d) > Math.abs(worst)) { worst = d; at = `(${v.x.toFixed(1)}, ${v.z.toFixed(1)}) 置き y=${v.y.toFixed(2)} 床 ${g.toFixed(2)}`; }
    }
    if (n) rows.push(`${o.name.padEnd(20)} ${String(n).padStart(4)} 個  ずれ>0.12m ${String(bad).padStart(4)}  最大 ${worst >= 0 ? '+' : ''}${worst.toFixed(2)}m  ${at}`
      + (LIST && list.length ? '\n' + list.slice(0, 40).join('\n') : '')
      + (bad ? '\n' + [...why.entries()].sort((a, c) => c[1] - a[1]).slice(0, 4)
          .map(([k, c]) => `${''.padEnd(22)}${String(c).padStart(4)} 件  ${k}`).join('\n') : ''));
  });
  return rows.join('\n');
}, LIST0));
await b.close();
