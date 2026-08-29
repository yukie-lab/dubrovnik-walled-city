// ============================================================================
// harmony.mjs — 「調和の門」の計器。要素ごとに画素を分類して測る。
//
//   node tools/harmony.mjs <iter> [view …] [--time t1am,t3gold]
//
// 同じ定点を 2 回描く:
//   ① 本番の絵(ポスト込み)
//   ② 部位ごとの平坦な色(トーンマップ・霧を切った分類マスク)
// ②で「この画素は屋根/海/石/空/植生/山/島/生活」を確定し、①からその集合の
// リニア輝度・彩度・色相・B/R を出す。**目で「海が濁った」と言わない。**
// 石灰岩と空と海と屋根の関係が、パスの前後でどう動いたかを数字で見る。
// ============================================================================
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8765';

// 部位 → 分類。上から順に最初に当たったものを採る。
const RULES = [
  ['sky', /^sky\./], ['sea', /^sea\./],
  ['roof', /^house\.(roof|ridgeTile|gableFin)/],
  ['island', /^surround\.lokrum/],
  ['veg', /^surround\.pine|^life\.foliage/],
  ['mountain', /^ground\.far|^surround\.(fortImperial|srdjCross)/],
  ['stradun', /^ground\.stradun/],
  ['life', /^life\./],
  ['stone', /./],
];
const COL = {
  sky: 0xff0000, sea: 0x00ff00, roof: 0x0000ff, island: 0xffff00, veg: 0x00ffff,
  mountain: 0xff00ff, stradun: 0xff8000, life: 0x8000ff, stone: 0xffffff, none: 0x000000,
};

const views = [], times = [];
// 定点の定義ファイル。campaign.txt はキャンペーン全体で凍結されているので、
// パス固有の診断視点は --views で別ファイルを渡す(採点表は定点のまま)。
const vfArg = process.argv.indexOf('--views');
const VIEWFILE = vfArg >= 0 ? process.argv.splice(vfArg, 2)[1] : 'tools/campaign.txt';
for (const raw of readFileSync(root + VIEWFILE, 'utf8').split('\n')) {
  const line = raw.replace(/\s+#.*$/, '').trim();
  const m = line.match(/^(view|time)\s+(\S+)\s+(.+)$/);
  if (!m) continue;
  (m[1] === 'view' ? views : times).push({ name: m[2], spec: m[3].trim() });
}
const argv = process.argv.slice(2);
const iter = argv.shift() || '(現在)';
let wantT = times.map(t => t.name), wantV = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--time') wantT = argv[++i].split(','); else wantV.push(argv[i]);
}
if (!wantV.length) wantV = views.map(v => v.name);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--use-angle=metal', '--window-size=1240,800'] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 760, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));

