// ============================================================================
// piercetest.mjs — 壁貫通QA(検出のみ・修正はしない)
//
// 自動ウォーク全4ルート(makeRoutes)と城壁階段5本(WALL_STAIRS 単体)を、
// src/main.js の auto.update / src/player.js の update と同じ数値で
// フレーム単位(dt=1/60)に歩かせ、「見た目は石壁なのに体が通り抜ける」
// 位置列を検出する。
//
// 実行: node tools/piercetest.mjs      (違反ありなら exit code 1)
//
// 検出種別:
//   A_CROSS   階段側壁の横断(連続2点で符号付き横距離が反転し、跳び幅が壁越え)
//   A_INWALL  階段側壁の厚み内に滞在(|s|∈(w/2+0.2, w/2+0.55) が2連続ステップ)
//   B_PARAPET 歩廊胸壁の外(|py−壁y|<2.6 で横距離 > walkHalf+0.1)
//   C_CROWN   ミンチェタ王冠リング内(門口方位 ±0.55rad 以外/天端高さ)
//   D_HOUSE   家の内部(AABB内かつ py < eaves−0.1)
//   E_CYL     塔円柱の内部(中心距離 < r−0.1 かつ py < y1−0.1)
//   WATCHDOG  6秒進捗なしでウェイポイントをスキップ(テストでは失敗扱い)
//
// テスト設計上の注意(意図した逸脱・限界は末尾の最終レポートにも出す):
//  - B には仕様の免除(塔・門・階段到着点)に加え、collide と同じ
//    「階段通行中(ns.d < w/2+0.8 かつ |py−ns.y| < 2.4)」免除を足した。
//    壁面に沿って登る露天階段(pileStair 等)の中腹は歩廊から横 2.6m 高さ
//    2.6m 以内に入るため、これが無いと正規の階段歩行が全て偽陽性になる。
//  - A の横断判定は両点の弧長が側壁の実在区間 s∈[0.5, L−1.6](collide の
//    シェルと同じ)に掛かる場合のみ数える。両端は乗り換えのため意図的に
//    開いている。
//  - A は「見える壁」の側だけ数える。walls.js を確認: 囲い階段(enclosed)は
//    両側+天井(ay−0.4..+2.5)、露天階段は谷側(城壁中心線から遠い側)の
//    手すり壁(ay−2.0..約+1.0)のみ。露天の山側や手すり天端より上に体が
//    ある場合は石壁が存在しないので違反にしない(仕様の帯のままだと
//    歩廊を普通に歩くだけで偽陽性になる — ploceStair 脇で実測済み)。
//  - p0(ルート開始の teleport 直後)も仕様どおり collide 解決後の位置を
//    使う(生の teleport 座標だと合成の進入点が壁内に生まれ偽陽性)。
//  - monuments.js / walls.js が実行時に push する extraColliders(鐘楼・教会・
//    門脇など)は three.js/canvas 依存のためこのヘッドレス計測には存在しない。
//    → 記念建築への貫通はこのテストでは検出できない(限界として報告)。
//
// ★ もっと大きな限界: このテストは plan.js の衝突モデルを plan.js の衝突モデル
//    で検証している。モデルが自己整合でありさえすれば、描かれている石とどれだけ
//    食い違っていても ALL CLEAN になる。「見た目は石壁なのに体が通り抜ける」の
//    本体は walls.js / buildings.js / ground.js が置く三角形との食い違いなので、
//    実際の描画を真実として測る tools/geomtest.mjs を必ず併せて回すこと。
// ============================================================================
import { buildPlan, makeRoutes } from '../src/plan.js';
import { nearestOnPolyline, polylineLength } from '../src/util.js';

const plan = buildPlan();
const routes = makeRoutes(plan);
const DT = 1 / 60;
const REACH = 1.25;

const shortestAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const angDist = (a, b) => {
  let d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
};

