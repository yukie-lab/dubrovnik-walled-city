// 雲アトラスの実画素を読み、セルの縁で切れているかを数える。
//   node tools/_cloudatlas.mjs [出力名]
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'fs';
const NAME = process.argv[2] || 'cloudatlas';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new', '--use-angle=metal', '--no-sandbox'], protocolTimeout: 300000 });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&hud=0&time=10', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
const out = await p.evaluate(() => {
  let mesh = null;
  window.__world.scene.traverse((o) => { if (o.name === 'sky.clouds') mesh = o; });
  const img = mesh.material.uniforms.uTex.value.image;
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const cx2 = cv.getContext('2d');
  cx2.drawImage(img, 0, 0);
  const D = cx2.getImageData(0, 0, cv.width, cv.height).data;
  const S = cv.width, cell = S / 2;
  const A = (x, y) => D[(y * S + x) * 4 + 3] / 255;
  const rows = [];
  for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) {
    const ox = cx * cell, oy = cy * cell;
    // 画像は左上が原子。セルの上辺 = oy、下辺 = oy+cell-1
    const edge = (name, pts) => {
      let n = 0, mx = 0;
      for (const [x, y] of pts) { const a = A(x, y); if (a > 0.02) n++; mx = Math.max(mx, a); }
      return { name, frac: n / pts.length, max: mx };
    };
    const top = [], bot = [], left = [], right = [];
    for (let i = 0; i < cell; i++) {
      top.push([ox + i, oy]); bot.push([ox + i, oy + cell - 1]);
      left.push([ox, oy + i]); right.push([ox + cell - 1, oy + i]);
    }
    rows.push({ cell: `${cx},${cy}`,
      top: edge('上', top), bottom: edge('下', bot), left: edge('左', left), right: edge('右', right) });
  }
  return { png: cv.toDataURL('image/png'), rows, size: S };
});
writeFileSync(`shots/${NAME}.png`, Buffer.from(out.png.split(',')[1], 'base64'));
console.log(`アトラス ${out.size}px → shots/${NAME}.png`);
console.log('セル  縁で切れている割合(その辺の画素のうち α>0.02) / 最大α');
for (const r of out.rows) {
  const f = (e) => `${e.name} ${(e.frac * 100).toFixed(1)}%(α${e.max.toFixed(2)})`;
  console.log(`  ${r.cell}  ${f(r.top)}  ${f(r.left)}  ${f(r.right)}  ${f(r.bottom)}`);
}
await b.close();
