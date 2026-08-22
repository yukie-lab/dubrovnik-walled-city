// 歩廊より上で、胸壁の外面より外へ出ている石を洗い出す。
// 「塀の上のブロックが飛び出ている」を数で言うための計器。
import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import { collectObjects, buildTriangles } from './structure/geom.mjs';
import { nearestOnPolyline } from '../src/util.js';
const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const plan = w.plan, pts = plan.wallPts;
// 各ノードの外側マイター点までの距離(= 胸壁の外面)
const halfAt = (nw) => {
  const i = nw.i, L = Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]);
  const t = L > 1e-6 ? Math.min(1, Math.max(0, Math.hypot(nw.x-pts[i-1][0], nw.z-pts[i-1][1]) / L)) : 0;
  return (plan.wallNodeHalf[i-1] ?? 3) * (1-t) + (plan.wallNodeHalf[i] ?? 3) * t;
};
const CX = 0, CZ = 15;
const rows = [];
for (const o of collectObjects(w.root)) {
  if (!/^wall\./.test(o.tag || '')) continue;
  const parts = o.mesh?.geometry?.userData?.parts;
  const { tris } = buildTriangles([o], {});
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i];
    for (let k = 0; k < 3; k++) {
      const x = t[k*3], y = t[k*3+1], z = t[k*3+2];
      const nw = nearestOnPolyline(pts, x, z);
      if (nw.d > 12) continue;
      const wy = plan.wallWalkYAt(nw);
      if (y < wy - 0.2 || y > wy + 4.0) continue;      // 歩廊の上だけ
      // 外側か内側か
      const dOut = Math.hypot(x - CX, z - CZ) > Math.hypot(nw.x - CX, nw.z - CZ);
      if (!dOut) continue;
      const jut = nw.d - halfAt(nw);
      if (jut > 0.10) { let pn = '-'; if (parts) for (const q of parts) if (i>=q.from&&i<q.to) pn = q.name;
        rows.push({ tag: o.tag, pn, jut, p: [x, y, z] }); }
    }
  }
}
rows.sort((a,b)=>b.jut-a.jut);
const agg = new Map();
for (const r of rows) { const k = r.tag + '/' + r.pn; const a = agg.get(k) || {n:0,max:0,p:null}; a.n++; if (r.jut>a.max){a.max=r.jut;a.p=r.p;} agg.set(k,a); }
console.log(`胸壁の外面より 10cm 以上外へ出た頂点: ${rows.length}`);
for (const [k,a] of [...agg].sort((x,y)=>y[1].max-x[1].max))
  console.log(`  ${k.padEnd(26)} ${String(a.n).padStart(5)} 個  最大 ${a.max.toFixed(2)}m @ ${a.p.map(v=>v.toFixed(1)).join(',')}`);
