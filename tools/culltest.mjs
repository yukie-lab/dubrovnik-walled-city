// ============================================================================
// culltest.mjs — 「裏から見ると消える面」を全視点で洗い出す計器。
//
//   node tools/culltest.mjs                 shots.txt の定点すべて
//   node tools/culltest.mjs name:x:z:yaw:pitch:time[:extra] …
//
// 同じ視点を FrontSide と DoubleSide の二回描いて、ピクセルを突き合わせる。
// 違うピクセル = 「そこに面はあるのに、こちらを向いている面が無い」場所。
//   ・二枚の平行な面を同じ巻きで張った(片方が裏を向いて消える)
//   ・厚みを付けたつもりで、片面しか無い
//   ・閉じていない殻の内側が見えている
// つまり「石が板」「中が空洞」の全部を、目ではなくピクセル数で数える。
//
// 目視で探すのをやめるための計器。差分が 0 になれば、その視点に板は無い。
// ============================================================================
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';

const W = 1600, H = 1000;
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

let specs = process.argv.slice(2).filter(s => !s.startsWith('--'));
if (!specs.length) {
  specs = readFileSync(new URL('./shots.txt', import.meta.url).pathname, 'utf8')
    .split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
}
const KEEP = process.argv.includes('--png');

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new', '--use-angle=metal', '--window-size=1640,1060'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });

