import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=12', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const plan = window.__world.plan;
  const out = [];
  // 舗装(groundAt)と地形(outsideHeight)の差。+ なら舗装が地形の上に浮く。
  const scan = (x0,x1,z0,z1,step,tag) => {
    let worstUp = 0, upAt = null, worstDn = 0, dnAt = null, n = 0;
    for (let x = x0; x <= x1; x += step) for (let z = z0; z <= z1; z += step) {
      const g = plan.groundAt(x, z, 2.0);
      if (!g || g.y < -1) continue;
      const t = plan.outsideHeight(x, z);
      const d = g.y - t;
      n++;
      if (d > worstUp) { worstUp = d; upAt = [x, z, g.y, t, g.zone]; }
      if (d < worstDn) { worstDn = d; dnAt = [x, z, g.y, t, g.zone]; }
    }
    out.push(`${tag}: 点${n}  舗装が地形より上 最大 ${worstUp.toFixed(2)}m ${upAt ? `@(${upAt[0]},${upAt[1]}) 舗装${upAt[2].toFixed(2)}/地形${upAt[3].toFixed(2)} ${upAt[4]}` : ''}`);
    out.push(`      地形が舗装より上 最大 ${(-worstDn).toFixed(2)}m ${dnAt ? `@(${dnAt[0]},${dnAt[1]}) 舗装${dnAt[2].toFixed(2)}/地形${dnAt[3].toFixed(2)} ${dnAt[4]}` : ''}`);
  };
  scan(179.6, 182.0, 42, 58.5, 0.4, '聖ヨハネのエプロン');
  scan(179.6, 214, 56.5, 64.5, 0.6, 'ポルポレラ');



  return out.join('\n');
}));
await b.close();
