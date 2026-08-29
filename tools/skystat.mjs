// ============================================================================
// skystat.mjs — 空の計器。第5パス(空)の採点に使う。
//
//   node tools/skystat.mjs <iter> [view …] [--time t2noon]
//
// 「グラデーションではなく塗られた大気」を数字で言うための道具。
//
// 空の画素を仰角(度)で束ね、**仰角だけの関数として最小二乗で当てはめた
// 縦のグラデーションを引き算する**。残差が空の「絵具」— それが 0 なら、
// その空は定義上ただのグラデーションで、塗られてはいない。
//
//   grad     縦のグラデーションの振れ幅(仰角 0〜60° の L* 差)
//   resid    グラデーションを引いた残差の SD(L*)。**これが塗り**
//   resH     同じ仰角の帯の中での水平方向の SD(L*)。方位の非対称と斑
//   sunAsym  太陽側の半分 − 反太陽側の半分(同じ仰角帯での L* 差)
//   C*(0/30/60) 仰角別の彩度 — 水平線へ向かって霞が濃くなれば下がる
//   h°(0/60)   仰角別の色相
//   雲%      雲の被覆率 / 塊の数 / 縁の柔らかさ(縁 1px あたりの L* 変化)
//   雲ΔL*    1 つの雲の中の L* の幅(頂が明るく底が陰る = 立体)
// ============================================================================
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8765';

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

