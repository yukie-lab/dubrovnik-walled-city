// 巨大な三角形を洗い出す。城壁の部材で 40m² を超える面は、ほぼ必ず
// 「どこかへ飛んでいった頂点」を持つ板。
import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import { collectObjects, buildTriangles } from './structure/geom.mjs';
const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const MIN = Number(process.argv[2] || 40);
const rows = [];
for (const o of collectObjects(w.root)) {
  if (o.backdrop || o.isPoints) continue;
  if (process.argv[3] && o.tag !== process.argv[3]) continue;
  if (!process.argv[3] && /^(sea|ground|sky|surround)\./.test(o.tag || '')) continue;
  const parts = o.mesh?.geometry?.userData?.parts || null;
  const { tris } = buildTriangles([o], {});
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i];
    const ax=t[3]-t[0],ay=t[4]-t[1],az=t[5]-t[2],bx=t[6]-t[0],by=t[7]-t[1],bz=t[8]-t[2];
    const a = Math.hypot(ay*bz-az*by, az*bx-ax*bz, ax*by-ay*bx)/2;
    if (a < MIN) continue;
    // 一番長い辺 = どれだけ遠くへ飛んだか
    let L = 0;
    for (const [p,q] of [[0,1],[1,2],[2,0]])
      L = Math.max(L, Math.hypot(t[p*3]-t[q*3], t[p*3+1]-t[q*3+1], t[p*3+2]-t[q*3+2]));
    let pn = '-'; if (parts) for (const q of parts) if (i>=q.from && i<q.to) pn = q.name;
    rows.push({ tag: o.tag, pn, a, L, t });
  }
}
rows.sort((x,y)=>y.a-x.a);
console.log(`${MIN}m² 超の三角: ${rows.length}`);
for (const r of rows.slice(0, 20)) {
  const v = [0,1,2].map(k => [r.t[k*3].toFixed(0), r.t[k*3+1].toFixed(0), r.t[k*3+2].toFixed(0)].join(','));
  console.log(`  ${String(r.a.toFixed(0)).padStart(6)}m² 最長辺${String(r.L.toFixed(0)).padStart(4)}m  ${(r.tag+'/'+r.pn).padEnd(28)} ${v.join(' | ')}`);
}
