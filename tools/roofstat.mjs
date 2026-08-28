// ============================================================================
// roofstat.mjs — 「屋根の海が何十もの橙で揺れているか」を数える計器。
//
//   node tools/roofstat.mjs <iter> [view …] [--time t2noon]
//
// 同じ定点を三回描く:
//   ① 本番の絵
//   ② 部位の分類マスク(屋根の画素を確定する)
//   ③ **屋根 1 軒ごとに固有の色を配ったマスク**(instanceColor に id を焼く)
//
// ③があるので「軒ごとの平均色」が取れる。**「何十もの橙」は軒と軒の差**で
// あって、瓦一枚の差でも列の焼きむらでもない。両方を分けて測る。
//
// 出力:
//   軒数        画面に 400 画素以上で写っている屋根の数
//   ΔE群        軒ごとの平均色を CIELAB で ΔE 3 に丸めて数えた「区別できる橙」の数
//   軒間 σ      軒ごとの平均 L* / C* / h° の標準偏差(= 家から家への差)
//   軒内 σ      1 軒の中の L* の標準偏差の平均(= 瓦と列の差)
//   軒間/軒内   これが 1 を大きく下回ると「全部同じ屋根が並んでいる」
//   尺度別SD    r2/r8/r32/r96 の局所SD(屋根画素のみ)
// ============================================================================
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8765';
const SCALES = [2, 8, 32, 96];

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