const rows = [];
for (const v of views.filter(v => wantV.includes(v.name))) {
  for (const t of times.filter(t => wantT.includes(t.name))) {
    const p = v.spec.split(':');
    const extra = p.slice(4).join(':');
    const url = `${BASE}/index.html?shot=1${extra}&hud=0&x=${p[0]}&z=${p[1]}&yaw=${p[2]}&pitch=${p[3]}&time=${t.spec}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction('window.__READY === true', { timeout: 25000 });
    await new Promise(r => setTimeout(r, 1300));
    const res = await page.evaluate(async (RULES_S, COL_S) => {
      const RULES2 = RULES_S.map(([k, r]) => [k, new RegExp(r)]);
      const COL2 = COL_S;
      const w = window.__world, T = w.THREE, gl = w.renderer.getContext();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const grab = () => { const px = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
      const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await frame();
      const real = grab();                                     // ① 本番の絵
      // ② 分類マスク。トーンマップを切ると material.color の hex がそのまま画素になる。
      const saved = [], tm = w.renderer.toneMapping, fog = w.scene.fog;
      w.renderer.toneMapping = T.NoToneMapping; w.scene.fog = null;
      w.scene.traverse(o => {
        if (!o.isMesh && !o.isInstancedMesh) return;
        let cls = 'stone';
        for (const [k, re] of RULES2) if (re.test(o.name || '')) { cls = k; break; }
        // InstancedMesh の instanceColor は材質色に **必ず掛かる**(material.vertexColors とは無関係)。
        // 屋根の橙の個体差がそのまま分類色を壊し、屋根が 0.2% しか数えられなかった。
        saved.push([o, o.material, o.instanceColor]);
        if (o.instanceColor) o.instanceColor = null;
        o.material = new T.MeshBasicMaterial({ color: COL2[cls], fog: false,
          side: o.material?.side ?? T.FrontSide, transparent: false, depthWrite: true });
      });
      w.renderer.setRenderTarget(null);
      w.renderer.render(w.scene, w.camera);
      const mask = grab();
      for (const [o, m, ic] of saved) { o.material = m; if (ic) o.instanceColor = ic; }
      w.renderer.toneMapping = tm; w.scene.fog = fog;
      // 分類 → 集計
      const keys = Object.keys(COL2);
      const acc = {}; for (const k of keys) acc[k] = { n: 0, Y: 0, r: 0, g: 0, b: 0, sat: 0 };
      const s2l = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      for (let i = 0; i < W * H * 4; i += 4) {
        const mr = mask[i], mg = mask[i + 1], mb = mask[i + 2];
        let best = null, bd = 1e9;
        for (const k of keys) {
          const c = COL2[k], d = Math.abs(((c >> 16) & 255) - mr) + Math.abs(((c >> 8) & 255) - mg) + Math.abs((c & 255) - mb);
          if (d < bd) { bd = d; best = k; }
        }
        if (bd > 60) continue;                                  // 縁(AA)は捨てる
        const a = acc[best];
        const r = real[i] / 255, g = real[i + 1] / 255, b = real[i + 2] / 255;
        a.n++; a.Y += 0.2126 * s2l(r) + 0.7152 * s2l(g) + 0.0722 * s2l(b);
        a.r += r; a.g += g; a.b += b;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        a.sat += mx > 0 ? (mx - mn) / mx : 0;
      }
      const out = {};
      for (const k of keys) { const a = acc[k]; if (a.n < W * H * 0.0006) continue;
        out[k] = { pct: +(100 * a.n / (W * H)).toFixed(1), Y: +(a.Y / a.n).toFixed(4),
          BR: +((a.b / a.n) / Math.max(1e-4, a.r / a.n)).toFixed(3), sat: +(a.sat / a.n).toFixed(3) }; }
      return out;
    }, RULES.map(([k, r]) => [k, r.source]), COL);
    rows.push([`${v.name}_${t.name}`, res]);
    const s = Object.entries(res).map(([k, o]) => `${k} ${o.pct}% Y${o.Y} B/R${o.BR} S${o.sat}`).join('  ');
    console.log(`${(v.name + '_' + t.name).padEnd(20)} ${s}`);
  }
}
// 関係の要約(調和の門で毎回問われるもの)
console.log('\n--- 関係(調和の門)---');
for (const [name, r] of rows) {
  const rel = [];
  if (r.roof && r.sea) rel.push(`屋根/海 Y比 ${(r.roof.Y / Math.max(1e-4, r.sea.Y)).toFixed(2)} 彩度差 ${(r.roof.sat - r.sea.sat).toFixed(3)}`);
  if (r.stone && r.sky) rel.push(`石/空 Y比 ${(r.stone.Y / Math.max(1e-4, r.sky.Y)).toFixed(2)}`);
  if (r.veg && r.sea) rel.push(`植生/海 Y比 ${(r.veg.Y / Math.max(1e-4, r.sea.Y)).toFixed(2)}`);
  if (r.sea && r.sky) rel.push(`海/空 Y比 ${(r.sea.Y / Math.max(1e-4, r.sky.Y)).toFixed(2)} ΔB/R ${(r.sea.BR - r.sky.BR).toFixed(2)}`);
  if (r.mountain && r.sky) rel.push(`山/空 Y比 ${(r.mountain.Y / Math.max(1e-4, r.sky.Y)).toFixed(2)}`);
  if (rel.length) console.log(`${name.padEnd(20)} ${rel.join('  ')}`);
}
await browser.close();
