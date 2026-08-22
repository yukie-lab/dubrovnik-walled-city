import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=11', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const plan = window.__world.plan;
  const out = [];
  out.push('壁ノード 10..14: ' + plan.wallPts.slice(10,15).map((q,i)=>`${i+10}:(${q[0]},${q[1]},y${q[2].toFixed(1)}) ${plan.wallKinds[i+10]}`).join('  '));
  out.push('塔: ' + Object.entries(plan.TOWERS).map(([k,t])=>`${k}(${t.x},${t.z},r${t.r})`).join(' '));
  for (const [x,z] of [[139.5,-68.0],[140.3,-67.4],[141.1,-66.8],[142,-66],[143,-65]]) {
    const g = plan.groundAt(x, z, 20.5);
    const c = plan.collide(x, z, 0.35, (g?.y ?? 19) + 1.0);
    out.push(`(${x}, ${z}) y=${g?.y?.toFixed(2)} zone=${g?.zone} 押し戻し ${Math.hypot(c.x-x,c.z-z).toFixed(2)}`);
    for (const [k,t] of Object.entries(plan.TOWERS)) {
      const d = Math.hypot(x-t.x, z-t.z);
      if (d < t.r + 6) out.push(`    塔 ${k} d=${d.toFixed(2)} r=${t.r} collideTop=${t.collideTop ?? (t.galleryY-0.2)}`);
    }
    for (const h of plan.houses) {
      if (Math.abs(x-h.x) < h.w/2+2 && Math.abs(z-h.z) < h.d/2+2) out.push(`    家 (${h.x.toFixed(1)},${h.z.toFixed(1)}) ${h.w}x${h.d} eaves=${h.eaves?.toFixed(1)}`);
    }
    for (const st of plan.WALL_STAIRS) {
      const ns = plan.nearestOnPolyline ? null : null;
    }
  }
  out.push('WALL_STAIRS: ' + plan.WALL_STAIRS.map(s=>`${s.id} w=${s.w} spiral=${!!s.spiral} pts=${JSON.stringify(s.pts.map(q=>[+q[0].toFixed(0),+q[1].toFixed(0)]))}`).join('\n  '));
  return out.join('\n');
}));
await b.close();
