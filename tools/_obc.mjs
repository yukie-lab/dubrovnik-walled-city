// _obc.mjs — onBeforeCompile の連鎖を検分する。
// 「このマテリアルに書いたはずのパッチが、本当に GLSL に届いているか」を、
// 目や絵ではなく **パッチ後の文字列** で確かめる。macroVariation のように
// 連鎖せず代入する patcher が一つでもあると、その前に書いた物は消える。
//   node tools/_obc.mjs [メッシュ名の部分一致 …]
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8765';
const want = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--use-angle=metal', '--no-sandbox'], protocolTimeout: 300000 });
const p = await b.newPage();
p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
await p.goto(`${BASE}/index.html?shot=1`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__world !== undefined', { timeout: 60000 });
const rows = await p.evaluate((want) => {
  const W = window.__world;
  // 本物のコンパイルを待たずに済むよう、three が渡すのと同じ形の偽シェーダに
  // include を並べて OBC を通す。置換が起きた印だけを読む。
  const INC = ['common', 'worldpos_vertex', 'color_fragment', 'map_fragment',
    'lights_fragment_end', 'dithering_fragment', 'normal_fragment_maps',
    'roughnessmap_fragment', 'emissivemap_fragment', 'begin_vertex', 'project_vertex',
    'fog_fragment', 'aomap_fragment', 'opaque_fragment', 'output_fragment', 'uv_vertex'];
  const fake = () => INC.map(n => `#include <${n}>`).join('\n');
  const MARK = [
    ['macro', /uMacro\b/], ['specClamp', /3\.2 \/ pk/], ['skyVis', /vSkyV\b/],
    ['triplanar', /mapScrub\b/], ['wet', /vWetP\b|uWetTime\b/],
  ];
  const out = [], seen = new Set();
  for (const root of W.solids) root.traverse(o => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) {
      if (!m || !o.name) continue;
      if (want.length && !want.some(w => o.name.includes(w))) continue;
      const key = o.name + '|' + m.uuid;
      if (seen.has(key)) continue; seen.add(key);
      const sh = { vertexShader: fake(), fragmentShader: fake(), uniforms: {}, defines: {} };
      let err = '';
      try { if (m.onBeforeCompile) m.onBeforeCompile.call(m, sh, W.renderer); }
      catch (e) { err = String(e).slice(0, 80); }
      const src = sh.vertexShader + '\n' + sh.fragmentShader;
      out.push({ name: o.name, obc: !!m.onBeforeCompile, err,
        has: MARK.filter(([, re]) => re.test(src)).map(([k]) => k).join(',') || '(なし)' });
    }
  });
  return out;
}, want);
for (const r of rows) console.log(`${r.name.padEnd(24)} obc=${r.obc ? 'あり' : 'なし'}  パッチ: ${r.has}${r.err ? '  [' + r.err + ']' : ''}`);
await b.close();
