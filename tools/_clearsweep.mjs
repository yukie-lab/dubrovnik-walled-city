// 向きを掃いて「半透明の物が画面を汚す」向きを探す。カメラは毎フレーム
// player.pose() が書くので、**player の yaw/pitch を動かす**(camera.rotation を
// 直接触っても効かない — 一度それで嘘の一定値を出した)。
//   node tools/_clearsweep.mjs x z gy time [fov]
import puppeteer from 'puppeteer-core';
const [X, Z, GY, TIME, FOV = '62'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--window-size=1240,800','--no-sandbox'], protocolTimeout: 300000 });
const p = await b.newPage();
await p.setViewport({ width: 1200, height: 760, deviceScaleFactor: 1 });
await p.goto(`http://localhost:8765/index.html?shot=1&hud=0&x=${X}&z=${Z}&gy=${GY}&time=${TIME}&fov=${FOV}&yaw=0&pitch=0`,
  { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
await new Promise(r => setTimeout(r, 1300));
console.log(await p.evaluate(async () => {
  const w = window.__world, T = w.THREE, gl = w.renderer.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const read = () => { const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const groups = new Map();
  w.scene.traverse(o => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const m = o.material;
    if (!m || (!m.transparent && !(m.opacity < 1))) return;
    const k = o.name || '(無名)';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  });
  const out = [];
  for (let yi = 0; yi < 16; yi++) {
    for (const pitch of [-0.45, -0.20]) {
      const yaw = (yi / 16) * Math.PI * 2 - Math.PI;
      w.player.yaw = yaw; w.player.pitch = pitch;
      await frame(); await frame();
      const base = read().slice();
      for (const [name, list] of groups) {
        const vis = list.map(o => o.visible);
        list.forEach(o => { o.visible = false; });
        await frame();
        const cur = read();
        let n = 0, mx = 0;
        for (let i = 0; i < base.length; i += 4) {
          const d = Math.max(Math.abs(base[i]-cur[i]), Math.abs(base[i+1]-cur[i+1]), Math.abs(base[i+2]-cur[i+2]));
          if (d > 8) { n++; if (d > mx) mx = d; }
        }
        list.forEach((o, i) => { o.visible = vis[i]; });
        if (n > W * H * 0.004) out.push({ s: `yaw ${yaw.toFixed(2)} pitch ${pitch}  ${name.padEnd(20)} ${(100*n/(W*H)).toFixed(2)}%  最大 ${mx}/255`, n });
      }
      await frame();
    }
  }
  return out.sort((a, c) => c.n - a.n).slice(0, 10).map(o => o.s).join('\n') || '(どの向きでも 0.4% 未満)';
}));
await b.close();
