// 「人が動いているか」を数える。通常モード(shot=1 を付けない)で読み込み、
// 1 秒あけて 2 回位置を取り、**動いた個体の数と移動量**を出す。
//   node tools/_lifemove.mjs [待ち秒=1.0]
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8765';
const WAIT = Number(process.argv[2] || 1.0);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--use-angle=metal', '--no-sandbox'], protocolTimeout: 300000 });
const p = await b.newPage();
p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
await p.goto(`${BASE}/index.html?time=12.87`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
await new Promise(r => setTimeout(r, 2500));
const snap = () => p.evaluate(() => {
  const w = window.__world, T = w.THREE;
  const m = new T.Matrix4(), v = new T.Vector3();
  const out = {};
  w.scene.traverse(o => {
    if (!o.name || !o.name.startsWith('life.') || !o.isInstancedMesh) return;
    const a = new Float32Array(o.count * 3);
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m); v.setFromMatrixPosition(m); o.localToWorld(v);
      a[i * 3] = v.x; a[i * 3 + 1] = v.y; a[i * 3 + 2] = v.z;
    }
    out[o.name] = Array.from(a);
  });
  return { pos: out, elapsed: w.worldState.elapsed };
});
const A = await snap();
await new Promise(r => setTimeout(r, WAIT * 1000));
const B = await snap();
console.log(`elapsed ${A.elapsed.toFixed(2)} → ${B.elapsed.toFixed(2)} (${(B.elapsed - A.elapsed).toFixed(2)}s)`);
console.log(`${'名前'.padEnd(24)} ${'個数'.padStart(5)} ${'動いた'.padStart(6)} ${'最大移動'.padStart(9)} ${'平均移動'.padStart(9)}`);
for (const k of Object.keys(A.pos)) {
  const a = A.pos[k], c = B.pos[k];
  if (!c || a.length !== c.length) { console.log(`${k.padEnd(24)} 個数が変わった`); continue; }
  let moved = 0, mx = 0, sum = 0;
  for (let i = 0; i < a.length; i += 3) {
    const d = Math.hypot(c[i] - a[i], c[i + 1] - a[i + 1], c[i + 2] - a[i + 2]);
    if (d > 0.002) moved++;
    if (d > mx) mx = d; sum += d;
  }
  const n = a.length / 3;
  console.log(`${k.padEnd(24)} ${String(n).padStart(5)} ${String(moved).padStart(6)} ${mx.toFixed(3).padStart(9)} ${(sum / n).toFixed(3).padStart(9)}`);
}
await b.close();