console.log(`# ${iter} — 空。グラデーションを引いた残差が「塗り」。`);
console.log(`# ${'視点_時刻'.padEnd(20)} 空%  grad  resid  resH  sunAsym   C*(0/30/60)      h°(0/60)   雲%  塊 縁 雲ΔL*`);
for (const v of views.filter(v => wantV.includes(v.name))) {
  for (const t of times.filter(t => wantT.includes(t.name))) {
    const p = v.spec.split(':');
    const extra = p.slice(4).join(':');
    await page.goto(`${BASE}/index.html?shot=1${extra}&hud=0&x=${p[0]}&z=${p[1]}&yaw=${p[2]}&pitch=${p[3]}&time=${t.spec}`,
      { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction('window.__READY === true', { timeout: 25000 });
    await new Promise(r => setTimeout(r, 1300));
    const res = await page.evaluate(async () => {
      const w = window.__world, T = w.THREE, gl = w.renderer.getContext();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const grab = () => { const px = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
      const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await frame();
      const real = grab();
      // 雲は自前の ShaderMaterial(頂点シェーダでビルボード化)なので、
      // 材質を差し替えるマスクでは板が潰れて 0% になる。**雲を消して撮り直し、
      // 差のある画素を雲とする**。シェーダの中身に依存しない。
      let cloudsMesh = null;
      w.scene.traverse(o => { if (/^sky\.clouds/.test(o.name || '')) cloudsMesh = o; });
      let noCloud = real;
      if (cloudsMesh) { cloudsMesh.visible = false; await frame(); noCloud = grab(); cloudsMesh.visible = true; await frame(); }
      // 分類マスク: 天蓋 / それ以外(雲は上で取った)
      const saved = [], tm = w.renderer.toneMapping, fog = w.scene.fog;
      w.renderer.toneMapping = T.NoToneMapping; w.scene.fog = null;
      w.scene.traverse(o => {
        if (!o.isMesh && !o.isInstancedMesh) return;
        saved.push([o, o.material, o.instanceColor]);
        if (o.instanceColor) o.instanceColor = null;
        const c = /^sky\.dome/.test(o.name || '') ? 0xff0000 : 0x000000;
        o.material = new T.MeshBasicMaterial({ color: c, fog: false,
          side: o.material?.side ?? T.FrontSide,
          transparent: o.material?.transparent ?? false,
          opacity: 1, depthWrite: true });
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
      // 画素 → 視線 → 仰角・太陽との方位差
      const inv = new T.Matrix4().copy(w.camera.projectionMatrix).invert();
      const camW = new T.Matrix4().extractRotation(w.camera.matrixWorld);
      const sunDir = w.lighting.sun.position.clone().sub(w.lighting.sun.target.position).normalize();
      const dirAt = (x, y) => {
        const v3 = new T.Vector3((x / W) * 2 - 1, (y / H) * 2 - 1, 0.5).applyMatrix4(inv).normalize();
        return v3.applyMatrix4(camW);
      };
      const cls = new Uint8Array(W * H);
      const Ls = new Float64Array(W * H), As = new Float64Array(W * H), Bs = new Float64Array(W * H);
      const El = new Float64Array(W * H), Sa = new Float64Array(W * H);
      let nSky = 0, nCloud = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, q = i * 4;
        const isDome = mask[q] > 128 && mask[q + 1] < 96;
        const isCloud = isDome && (Math.abs(real[q] - noCloud[q]) + Math.abs(real[q + 1] - noCloud[q + 1])
          + Math.abs(real[q + 2] - noCloud[q + 2])) > 6;
        const c = isCloud ? 2 : isDome ? 1 : 0;
        cls[i] = c; if (c === 1) nSky++; else if (c === 2) nCloud++;
        if (!c) continue;
        const L = lab(real[q] / 255, real[q + 1] / 255, real[q + 2] / 255);
        Ls[i] = L[0]; As[i] = L[1]; Bs[i] = L[2];
        const d = dirAt(x, y);
        El[i] = Math.asin(Math.max(-1, Math.min(1, d.y))) * 180 / Math.PI;
        Sa[i] = d.dot(sunDir);
      }
      if (nSky < 8000) return null;
      // 仰角 1° の帯で平均 → 縦のグラデーション。残差 = 塗り。
      const bin = new Map();
      for (let i = 0; i < W * H; i++) { if (cls[i] !== 1) continue;
        const k = Math.round(El[i]); const e = bin.get(k) || { s: 0, n: 0 }; e.s += Ls[i]; e.n++; bin.set(k, e); }
      const prof = new Map(); for (const [k, e] of bin) if (e.n > 40) prof.set(k, e.s / e.n);
      const at = k => { let best = null, bd = 1e9;
        for (const [kk, vv] of prof) { const d = Math.abs(kk - k); if (d < bd) { bd = d; best = vv; } } return best; };
      let rs = 0, rn = 0;
      for (let i = 0; i < W * H; i++) { if (cls[i] !== 1) continue;
        const m = prof.get(Math.round(El[i])); if (m === undefined) continue;
        rs += (Ls[i] - m) ** 2; rn++; }
      // 同じ帯の中の水平 SD(帯ごとの SD の平均)
      const rowSD = []; const rowsA = new Map();
      for (let i = 0; i < W * H; i++) { if (cls[i] !== 1) continue;
        const k = Math.round(El[i] / 3) * 3; const e = rowsA.get(k) || []; e.push(Ls[i]); rowsA.set(k, e); }
      for (const [, arr] of rowsA) { if (arr.length < 200) continue;
        const m = arr.reduce((a, b) => a + b, 0) / arr.length;
        rowSD.push(Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length)); }
      // 太陽側 / 反太陽側の非対称(同じ仰角帯で)
      let asymS = 0, asymN = 0, asymSn = 0, asymNn = 0;
      for (let i = 0; i < W * H; i++) { if (cls[i] !== 1) continue;
        const m = prof.get(Math.round(El[i])); if (m === undefined) continue;
        if (Sa[i] > 0.25) { asymS += Ls[i] - m; asymSn++; }
        else if (Sa[i] < -0.25) { asymN += Ls[i] - m; asymNn++; } }
      // 仰角別の彩度・色相
      const ch = (lo, hi) => { let a = 0, b = 0, n = 0;
        for (let i = 0; i < W * H; i++) { if (cls[i] !== 1) continue;
          if (El[i] < lo || El[i] >= hi) continue; a += As[i]; b += Bs[i]; n++; }
        if (!n) return null; a /= n; b /= n;
        return { C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180 / Math.PI) + 360) % 360 }; };
      // 雲: 塊の数・縁の柔らかさ・1 塊の中の L* の幅
      const lbl = new Int32Array(W * H).fill(-1); let nb = 0; const blobs = [];
      const st = [];
      for (let i = 0; i < W * H; i++) {
        if (cls[i] !== 2 || lbl[i] >= 0) continue;
        const id = nb++; st.length = 0; st.push(i); lbl[i] = id;
        let n = 0, lo = 1e9, hi = -1e9;
        while (st.length) { const j = st.pop(); n++; lo = Math.min(lo, Ls[j]); hi = Math.max(hi, Ls[j]);
          const x = j % W, y = (j / W) | 0;
          for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1])
            if (k >= 0 && cls[k] === 2 && lbl[k] < 0) { lbl[k] = id; st.push(k); } }
        blobs.push({ n, span: hi - lo }); }
      const big = blobs.filter(b => b.n > 400);
      // 縁の柔らかさ = 雲と空の境界を跨ぐ L* 勾配(1px あたり)
      let eg = 0, egn = 0;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x; if (cls[i] !== 2) continue;
        for (const j of [i - 1, i + 1, i - W, i + W])
          if (cls[j] === 1) { eg += Math.abs(Ls[i] - Ls[j]); egn++; } }
      const mean = a => a.length ? a.reduce((x, y2) => x + y2, 0) / a.length : 0;
      return {
        skyPct: +(100 * nSky / (W * H)).toFixed(1),
        grad: +((at(0) ?? 0) - (at(60) ?? at(40) ?? 0)).toFixed(2),
        resid: +Math.sqrt(rs / Math.max(1, rn)).toFixed(3),
        resH: +mean(rowSD).toFixed(3),
        asym: +((asymSn ? asymS / asymSn : 0) - (asymNn ? asymN / asymNn : 0)).toFixed(2),
        c0: ch(-2, 8), c30: ch(25, 35), c60: ch(50, 70),
        cloudPct: +(100 * nCloud / (W * H)).toFixed(1),
        blobs: big.length, edge: +(egn ? eg / egn : 0).toFixed(2),
        cloudSpan: +mean(big.map(b => b.span)).toFixed(1),
      };
    });
    if (!res) continue;
    const cf = o => (o ? `${o.C.toFixed(1)}` : ' — ');
    const hf = o => (o ? `${o.h.toFixed(0)}` : ' — ');
    console.log(`${(v.name + '_' + t.name).padEnd(21)} ${String(res.skyPct).padStart(4)}% `
      + `${res.grad.toFixed(1).padStart(6)} ${res.resid.toFixed(3).padStart(6)} ${res.resH.toFixed(3).padStart(6)} `
      + `${res.asym.toFixed(2).padStart(7)}  ${cf(res.c0).padStart(5)}/${cf(res.c30).padStart(5)}/${cf(res.c60).padStart(5)}  `
      + `${hf(res.c0).padStart(4)}/${hf(res.c60).padStart(4)}  ${String(res.cloudPct).padStart(4)}% `
      + `${String(res.blobs).padStart(3)} ${res.edge.toFixed(1).padStart(5)} ${res.cloudSpan.toFixed(1).padStart(5)}`);
  }
}
await browser.close();
