// life 層の実数を数える。「人が減った」を画素の割合で言わない — 画素は
// 立ち位置が変われば動く。**インスタンスの個数**と、動いている個体の数を数える。
//   node tools/_lifecount.mjs
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8765';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--use-angle=metal', '--no-sandbox'], protocolTimeout: 300000 });
const p = await b.newPage();
p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
await p.goto(`${BASE}/index.html?shot=1&time=12.87`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
console.log(await p.evaluate(() => {
  const w = window.__world;
  const cnt = new Map();
  w.scene.traverse(o => {
    if (!o.name || !o.name.startsWith('life.')) return;
    const n = o.isInstancedMesh ? o.count : 1;
    cnt.set(o.name, (cnt.get(o.name) || 0) + n);
  });
  const rows = [...cnt.entries()].sort((a, c) => c[1] - a[1]);
  // 個数が同じでも「立っている場所」が変わっていれば画素は動く。位置そのものを
  // 丸めて畳んだ指紋で突き合わせる — 目で「人が減った」と言わないため。
  const m = new w.THREE.Matrix4(), v = new w.THREE.Vector3();
  const digest = {};
  w.scene.traverse(o => {
    if (!o.name || !o.name.startsWith('life.') || !o.isInstancedMesh) return;
    let h = 2166136261;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m); v.setFromMatrixPosition(m); o.localToWorld(v);
      for (const q of [v.x, v.y, v.z]) {
        h ^= Math.round(q * 100) | 0; h = Math.imul(h, 16777619);
      }
    }
    digest[o.name] = (h >>> 0).toString(16);
  });
  // 歩いている個体そのものの数(描画のインスタンス数ではなく、life が持つ配列)
  const L = w.life || {};
  const walkers = L.folks?.length ?? L.people?.length ?? L.agents?.length ?? null;
  const keys = Object.keys(L).filter(k => Array.isArray(L[k])).map(k => `${k}=${L[k].length}`);
  return rows.map(([k, n]) => `${k.padEnd(24)} ${String(n).padStart(5)}`).join('\n')
    + `\n合計 ${rows.reduce((a, r) => a + r[1], 0)}`
    + `\n--- life の配列 ---\n${keys.join('  ') || '(無し)'}`
    + `\n歩行体 ${walkers === null ? '不明' : walkers}`
    + `\n--- 位置の指紋 ---\n` + Object.entries(digest).sort()
        .map(([k, d]) => `${k.padEnd(24)} ${d}`).join('\n');
}));
await b.close();
