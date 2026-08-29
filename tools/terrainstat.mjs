// ============================================================================
// terrainstat.mjs — 山と島の計器。第4パス(山と島)の採点に使う。
//
//   node tools/terrainstat.mjs <iter> [view …] [--time t2noon]
//
// 面(スルジ山・ロクルム島の地面)と 輪郭(松と糸杉)は別の物差しで測る。
//
// 【面】尺度別の局所SD を中央値で割った相対値。r1〜r4 = 岩肌と灌木そのもの、
//       r16〜r64 = 岩盤の露頭とマキの群れ。**どの尺度にも情報が無ければ「板」。**
//       あわせて空との輝度比(空気遠近が逆転していないか)と CIELAB。
//
// 【輪郭】silK = 輪郭画素 ÷ 面積。**塊は小さく、一本ずつ立つ木は大きい。**
//         silΔY = 海や空と接している輪郭を跨ぐ輝度差の平均(= シルエットの強さ)。
//         明るい海を背にした糸杉は、この二つが両方大きくなければならない。
// ============================================================================
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8765';
const SCALES = [1, 2, 4, 8, 16, 32, 64];

const RULES = [
  ['sky', /^sky\./], ['sea', /^sea\./],
  ['veg', /^surround\.pine|^life\.foliage/],
  ['island', /^surround\.lokrum/],
  ['mountain', /^ground\.far|^surround\.(fortImperial|srdjCross)/],
  ['roof', /^house\.(roof|ridgeTile|gableFin)/],
  ['other', /./],
];
const COL = { sky: 0xff0000, sea: 0x00ff00, veg: 0x00ffff, island: 0xffff00,
  mountain: 0xff00ff, roof: 0x0000ff, other: 0x808080, none: 0x000000 };
const SURF = ['mountain', 'island'];

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

