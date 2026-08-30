// ============================================================================
// stonestat.mjs — 石を「数字」で見る計器。第2パス(石)の採点に使う。
//
//   node tools/stonestat.mjs <iter> [view …] [--time t1am,t2noon]
//
// harmony.mjs と同じ分類マスクで画素を要素別に確定したうえで、要素ごとに
// **尺度別の局所コントラスト**(r = 1,2,4,8,16,32 px の局所SD)を出す。
//
// 「石が平ら」「絵画性が無い」は目では言えない。石の面には二つの尺度の情報が
// 要る — 石ひとつの大きさ(r 16〜32 = 目地と石の割り)と、骨材の粒
// (r 1〜4 = 面そのもの)。r 1〜4 が 0.01 を切っていたら、その面は
// 「塗った壁」であって石ではない。
//
// 目地の極性(skew)は高周波成分(r=3 の箱平均からの差)の**歪度**。
// 明るい面を細い暗い線が割る = 少数の強い負の外れ値 = **負の歪度**。
// 目地の法「目地は石より暗く」が守られていれば負になる。正なら明るい目地
// (= バスルームタイル)か、面のほうが疎らな斑になっている。
//
// 磨きと粗さの差は headroom(p99 − 中央値)で見る。磨いた床は掠め角で
// 鏡面の帯を持つので headroom が大きく、粗い壁は小さい。
// ============================================================================
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8765';

const RULES = [
  ['sky', /^sky\./], ['sea', /^sea\./],
  ['roof', /^house\.(roof|ridgeTile|gableFin)/],
  ['island', /^surround\.lokrum/],
  ['veg', /^surround\.pine|^life\.foliage/],
  ['mountain', /^ground\.far|^surround\.(fortImperial|srdjCross)/],
  ['stradun', /^ground\.stradun/],
  ['paving', /^ground\.(near|paving)/],
  ['wall', /^wall\./],
  ['facade', /^house\.(body|plinth|streetStone)|^monument\.stone/],
  ['steps', /^steps$/],
  ['life', /^life\./],
  ['other', /./],
];
const COL = {
  sky: 0xff0000, sea: 0x00ff00, roof: 0x0000ff, island: 0xffff00, veg: 0x00ffff,
  mountain: 0xff00ff, stradun: 0xff8000, paving: 0x80ff00, wall: 0xffffff,
  facade: 0x0080ff, steps: 0x8000ff, life: 0x808080, other: 0x004040, none: 0x000000,
};
const WANT = ['stradun', 'paving', 'wall', 'facade', 'steps', 'roof'];
const SCALES = [1, 2, 4, 8, 16, 32];

