// ============================================================================
// arctest.mjs — 時刻の弧が「ポインタに付いてくる」かを実機で測る。
//
//   node tools/arctest.mjs
//
// 実際にブラウザを開き、Start を押し、ポインタロックを外して弧をドラッグし、
//   (1) ポインタの x → 設定された時刻    (写像が正しいか)
//   (2) その時刻 → 描かれた太陽の x      (描画が写像と一致するか)
// の両方を実ピクセルで確かめる。片方だけ正しくても印はポインタから外れる。
//
// 以前は x を弧の角度から出していたので、半径が高さで頭打ち(74px)になって
// 印は全幅の 50% しか動けず、しかも余弦分布・日没の先でクランプ。
// ポインタとの最大ずれは 296px 中 76px あった。
// ============================================================================
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8765';
const TOL = 3.0;   // 実ピクセル。太陽の円の縁のアンチエイリアスで ±0.5 出る

const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--use-angle=metal', '--window-size=1400,900'] });
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
await p.goto(`${BASE}/index.html?x=-140&z=0&yaw=-1.6`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
await p.evaluate(() => document.getElementById('btnStart')?.click());
await new Promise(r => setTimeout(r, 1200));

const box = await (await p.$('#timeCtl')).boundingBox();
const rows = [];
for (const f of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]) {
  const px = box.x + 10 + (box.width - 20) * f, py = box.y + 26;
  // ポインタロック中は DOM がイベントを受け取らない(実機では Esc で外す)
  await p.evaluate(() => document.exitPointerLock?.());
  await new Promise(r => setTimeout(r, 60));
  // ポインタロックの取り直しが挟まると 1 回目のドラッグが落ちることがある。
  // 「時刻が動いたか」を見て、動かなければ 1 度だけやり直す(計器側の都合)。
  const before = await p.evaluate(() => document.getElementById('timeLabel').textContent);
  for (let attempt = 0; attempt < 3; attempt++) {
    await p.mouse.move(px, py); await p.mouse.down(); await p.mouse.move(px, py); await p.mouse.up();
    await new Promise(r2 => setTimeout(r2, 260));   // 弧は次のフレームで描き直される
    const now = await p.evaluate(() => document.getElementById('timeLabel').textContent);
    if (now !== before) break;
    await p.evaluate(() => document.exitPointerLock?.());
    await new Promise(r2 => setTimeout(r2, 140));
  }
  const r = await p.evaluate(() => {
    const c = document.getElementById('timeArc');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let sx = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 120) continue;
      const R = d[i], G = d[i + 1], B = d[i + 2];
      const day = R > 220 && G > 160 && G < 215 && B > 70 && B < 150;
      const night = R > 170 && R < 225 && G > 175 && G < 230 && B > 200;
      if (day || night) { sx += ((i / 4) % c.width); n++; }
    }
    return { sx: n ? sx / n : -1, w: c.width, label: document.getElementById('timeLabel').textContent,
      rect: c.getBoundingClientRect().toJSON() };
  });
  rows.push({ f, px, r });
}
await b.close();

const { TIME_T0, TIME_T1 } = await import('../src/ui.js').catch(() => ({}));
const T0 = TIME_T0 ?? 4.7, T1 = TIME_T1 ?? 23.6;
const C = { red: '\x1b[31m', grn: '\x1b[32m', dim: '\x1b[2m', off: '\x1b[0m' };
let bad = 0;
console.log(`\n時刻の弧 — ドラッグ 6 点  ${C.dim}(許容 ${TOL}px / キャンバス幅 296)${C.off}`);
for (const { f, px, r } of rows) {
  const pointerX = ((px - r.rect.left) / r.rect.width) * r.w;
  const [hh, mm] = r.label.split(':').map(Number);
  const tNow = hh + mm / 60;
  const wantT = T0 + ((pointerX - 10) / (r.w - 20)) * (T1 - T0);
  const wantX = 10 + ((tNow - T0) / (T1 - T0)) * (r.w - 20);
  const eT = Math.abs(tNow - wantT) * 60;        // 分
  const eX = Math.abs(r.sx - wantX);             // px
  const ok = eT < 12 && eX < TOL;                // 時計は測る間も進むので 12 分見る
  if (!ok) bad++;
  console.log(`  ${(f * 100).toFixed(0).padStart(3)}%  ${r.label}`
    + ` ${C.dim}(狙い ${wantT.toFixed(2)})${C.off}  写像のずれ ${eT.toFixed(1).padStart(4)}分`
    + `  描画のずれ ${eX.toFixed(1).padStart(4)}px  ${ok ? '✅' : C.red + '❌' + C.off}`);
}
console.log(bad ? `${C.red}弧がポインタに付いてこない ${bad} / ${rows.length} 点${C.off}`
  : `${C.grn}ALL CLEAN — 印はポインタに付いてくる${C.off}`);
process.exit(bad ? 1 : 0);
