// 「見えている所で人が湧いていないか」を数える。時計を進めながら、
// 視錐台の中に居る人の _off が 1 フレームで反転した回数を数える。
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--no-sandbox'], protocolTimeout: 300000 });
const p = await b.newPage();
// 開幕の立ち位置(ピレ門)に置き、ストラドゥンを向く
await p.goto('http://localhost:8765/index.html?shot=1&hud=0&x=-147&z=0.3&yaw=-1.5708&pitch=0.02&time=7.1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
await new Promise(r => setTimeout(r, 1500));
const step = (t) => p.evaluate((t) => {
  const w = window.__world, T = w.THREE, L = w.life;
  if (t !== null) w.worldState.time = t;
  const cam = w.camera; cam.updateMatrixWorld();
  const fr = new T.Frustum().setFromProjectionMatrix(
    new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const sph = new T.Sphere(new T.Vector3(), 1.0);
  const F = L.folk || [];
  const vis = F.map(f => { sph.center.set(f.x, f.y + 0.9, f.z); return fr.intersectsSphere(sph); });
  return { off: F.map(f => !!f._off), want: F.map(f => !!f._want), vis,
           n: F.length, time: w.worldState.time };
}, t);
let prev = await step(null);
let popped = 0, changed = 0, deferred = 0;
for (let k = 1; k <= 24; k++) {
  const t = 7.1 + k * 0.08;                 // 実機の flow 36 なら 8 秒ぶん
  await new Promise(r => setTimeout(r, 260));
  const cur = await step(t);
  for (let i = 0; i < cur.n; i++) {
    if (cur.off[i] !== prev.off[i]) { changed++; if (prev.vis[i] || cur.vis[i]) popped++; }
    if (cur.off[i] !== cur.want[i]) deferred++;
  }
  prev = cur;
}
console.log(`時刻 7.1 → ${prev.time.toFixed(2)}  状態が変わった ${changed} 回  うち画面内で変わった ${popped} 回  保留のまま ${deferred} 人回`);
await b.close();
