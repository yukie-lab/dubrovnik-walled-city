// 実路テスト: 階段・路地を「実際に歩いて」接続と段差を測る(plan は three 非依存)
import { buildPlan, makeRoutes } from '../src/plan.js';
import { nearestOnPolyline } from '../src/util.js';

const plan = buildPlan();

function walkPath(name, pts, opts = {}) {
  let y = plan.groundAt(pts[0][0], pts[0][1], opts.startY ?? pts[0][2] ?? 5).y;
  let maxJump = 0, lost = null, pushed = null;
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
    const L = Math.hypot(x1 - x0, z1 - z0);
    for (let s = 0.4; s <= L; s += 0.4) {
      const t = s / L;
      const wx = x0 + (x1 - x0) * t, wz = z0 + (z1 - z0) * t;
      const g = plan.groundAt(wx, wz, y);
      const jump = g.y - y;
      if (jump > 1.45 && !lost) lost = `seg${i}@${t.toFixed(2)} ${y.toFixed(2)}→${g.y.toFixed(2)}`;
      if (g.y < 0.4 && !lost) lost = `seg${i}@${t.toFixed(2)} 水域 y${g.y.toFixed(2)}`;
      maxJump = Math.max(maxJump, Math.abs(jump));
      if (jump <= 1.45 && g.y >= 0.4) y = g.y;
      // 実プレイヤーと同じ: 衝突解決で押し出されないか
      const c = plan.collide(wx, wz, 0.35, y + 1.0);
      const push = Math.hypot(c.x - wx, c.z - wz);
      if (push > 0.6 && !pushed) pushed = `seg${i}@${t.toFixed(2)} push${push.toFixed(1)}m`;
    }
  }
  if (pushed && !lost) lost = '衝突 ' + pushed;
  const target = pts[pts.length - 1][2];
  const ok = target === undefined || Math.abs(y - target) < 1.2;
  console.log(
    name.padEnd(16),
    'end', y.toFixed(2),
    target !== undefined ? `(目標 ${target})` : '',
    'maxStep', maxJump.toFixed(2),
    lost ? '❌ LOST ' + lost : (ok ? '✅' : '❌ 届かず'),
  );
  return { y, ok: ok && !lost };
}

console.log('--- 城壁への階段(通りから入口へ歩いて入る) ---');
for (const st of plan.WALL_STAIRS) {
  const [x0, z0] = st.pts[0];
  const [x1, z1] = st.pts[1];
  const L = Math.hypot(x1 - x0, z1 - z0);
  const bx = x0 - ((x1 - x0) / L) * 2.5;   // 入口の 2.5m 手前(街路側)
  const bz = z0 - ((z1 - z0) / L) * 2.5;
  const gApproach = plan.groundAt(bx, bz, st.pts[0][2] + 3);
  const gap = Math.abs(gApproach.y - st.pts[0][2]);
  const mark = gap > 1.2 ? `⚠ 入口段差${gap.toFixed(1)}m` : '';
  walkPath(st.id + (mark ? ' ' + mark : ''), [[bx, bz, gApproach.y], ...st.pts], { startY: gApproach.y });
}

console.log('--- 階段上端の接続(歩廊 or 塔頂テラス) ---');
for (const st of plan.WALL_STAIRS) {
  const e = st.pts[st.pts.length - 1];
  // 見晴らしの砲座(カヴァリエ)へ上がる螺旋は、歩廊ではなく砲座の天端に着く。
  // 歩廊との距離で測ると必ず「行き止まり」と出る — 測る相手が違う。
  if (st.id === 'stjohnTop' && plan.CAVALIER) {
    const C2 = plan.CAVALIER;
    const d = Math.hypot(e[0] - C2.x, e[1] - C2.z);
    const ok = d < (C2.r ?? 2.6) + 1.2 && Math.abs(e[2] - C2.y) < 1.0;
    console.log(st.id.padEnd(16), '砲座 d=', d.toFixed(2), '/', ((C2.r ?? 2.6) + 1.2).toFixed(2),
      'y', C2.y, ok ? '✅' : '❌ 行き止まり');
    continue;
  }
  if (st.id === 'mincetaTop') {
    const t = plan.TOWERS.minceta;
    const d = Math.hypot(e[0] - t.x, e[1] - t.z);
    const ok = d < t.crownR - 0.3 && Math.abs(e[2] - t.topY) < 1.0;
    console.log(st.id.padEnd(16), '塔頂 d=', d.toFixed(2), '/', (t.crownR - 0.3).toFixed(2), 'topY', t.topY, ok ? '✅' : '❌ 行き止まり');
    continue;
  }
  const nw = nearestOnPolyline(plan.wallPts, e[0], e[1]);
  // 階段の頭は歩廊デッキの外に出す(下をくぐると頭が石に入る)。
  // デッキとの間は踊り場が渡すので、許容は デッキ半幅 + 踊り場の長さ。
  const half = plan.wallNodeHalf[Math.max(0, nw.i - 1)];
  const lim = half + 1.6;
  const ok = nw.d < lim && Math.abs(nw.y - e[2]) < 1.5;
  console.log(st.id.padEnd(16), 'd=', nw.d.toFixed(2), '/', lim.toFixed(2), 'walkY', nw.y.toFixed(2), 'vs', e[2], ok ? '✅' : '❌ 行き止まり');
}