console.log(`# ${iter} — 山と島。面は尺度別の情報、木は輪郭で測る。`);
console.log(`# ${'視点_時刻'.padEnd(20)} 要素     %画面  中央値 /空Y比  L*/C*/h°       ${SCALES.map(s => ('r' + s).padStart(6)).join('')}   silK  silΔY`);
for (const v of views.filter(v => wantV.includes(v.name))) {
  for (const t of times.filter(t => wantT.includes(t.name))) {
    const p = v.spec.split(':');
    const extra = p.slice(4).join(':');
    await page.goto(`${BASE}/index.html?shot=1${extra}&hud=0&x=${p[0]}&z=${p[1]}&yaw=${p[2]}&pitch=${p[3]}&time=${t.spec}`,
      { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction('window.__READY === true', { timeout: 25000 });
    await new Promise(r => setTimeout(r, 1300));
    const res = await page.evaluate(async (RS, CS, SC, SURFC) => {
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
      w.scene.traverse(o => {
        if (!o.isMesh && !o.isInstancedMesh) return;
        let cls = 'other';
        for (const [k, re] of RULES2) if (re.test(o.name || '')) { cls = k; break; }
        saved.push([o, o.material, o.instanceColor]);
        if (o.instanceColor) o.instanceColor = null;
        o.material = new T.MeshBasicMaterial({ color: CS[cls], fog: false,
          side: o.material?.side ?? T.FrontSide });
      });
      w.renderer.setRenderTarget(null); w.renderer.render(w.scene, w.camera);
      const mask = grab();
      for (const [o, m, ic] of saved) { o.material = m; o.instanceColor = ic || null; }
      w.renderer.toneMapping = tm; w.scene.fog = fog;

      const s2l = q => (q <= 0.04045 ? q / 12.92 : ((q + 0.055) / 1.055) ** 2.4);
      const f = q => (q > 0.008856 ? Math.cbrt(q) : 7.787 * q + 16 / 116);
      const lab = (r, g, b) => { const R = s2l(r), G = s2l(g), B = s2l(b);
        const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
        const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
        return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]; };
      const keys = Object.keys(CS);
      const cls = new Uint8Array(W * H), Ys = new Float64Array(W * H);
      const Ls = new Float64Array(W * H), As = new Float64Array(W * H), Bs = new Float64Array(W * H);
      for (let i = 0, q = 0; i < W * H; i++, q += 4) {
        let best = 0, bd = 1e9;
        for (let k = 0; k < keys.length; k++) { const c = CS[keys[k]];
          const d = Math.abs(((c >> 16) & 255) - mask[q]) + Math.abs(((c >> 8) & 255) - mask[q + 1]) + Math.abs((c & 255) - mask[q + 2]);
          if (d < bd) { bd = d; best = k; } }
        cls[i] = bd > 60 ? 255 : best;
        const r = real[q] / 255, g = real[q + 1] / 255, b = real[q + 2] / 255;
        Ys[i] = 0.2126 * s2l(r) + 0.7152 * s2l(g) + 0.0722 * s2l(b);
        const L = lab(r, g, b); Ls[i] = L[0]; As[i] = L[1]; Bs[i] = L[2];
      }
      const idOf = n => keys.indexOf(n);
      const meanY = (n) => { const c = idOf(n); let s = 0, k = 0;
        for (let i = 0; i < W * H; i++) if (cls[i] === c) { s += Ys[i]; k++; }
        return k ? s / k : 0; };
      const skyY = meanY('sky');
      // 積分画像(クラス限定)
      const out = {};
      for (const name of SURFC) {
        const ci = idOf(name); let n = 0;
        for (let i = 0; i < W * H; i++) if (cls[i] === ci) n++;
        if (n < 2500) continue;
        const I = new Float64Array((W + 1) * (W ? H + 1 : 1)), Ic = new Float64Array((W + 1) * (H + 1));
        for (let y = 0; y < H; y++) { let rs = 0, rc = 0;
          for (let x = 0; x < W; x++) { const i = y * W + x; const on = cls[i] === ci ? 1 : 0;
            rs += Ls[i] * on; rc += on;
            I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + rs;
            Ic[(y + 1) * (W + 1) + x + 1] = Ic[y * (W + 1) + x + 1] + rc; } }
        const box = (A, x, y, r) => { const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r);
          const x1 = Math.min(W - 1, x + r), y1 = Math.min(H - 1, y + r);
          return A[(y1 + 1) * (W + 1) + x1 + 1] - A[y0 * (W + 1) + x1 + 1] - A[(y1 + 1) * (W + 1) + x0] + A[y0 * (W + 1) + x0]; };
        const vals = [], sds = SC.map(() => ({ s: 0, n: 0 }));
        let sL = 0, sA = 0, sB = 0, k2 = 0;
        for (let y = 1; y < H - 1; y += 2) for (let x = 1; x < W - 1; x += 2) {
          const i = y * W + x; if (cls[i] !== ci) continue;
          vals.push(Ys[i]); sL += Ls[i]; sA += As[i]; sB += Bs[i]; k2++;
          for (let j = 0; j < SC.length; j++) { const cn = box(Ic, x, y, SC[j]); if (cn < 8) continue;
            const d = Ls[i] - box(I, x, y, SC[j]) / cn; sds[j].s += d * d; sds[j].n++; }
        }
        vals.sort((a, b) => a - b);
        const med = vals[Math.floor(vals.length / 2)];
        const aM = sA / k2, bM = sB / k2;
        out[name] = { pct: +(100 * n / (W * H)).toFixed(1), med: +med.toFixed(4),
          vsSky: +(med / Math.max(1e-4, skyY)).toFixed(2),
          L: +(sL / k2).toFixed(1), C: +Math.hypot(aM, bM).toFixed(1),
          h: +(((Math.atan2(bM, aM) * 180 / Math.PI) + 360) % 360).toFixed(1),
          sd: sds.map(o => +Math.sqrt(o.s / Math.max(1, o.n)).toFixed(3)) };
      }
      // 輪郭(植生・島)— 海/空と接する境界
      const silhouette = (name) => {
        const ci = idOf(name), seaI = idOf('sea'), skyI = idOf('sky');
        let area = 0, bnd = 0, dsum = 0, dn = 0, sL = 0, sA = 0, sB = 0;
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          const i = y * W + x; if (cls[i] !== ci) continue;
          area++; sL += Ls[i]; sA += As[i]; sB += Bs[i];
          let isB = false;
          for (const j of [i - 1, i + 1, i - W, i + W]) {
            if (cls[j] !== ci) isB = true;
            if (cls[j] === seaI || cls[j] === skyI) { dsum += Math.abs(Ls[i] - Ls[j]); dn++; }
          }
          if (isB) bnd++;
        }
        if (area < 1200) return null;
        const aM = sA / area, bM = sB / area;
        return { pct: +(100 * area / (W * H)).toFixed(1), silK: +(bnd / area).toFixed(3),
          silD: dn ? +(dsum / dn).toFixed(1) : 0, L: +(sL / area).toFixed(1),
          C: +Math.hypot(aM, bM).toFixed(1), h: +(((Math.atan2(bM, aM) * 180 / Math.PI) + 360) % 360).toFixed(1) };
      };
      return { surf: out, veg: silhouette('veg'), islandSil: silhouette('island'), mountSil: silhouette('mountain') };
    }, RULES.map(([k, r]) => [k, r.source]), COL, SCALES, SURF);
    const tag = `${v.name}_${t.name}`;
    for (const [k, o] of Object.entries(res.surf)) {
      const sil = k === 'mountain' ? res.mountSil : res.islandSil;
      console.log(`${tag.padEnd(21)} ${k.padEnd(8)} ${String(o.pct).padStart(5)}%  ${o.med.toFixed(3)}  ${o.vsSky.toFixed(2)}  `
        + `${o.L.toFixed(1).padStart(5)}/${o.C.toFixed(1).padStart(4)}/${o.h.toFixed(0).padStart(4)}  `
        + `${o.sd.map(x => x.toFixed(2).padStart(6)).join('')}  ${sil ? sil.silK.toFixed(3) : '  —  '}  ${sil ? sil.silD.toFixed(1) : ' — '}`);
    }
    if (res.veg) console.log(`${tag.padEnd(21)} ${'veg'.padEnd(8)} ${String(res.veg.pct).padStart(5)}%  `
      + `                 ${res.veg.L.toFixed(1).padStart(5)}/${res.veg.C.toFixed(1).padStart(4)}/${res.veg.h.toFixed(0).padStart(4)}`
      + `${' '.repeat(44)}  ${res.veg.silK.toFixed(3)}  ${res.veg.silD.toFixed(1)}`);
  }
}
await browser.close();
