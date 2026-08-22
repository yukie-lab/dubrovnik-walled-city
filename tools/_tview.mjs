// 塔のテラスから外がどれだけ見えるか。床の何点かに立って全方位へレイを撃つ。
import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import { collectObjects, buildTriangles, Grid, castRay } from './structure/geom.mjs';
const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const plan = w.plan;
const objects = collectObjects(w.root);
const { tris, owner } = buildTriangles(objects, { filter: (o) => !o.backdrop && !o.isPoints });
const grid = new Grid(tris, 4);
const stone = (oi) => objects[oi].solid && !objects[oi].thin;
for (const [nm, t] of Object.entries(plan.TOWERS)) {
  const rTop = t.terraceR ?? (t.crownR - 0.80);
  const y = t.topY + 0.05 + 1.62;
  let open = 0, tot = 0, openMid = 0, totMid = 0;
  for (const rr of [0, rTop * 0.45, rTop * 0.8]) {
    for (let a = 0; a < 24; a++) {
      const aa = (a / 24) * Math.PI * 2;
      const px = t.x + Math.cos(aa) * rr, pz = t.z + Math.sin(aa) * rr;
      for (let h = 0; h < 36; h++) {
        const ha = (h / 36) * Math.PI * 2;
        for (const v of [-10, -5, 0, 4]) {
          const va = v * Math.PI / 180;
          const hit = castRay(grid, owner, px, y, pz, Math.cos(ha) * Math.cos(va), Math.sin(va), Math.sin(ha) * Math.cos(va), 40, stone);
          tot++; if (!hit) open++;
          if (rr < 0.01) { totMid++; if (!hit) openMid++; }
        }
      }
    }
  }
  console.log(`${nm.padEnd(9)} 床 y=${(t.topY + 0.05).toFixed(2)} 胸壁の天端 y=${(t.topY + 1.35).toFixed(2)} (床上 ${(1.30).toFixed(2)}m)  外が見える ${(open / tot * 100).toFixed(1)}%  中央だけ ${(openMid / totMid * 100).toFixed(1)}%`);
}