console.log('--- 北の路地を登る(ストラドゥン→ペリネ) ---');
let alleysOk = 0, alleysBad = [];
for (const s of plan.streets) {
  if (!s.id.startsWith('alleyN')) continue;
  const [x] = s.pts[0];
  const z0 = s.pts[0][1], z1 = s.pts[1][1];
  const r = walkPath(s.id, [[x, z0, undefined], [x, z1, undefined]], { startY: 3 });
  const targetY = plan.terrainHeight(x, z1);
  if (Math.abs(r.y - targetY) < 1.3) alleysOk++; else alleysBad.push(s.id);
}
console.log(`北路地 登頂 ${alleysOk} 本 / 不通: ${alleysBad.join(',') || 'なし'}`);

console.log('--- おすすめルート(自動ウォークと同じ定義を歩く) ---');
for (const r of makeRoutes(plan)) {
  const pts = r.wps.map(w => [w.x, w.z]);
  const g0 = plan.groundAt(pts[0][0], pts[0][1], 500);
  walkPath(`route:${r.id}`, pts, { startY: g0.y });
}

// ロヴリイェナツの岩から海沿いに下りて、ピレ橋に **上がれる** か。
// 橋の西端は長らく行き止まりで、そのための「西へ押し戻す壁」が
// collide に残っていた。岩から陸続きにした後、橋の袂まで来られるのに
// 2.2m 東へ弾かれて永久に橋へ上がれなかった(ユーザー報告)。
// 「入れるが帰れない」は trapstest が見るが、「近くまで来られるのに
// 上がれない」は誰も見ていなかった。定点で押さえる。
console.log('--- 城壁の外を回る(ロヴリイェナツの岩 ⇄ ピレ橋 ⇄ 門) ---');
{
  const legs = [
    ['岩→西の岸', 26, [[-224, 40], [-208, 14], [-194, 4], [-184, 2.4]]],
    ['西の岸→橋', 2.6, [[-184, 2.4], [-180, 2.2], [-176, 2.2, 2.8]]],
    ['橋→ピレ門', 2.8, [[-176, 2.2], [-166, 2.2], [-159, 2.0, 2.8]]],
    ['門→西の岸', 2.8, [[-159, 2.0], [-170, 2.2], [-182, 2.2], [-192, 4]]],
    ['橋の北肩', 2.6, [[-184, 6.0], [-179.5, 4.6], [-176, 3.6, 2.8]]],
    ['橋の南肩', 2.6, [[-184, -1.6], [-179.5, 0.4], [-176, 1.0, 2.8]]],
  ];
  let bad = 0;
  for (const [nm, sy, pts] of legs) if (!walkPath(nm, pts, { startY: sy }).ok) bad++;
  console.log(bad ? `  ${bad} 区間が通れない ❌` : '  外周は双方向に通れる ✅');
}

