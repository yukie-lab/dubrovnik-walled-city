import { installDomShim } from './structure/domshim.mjs';
installDomShim();
const { buildWorld } = await import('../src/world.js');
const { nearestOnPolyline } = await import('../src/util.js');
const w = buildWorld({});
const plan = w.plan;
for (const arg of process.argv.slice(2)) {
  const [x, z] = arg.split(',').map(Number);
  const nw = nearestOnPolyline(plan.wallPts, x, z);
  const n = plan.wallSegN[nw.i];
  const A = plan.wallPts[nw.i - 1], B = plan.wallPts[nw.i];
  const L = Math.hypot(B[0]-A[0], B[1]-A[1]);
  const t = L > 1e-6 ? Math.min(1, Math.max(0, Math.hypot(nw.x-A[0], nw.z-A[1]) / L)) : 0;
  console.log(`(${x},${z})  i=${nw.i} segN=${n} t=${t.toFixed(4)} nw.y=${nw.y.toFixed(3)} d=${nw.d.toFixed(2)}`);
  console.log(`   A.y=${A[2].toFixed(3)} B.y=${B[2].toFixed(3)}  walkY=${plan.wallWalkYAt(nw).toFixed(3)}  帯=${Math.round(t*n)}/${n}`);
  console.log(`   区間の t 範囲(帯 j): j=${Math.round(t*n)} → [${((Math.round(t*n)-0.5)/n).toFixed(4)}, ${((Math.round(t*n)+0.5)/n).toFixed(4)}]`);
}