console.log(`# ${iter} — 屋根の海。「何十もの橙」は軒と軒の差。`);
console.log(`# ${'視点_時刻'.padEnd(20)} 屋根%  軒数 ΔE群  平均(L*/C*/h°)      軒間σ(L*/C*/h°)      軒内σL*  軒間/軒内  ${SCALES.map(s => ('r' + s).padStart(7)).join('')}`);
for (const v of views.filter(v => wantV.includes(v.name))) {
  for (const t of times.filter(t => wantT.includes(t.name))) {
    const p = v.spec.split(':');
    const extra = p.slice(4).join(':');
    await page.goto(`${BASE}/index.html?shot=1${extra}&hud=0&x=${p[0]}&z=${p[1]}&yaw=${p[2]}&pitch=${p[3]}&time=${t.spec}`,
      { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction('window.__READY === true', { timeout: 25000 });
    await new Promise(r => setTimeout(r, 1300));
    const res = await page.evaluate(async (SC) => {
      const w = window.__world, T = w.THREE, gl = w.renderer.getContext();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const grab = () => { const px = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
      const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await frame();
      const real = grab();
      // ---- ③ 軒ごとの id マスク
      const saved = [], tm = w.renderer.toneMapping, fog = w.scene.fog;
      w.renderer.toneMapping = T.NoToneMapping; w.scene.fog = null;
      let roofMesh = null;
      w.scene.traverse(o => {
        if (!o.isMesh && !o.isInstancedMesh) return;
        saved.push([o, o.material, o.instanceColor]);
        const isRoof = /^house\.roof$/.test(o.name || '');
        if (isRoof) roofMesh = o;
        o.material = new T.MeshBasicMaterial({ color: 0xffffff, fog: false,
          side: o.material?.side ?? T.FrontSide, vertexColors: false });
        if (!isRoof) { o.material.color.setRGB(0, 0, 0, T.SRGBColorSpace); o.instanceColor = null; }
      });
      if (roofMesh) {
        const n = roofMesh.count, arr = new Float32Array(n * 3);
        const c = new T.Color();
        for (let i = 0; i < n; i++) {
          const id = i + 1;
          c.setRGB((id & 255) / 255, ((id >> 8) & 255) / 255, 0, T.SRGBColorSpace);
          arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
        }
        roofMesh.instanceColor = new T.InstancedBufferAttribute(arr, 3);
        roofMesh.instanceColor.needsUpdate = true;
      }
      w.renderer.setRenderTarget(null); w.renderer.render(w.scene, w.camera);
      const idm = grab();
      for (const [o, m, ic] of saved) { o.material = m; o.instanceColor = ic || null; }
      w.renderer.toneMapping = tm; w.scene.fog = fog;

      // ---- 色空間: sRGB → linear → XYZ(D65)→ CIELAB
      const s2l = v2 => (v2 <= 0.04045 ? v2 / 12.92 : ((v2 + 0.055) / 1.055) ** 2.4);
      const f = q => (q > 0.008856 ? Math.cbrt(q) : 7.787 * q + 16 / 116);
      const lab = (r, g, b) => {
        const R = s2l(r), G = s2l(g), B = s2l(b);
        const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
        const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
        const fx = f(X), fy = f(Y), fz = f(Z);
        return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
      };
      // ---- 集計
      const per = new Map();          // id → {n, L, a, b, L2}
      const Ls = new Float64Array(W * H); const isRoof = new Uint8Array(W * H);
      let nRoof = 0;
      for (let i = 0, q = 0; i < W * H; i++, q += 4) {
        const id = idm[q] + (idm[q + 1] << 8);
        if (id === 0) continue;
        const [L, A, B2] = lab(real[q] / 255, real[q + 1] / 255, real[q + 2] / 255);
        Ls[i] = L; isRoof[i] = 1; nRoof++;
        let e = per.get(id);
        if (!e) { e = { n: 0, L: 0, a: 0, b: 0, L2: 0 }; per.set(id, e); }
        e.n++; e.L += L; e.a += A; e.b += B2; e.L2 += L * L;
      }
      if (nRoof < 1500) return null;
      const roofs = [...per.values()].filter(e => e.n >= 400)
        .map(e => ({ n: e.n, L: e.L / e.n, a: e.a / e.n, b: e.b / e.n,
          sd: Math.sqrt(Math.max(0, e.L2 / e.n - (e.L / e.n) ** 2)) }));
      if (roofs.length < 3) return null;
      const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
      const sdev = xs => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
      const Cs = roofs.map(r => Math.hypot(r.a, r.b));
      const hs = roofs.map(r => (Math.atan2(r.b, r.a) * 180 / Math.PI + 360) % 360);
      // ΔE 3 に丸めた区別できる色の数
      const bins = new Set(roofs.map(r => `${Math.round(r.L / 3)},${Math.round(r.a / 3)},${Math.round(r.b / 3)}`));
      // ---- 尺度別の局所SD(屋根画素のみ)
      const I = new Float64Array((W + 1) * (H + 1));
      for (let y = 0; y < H; y++) { let rs = 0;
        for (let x = 0; x < W; x++) { rs += Ls[y * W + x] * (isRoof[y * W + x] ? 1 : 0);
          I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + rs; } }
      const Ic = new Float64Array((W + 1) * (H + 1));
      for (let y = 0; y < H; y++) { let rs = 0;
        for (let x = 0; x < W; x++) { rs += isRoof[y * W + x];
          Ic[(y + 1) * (W + 1) + x + 1] = Ic[y * (W + 1) + x + 1] + rs; } }
      const box = (A, x, y, r) => {
        const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r);
        const x1 = Math.min(W - 1, x + r), y1 = Math.min(H - 1, y + r);
        return A[(y1 + 1) * (W + 1) + x1 + 1] - A[y0 * (W + 1) + x1 + 1] - A[(y1 + 1) * (W + 1) + x0] + A[y0 * (W + 1) + x0];
      };
      const sds = SC.map(r => { let s = 0, k = 0;
        for (let y = 2; y < H - 2; y += 2) for (let x = 2; x < W - 2; x += 2) {
          const i = y * W + x; if (!isRoof[i]) continue;
          const cn = box(Ic, x, y, r); if (cn < 12) continue;
          const d = Ls[i] - box(I, x, y, r) / cn; s += d * d; k++; }
        return k ? +Math.sqrt(s / k).toFixed(2) : 0; });
      return {
        pct: +(100 * nRoof / (W * H)).toFixed(1), roofs: roofs.length, bins: bins.size,
        mL: +mean(roofs.map(r => r.L)).toFixed(1), mC: +mean(Cs).toFixed(1), mH: +mean(hs).toFixed(1),
        sdL: +sdev(roofs.map(r => r.L)).toFixed(2), sdC: +sdev(Cs).toFixed(2), sdH: +sdev(hs).toFixed(2),
        inL: +mean(roofs.map(r => r.sd)).toFixed(2),
        ratio: +(sdev(roofs.map(r => r.L)) / Math.max(1e-3, mean(roofs.map(r => r.sd)))).toFixed(2),
        sds,
      };
    }, SCALES);
    if (!res) { continue; }
    console.log(`${(v.name + '_' + t.name).padEnd(21)} ${String(res.pct).padStart(4)}% `
      + ` ${String(res.roofs).padStart(4)} ${String(res.bins).padStart(4)} `
      + ` ${res.mL.toFixed(1).padStart(5)}/${res.mC.toFixed(1).padStart(5)}/${res.mH.toFixed(1).padStart(5)} `
      + `${res.sdL.toFixed(2).padStart(6)}/${res.sdC.toFixed(2).padStart(5)}/${res.sdH.toFixed(1).padStart(5)}  `
      + `${res.inL.toFixed(2).padStart(7)}  ${res.ratio.toFixed(2).padStart(7)}   ${res.sds.map(x => x.toFixed(2).padStart(7)).join('')}`);
  }
}
await browser.close();