// 「完走はするが、壁を擦りながらじりじり進む」は上の walkPath では出ない
// (滑って進むので端点には届く)。航路点を結ぶ直線そのものが石の中を通って
// いないかを別に測る。旧港のオートがアルセナルの柱に当たり続けたのがこれ。
console.log('--- オート経路が実体に食い込んでいないか(押し戻し > 0.25m で不合格) ---');
{
  let bad = 0;
  for (const r of makeRoutes(plan)) {
    const w = r.wps;
    let worst = 0, worstAt = null, hits = 0;
    // 高さは歩きながら引き継ぐ。毎回 groundAt(..., 500) で引くと、街路の点でも
    // 「その真上にある城壁の天端」を拾ってしまい、存在しない食い込みを報告する。
    let curY = plan.groundAt(w[0].x, w[0].z, 500).y;
    for (let i = 1; i < w.length; i++) {
      const ax = w[i - 1].x, az = w[i - 1].z, bx = w[i].x, bz = w[i].z;
      const L = Math.hypot(bx - ax, bz - az);
      for (let d = 0; d <= L; d += 0.8) {
        const t = L > 1e-6 ? d / L : 0;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const g = plan.groundAt(x, z, curY + 1.2);
        if (!g) continue;
        curY = g.y;
        const c = plan.collide(x, z, 0.35, g.y + 1.0);
        const push = Math.hypot(c.x - x, c.z - z);
        if (push > worst) { worst = push; worstAt = [x, z, +g.y.toFixed(1)]; }
        if (push > 0.25) hits++;
      }
    }
    const at = worstAt ? ` 最大 ${worst.toFixed(2)}m @ (${worstAt[0].toFixed(1)}, ${worstAt[1].toFixed(1)}) y=${worstAt[2]}` : '';
    if (hits) {
      bad++;
      console.log(`  route:${r.id.padEnd(9)} ❌ ${hits} 点で食い込み${at}`);
    } else {
      console.log(`  route:${r.id.padEnd(9)} ✅${at}`);
    }
  }
  if (!bad) console.log('  経路の食い込み: ✅ なし');
}

// 歩廊は「一本の廊下」なので、どこか 1 点でも塞がれば一周が成立しない。
// 中心線を 1m 刻みで進み、横断方向に立てる帯の幅を測る。
// (ドミニコ会修道院が歩廊を跨いで幅 0.00m の行き止まりを作っていた)
console.log('--- 城壁の歩廊が塞がれていないか(有効幅) ---');
{
  const pts = plan.wallPts;
  let stuck = 0, narrow = 0, worst = 99, worstAt = null;
  for (let i = 1; i < pts.length; i++) {
    const A = pts[i - 1], B = pts[i];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (len < 0.5) continue;
    const dx = (B[0] - A[0]) / len, dz = (B[1] - A[1]) / len;
    const nx = -dz, nz = dx;
    for (let d = 0; d < len; d += 1.0) {
      const t = d / len;
      const cx = A[0] + (B[0] - A[0]) * t, cz = A[1] + (B[1] - A[1]) * t;
      const gy = A[2] + (B[2] - A[2]) * t;
      let lo = null, hi = null;
      for (let o = -2.6; o <= 2.6; o += 0.1) {
        const x = cx + nx * o, z = cz + nz * o;
        const g = plan.groundAt(x, z, gy + 1.0);
        if (!g || Math.abs(g.y - gy) > 1.6) continue;
        const c = plan.collide(x, z, 0.35, g.y + 1.0);
        if (Math.hypot(c.x - x, c.z - z) > 0.06) continue;
        if (lo === null) lo = o; hi = o;
      }
      const w = (lo === null) ? 0 : hi - lo + 0.1;
      if (w < worst) { worst = w; worstAt = [cx, cz, gy]; }
      if (w < 0.75) stuck++; else if (w < 1.35) narrow++;
    }
  }
  const at = worstAt ? ` 最小 ${worst.toFixed(2)}m @ (${worstAt[0].toFixed(1)}, ${worstAt[1].toFixed(1)}) y=${worstAt[2].toFixed(1)}` : '';
  console.log(`  塞がり ${stuck} / 狭い ${narrow}  ${stuck ? '❌' : '✅'}${at}`);
}

console.log('--- 路地とプリイェコの交差が庭塀で塞がれていないか ---');
let blocked = [];
for (const s of plan.streets) {
  if (!s.id.startsWith('alleyN') || s.pts[1][1] > -70) continue;
  const x = s.pts[0][0];
  for (const zc of [-36, -74]) {
    // 交差点で横に 2m ずれてみる(通り抜けチェック)
    const g1 = plan.groundAt(x, zc, plan.terrainHeight(x, zc));
    const c = plan.collide(x, zc, 0.35, g1.y + 1);
    if (Math.hypot(c.x - x, c.z - zc) > 0.6) blocked.push(`${s.id}@z${zc}`);
  }
}
console.log('交差の押し出し:', blocked.length ? '❌ ' + blocked.join(' ') : '✅ なし');
