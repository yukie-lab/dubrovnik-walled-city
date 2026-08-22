import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?x=-138&z=-1.2&yaw=-1.62&pitch=0&time=10.6', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(async () => {
  const life = window.__world.life;
  const folk = life.folk || life._folk;
  if (!folk) return 'folk not exposed: ' + Object.keys(life).join(',');
  const prev = new Map();
  let maxJump = 0, worst = null, samples = 0, moved = 0, paused = 0;
  for (let k = 0; k < 240; k++) {
    await new Promise(r => requestAnimationFrame(r));
    if (k < 60) continue;
    for (let i = 0; i < folk.length; i += 7) {
      const f = folk[i];
      if (!f.walk || f.curR == null) continue;
      const pr = prev.get(i);
      if (pr != null) {
        let d = Math.abs(((f.curR - pr + Math.PI) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI) - Math.PI);
        if (d > maxJump) { maxJump = d; worst = i; }
        samples++;
      }
      prev.set(i, f.curR);
      if ((f.curW ?? 0) > 0.5) moved++; else paused++;
    }
  }
  return JSON.stringify({ samples, maxJumpDeg: +(maxJump*180/Math.PI).toFixed(1), worst,
    movingPct: +(100*moved/(moved+paused)).toFixed(1) });
}));
await b.close();
