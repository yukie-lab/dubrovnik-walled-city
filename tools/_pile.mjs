// 開幕(ピレ門・7.1時)で「何人が見えていて、何人が歩く体で、何人が今動いているか」。
// そして時計が進むあいだに「何人が突然現れるか」。
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8765';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--use-angle=metal', '--no-sandbox'], protocolTimeout: 300000 });
const p = await b.newPage();
p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
const probe = () => p.evaluate(() => {
  const w = window.__world, L = w.life, S = w.worldState;
  const cam = w.camera.position;
  const F = L.folk || [];
  const near = F.filter(f => Math.hypot(f.x - cam.x, f.z - cam.z) < 45);
  const on = f => !f._off;
  return {
    time: S.time,
    all: F.length, allOn: F.filter(on).length,
    near: near.length, nearOn: near.filter(on).length,
    nearOnWalkers: near.filter(f => on(f) && f.walk).length,
    nearOnSit: near.filter(f => on(f) && f.sit).length,
    onIds: F.map((f, i) => on(f) ? i : -1).filter(i => i >= 0),
  };
});
const t0 = await probe();
const seen = [t0];
for (let k = 0; k < 6; k++) { await new Promise(r => setTimeout(r, 10000)); seen.push(await probe()); }
console.log(`${'時刻'.padStart(6)} ${'居る/全'.padStart(10)} ${'45m内 居る/全'.padStart(14)} ${'うち歩く体'.padStart(10)} ${'うち座'.padStart(7)} ${'10秒で新たに現れた'.padStart(18)}`);
let prev = null;
for (const s of seen) {
  const added = prev ? s.onIds.filter(i => !prev.includes(i)).length : 0;
  console.log(`${s.time.toFixed(2).padStart(6)} ${(s.allOn + '/' + s.all).padStart(10)} ${(s.nearOn + '/' + s.near).padStart(14)} ${String(s.nearOnWalkers).padStart(10)} ${String(s.nearOnSit).padStart(7)} ${String(added).padStart(18)}`);
  prev = s.onIds;
}
await b.close();
