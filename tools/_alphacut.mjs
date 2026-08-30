// アルファで抜いている材質を洗い出す。分類マスクを描く計器(harmony / stonestat)は
// これを再現しないと、葉や布が「四角い板」になって後ろの要素を食う。
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--use-angle=metal', '--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__world !== undefined', { timeout: 60000 });
console.log(await p.evaluate(() => {
  const w = window.__world, seen = new Map();
  w.scene.traverse(o => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) {
      if (!m) continue;
      if (!(m.alphaTest > 0) && !m.transparent) continue;
      const k = `${o.name}`;
      if (!seen.has(k)) seen.set(k, `${o.name.padEnd(22)} alphaTest=${m.alphaTest} transparent=${m.transparent} map=${!!m.map} alphaMap=${!!m.alphaMap} mapFmt=${m.map ? (m.map.format === 1023 ? 'RGBA' : m.map.format) : '-'}`);
    }
  });
  return [...seen.values()].join('\n');
}));
await b.close();