const views = [], times = [];
for (const raw of readFileSync(root + 'tools/campaign.txt', 'utf8').split('\n')) {
  const m = raw.replace(/\s+#.*$/, '').trim().match(/^(view|time)\s+(\S+)\s+(.+)$/);
  if (m) (m[1] === 'view' ? views : times).push({ name: m[2], spec: m[3].trim() });
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

console.log(`# ${iter} — 尺度別の局所SD(石の面に情報があるか)`);
console.log(`# ${'視点_時刻'.padEnd(20)} 要素      %画面 中央値 headroom   歪度  彩度   ${SCALES.map(s => ('r' + s).padStart(6)).join(' ')}`);
for (const v of views.filter(v => wantV.includes(v.name))) {
  for (const t of times.filter(t => wantT.includes(t.name))) {
    const p = v.spec.split(':');
    const extra = p.slice(4).join(':');
    await page.goto(`${BASE}/index.html?shot=1${extra}&hud=0&x=${p[0]}&z=${p[1]}&yaw=${p[2]}&pitch=${p[3]}&time=${t.spec}`,
      { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction('window.__READY === true', { timeout: 25000 });
    await new Promise(r => setTimeout(r, 1300));
    const res = await page.evaluate(async (RS, CS, WANTC, SC) => {
      const RULES2 = RS.map(([k, r]) => [k, new RegExp(r)]);
      const w = window.__world, T = w.THREE, gl = w.renderer.getContext();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const grab = () => { const px = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
      const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await frame();
      const real = grab();
      const saved = [], tm = w.renderer.toneMapping, fog = w.scene.fog;
      w.renderer.toneMapping = T.NoToneMapping; w.scene.fog = null;
      const hidden = [];
      w.scene.traverse(o => {
        if (!o.isMesh && !o.isInstancedMesh) return;
        // 半透明の飾り(灯だまり・煤の帯・窓の内法・噴水・雲)は「その画素の持ち主」
        // ではない。石を覆うのではなく染めている物なので、マスクでは描かない —
        // 持ち主は後ろの不透明な物。alphaTest で抜く物(葉・松)はこの限りでない。
        if (o.material && !(o.material.alphaTest > 0) && o.material.transparent) {
          hidden.push([o, o.visible]); o.visible = false; return;
        }
        let cls = 'other';
        for (const [k, re] of RULES2) if (re.test(o.name || '')) { cls = k; break; }
        saved.push([o, o.material, o.instanceColor]);
        if (o.instanceColor) o.instanceColor = null;
        // アルファで抜いている物(life.foliage alphaTest 0.45 / surround.pine 0.42)を
        // 不透明の板として描くと、葉のカードが四角いまま後ろの要素を食う
        // (実測 v2_alley で veg が 4.8% と出るが、実際の画では 1% 未満)。
        // **map のアルファだけ**を採る — RGB を掛けると分類色そのものが壊れる。
        const src0 = o.material;
        const mm = new T.MeshBasicMaterial({ color: CS[cls], fog: false,
          side: src0?.side ?? T.FrontSide, transparent: false, depthWrite: true,
          alphaTest: src0?.alphaTest ?? 0, map: src0?.alphaTest ? src0.map : null });
        if (src0?.alphaTest > 0 && src0.map) mm.onBeforeCompile = (sh) => {
          sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>',
            'diffuseColor.a *= texture2D( map, vMapUv ).a;');
        };
        o.material = mm;
      });
      w.renderer.setRenderTarget(null); w.renderer.render(w.scene, w.camera);
      const mask = grab();
      for (const [o, m, ic] of saved) { o.material = m; if (ic) o.instanceColor = ic; }
      for (const [o, vis] of hidden) o.visible = vis;
      w.renderer.toneMapping = tm; w.scene.fog = fog;

      // 輝度画像(リニア)と分類
      const s2l = v2 => (v2 <= 0.04045 ? v2 / 12.92 : ((v2 + 0.055) / 1.055) ** 2.4);
      const Y = new Float64Array(W * H), cls = new Uint8Array(W * H);
      const keys = Object.keys(CS);
      const sat = new Float64Array(W * H);
      for (let i = 0, q = 0; i < W * H; i++, q += 4) {
        const r = real[q] / 255, g = real[q + 1] / 255, b = real[q + 2] / 255;
        Y[i] = 0.2126 * s2l(r) + 0.7152 * s2l(g) + 0.0722 * s2l(b);
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        sat[i] = mx > 0 ? (mx - mn) / mx : 0;
        let best = 0, bd = 1e9;
        for (let k = 0; k < keys.length; k++) {
          const c = CS[keys[k]];
          const d = Math.abs(((c >> 16) & 255) - mask[q]) + Math.abs(((c >> 8) & 255) - mask[q + 1]) + Math.abs((c & 255) - mask[q + 2]);
          if (d < bd) { bd = d; best = k; }
        }
        cls[i] = bd > 60 ? 255 : best;
      }
      // 積分画像で尺度別の箱平均 → 局所SD
      const I = new Float64Array((W + 1) * (H + 1));
      for (let y = 0; y < H; y++) { let rs = 0;
        for (let x = 0; x < W; x++) { rs += Y[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + rs; } }
      const boxMean = (x, y, r) => {
        const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r);
        const x1 = Math.min(W - 1, x + r), y1 = Math.min(H - 1, y + r);
        const s = I[(y1 + 1) * (W + 1) + x1 + 1] - I[y0 * (W + 1) + x1 + 1] - I[(y1 + 1) * (W + 1) + x0] + I[y0 * (W + 1) + x0];
        return s / ((x1 - x0 + 1) * (y1 - y0 + 1));
      };
      const out = {};
      for (const name of WANTC) {
        const ci = keys.indexOf(name);
        if (ci < 0) continue;
        const vals = [], sds = SC.map(() => ({ s: 0, n: 0 }));
        let n = 0, satS = 0, dark = 0, hf = 0, n3 = 0;
        for (let y = 2; y < H - 2; y += 2) for (let x = 2; x < W - 2; x += 2) {
          const i = y * W + x;
          if (cls[i] !== ci) continue;
          n++; vals.push(Y[i]); satS += sat[i];
          for (let k = 0; k < SC.length; k++) {
            const d = Y[i] - boxMean(x, y, SC[k]);
            sds[k].s += d * d; sds[k].n++;
          }
          const d2 = Y[i] - boxMean(x, y, 3);
          hf += d2 * d2 * d2; dark += d2 * d2; n3++;
        }
        if (n < 400) continue;
        vals.sort((a, b) => a - b);
        const q = f => vals[Math.min(vals.length - 1, Math.floor(f * vals.length))];
        out[name] = {
          pct: +(100 * n / (W * H / 4)).toFixed(1), med: +q(0.5).toFixed(4),
          head: +(q(0.99) - q(0.5)).toFixed(4), sat: +(satS / n).toFixed(3),
          skew: n3 && dark > 0 ? +((hf / n3) / Math.pow(dark / n3, 1.5)).toFixed(2) : 0,
          sd: sds.map(o => +Math.sqrt(o.s / Math.max(1, o.n)).toFixed(4)),
        };
      }
      return out;
    }, RULES.map(([k, r]) => [k, r.source]), COL, WANT, SCALES);
    for (const [k, o] of Object.entries(res)) {
      console.log(`${(v.name + '_' + t.name).padEnd(21)} ${k.padEnd(8)} ${String(o.pct).padStart(5)}% `
        + ` ${o.med.toFixed(3)}  ${o.head.toFixed(3)}  ${String(o.skew).padStart(6)}  ${o.sat.toFixed(3)} `
        + ` ${o.sd.map(x => x.toFixed(4)).join(' ')}`);
    }
  }
}
await browser.close();