const STAIR_LEN = new Map(plan.WALL_STAIRS.map(st => [st.id, polylineLength(st.pts)]));
const STAIR_TOPS = plan.WALL_STAIRS.map(st => ({
  id: st.id, x: st.pts[st.pts.length - 1][0], z: st.pts[st.pts.length - 1][1],
}));
const TOWER_LIST = Object.entries(plan.TOWERS).map(([name, t]) => ({ name, ...t }));
const cylNameOf = (c) => TOWER_LIST.find(t => t.x === c.x && t.z === c.z)?.name ?? `cyl(${c.x},${c.z})`;

// 露天階段の手すり壁の側(walls.js と同一の判定: 城壁中心線から遠い側)
// stairId → 配列[セグメント終端 index] = +1/-1(sLat の符号と同じ規約)
const RAIL_SIDE = new Map();
for (const st of plan.WALL_STAIRS) {
  if (st.enclosed) continue;
  const arr = [];
  for (let i = 1; i < st.pts.length; i++) {
    const [ax, az] = st.pts[i - 1], [bx, bz] = st.pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    const nx = -dz, nz = dx;                     // +n 側 = sLat > 0 の側
    const half = st.w / 2 + 0.18;
    const midx = (ax + bx) / 2, midz = (az + bz) / 2;
    const dP = nearestOnPolyline(plan.wallPts, midx + nx * half, midz + nz * half).d;
    const dM = nearestOnPolyline(plan.wallPts, midx - nx * half, midz - nz * half).d;
    arr[i] = dP > dM ? 1 : -1;
  }
  RAIL_SIDE.set(st.id, arr);
}

// 家の空間グリッド(plan 内部のものは非公開なので同じ刻みで作り直す)
const CELL = 10;
const houseGrid = new Map();
plan.houses.forEach((h, i) => {
  const x0 = Math.floor((h.x - h.w / 2) / CELL), x1 = Math.floor((h.x + h.w / 2) / CELL);
  const z0 = Math.floor((h.z - h.d / 2) / CELL), z1 = Math.floor((h.z + h.d / 2) / CELL);
  for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
    const k = cx + ':' + cz;
    if (!houseGrid.has(k)) houseGrid.set(k, []);
    houseGrid.get(k).push(i);
  }
});
function* housesNear(x, z) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) {
    const list = houseGrid.get(gx + ':' + gz);
    if (list) yield* list;
  }
}

// ---------------------------------------------------------------- 違反 ----
const ALL = [];   // {type, run, wpIdx, x, z, py, target, frames}

