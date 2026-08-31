// 実機(通常モード・時計が流れる)でカメラを凍らせ、一定間隔で複数枚撮る。
//   node tools/_liveshots.mjs <名前> x z yaw pitch <枚数> <間隔秒> [fov]
import puppeteer from 'puppeteer-core';
const [NAME, X, Z, YAW, PITCH, N = '3', GAP = '0.5', FOV = '62', TIME = '11'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new','--use-angle=metal','--window-size=1640,1060','--no-sandbox'], protocolTimeout: 300000 });
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
await p.goto(`http://localhost:8765/index.html?fov=${FOV}&time=${TIME}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 60000 });
await p.evaluate(() => document.querySelector('#btnStart')?.click());
await new Promise(r => setTimeout(r, 3600));
await p.evaluate(([x, z, yaw, pitch]) => {
  const w = window.__world;
  w.player.teleport(x, z, yaw, pitch);
  w.player.frozen = true;
}, [Number(X), Number(Z), Number(YAW), Number(PITCH)]);
await new Promise(r => setTimeout(r, 1000));
for (let i = 0; i < Number(N); i++) {
  await p.screenshot({ path: `shots/cv/${NAME}_${i}.png` });
  const t = await p.evaluate(() => window.__world.worldState.time);
  console.log(`${NAME}_${i}  時刻 ${t.toFixed(3)}`);
  if (i < Number(N) - 1) await new Promise(r => setTimeout(r, Number(GAP) * 1000));
}
await b.close();
