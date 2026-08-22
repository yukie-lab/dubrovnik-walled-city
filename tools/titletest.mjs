// ============================================================================
// titletest.mjs — 表題が「画面」ではなく「最初の一瞬」になっているかを実機で測る。
//
//   node tools/titletest.mjs [--png]
//
// 見るのは 4 つ。どれも目ではなく数で。
//   1. 背景は生きた街か(表題のあいだもカメラが動き、人が動いているか)
//   2. 入城は **降下** か — カメラが 2〜3 秒かけて連続に下り、
//      1 フレームでも跳んだら失敗(暗転・切り替えは失敗状態)
//   3. 着地は「ピレ側のストラドゥン、立った目の高さ」とビット一致するか
//   4. 表題の字は「現れる」か(滑り込みではなく、字送りが落ち着く)
// ============================================================================
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8765';
const KEEP = process.argv.includes('--png');
mkdirSync(new URL('../shots/', import.meta.url).pathname, { recursive: true });

const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--use-angle=metal', '--window-size=1640,1060'] });
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 40000 });

const camOf = () => p.evaluate(() => {
  const c = window.__world.camera;
  return { x: c.position.x, y: c.position.y, z: c.position.z, pitch: c.rotation.x, yaw: c.rotation.y };
});
const shot = async (n) => { if (KEEP) await p.screenshot({ path: `shots/title_${n}.png` }); };

// ---- 1. 表題のあいだ、背景は動いているか
const c0 = await camOf();
await new Promise(r => setTimeout(r, 2500));
await shot('reveal');
const c1 = await camOf();
const drift = Math.hypot(c1.x - c0.x, c1.y - c0.y, c1.z - c0.z);

// 字は現れ切ったか(全字が不透明)
const typeOk = await p.evaluate(() => {
  const sp = [...document.querySelectorAll('#ttlMain span')];
  return sp.length > 0 && sp.every(s => parseFloat(getComputedStyle(s).opacity) > 0.95);
});
// 字送りが落ち着いたか(settle 後の値)
const track = await p.evaluate(() => getComputedStyle(document.getElementById('ttlMain')).letterSpacing);

// ---- 2. 入城 = 降下。1 フレームごとにカメラを取り、跳びを探す
await p.evaluate(() => document.getElementById('btnStart').click());
const path = [];
for (let k = 0; k < 90; k++) {
  path.push({ ...(await camOf()), t: Date.now() });
  if (k === 26) await shot('descend');
  await new Promise(r => setTimeout(r, 40));
}
await shot('arrived');
// **速度**で見る。標本の間隔はブラウザの都合で 40〜180ms に揺れるので、
// 「1 標本の移動量」で継ぎ目を測ると、ただの間延びを跳びと誤判定する
// (実測 9.5m と出たが、実体は長いフレーム 1 枚だった)。
let jump = 0, jAt = -1;
for (let i = 1; i < path.length; i++) {
  const dt = Math.max(0.016, (path[i].t - path[i - 1].t) / 1000);
  const v = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y, path[i].z - path[i - 1].z) / dt;
  if (v > jump) { jump = v; jAt = i; }
}
const moved = Math.hypot(path[path.length - 1].x - path[0].x, path[path.length - 1].y - path[0].y);

// ---- 3. 着地はプレイヤーの立ち位置と一致するか
const land = await p.evaluate(() => {
  const w = window.__world, c = w.camera, pl = w.player;
  return { dx: c.position.x - pl.x, dz: c.position.z - pl.z, yaw: c.rotation.y - pl.yaw,
    started: !document.getElementById('title').classList.contains('entering')
      || document.getElementById('title').classList.contains('hidden') };
});
await b.close();

const C = { red: '\x1b[31m', grn: '\x1b[32m', dim: '\x1b[2m', off: '\x1b[0m' };
const ok = (v) => (v ? `${C.grn}✅${C.off}` : `${C.red}❌${C.off}`);
let bad = 0;
const line = (label, pass, detail) => { if (!pass) bad++; console.log(`  ${ok(pass)} ${label.padEnd(34)} ${detail}`); };
console.log('\n表題 — 実機の測定');
// 閾値は **設計値から引く**。漂いは 0.18 m/s なので 2.5 秒で 0.45m。
// 0.30 は「設計どおりなら必ず超え、遅くなれば必ず落ちる」位置。
// 以前は閾値 0.25 に対し設計値が 0.229 で、通っていたのは読み込みの揺れだった。
line('背景は生きた街(カメラが漂う)', drift > 0.30, `2.5 秒で ${drift.toFixed(2)}m 動いた(設計 0.45m)`);
line('字は現れ切る', typeOk, `字送り ${track}`);
// 速度は「瞬間移動が無いこと」だけを見る。標本の間隔が 40〜180ms に揺れるので
// 山の値そのものは信用できない(理論の山 5.8 m/s に対し実測 8.1 が出る)。
// 切り替え(暗転・カット)なら 7m を 1 フレームで飛ぶので 200 m/s の桁になる。
line('瞬間移動なし', jump < 40 && jAt >= 0, `最大速度 ${jump.toFixed(2)} m/s`);
// 滑らかさはこちらで見る。降下のあいだ、下りと寄りは一度も引き返さない。
// 1 フレームでも継ぎ目があれば、必ずどこかで逆行する。
let back = 0;
for (let i = 1; i < path.length; i++) {
  if (path[i].y > path[i - 1].y + 0.004) back++;
  if (path[i].x > path[i - 1].x + 0.004) back++;
}
line('降下は一方向(引き返さない)', back === 0, `逆行 ${back} 回 / ${path.length - 1} 区間`);
if (process.argv.includes('--dump')) path.forEach((q,i)=>{ if(Math.abs(i-jAt)<4) console.log('   ',i,q.x.toFixed(2),q.y.toFixed(2),q.z.toFixed(2),q.yaw.toFixed(3)); });
line('降下の距離', moved > 2.5 && moved < 13, `${moved.toFixed(2)}m 下って寄った`);
line('着地 = プレイヤーの立ち位置', Math.abs(land.dx) < 0.02 && Math.abs(land.dz) < 0.02 && Math.abs(land.yaw) < 0.01,
  `Δx ${land.dx.toFixed(3)} Δz ${land.dz.toFixed(3)} Δyaw ${land.yaw.toFixed(4)}`);
line('例外なし', errs.length === 0, errs[0] || 'なし');
console.log(bad ? `${C.red}表題 ${bad} 件が要件を満たしていない${C.off}`
  : `${C.grn}ALL CLEAN — 表題は最初の一瞬になっている${C.off}`);
process.exit(bad ? 1 : 0);