// ---------------------------------------------------------------- 検出 ----
function makeDetector(runName) {
  const open = new Map();       // 連続する同一違反を1イベントに束ねる
  const crossEv = new Map();    // stairId → {ev, frameNo}
  let prev = null;
  let frameNo = 0;

  function fire(hits, p) {
    const seen = new Set();
    for (const h of hits) {
      seen.add(h.key);
      const ev = open.get(h.key);
      if (ev) { ev.frames++; continue; }
      const rec = {
        type: h.type, run: runName, wpIdx: p.wpIdx,
        x: p.x, z: p.z, py: p.py, target: h.target, frames: 1,
      };
      open.set(h.key, rec);
      ALL.push(rec);
    }
    for (const k of [...open.keys()]) if (!seen.has(k)) open.delete(k);
  }

  function step(p) {
    frameNo++;
    const hits = [];
    const stairInfo = new Map();

    // --- A. 階段側壁 --------------------------------------------------
    for (const st of plan.WALL_STAIRS) {
      const ns = nearestOnPolyline(st.pts, p.x, p.z);
      const L = STAIR_LEN.get(st.id);
      const half = st.w / 2;
      // 接線との外積 = 符号付き横距離(最近傍が頂点クランプ時は |s|<=d)
      const sLat = ns.tx * (p.z - ns.z) - ns.tz * (p.x - ns.x);
      const inBand = Math.abs(p.py - ns.y) < 2.3;
      const inArc = ns.s > 0.5 && ns.s < L - 1.6;
      // 「見える壁」の実在判定(冒頭の注意書き参照):
      //   囲い階段 = 両側・高さ帯 2.3 のまま / 露天 = 手すり側のみ・体の足が
      //   手すり天端(約 ay+1.0)より下にあるとき
      const railSign = st.enclosed ? 0 : (RAIL_SIDE.get(st.id)[ns.i] ?? RAIL_SIDE.get(st.id).find(v => v !== undefined));
      const visSide = st.enclosed || Math.sign(sLat) === railSign;
      const visHeight = st.enclosed ? inBand : (inBand && p.py - ns.y < 2.0);
      const inwall = visHeight && visSide && inArc
        && Math.abs(sLat) > half + 0.2 && Math.abs(sLat) < half + 0.55;
      const inStairC = ns.d < half + 0.8 && Math.abs(p.py - ns.y) < 2.4;   // collide の inStair と同じ
      stairInfo.set(st.id, { sLat, inBand, inArc, inwall, inStairC, visSide, visHeight });

      if (prev) {
        const q = prev.stair.get(st.id);
        // A-1 横断: 両点が高さ帯、符号反転、跳び幅が壁越え、側壁の実在区間。
        //           露天は「壁越えした遠い側の点」が手すり側のときだけ。
        const farVis = st.enclosed
          || (q && ((Math.abs(q.sLat) > Math.abs(sLat))
            ? (Math.sign(q.sLat) === railSign && q.visHeight)
            : (Math.sign(sLat) === railSign && visHeight)));
        if (q && q.inBand && inBand && (q.inArc || inArc) && farVis
          && q.sLat * sLat < 0
          && Math.max(Math.abs(q.sLat), Math.abs(sLat)) > half + 0.05) {
          const c = crossEv.get(st.id);
          if (c && frameNo - c.frameNo < 60) { c.ev.frames++; c.frameNo = frameNo; }
          else {
            const rec = {
              type: 'A_CROSS', run: runName, wpIdx: p.wpIdx,
              x: p.x, z: p.z, py: p.py,
              target: `${st.id} 側壁横断 s ${q.sLat.toFixed(2)}→${sLat.toFixed(2)} (w/2=${half.toFixed(2)})`,
              frames: 1,
            };
            ALL.push(rec);
            crossEv.set(st.id, { ev: rec, frameNo });
          }
        }
        // A-2 壁内滞在: 2連続ステップ
        if (q && q.inwall && inwall) {
          hits.push({
            key: 'A2|' + st.id, type: 'A_INWALL',
            target: `${st.id} 側壁の厚み内 |s|=${Math.abs(sLat).toFixed(2)} (帯 ${(half + 0.2).toFixed(2)}..${(half + 0.55).toFixed(2)})`,
          });
        }
      }
    }

    // --- B. 歩廊胸壁 --------------------------------------------------
    const nw = nearestOnPolyline(plan.wallPts, p.x, p.z);
    const kind = plan.wallKinds[Math.max(0, nw.i - 1)];
    const wk = plan.WALL_KIND[kind] || plan.WALL_KIND.sea;
    if (Math.abs(p.py - nw.y) < 2.6 && nw.d > wk.walkHalf + 0.1) {
      const exempt =
        TOWER_LIST.some(t => Math.hypot(p.x - t.x, p.z - t.z) < t.crownR + 1.3)
        || plan.GATES.some(g => Math.hypot(p.x - g.x, p.z - g.z) < 6)
        || STAIR_TOPS.some(s => Math.hypot(p.x - s.x, p.z - s.z) < 2.2)
        || [...stairInfo.values()].some(si => si.inStairC);   // 階段通行中(注意書き参照)
      if (!exempt) {
        hits.push({
          key: 'B|' + (nw.i - 1), type: 'B_PARAPET',
          target: `城壁 seg${nw.i - 1}(${kind}) 横距離 ${nw.d.toFixed(2)} > ${(wk.walkHalf + 0.1).toFixed(2)}`,
        });
      }
    }

    // --- C. ミンチェタ王冠リング --------------------------------------
    {
      const t = plan.TOWERS.minceta;
      const dT = Math.hypot(p.x - t.x, p.z - t.z);
      if (p.py > t.galleryY - 0.4 && dT > t.r - 0.2 && dT < t.crownR + 0.2) {
        const ang = Math.atan2(p.z - t.z, p.x - t.x);
        const ok = p.py < t.topY - 0.6 && plan.mincetaGaps.some(g => angDist(ang, g) < 0.55);
        if (!ok) {
          hits.push({
            key: 'C|minceta', type: 'C_CROWN',
            target: `minceta王冠リング dT=${dT.toFixed(2)}∈(${(t.r - 0.2).toFixed(1)},${(t.crownR + 0.2).toFixed(1)}) ang=${ang.toFixed(2)}`,
          });
        }
      }
    }

    // --- D. 家の内部 --------------------------------------------------
    for (const i of housesNear(p.x, p.z)) {
      const h = plan.houses[i];
      if (Math.abs(p.x - h.x) < h.w / 2 - 0.05
        && Math.abs(p.z - h.z) < h.d / 2 - 0.05
        && p.py < h.eaves - 0.1) {
        hits.push({
          key: 'D|' + i, type: 'D_HOUSE',
          target: `家(${h.x.toFixed(1)},${h.z.toFixed(1)}) w${h.w.toFixed(1)}×d${h.d.toFixed(1)} eaves${h.eaves.toFixed(1)}${h.garden ? ' [庭塀]' : ''}`,
        });
      }
    }

    // --- E. 塔円柱の内部 ----------------------------------------------
    for (const c of plan.extraCylinders) {
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < c.r - 0.1 && p.py < c.y1 - 0.1) {
        const name = cylNameOf(c);
        if (name === 'minceta' && p.py > plan.TOWERS.minceta.galleryY - 0.5) continue;
        hits.push({
          key: 'E|' + name, type: 'E_CYL',
          target: `塔円柱 ${name} d=${d.toFixed(2)} < ${(c.r - 0.1).toFixed(2)} (y1=${c.y1})`,
        });
      }
    }

    fire(hits, p);
    prev = { stair: stairInfo };
  }

  return { step };
}

