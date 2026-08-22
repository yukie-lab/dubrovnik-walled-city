// 部位を色で塗り分けて撮る。「どの作り方の塊がそこに写っているか」を
// 推測ではなく色で答えるための計器。
//   node tools/partmap.mjs <name> <spec>     spec は shots.txt の 1 行と同じ
import puppeteer from 'puppeteer-core';
const [name, spec] = process.argv.slice(2);
const [, x, z, yaw, pitch, time, extra] = spec.split(':');
const url = `http://localhost:8765/index.html?shot=1${extra || ''}&hud=0&x=${x}&z=${z}&yaw=${yaw}&pitch=${pitch}&time=${time}`;
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--headless=new', '--use-angle=metal', '--window-size=1640,1060'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY === true', { timeout: 30000 });
await new Promise(r => setTimeout(r, 1200));
const legend = await page.evaluate((argv) => {
  const { THREE, scene } = window.__world;
  // 色は黄金角で回す。固定パレットを使い回すと、部位が 12 を超えた瞬間に
  // 二つの部位が同じ色になり、色分けの意味が消える(実際に消えた)。
  // CSS 文字列は three の色空間変換を通ると白に飛ぶことがある。数値で作る。
  const HUE = (i) => new THREE.Color().setHSL(((i * 0.381966) % 1), i % 2 ? 0.65 : 0.95,
    i % 3 === 2 ? 0.32 : 0.52, THREE.SRGBColorSpace);
  const out = [];
  // 札の無いメッシュもタグ単位で塗る(メルロンのようにインスタンスの塊は
  // 部位に割れないが、「どこまでが胸壁でどこからが狭間石か」は色で見たい)。
  const EXTRA = (argv[2] || '').split(',').filter(Boolean);
  let extraI = 100;
  scene.traverse((o) => {
    if (o.isMesh && o.name && (EXTRA.includes(o.name) || EXTRA.includes('*')) && !o.geometry?.userData?.parts) {
      o.material = new THREE.MeshBasicMaterial({ color: HUE(extraI++), side: THREE.FrontSide, fog: false });
      out.push({ tag: o.name, names: [`${o.name}=#${HUE(extraI - 1).getHexString()}`] });
      return;
    }
    const ps = o.geometry?.userData?.parts;
    if (!ps || !ps.length) return;
    const g = o.geometry, n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const names = [...new Set(ps.map(q => q.name))];
    const idx = g.index;
    for (const q of ps) {
      const ci = names.indexOf(q.name);
      const c = HUE(ci);
      for (let f = q.from; f < q.to; f++) for (let k = 0; k < 3; k++) {
        const v = idx ? idx.getX(f * 3 + k) : f * 3 + k;
        col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    o.material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.FrontSide, fog: false });
    out.push({ tag: o.userData?.tag, names: names.map((nm, i) => `${nm}=#${HUE(i).getHexString()}`) });
  });
  return out;
}, process.argv.slice(2));
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: new URL(`../shots/${name}.png`, import.meta.url).pathname });
console.log(JSON.stringify(legend));
await browser.close();
