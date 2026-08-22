// メルロンが胸壁の上に本当に載っているかを測る。
// 底面の 4 隅から真下へレイを撃ち、当たった石の高さと部位を見る。
import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import * as THREE from 'three';
import { collectObjects, buildTriangles, Grid, castDown } from './structure/geom.mjs';
const { buildWorld } = await import('../src/world.js');
const w = buildWorld({});
const objects = collectObjects(w.root);
const { tris, owner } = buildTriangles(objects, { filter: (o) => !o.backdrop && !o.isPoints });
const grid = new Grid(tris, 4);
const parts = objects.find(o => o.tag === 'wall.curtain')?.mesh.geometry.userData.parts || [];
const partOf = (oi, ti) => {
  const o = objects[oi]; if (o.tag !== 'wall.curtain') return o.tag;
  // owner は三角の連番 → オブジェクト。部位は wall.curtain 内の三角番号が要る
  return o.tag;
};
const mm = objects.filter(o => o.tag === 'wall.merlon');
console.log('メルロンのインスタンス', mm.length);
const P = new THREE.Vector3();
let over = 0, gap = 0, tested = 0;
const bad = [];
const HW = 1.06 / 2 - 0.04, HD = 0.72 / 2 - 0.04;   // 隅は 4cm 内側で測る
for (let i = 0; i < mm.length; i++) {
  const M = mm[i].matrix;
  const base = new THREE.Vector3(0, 0, 0).applyMatrix4(M);
  if (base.y < 1) continue;
  tested++;
  const corners = [[-HW, 0, -HD], [HW, 0, -HD], [HW, 0, HD], [-HW, 0, HD], [0, 0, 0]];
  const hits = corners.map(c => {
    P.set(c[0], 0.0, c[2]).applyMatrix4(M);
    // メルロン自身の底面を拾わないよう、狭間石のメッシュは除く。
    // これを忘れると「常に支えられている」と出る(実際に出た)。
    const h = castDown(grid, owner, P.x, P.z, P.y + 0.20, (oi) => objects[oi].tag !== 'wall.merlon');
    return { p: [P.x, P.y, P.z], y: h ? h.y : null, tag: h ? objects[h.obj].tag : null };
  });
  const ds = hits.map(h => h.y === null ? 99 : base.y - h.y);
  const worst = Math.max(...ds);
  const bury = -Math.min(...ds);          // 段が下を横切ると、片端が石に埋まる
  if (worst > 0.10 || bury > 0.10) { over++;
    bad.push({ i, w: worst, base: base.toArray().map(v => +v.toFixed(1)),
      d: hits.map(h => h.y === null ? 'なし' : (base.y - h.y).toFixed(2)).join(' '),
      tags: [...new Set(hits.map(h => h.tag))].join(',') }); }
}
console.log(`底が石に載っていない/段に埋まっているメルロン: ${over} / ${tested}`);
bad.sort((a, b) => b.w - a.w);
for (const b of bad) console.log(`   最悪 ${b.w === 99 ? 'なし' : b.w.toFixed(2)}  底 ${b.base.join(',').padEnd(20)} 隅 ${b.d}  ${b.tags}`);
