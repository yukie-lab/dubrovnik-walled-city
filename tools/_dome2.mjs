import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=13', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const plan = window.__world.plan;
  const M = plan.MONUMENTS;
  const out = [];
  const rep = (name, m, eavesRel) => {
    const h = plan.houses.find(q => Math.abs(q.x - m.x) < 0.6 && Math.abs(q.z - m.z) < 0.6);
    const terr = plan.terrainHeight(m.x, m.z);
    let plazaY = null;
    for (const p2 of plan.PLAZAS) if (m.x > p2.x0-2 && m.x < p2.x1+2 && m.z > p2.z0-2 && m.z < p2.z1+2) { plazaY = p2.y; break; }
    const roofRidge = h ? h.eaves + (h.roofH ?? 0) : null;
    const domeYB = terr - 0.5 + eavesRel + (m.d / 2) * 0.36 + 0.6;
    out.push(`${name}: 素地形 ${terr.toFixed(2)}  広場 ${plazaY}  synth軒 ${h?.eaves.toFixed(2)}  棟 ${roofRidge?.toFixed(2)}  ドーム底 ${domeYB.toFixed(2)}  ずれ ${(domeYB - (roofRidge ?? 0)).toFixed(2)}`);
  };
  rep('大聖堂', M.cathedral, 14);
  rep('聖ヴラホ', M.stBlaise, 13);
  return out.join('\n');
}));
await b.close();