// ------------------------------------------------- 操舵シミュレーション ----
// main.js auto.update + player.js update の忠実な再現(dt=1/60)。
function simulate(runName, wps, spawnCurY) {
  const det = makeDetector(runName);
  const p = {
    x: wps[0].x, z: wps[0].z,
    yaw: wps.length > 1 ? Math.atan2(-(wps[1].x - wps[0].x), -(wps[1].z - wps[0].z)) : 0,
    vx: 0, vz: 0, groundY: 0,
  };
  p.groundY = plan.groundAt(p.x, p.z, spawnCurY).y;   // teleport 相当
  {
    // p0 も仕様どおり「collide 解決後の位置」にする(生 teleport 座標は使わない)
    const c0 = plan.collide(p.x, p.z, 0.35, p.groundY + 1.0);
    p.x = c0.x; p.z = c0.z;
    const g0 = plan.groundAt(p.x, p.z, p.groundY);
    if (g0.y <= p.groundY + 1.45) p.groundY = g0.y;
  }
  det.step({ x: p.x, z: p.z, py: p.groundY + 1.0, wpIdx: 0 });

  const playerUpdate = (forward) => {
    const maxV = 1.5;
    let tx = 0, tz = 0;
    if (forward) { tx = -Math.sin(p.yaw) * maxV; tz = -Math.cos(p.yaw) * maxV; }
    const acc = forward ? 6.5 : 8.5;
    p.vx += (tx - p.vx) * Math.min(1, DT * acc);
    p.vz += (tz - p.vz) * Math.min(1, DT * acc);
    let nx = p.x + p.vx * DT, nz = p.z + p.vz * DT;
    const g = plan.groundAt(nx, nz, p.groundY);
    if (g.y > p.groundY + 1.45 || g.y < 0.4) { nx = p.x; nz = p.z; }   // 登れない段差・海面
    else p.groundY = g.y;
    const c = plan.collide(nx, nz, 0.35, p.groundY + 1.0);
    p.x = c.x; p.z = c.z;
    const g2 = plan.groundAt(p.x, p.z, p.groundY);
    if (g2.y <= p.groundY + 1.45 && g2.y >= 0.4) p.groundY = g2.y;
  };

  let wpIdx = 1, pauseT = 0, stuckT = 0, lastDist = 1e9;
  let frames = 0;
  const MAXF = 150000;   // 2500 sim 秒の安全弁
  while (wpIdx < wps.length && frames < MAXF) {
    frames++;
    const w = wps[wpIdx];
    if (pauseT > 0) {   // 眺めのポーズ(視線は yaw に影響するので再現する)
      pauseT -= DT;
      if (w.gaze) p.yaw += shortestAngle(w.gaze.yaw - p.yaw) * Math.min(1, DT * 1.6);
      playerUpdate(false);
      det.step({ x: p.x, z: p.z, py: p.groundY + 1.0, wpIdx });
      if (pauseT <= 0) { wpIdx++; lastDist = 1e9; stuckT = 0; }
      continue;
    }
    const dx = w.x - p.x, dz = w.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < REACH) {
      if (w.pause) { pauseT = w.pause; continue; }
      wpIdx++; lastDist = 1e9; stuckT = 0;
      continue;
    }
    if (dist > lastDist - 0.02) stuckT += DT; else stuckT = 0;
    lastDist = dist;
    if (stuckT > 6) {   // 自動ウォークはスキップするが、テストでは違反として記録
      ALL.push({
        type: 'WATCHDOG', run: runName, wpIdx,
        x: p.x, z: p.z, py: p.groundY + 1.0,
        target: `wp${wpIdx}(${w.x.toFixed(1)},${w.z.toFixed(1)}) 残り${dist.toFixed(2)}mで6秒進捗なし→スキップ`,
        frames: 360,
      });
      stuckT = 0; wpIdx++; lastDist = 1e9;
      continue;
    }
    const desired = Math.atan2(-dx, -dz);
    const dYaw = shortestAngle(desired - p.yaw);
    p.yaw += Math.max(-DT * 2.1, Math.min(DT * 2.1, dYaw));
    playerUpdate(Math.abs(dYaw) < 1.15);
    det.step({ x: p.x, z: p.z, py: p.groundY + 1.0, wpIdx });
  }
  if (frames >= MAXF) {
    ALL.push({
      type: 'WATCHDOG', run: runName, wpIdx,
      x: p.x, z: p.z, py: p.groundY + 1.0,
      target: `シミュレーション上限 ${MAXF} フレーム到達(未完走)`, frames: 0,
    });
  }
  console.log(`  ${runName.padEnd(24)} ${String(frames).padStart(6)}f (${(frames / 60).toFixed(0)}s) 終点(${p.x.toFixed(1)}, ${p.z.toFixed(1)}) y${p.groundY.toFixed(1)}`);
}

