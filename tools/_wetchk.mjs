import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--use-angle=metal','--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:8080/index.html?shot=1&hud=0&x=196&z=63.4&yaw=2.4&pitch=-0.12&time=13&gy=1.5', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 40000 });
await new Promise(r => setTimeout(r, 1500));
console.log(await p.evaluate(() => {
  const { renderer } = window.__world;
  const progs = renderer.info.programs || [];
  let wet = 0, tot = 0, shd = 0;
  for (const pr of progs) {
    tot++;
    const src = pr.cacheKey || '';
    if (String(src).includes('|wet')) wet++;
  }
  // 実マテリアルを走査して onBeforeCompile が付いたか見る
  const names = [];
  window.__world.scene.traverse(o => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) if (m && m.customProgramCacheKey && String(m.customProgramCacheKey()).includes('|wet')) names.push(o.type + ':' + (m.type));
  });
  return `programs=${tot} wetKey=${wet} wetMats=${names.length} ${JSON.stringify(names.slice(0,8))}`;
}));
await b.close();
