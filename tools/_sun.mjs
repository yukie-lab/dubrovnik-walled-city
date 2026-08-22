import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--headless=new','--use-angle=metal'] });
const p = await b.newPage();
await p.goto('http://localhost:8765/index.html?shot=1&hud=0&x=172.5&z=14&yaw=-1.6&pitch=-0.02&time=17.9&gy=1.7', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY === true', { timeout: 30000 });
await new Promise(r=>setTimeout(r,1200));
console.log(await p.evaluate(() => {
  const m = document.querySelector('canvas');
  const w = window.__world;
  const sky = w.scene.children[6];
  let su = null;
  w.scene.children[5].traverse(o => { if (o.isMesh && o.material.uniforms && o.material.uniforms.uFog) su = o.material.uniforms; });
  let u = null;
  sky.traverse(o => { if (o.isMesh && o.material.uniforms && o.material.uniforms.uZenith) u = o.material.uniforms; });
  const g = (c) => c ? [+c.r.toFixed(3), +c.g.toFixed(3), +c.b.toFixed(3)] : null;
  return JSON.stringify({
    zen: g(u?.uZenith?.value), hor: g(u?.uHorizon?.value), horF: g(u?.uHorizonFar?.value),
    gain: u?.uSkyGain?.value, sunDir: u?.uSunDir?.value && [+u.uSunDir.value.x.toFixed(2), +u.uSunDir.value.y.toFixed(2), +u.uSunDir.value.z.toFixed(2)],
    camPos: [w.camera.position.x|0, +w.camera.position.y.toFixed(1), w.camera.position.z|0],
    skyPos: [sky.position.x|0, sky.position.y|0, sky.position.z|0],
    seaFog: su ? [+su.uFog.value.r.toFixed(3), +su.uFog.value.g.toFixed(3), +su.uFog.value.b.toFixed(3)] : null,
    seaDeep: su ? [+su.uDeep.value.r.toFixed(3), +su.uDeep.value.g.toFixed(3), +su.uDeep.value.b.toFixed(3)] : null,
    seaSkyRef: su ? [+su.uSkyRef.value.r.toFixed(3), +su.uSkyRef.value.g.toFixed(3), +su.uSkyRef.value.b.toFixed(3)] : null,
    fogSceneCol: [+w.scene.fog.color.r.toFixed(3), +w.scene.fog.color.g.toFixed(3), +w.scene.fog.color.b.toFixed(3)],
    fogDensity: w.scene.fog.density,
  });
}));
await b.close();
