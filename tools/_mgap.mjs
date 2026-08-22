// 隣り合うメルロンの間隔と、重なりを測る。
import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import * as THREE from 'three';
import { collectObjects } from './structure/geom.mjs';
const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const mm = collectObjects(w.root).filter(o => o.tag === 'wall.merlon');
const P = new THREE.Vector3();
const info = mm.map(o => {
  const M = o.matrix;
  const c = new THREE.Vector3(0, 0, 0).applyMatrix4(M);
  const xdir = new THREE.Vector3(1, 0, 0).applyMatrix4(M).sub(c);   // 幅方向(スケール込み)
  const halfW = xdir.length() * 1.06 / 2;
  return { c, u: xdir.normalize(), halfW, box: o.box };
});
// 近いもの同士を総当り(244 本なので十分)
let overlap = 0, minGap = 9, worst = null;
const rows = [];
for (let i = 0; i < info.length; i++) for (let j = i + 1; j < info.length; j++) {
  const A = info[i], B = info[j];
  const d = A.c.distanceTo(B.c);
  if (d > 3.5) continue;
  // 幅方向の投影で隙間を測る
  const gap = d - (A.halfW + B.halfW);
  if (gap < minGap) { minGap = gap; worst = [A.c.toArray().map(v=>+v.toFixed(1)), B.c.toArray().map(v=>+v.toFixed(1))]; }
  if (gap < 0.05) { overlap++; rows.push({ gap, a: A.c.toArray().map(v=>+v.toFixed(1)), b: B.c.toArray().map(v=>+v.toFixed(1)) }); }
}
console.log(`メルロン ${info.length} 本。隣との隙間が 5cm 未満の対: ${overlap}  最小隙間 ${minGap.toFixed(3)}m`);
rows.sort((a,b)=>a.gap-b.gap);
for (const r of rows.slice(0, 12)) console.log(`   隙間 ${r.gap.toFixed(3)}  ${r.a.join(',')} ↔ ${r.b.join(',')}`);