// ------------------------------------------------------------ 自己検証 ----
// 検出器が「発火し得る」ことを合成位置で証明する(発火しない検出器は
// 沈黙のまま ALL CLEAN を出してしまう — それを許さない)。
{
  const det = makeDetector('selftest');
  const feed = [];
  // D: 実在の家の中心
  const h = plan.houses.find(hh => !hh.garden && hh.w > 3 && hh.d > 3);
  feed.push(['D_HOUSE', { x: h.x, z: h.z, py: h.eaves - 0.5, wpIdx: 0 }]);
  // E: 北東角塔の円筒内・低所
  const ne = plan.TOWERS.neCorner;
  feed.push(['E_CYL', { x: ne.x, z: ne.z, py: 5, wpIdx: 0 }]);
  // B: 北壁の直線区間で胸壁の外へ 2.8m(塔・門・階段のどの免除にも掛からない)
  {
    const bx = -43, bz = -89.2;
    const nw = nearestOnPolyline(plan.wallPts, bx, bz);
    feed.push(['B_PARAPET', { x: bx, z: bz, py: nw.y + 1.0, wpIdx: 0 }]);
  }
  // C: ミンチェタ王冠リング内・門口から 1.5rad ずれた方位
  {
    const t = plan.TOWERS.minceta;
    const ang = plan.mincetaGaps[0] + 1.5;
    feed.push(['C_CROWN', {
      x: t.x + Math.cos(ang) * 9.3, z: t.z + Math.sin(ang) * 9.3,
      py: t.galleryY + 1.0, wpIdx: 0,
    }]);
  }
  // A_INWALL / A_CROSS: ピレ大階段の第1セグメント中点、手すり側の壁厚内
  {
    const st = plan.WALL_STAIRS.find(s => s.id === 'pileStair');
    const [ax, az, ay] = st.pts[0], [bx, bz, by] = st.pts[1];
    const len = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    const nx = -dz, nz = dx;
    const sv = RAIL_SIDE.get('pileStair')[1];
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, my = (ay + by) / 2;
    const off = st.w / 2 + 0.3;
    const pin = { x: mx + nx * sv * off, z: mz + nz * sv * off, py: my + 1.0, wpIdx: 0 };
    feed.push(['A_INWALL', pin]);
    feed.push(['A_INWALL', { ...pin }]);   // 2連続ステップ
    feed.push(['A_CROSS', { x: mx - nx * sv * 0.3, z: mz - nz * sv * 0.3, py: my + 1.0, wpIdx: 0 }]);
    feed.push(['A_CROSS', { ...pin }]);    // 符号反転 + 壁越え
  }
  for (const [, f] of feed) det.step(f);
  const fired = new Set(ALL.map(v => v.type));
  const want = ['A_CROSS', 'A_INWALL', 'B_PARAPET', 'C_CROWN', 'D_HOUSE', 'E_CYL'];
  const dead = want.filter(w => !fired.has(w));
  ALL.length = 0;   // 自己検証の発火は違反として数えない
  if (dead.length) {
    console.error(`自己検証 FAIL: 発火しない検出器 ${dead.join(', ')}`);
    process.exit(2);
  }
  console.log(`自己検証 OK (${want.length}/${want.length} の検出器が合成位置で発火)`);
}

