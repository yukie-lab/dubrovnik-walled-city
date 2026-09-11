// Frame-stability, telemetry and compositor-vs-render-buffer checks.
// node tools/rendercheck.mjs <record-name> [--repeat N] [--view sea|alley|roofs|stradun] [--lod]
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2), name = args[0] || 'rendercheck';
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const repeat = Number(option('--repeat', 1));
const checkLOD = args.includes('--lod');
let views = [
  ['sea', 'x=0&z=103&yaw=3.1416&pitch=-0.14&gy=16&fov=52&time=21.2'],
  ['stradun', 'x=-138&z=-1.2&yaw=-1.62&pitch=0.015&fov=52&time=7.9'],
  ['alley', 'x=-98.4&z=-30&yaw=-0.12&pitch=0.18&fov=44&time=12.87'],
  ['roofs', 'x=58&z=-88&yaw=-2.303&pitch=-0.02&gy=24&fov=54&time=7.9'],
].filter(([v]) => !args.includes('--view') || v === option('--view'));
if (args.includes('--sweep')) {
  const fixed = [], times = [];
  for (const raw of readFileSync(new URL('./campaign.txt', import.meta.url), 'utf8').split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    const m = line.match(/^(view|time)\s+(\S+)\s+(.+)$/);
    if (m?.[1] === 'view') fixed.push([m[2], m[3].trim().split(':')]);
    if (m?.[1] === 'time') times.push([m[2], m[3].trim()]);
  }
  views = fixed.flatMap(([v, [x,z,yaw,pitch,extra]]) => times.map(([t,h]) =>
    [`${v}_${t}`, `x=${x}&z=${z}&yaw=${yaw}&pitch=${pitch}&time=${h}${extra || ''}`]));
}
if(args.includes('--view'))views=views.filter(([v])=>v.includes(option('--view')));
const dir = new URL('../shots/rendercheck/', import.meta.url);
mkdirSync(dir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new', '--use-angle=metal', '--window-size=1640,1060'],
});
const errors = [], rows = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 1000)); });
  if(args.includes('--walk')) {
    const { walkChecks }=await import('./walk-capture.mjs');
    await walkChecks(page,{name,dir,rows,errors,args});
    views=[];
  }
  for (let r = 0; r < repeat; r++) for (const [view, query] of views) {
    await page.goto(`${process.env.BASE || 'http://localhost:8765'}/index.html?shot=1&hud=0&${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__READY && window.__captureFrame', { timeout: 60000 });
    const stem = `${name}-${view}-${r}`;
    let fullStats = null, lodDifference = null;
    if (checkLOD) {
      await page.evaluate(() => { window.__world.instanceLOD.enabled = false; });
      let fullPng;
      for (let f = 0; f < 6; f++) fullPng = await page.evaluate(() => window.__captureFrame());
      writeFileSync(new URL(stem + '-full.png', dir), Buffer.from(fullPng.split(',')[1], 'base64'));
      fullStats = await page.evaluate(() => ({ ...window.__RENDER_STATS }));
      await page.evaluate(() => { window.__world.instanceLOD.enabled = true; });
    }
    const hashes = [];
    let png;
    // All captures are requested at the end of the application's render
    // callback. No unsynchronised gl.readPixels from an arbitrary event turn.
    for (let f = 0; f < 10; f++) {
      png = Buffer.from((await page.evaluate(() => window.__captureFrame())).split(',')[1], 'base64');
      hashes.push(createHash('sha256').update(png).digest('hex'));
    }
    const direct = new URL(stem + '-direct.png', dir), composited = new URL(stem + '-page.png', dir);
    writeFileSync(direct, png);
    await page.screenshot({ path: composited.pathname });
    const result = await page.evaluate(async () => {
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      for (let f = 0; f < 30; f++) await frame();
      const t0 = performance.now();
      for (let f = 0; f < 120; f++) await frame();
      const ms = performance.now() - t0;
      return { ...window.__RENDER_STATS, actualFps: 120000 / ms,
        reportedFps: window.__FPS, debug: document.getElementById('debug')?.textContent,
        renderCalls: window.__CALLS, exposedInstances: window.__INSTANCES };
    });
    const diff = spawnSync(process.execPath,
      [new URL('./_imgdiff.mjs', import.meta.url).pathname, direct.pathname, composited.pathname], { encoding: 'utf8' });
    if (diff.status !== 0) throw new Error(diff.stderr || diff.stdout);
    if (checkLOD) {
      const lodDiff = spawnSync(process.execPath,
        [new URL('./_imgdiff.mjs', import.meta.url).pathname, new URL(stem + '-full.png', dir).pathname, direct.pathname], { encoding: 'utf8' });
      if (lodDiff.status !== 0) throw new Error(lodDiff.stderr || lodDiff.stdout);
      lodDifference = lodDiff.stdout.split('\n')[0];
      if (!lodDifference.includes('最大|ΔY| 0.0000')) errors.push(`${view}: LOD changed visible pixels: ${lodDifference}`);
    }
    const row = { view, query, run: r, stableFrames: new Set(hashes.slice(-6)).size === 1,
      hashes, ...result, fullStats, lodDifference, compositorDifference: diff.stdout.split('\n')[0] };
    rows.push(row);
    console.log(`${view} #${r}: calls=${row.drawCalls} instances=${row.instances}/${row.instanceCapacity} fps=${row.actualFps.toFixed(1)} stable=${row.stableFrames}  ${row.compositorDifference}`);
    if (checkLOD) console.log(`  LOD culled=${row.culledInstances}, tris ${fullStats.triangles} → ${row.triangles}: ${lodDifference}`);
    if (row.drawCalls > 200 || !row.instances || row.instances > row.instanceCapacity
      || row.instances !== row.exposedInstances || row.dpr > 2 || !row.stableFrames) errors.push(`${view}: telemetry/stability/budget check failed`);
  }
} finally {
  await browser.close();
  writeFileSync(new URL(name + '.json', dir), JSON.stringify({ errors, rows }, null, 2) + '\n');
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
