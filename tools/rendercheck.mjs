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
if(args.includes('--window-study')) {
  const poses=[
    ['window_front','x=-149.1&z=-17.317453&yaw=-1.5707963267948966&pitch=0.26&gy=5.3&fov=50'],
    ['window_oblique','x=-149.1&z=-14&yaw=-0.777&pitch=0.18&gy=5.3&fov=45'],
  ];
  views=poses.flatMap(([v,q])=>[['am',7.9],['noon',12.87],['gold',19.3],['dusk',21.2]]
    .map(([t,h])=>[`${v}_${t}`,`${q}&time=${h}`]));
}
if(args.includes('--weather-study')) {
  const poses=[
    ['runoff_front','x=-150.5&z=-17.317453&yaw=-1.5707963267948966&pitch=.02&gy=4.9&fov=50'],
    ['runoff_oblique','x=-150.5&z=-13.3&yaw=-.88&pitch=.02&gy=4.9&fov=45'],
  ];
  views=poses.flatMap(([v,q])=>[['am',7.9],['noon',12.87],['gold',19.3],['dusk',21.2]]
    .map(([t,h])=>[`${v}_${t}`,`${q}&time=${h}`]));
}
if(args.includes('--query'))views=[[option('--view','custom'),option('--query')]];
if(args.includes('--view'))views=views.filter(([v])=>v.includes(option('--view')));
const dir = new URL('../shots/rendercheck/', import.meta.url);
mkdirSync(dir, { recursive: true });
const browser = await puppeteer.launch({
  protocolTimeout:600000,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new', '--use-angle=metal', '--window-size=1640,1060',
    ...(args.includes('--audio-check')?['--autoplay-policy=user-gesture-required',
      '--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies']:[])],
});
const errors = [], rows = [];
try {
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(120000);
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  if(args.includes('--source-ref') || args.includes('--buildings-source') || args.includes('--leaf-cpu') || args.includes('--masonry-source') || args.includes('--leaf-source') || args.includes('--folk-contact-source') || args.includes('--folk-pose-source')) {
    const overrides=new Map();
    if(args.includes('--source-ref')) {
      const ref=option('--source-ref');
      const listing=spawnSync('git',['ls-tree','-r','--name-only',ref,'--','src','index.html'],{encoding:'utf8'});
      if(listing.status)throw new Error('Cannot read baseline source tree');
      for(const file of listing.stdout.trim().split('\n')) {
        const result=spawnSync('git',['show',ref+':'+file],{encoding:'utf8',maxBuffer:8*1024*1024});
        if(result.status)throw new Error('Cannot read baseline '+file);
        overrides.set('/'+file,result.stdout);
        if(file==='index.html')overrides.set('/',result.stdout);
      }
    }
    for(const module of ['folk-contact','folk-pose'])if(args.includes('--'+module+'-source'))
      overrides.set('/src/'+module+'.js',readFileSync(option('--'+module+'-source'),'utf8'));
    if(args.includes('--buildings-source'))overrides.set('/src/buildings.js',readFileSync(option('--buildings-source'),'utf8'));
    if(args.includes('--masonry-source'))overrides.set('/src/masonry.js',readFileSync(option('--masonry-source'),'utf8'));
    if(args.includes('--leaf-source'))overrides.set('/src/woodland-leaf-lod.js',readFileSync(option('--leaf-source'),'utf8'));
    if(args.includes('--leaf-cpu'))overrides.set('/src/woodland-leaf-lod.js',readFileSync(new URL('./fixtures/woodland-cpu-lod.mjs',import.meta.url),'utf8').replace('../../src/woodland-wind.js','/src/woodland-wind.js'));
    await page.setRequestInterception(true);
    page.on('request',request=>{
      const source=overrides.get(new URL(request.url()).pathname);
      if(source!==undefined)request.respond({status:200,contentType:new URL(request.url()).pathname.endsWith('.js')?'text/javascript':'text/html',body:source});
      else request.continue();
    });
  }
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 1000)); });
  if(args.includes('--audio-check')) {
    const {audioCheck}=await import('./audio-check.mjs');
    await audioCheck(page,{name,dir,rows,errors,args});views=[];
  }
  if(args.includes('--atmosphere-probe')) {
    const {atmosphereProbe}=await import('./atmosphere-probe.mjs');
    await atmosphereProbe(page,{name,dir,rows,errors,args});views=[];
  }
  if(args.includes('--sky-cycle')) {
    const {skyCycleChecks}=await import('./sky-cycle-capture.mjs');
    await skyCycleChecks(page,{name,dir,rows,errors,args});views=[];
  }
  if(args.includes('--sky-motion')) {
    const {atmosphereMotionChecks}=await import('./atmosphere-motion-capture.mjs');
    await atmosphereMotionChecks(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--sky-depth-order')) {
    const {skyDepthOrderCheck}=await import('./sky-depth-order-check.mjs');
    await skyDepthOrderCheck(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--geometry-profile')) {
    const {frameGeometryProfile}=await import('./frame-geometry-profile.mjs');
    await frameGeometryProfile(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--shader-transition')) {
    const {shaderTransitionCheck}=await import('./shader-transition-check.mjs');
    await shaderTransitionCheck(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--bird-support')) {
    const {birdSupportSurvey}=await import('./bird-support-survey.mjs');
    await birdSupportSurvey(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--bird-poses')) {
    const {birdPoseCheck}=await import('./bird-pose-check.mjs');
    await birdPoseCheck(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--masonry-study')) {
    const {masonryAtlasCapture}=await import('./masonry-atlas-capture.mjs');
    await masonryAtlasCapture(page,{name,dir,rows,errors,args});views=[];
  }
  if(args.includes('--stair-illuminance')) {
    const {stairIlluminanceProbe}=await import('./stair-illuminance-probe.mjs');
    await stairIlluminanceProbe(page,{name,dir,rows,errors,args});views=[];
  }
  if(args.includes('--night-precision')) {
    const {nightPrecisionCheck}=await import('./night-precision-check.mjs');
    await nightPrecisionCheck(page,{name,dir,rows,errors,args});views=[];
  }
  if(args.includes('--radiance-storage')) {
    const {radianceStorageCheck}=await import('./radiance-storage-check.mjs');
    await radianceStorageCheck(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--masonry-repeat')) {
    const {masonryRepeatCheck}=await import('./masonry-repeat-check.mjs');
    await masonryRepeatCheck(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--moon-study')) {
    const {moonChecks}=await import('./moon-capture.mjs');
    await moonChecks(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--frame-shadows')) {
    const {frameShadowChecks}=await import('./frame-shadow-capture.mjs');
    await frameShadowChecks(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--sky-continuous')) {
    const {continuousSkyChecks}=await import('./sky-continuous-capture.mjs');
    await continuousSkyChecks(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--light-history')) {
    const {lightHistoryCheck}=await import('./light-history-check.mjs');
    await lightHistoryCheck(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--light-slots')) {
    const {lightSlotsCheck}=await import('./light-slots-check.mjs');
    await lightSlotsCheck(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--sky-budget')) {
    const {skyBudgetCheck}=await import('./sky-budget-check.mjs');
    await skyBudgetCheck(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--environment-check')) {
    const {environmentConvolverChecks}=await import('./environment-convolver-check.mjs');
    await environmentConvolverChecks(page,{rows,errors});views=[];
  }
  if(args.includes('--environment-height')) {
    const {environmentHeightCheck}=await import('./environment-height-check.mjs');
    await environmentHeightCheck(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--sea-calibration')) {
    const {seaCalibrationCapture}=await import('./sea-calibration-capture.mjs');
    await seaCalibrationCapture(page,{name,dir,rows,errors,args});views=[];
  }
  if(args.includes('--sea-regression')) {
    const {seaRegressionCapture}=await import('./sea-regression-capture.mjs');
    await seaRegressionCapture(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--sea-precision')) {
    const {seaPrecisionProbe}=await import('./sea-precision-probe.mjs');
    await seaPrecisionProbe(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--sea-glare')) {
    const {seaGlareCapture}=await import('./sea-glare-capture.mjs');
    await seaGlareCapture(page,{name,dir,rows,errors,args});views=[];
  }
  if(args.includes('--water-reflection-check')) {
    const {waterReflectionCheck}=await import('./water-reflection-check.mjs');
    await waterReflectionCheck(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--sea-fit')) {
    const {seaFit}=await import('./sea-fit.mjs');
    await seaFit(page,{name,dir,rows,errors,args});views=[];
  }
  if(args.includes('--sea-probe')) {
    const {seaTransportProbe}=await import('./sea-transport-probe.mjs');
    await seaTransportProbe(page,{name,dir,rows,errors,args});views=[];
  }
  if(args.includes('--water-controls')) {
    const {waterControlsCheck}=await import('./water-controls-check.mjs');
    await waterControlsCheck(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--reference-photographs')) {
    for(const [id,url] of [
      ['walls','https://citywallsdubrovnik.hr/wp-content/uploads/2020/06/P1100931-Large-1024x576.jpg'],
      ['parapet','https://citywallsdubrovnik.hr/wp-content/uploads/2020/06/P1100817-Large-1024x576.jpg'],
    ]) {
      const response=await page.goto(url,{waitUntil:'load',timeout:60000});
      if(!response.ok())throw new Error('Reference photograph HTTP '+response.status());
      writeFileSync(new URL(`${name}-${id}.jpg`,dir),await response.buffer());rows.push({view:id,source:url});
    }
    views=[];
  }
  if(args.includes('--walk')) {
    const { walkChecks }=await import('./walk-capture.mjs');
    await walkChecks(page,{name,dir,rows,errors,args});
    views=[];
  }
  if(args.includes('--north-motion')) {
    const {woodlandMotionChecks}=await import('./woodland-motion-capture.mjs');
    await woodlandMotionChecks(page,{name,dir,rows,errors,args});views=[];
  }
  if(args.includes('--rainware')) {
    const {rainwareChecks}=await import('./rainware-capture.mjs');
    await rainwareChecks(page,{name,dir,rows,errors,args});views=[];
  }
  if(args.includes('--ui')) {
    const {uiChecks}=await import('./ui-check.mjs');
    await uiChecks(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--window-uv')) {
    const {windowUVChecks}=await import('./window-uv-capture.mjs');
    await windowUVChecks(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--stain-blend')) {
    const {stainBlendChecks}=await import('./stain-blend-capture.mjs');
    await stainBlendChecks(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--wall-stairs')) {
    const {wallStairChecks}=await import('./wall-stair-capture.mjs');
    await wallStairChecks(page,{name,dir,rows,errors,args});views=[];
  }
  if(args.includes('--stair-light-probe')) {
    const {stairLightChecks}=await import('./stair-light-probe.mjs');
    await stairLightChecks(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--stair-shadow-init')) {
    const {stairShadowInitCheck}=await import('./stair-shadow-init-check.mjs');
    await stairShadowInitCheck(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--folk')) {
    const {folkChecks}=await import('./folk-capture.mjs');
    await folkChecks(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--folk-soles')) {
    const {folkSoleChecks}=await import('./folk-sole-capture.mjs');
    await folkSoleChecks(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--trees')) {
    const {woodlandChecks}=await import('./woodland-capture.mjs');
    await woodlandChecks(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--leaf-wind')) {
    const {woodlandInstanceChecks}=await import('./woodland-instance-capture.mjs');
    await woodlandInstanceChecks(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--veg-study')) {
    const {woodlandDensityChecks}=await import('./woodland-density-capture.mjs');
    await woodlandDensityChecks(page,{name,dir,rows,errors});views=[];
  }
  if(args.includes('--tour')) {
    const {tourChecks}=await import('./tour-capture.mjs');
    await tourChecks(page,{name,dir,rows,errors,args});views=[];
  }
  if(args.includes('--step-study')) {
    const {stepStudy}=await import('./step-study.mjs');
    await stepStudy(page,{name,dir,rows,errors,args});views=[];
  }
  for (let r = 0; r < repeat; r++) for (const [view, query] of views) {
    await page.goto(`${process.env.BASE || 'http://localhost:8765'}/index.html?shot=1&hud=0&${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__READY && window.__captureFrame', { timeout: 60000 });
    if(errors.length)throw new Error(errors.join('\n'));
    const stem = `${name}-${view}-${r}`;
    if(args.includes('--veg-pixel-area'))await page.evaluate(value=>{
      for(const b of window.__world.instanceLOD.batches)if('pixelArea' in b)b.pixelArea=value;
    },Number(option('--veg-pixel-area')));
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
      if(errors.length)throw new Error(errors.join('\n'));
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
    if(args.includes('--textures')) {
      const {textureAudit}=await import('./texture-audit.mjs');await textureAudit(page,{name,dir,repeat:args.includes('--texture-repeat')?2:1});
    }
    if(args.includes('--program-audit')) {
      const {materialProgramAudit}=await import('./material-program-audit.mjs');await materialProgramAudit(page,{name:stem,dir,strict:args.includes('--program-strict')});
    }
    if(args.includes('--profile')) {
      const {profileGPU}=await import('./gpu-profile.mjs');
      row.gpu=await profileGPU(page,1000/row.actualFps);console.log(JSON.stringify(row.gpu));
    }
    console.log(`${view} #${r}: calls=${row.drawCalls} instances=${row.instances}/${row.instanceCapacity} fps=${row.actualFps.toFixed(1)} stable=${row.stableFrames}  ${row.compositorDifference}`);
    if (checkLOD) console.log(`  LOD culled=${row.culledInstances}, tris ${fullStats.triangles} → ${row.triangles}: ${lodDifference}`);
    if (row.drawCalls > 200 || !row.instances || row.instances > row.instanceCapacity
      || row.instances !== row.exposedInstances || row.dpr > 2 || !row.stableFrames) errors.push(`${view}: telemetry/stability/budget check failed`);
  }
  if(!views.length&&args.includes('--program-audit')) {
    const {materialProgramAudit}=await import('./material-program-audit.mjs');
    await materialProgramAudit(page,{name,dir,strict:args.includes('--program-strict')});
  }
} catch(e) {
  errors.push(String(e.stack||e));
  throw e;
} finally {
  await browser.close();
  writeFileSync(new URL(name + '.json', dir), JSON.stringify({ errors, rows }, null, 2) + '\n');
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
