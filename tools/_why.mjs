import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/?shot=1&x=0&z=0&yaw=0&pitch=0&time=11', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
console.log(await p.evaluate(() => {
  const plan = window.__world.plan;
  const out = [];
  const probe = (x, z) => {
    const g = plan.groundAt(x, z, 500);
    const py = (g?.y ?? 0) + 1.0;
    const c = plan.collide(x, z, 0.35, py);
    out.push(`(${x}, ${z}) y=${g?.y?.toFixed(2)} zone=${g?.zone} 押し戻し ${Math.hypot(c.x-x,c.z-z).toFixed(2)} → (${c.x.toFixed(1)},${c.z.toFixed(1)})`);
    // 原因の切り分け
    for (const t of Object.entries(plan.TOWERS || {})) {
      const d = Math.hypot(x - t[1].x, z - t[1].z);
      if (d < t[1].r + 3) out.push(`    塔 ${t[0]} まで ${d.toFixed(2)} (r=${t[1].r})`);
    }
    for (const bx of plan.extraColliders) {
      if (x > bx.x0 - 1 && x < bx.x1 + 1 && z > bx.z0 - 1 && z < bx.z1 + 1) out.push(`    箱 x[${bx.x0.toFixed(1)},${bx.x1.toFixed(1)}] z[${bx.z0.toFixed(1)},${bx.z1.toFixed(1)}] y1=${bx.y1.toFixed(1)}`);
    }
    for (const cy of plan.extraCylinders) {
      const d = Math.hypot(x - cy.x, z - cy.z);
      if (d < cy.r + 1) out.push(`    円柱 r=${cy.r} まで ${d.toFixed(2)} y[${cy.y0},${cy.y1}]`);
    }
    for (const h of plan.houses) {
      if (Math.abs(x - h.x) < h.w/2 + 1 && Math.abs(z - h.z) < h.d/2 + 1) out.push(`    家 (${h.x.toFixed(1)},${h.z.toFixed(1)}) ${h.w}x${h.d}`);
    }
    const nw = plan.wallPts ? null : null;
  };
  probe(-112.8, -84.7); probe(-129.5, -76.7); probe(164.3, -5.6); probe(165.0, -5.8);
  return out.join('\n');
}));
await b.close();
