// 「この白は何か」— 同じ定点を条件を切り替えて描き、明部>0.90 の割合の差で犯人を出す。
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [time='7.90', x='-138', z='-1.2', yaw='-1.62', pitch='0.015', extra='&fov=52'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--headless=new','--use-angle=metal','--window-size=840,560'] });
const p = await b.newPage();
await p.setViewport({ width: 800, height: 520, deviceScaleFactor: 1 });
await p.goto(`http://localhost:8765/index.html?shot=1${extra}&hud=0&x=${x}&z=${z}&yaw=${yaw}&pitch=${pitch}&time=${time}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 25000 });
await new Promise(r => setTimeout(r, 1300));
console.log(await p.evaluate(async () => {
  const w = window.__world, T = w.THREE, gl = w.renderer.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const s2l = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const stat = () => { const px = new Uint8Array(W*H*4); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,px);
    let hi=0,n=0,sum=0; for (let i=0;i<px.length;i+=4){ const Y=0.2126*s2l(px[i]/255)+0.7152*s2l(px[i+1]/255)+0.0722*s2l(px[i+2]/255); if(Y>0.90)hi++; sum+=Y; n++; }
    return { hi:+(100*hi/n).toFixed(2), mean:+(sum/n).toFixed(4) }; };
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const out = [];
  await frame(); out.push(['そのまま', stat()]);
  const env = w.scene.environment; w.scene.environment = null; await frame(); out.push(['環境マップを外す', stat()]); w.scene.environment = env;
  // 鏡面用 envMap(太陽入り)を外す
  const specs = []; w.scene.traverse(o=>{ const m = o.material; if (m && m.envMap) { specs.push([m, m.envMap]); m.envMap = null; m.needsUpdate = true; } });
  await frame(); out.push([`鏡面 envMap を外す(${specs.length} 材質)`, stat()]);
  for (const [m,e] of specs) { m.envMap = e; m.needsUpdate = true; }
  await frame();
  // 粗さを 1 にする(鏡面反射を殺す)
  const rs = []; w.scene.traverse(o=>{ const m=o.material; if (m && m.roughness !== undefined && m.roughness < 0.9) { rs.push([m,m.roughness]); m.roughness = 1.0; } });
  await frame(); out.push([`roughness を 1 に(${rs.length} 材質)`, stat()]);
  for (const [m,r] of rs) m.roughness = r;
  await frame();
  return out.map(([k,v])=>`${k.padEnd(28)} 明部>0.90 ${String(v.hi).padStart(6)}%   平均Y ${v.mean}`).join('\n');
}));
await b.close();