// ---------------------------------------------------------------- 実行 ----
console.log('=== 貫通テスト: 自動ウォーク4ルート ===');
for (const r of routes) {
  simulate(`route:${r.id}`, r.wps, 500);   // ルート開始 = wps[0] へ teleport(curY=500)
}

console.log('=== 貫通テスト: 城壁階段5本(単体・上り/下り) ===');
for (const st of plan.WALL_STAIRS) {
  const [x0, z0] = st.pts[0], [x1, z1] = st.pts[1];
  const L1 = Math.hypot(x1 - x0, z1 - z0);
  // 入口 2.5m 手前(街路側)— walktest.mjs と同じ取り方
  const ax = x0 - ((x1 - x0) / L1) * 2.5;
  const az = z0 - ((z1 - z0) / L1) * 2.5;
  const pts = st.pts.map(q => ({ x: q[0], z: q[1] }));
  const up = [{ x: ax, z: az }, ...pts];
  const down = [...pts.slice().reverse(), { x: ax, z: az }];
  // spawn の層は階段の当該端に合わせる(500 だと塔頂など無関係の上層に生まれる)
  simulate(`stair:${st.id}:up`, up, st.pts[0][2] + 3);
  simulate(`stair:${st.id}:down`, down, st.pts[st.pts.length - 1][2] + 3);
}