let worst = [];
for (const spec of specs) {
  const [name, x, z, yaw, pitch, time, extra] = spec.split(':');
  const url = `http://localhost:8765/index.html?shot=1${extra || ''}&hud=0`
    + `&x=${x}&z=${z}&yaw=${yaw}&pitch=${pitch}&time=${time}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY === true', { timeout: 40000 });
  await new Promise(r => setTimeout(r, 1200));

  const res = await page.evaluate(() => {
    const { THREE, scene, camera, renderer } = window.__world;
    const cv = document.createElement('canvas');
    cv.width = renderer.domElement.width; cv.height = renderer.domElement.height;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    const grab = () => {
      renderer.render(scene, camera);
      cx.drawImage(renderer.domElement, 0, 0);
      return cx.getImageData(0, 0, cv.width, cv.height);
    };
    // 1) いまの設定(表面のみ)
    const A = grab();
    // 2) 全マテリアルを両面に。背景(天蓋・海・雲)は対象外 — 裏から見る場所が
    //    無いので差が出ても意味が無い。
    const SKIP = /^(sky\.|sea\.|life\.(swift|gull|bird|pigeon)|.*shadow.*|.*Pool$|.*Ripple$|.*Jet$)/;
    const undo = [];
    scene.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      if (SKIP.test(o.name || '') || SKIP.test(o.userData?.tag || '')) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (!m || m.side === THREE.DoubleSide) continue;
        // side を変えると shadowSide の既定値も変わり、影の落ち方まで変わる。
        // それを差分に数えると「天井に帯がある」ような偽の指摘が出る(実測
        // ミンチェタで 11,302px)。影は動かさないよう明示して固定する。
        undo.push([m, m.side, m.shadowSide]);
        m.shadowSide = THREE.BackSide;
        m.side = THREE.DoubleSide; m.needsUpdate = true;
      }
    });
    const B = grab();
    // 影を固定した状態の「表面のみ」を基準にする(A は既定の影で描かれている)。
    for (const [m] of undo) { m.side = THREE.FrontSide; m.needsUpdate = true; }
    const A2 = grab();
    for (const [m] of undo) { m.side = THREE.DoubleSide; m.needsUpdate = true; }
    // 3) 突き合わせ
    const a = A2.data, b = B.data, n = cv.width * cv.height;
    const mask = new Uint8Array(n);
    let diff = 0;
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      const d = Math.max(Math.abs(a[j] - b[j]), Math.abs(a[j + 1] - b[j + 1]), Math.abs(a[j + 2] - b[j + 2]));
      if (d > 14) { mask[i] = 1; diff++; }
    }
    // 4) 塊に分けて、大きいものから重心を返す(そのまま _look.mjs へ渡せる)
    const lab = new Int32Array(n).fill(-1);
    const blobs = [];
    const stack = new Int32Array(n);
    for (let s = 0; s < n; s++) {
      if (!mask[s] || lab[s] >= 0) continue;
      const id = blobs.length; let sp = 0; stack[sp++] = s; lab[s] = id;
      let cnt = 0, sx = 0, sy = 0;
      while (sp) {
        const p = stack[--sp]; cnt++;
        const px = p % cv.width, py = (p - px) / cv.width;
        sx += px; sy += py;
        for (const q of [p - 1, p + 1, p - cv.width, p + cv.width]) {
          if (q < 0 || q >= n || !mask[q] || lab[q] >= 0) continue;
          if ((q === p - 1 && px === 0) || (q === p + 1 && px === cv.width - 1)) continue;
          lab[q] = id; stack[sp++] = q;
        }
      }
      blobs.push({ n: cnt, x: Math.round(sx / cnt), y: Math.round(sy / cnt) });
    }
    blobs.sort((p, q) => q.n - p.n);
    // 5) 塊ごとに「どの作り方の面か」を答える。両面のまま射線を飛ばす —
    //    表面だけだとその面が無いので、当たるのは背後の別物になる。
    const rc = new THREE.Raycaster();
    rc.far = 400;
    for (const bl of blobs.slice(0, 8)) {
      const nx = (bl.x / cv.width) * 2 - 1, ny = -((bl.y / cv.height) * 2 - 1);
      rc.setFromCamera({ x: nx, y: ny }, camera);
      const hit = rc.intersectObjects(scene.children, true)
        .find(h => h.object.isMesh || h.object.isInstancedMesh);
      if (!hit) { bl.who = '?'; continue; }
      const o = hit.object;
      let pn = '';
      const ps = o.geometry?.userData?.parts;
      if (ps && hit.faceIndex != null) for (const q of ps) if (hit.faceIndex >= q.from && hit.faceIndex < q.to) pn = '/' + q.name;
      bl.who = (o.name || o.userData?.tag || o.type) + pn;
    }
    // 6) 重ね絵(表面のみの絵に、消えていた場所をマゼンタで乗せる)
    cx.putImageData(A2, 0, 0);
    const ov = cx.getImageData(0, 0, cv.width, cv.height);
    for (let i = 0; i < n; i++) if (mask[i]) { ov.data[i * 4] = 255; ov.data[i * 4 + 1] = 0; ov.data[i * 4 + 2] = 190; }
    cx.putImageData(ov, 0, 0);
    const png = cv.toDataURL('image/png');
    for (const [m, s2, sh] of undo) { m.side = s2; m.shadowSide = sh; m.needsUpdate = true; }
    return { diff, total: n, blobs: blobs.slice(0, 8), png,
      scale: cv.width / 1600 };
  });

  const pct = (res.diff / res.total) * 100;
  worst.push({ name, pct, blobs: res.blobs, spec, scale: res.scale });
  const tag = pct > 0.5 ? '\x1b[31m' : pct > 0.05 ? '\x1b[33m' : '\x1b[32m';
  console.log(`${tag}${name.padEnd(20)} 消えている面 ${pct.toFixed(3)}%\x1b[0m`
    + (res.blobs.length ? '\n      ' + res.blobs.slice(0, 5)
      .map(b => `${String(b.n).padStart(6)}px ${b.who || '?'} @(${Math.round(b.x / res.scale)},${Math.round(b.y / res.scale)})`).join('\n      ') : ''));
  if (KEEP && res.diff) {
    writeFileSync(`${OUT}cull_${name}.png`, Buffer.from(res.png.split(',')[1], 'base64'));
  }
}
await browser.close();
worst.sort((a, b) => b.pct - a.pct);
const bad = worst.filter(w => w.pct > 0.02);
console.log(`\n${bad.length ? '\x1b[31m' : '\x1b[32m'}裏から見ると消える面: ${bad.length} 視点 / ${worst.length}\x1b[0m`);
process.exit(bad.length ? 1 : 0);