// ---- 歩ける点が実体(塔・家)の中に入っていないか。
// 旧港と防波堤の付け根が聖イヴァン要塞(半径 7 の実体)の中を通っていたのを
// 既存のテストが 1 つも検出できなかった。歩行帯そのものを実体と突き合わせる。
{
  const bad = [];
  const test = (x, z) => {
    const g = plan.groundAt(x, z, 200);
    if (!g || g.y < -50) return;
    for (const [id, t] of Object.entries(plan.TOWERS)) {
      if (Math.hypot(x - t.x, z - t.z) < t.r - 0.35 && g.y > t.baseY + 0.4 && g.y < t.topY - 0.6) {
        bad.push(`塔 ${id} (${x.toFixed(0)}, ${z.toFixed(0)}) y${g.y.toFixed(1)}`); return;
      }
    }
    // 城壁の躯体。歩ける床が壁厚の中にあり、しかも歩廊より十分下なら貫通。
    // 門(gateCarve)の下は通り抜けて正しいので除外する。
    {
      const nw = nearestOnPolyline(plan.wallPts, x, z);
      const hi = Math.min(nw.i ?? 0, plan.wallNodeHalf.length - 1);
      const th = plan.wallNodeHalf[hi];
      let deckY = null;
      try { if (nw.i > 0) deckY = plan.wallWalkYAt(nw); } catch { deckY = null; }
      const nearGate = plan.GATES.some(gg => Math.hypot(x - gg.x, z - gg.z) < 9);
      if (!nearGate && nw.d < th - 0.5 && deckY != null && g.y < deckY - 1.6 && g.y > -1) {
        bad.push(`城壁 (${x.toFixed(0)}, ${z.toFixed(0)}) 床 y${g.y.toFixed(1)} / 歩廊 y${deckY.toFixed(1)} / 中心線から ${nw.d.toFixed(1)}m(壁半厚 ${th.toFixed(1)})`);
        return;
      }
    }
    for (const h of plan.houses) {
      if (h.garden) continue;
      if (x > h.x - h.w / 2 + 0.3 && x < h.x + h.w / 2 - 0.3
        && z > h.z - h.d / 2 + 0.3 && z < h.z + h.d / 2 - 0.3
        && g.y > h.yBase + 0.5 && g.y < h.eaves - 0.6) {
        bad.push(`家 (${x.toFixed(0)}, ${z.toFixed(0)}) y${g.y.toFixed(1)}`); return;
      }
    }
  };
  for (const w of plan.OUTSIDE_WALKS) {
    for (let x = w.x0; x <= w.x1; x += 1.2) for (let z = w.z0; z <= w.z1; z += 1.2) {
      if (w.has && !w.has(x, z)) continue;
      test(x, z);
    }
  }
  for (const s2 of plan.streets) {
    for (let i = 1; i < s2.pts.length; i++) {
      const [x0, z0] = s2.pts[i - 1], [x1, z1] = s2.pts[i];
      const L = Math.hypot(x1 - x0, z1 - z0);
      for (let d = 0; d < L; d += 1.6) {
        const t = d / L;
        test(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
      }
    }
  }
  // 門の脇の石の中に立てないか(免除が半径の円だと開口の外まで素通しになる)
  for (const g of plan.GATES) {
    for (const sgn of [-1, 1]) {
      // 開口の半幅は門ごとに違う。定数で書くと門を広げた途端に
      // 「通れる場所」を違反として数え始める。必ず g.w から作る。
      for (const out of [0.35, 1.0, 1.8]) {
        const off = g.w / 2 + out;
        const px = g.x + g.tx * sgn * off, pz = g.z + g.tz * sgn * off;
        const q = plan.collide(px, pz, 0.32, g.y + 1.2);
        if (Math.hypot(q.x - px, q.z - pz) < 0.02) {
          bad.push(`門 ${g.id} の脇 (${px.toFixed(1)}, ${pz.toFixed(1)}) 開口から ${out}m 外で押し返されない`);
        }
      }
    }
  }
  console.log('');
  console.log('--- 歩ける点が実体(塔・家・城壁・門脇)の中に入っていないか ---');
  if (bad.length) {
    for (const b of bad.slice(0, 10)) console.log('  実体貫通:', b);
    console.log(`  合計 ${bad.length} 件`);
    process.exit(1);
  }
  console.log('実体貫通: ✅ なし');
}

// ---------------------------------------------------------------- 報告 ----
console.log('');
if (ALL.length === 0) {
  console.log('ALL CLEAN');
  process.exit(0);
}
console.log(`=== 違反リスト(${ALL.length} 件)===`);
for (const v of ALL) {
  console.log(
    `[${v.type.padEnd(9)}] ${v.run.padEnd(24)} wp${String(v.wpIdx).padStart(2)} ` +
    `(${v.x.toFixed(2)}, ${v.z.toFixed(2)}, py ${v.py.toFixed(2)}) ` +
    `対象: ${v.target}` + (v.frames > 1 ? ` [${v.frames}f]` : ''),
  );
}
console.log('');
console.log('=== 集計 ===');
const byType = new Map();
for (const v of ALL) byType.set(v.type, (byType.get(v.type) || 0) + 1);
for (const [t, n] of [...byType.entries()].sort()) console.log(`  ${t.padEnd(9)} ${n} 件`);
console.log(`  合計      ${ALL.length} 件`);
process.exit(1);
