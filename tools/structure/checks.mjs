// ============================================================================
// checks.mjs — 主張(assertion)の本体。
//
// 各検査は「全ての違反」を返す。最初の 1 件で止まらない。
// 違反は { check, id, tag, pos:[x,y,z], measured, tolerance, error, note } 。
// error は符号つき: 正 = 浮き / 過剰、負 = めり込み / 不足。
// ============================================================================
import * as THREE from 'three';
import * as T from './tolerances.mjs';
import { nearestOnPolyline } from '../../src/util.js';
import { castDown, castRay, rayTri, meshTopology, triNormal, triCentroid, boxOverlap, Grid, buildTriangles } from './geom.mjs';

const V = (x, y, z) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000, Math.round(z * 1000) / 1000];

/**
 * フットプリント上の地形の最小・最大(中心・四隅・辺の中点の 9 点)。
 * 城壁や塔の石の中に入り込んでいる標本点は除く — そこは石で埋まっていて、
 * 「下に隙間が見える」ことが原理的に起こらない。除かないと、城壁際に建つ家が
 * 壁を貫通して外側の斜面を「地面」と読み、6m 浮いていると報告される。
 */
function footprintTerrain(ctx, h, accept, rayTop) {
  const { grid, owner, plan } = ctx;
  const hw = h.w / 2 - 0.02, hd = h.d / 2 - 0.02;
  let min = Infinity, max = -Infinity, minAt = null, maxAt = null, missing = false, buried = 0;
  for (const [sx, sz] of [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const x = h.x + sx * hw, z = h.z + sz * hd;
    const push = plan.collide(x, z, 0.02, h.yBase + 0.15);
    if (Math.hypot(push.x - x, push.z - z) > 0.05) { buried++; continue; }
    const hit = castDown(grid, owner, x, z, rayTop, accept);
    if (!hit) { missing = true; continue; }
    if (hit.y < min) { min = hit.y; minAt = [x, z]; }
    if (hit.y > max) { max = hit.y; maxAt = [x, z]; }
  }
  return { min, max, minAt, maxAt, buried, missing: missing && min === Infinity };
}

// ---------------------------------------------------------------------------
// 1. 接地 — 置いた物の底が、その下の支持面に載っているか
// ---------------------------------------------------------------------------
export function checkGrounding(ctx) {
  const { objects, grid, owner, plan } = ctx;
  const out = [];

  // (a) 家。plan.houses が「置いた記録」そのもの。家体は 701 棟が 1 メッシュに
  //     マージされているので、メッシュ単位では 1 棟ずつ測れない。
  //
  //   斜面に建つ家は「山を削って座る」ので、上手側では必ず地面より下に潜る。
  //   一点だけを見て「めり込み」と言うのは主張の書き方が誤り。フットプリント
  //   全体の地形の最小値・最大値を採り、
  //     浮き   : 基礎面が地形の最低点より上にある = どこかに隙間が空く
  //     埋没   : 地形の起伏で説明できる以上に深い
  //   の二つを別々に測る。これなら例外表も個別のオフセットも要らない。
  const terrainOk = (oi) => objects[oi].terrain || objects[oi].tag === 'ground.paving' || objects[oi].tag === 'ground.stradun';
  const RAY_TOP = 400;   // 北斜面は 40m を超える。基礎から数 m では地形の下から撃つことになる
  for (const h of plan.houses) {
    const t = footprintTerrain(ctx, h, terrainOk, RAY_TOP);
    if (t.min === Infinity) continue;    // 全ての標本が石の中 = 判定不能
    if (t.missing) {
      out.push({ check: 'grounding', id: `house@${V(h.x, h.yBase, h.z)}`, tag: 'house.body',
        pos: V(h.x, h.yBase, h.z), measured: null, tolerance: T.FLOAT_MAX, error: Infinity,
        note: 'フットプリントの下に地面の三角形が無い(海または虚空の上)', cause: 'house over void' });
      continue;
    }
    const float = h.yBase - t.min;   // 基礎面がフットプリントの最低点より上 = 壁の下から向こうが見える
    if (float > T.FLOAT_MAX) {
      out.push({ check: 'grounding', id: `house@${V(h.x, h.yBase, h.z)}`, tag: 'house.body',
        pos: V(t.minAt[0], h.yBase, t.minAt[1]), measured: Math.round(float * 1000) / 1000,
        tolerance: T.FLOAT_MAX, error: float, note: '基礎が地形の最低点より上にある(隙間)',
        cause: 'house floats above terrain' });
    }
    // 基礎は設計上 HOUSE_BASE_BURY だけ地面より下から始まる(壁の下に隙間を
    // 作らないため)。それを欠陥と呼ぶのは検査の側の誤り。
    const excess = (t.min - h.yBase) - plan.HOUSE_BASE_BURY - T.EMBED_MAX;
    if (excess > 0) {
      out.push({ check: 'grounding', id: `house@${V(h.x, h.yBase, h.z)}`, tag: 'house.body',
        pos: V(t.minAt[0], h.yBase, t.minAt[1]), measured: Math.round((t.min - h.yBase) * 1000) / 1000,
        tolerance: Math.round((plan.HOUSE_BASE_BURY + T.EMBED_MAX) * 1000) / 1000, error: -excess,
        note: '地形の起伏で説明できない深さまで埋まっている', cause: 'house sunk below terrain' });
    }
  }

  // (b) 置いたインスタンス。支持面は「自分以外で、いちばん近い下の面」。
  for (let oi = 0; oi < objects.length; oi++) {
    const ob = objects[oi];
    if (!ob.groundContact || ob.backdrop) continue;
    // 立っていない者(椅子・石段に座る人)の脚は接地しない — 生成側の宣言。
    if (ob.standing && ob.instance >= 0 && !ob.standing[ob.instance]) continue;
    if (ob.tag === 'house.body') continue;   // (a) で見た
    const cx = (ob.box.min.x + ob.box.max.x) / 2, cz = (ob.box.min.z + ob.box.max.z) / 2;
    // 同じ複合体(人体の胴と脚など)は支持面ではない。自分の脚に「載っている」
    // と報告するのは、検査が物の単位を取り違えているということ。
    const hit = castDown(grid, owner, cx, cz, ob.box.min.y + 0.6,
      (o) => o !== oi && !objects[o].thin && !objects[o].decal
        && !(ob.composite && objects[o].composite === ob.composite && objects[o].instance === ob.instance));
    if (!hit) {
      out.push({ check: 'grounding', id: ob.id, tag: ob.tag, pos: V(cx, ob.box.min.y, cz),
        measured: null, tolerance: T.FLOAT_MAX, error: Infinity, note: '支持面が無い', cause: ob.tag });
      continue;
    }
    const err = ob.box.min.y - hit.y;
    // 底を意図的に埋める物(石段)は浮きだけを問う。
    const embedLimit = ob.buriedBase ? -Infinity : -T.EMBED_MAX;
    if (err > T.FLOAT_MAX || err < embedLimit) {
      out.push({ check: 'grounding', id: ob.id, tag: ob.tag, pos: V(cx, ob.box.min.y, cz),
        measured: Math.round(err * 1000) / 1000, tolerance: err > 0 ? T.FLOAT_MAX : -T.EMBED_MAX,
        error: err, note: err > 0 ? '浮いている' : 'めり込んでいる',
        cause: `${ob.tag} on ${objects[hit.obj].tag}` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. フットプリントの四隅 — 中心が合っていても斜面側の角は浮く
// ---------------------------------------------------------------------------
export function checkFootprintCorners(ctx) {
  const { grid, owner, objects, plan } = ctx;
  const terrainOk = (oi) => objects[oi].terrain || objects[oi].tag === 'ground.paving' || objects[oi].tag === 'ground.stradun';
  const out = [];
  // 中心が座っていても、斜面に張り出した角だけが浮く — これが実際に
  // いちばん多い欠陥で、中心だけを見る検査は必ず見落とす。
  // 角は「地面より下」であることだけを問う(上手側の角が埋まるのは正しい)。
  for (const h of plan.houses) {
    const hw = h.w / 2 - 0.02, hd = h.d / 2 - 0.02;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = h.x + sx * hw, z = h.z + sz * hd;
      const push = plan.collide(x, z, 0.02, h.yBase + 0.15);
      if (Math.hypot(push.x - x, push.z - z) > 0.05) continue;   // 石(城壁・塔)の中
      const hit = castDown(grid, owner, x, z, 400, terrainOk);
      if (!hit) {
        out.push({ check: 'footprintCorner', id: `house@${V(h.x, h.yBase, h.z)}`, tag: 'house.body',
          pos: V(x, h.yBase, z), measured: null, tolerance: T.CORNER_FLOAT_MAX, error: Infinity,
          note: '角の下に地面が無い', cause: 'house corner over void' });
        continue;
      }
      const err = h.yBase - hit.y;
      if (err > T.CORNER_FLOAT_MAX) {
        out.push({ check: 'footprintCorner', id: `house@${V(h.x, h.yBase, h.z)}`, tag: 'house.body',
          pos: V(x, h.yBase, z), measured: Math.round(err * 1000) / 1000,
          tolerance: T.CORNER_FLOAT_MAX, error: err,
          note: '角が斜面から浮いている(中心は座っている)', cause: 'house corner floats on slope' });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. 石段の連続性
// ---------------------------------------------------------------------------
export function checkStairs(ctx) {
  const { objects } = ctx;
  const out = [];
  const stepObj = objects.find((o) => o.tag === 'steps' && o.mesh.userData.steps);
  if (!stepObj) return [{ check: 'stairs', id: 'steps', tag: 'steps', pos: [0, 0, 0],
    measured: null, tolerance: null, error: 0, note: '石段のインスタンス素データが見つからない' }];
  const items = stepObj.mesh.userData.steps;
  const runs = new Map();
  items.forEach((it, i) => {
    const k = `${it.run}:${it.seg}`;
    (runs.get(k) || runs.set(k, []).get(k)).push({ ...it, i });
  });
  for (const [k, arr] of runs) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => a.step - b.step);
    const rises = [];
    for (let i = 1; i < arr.length; i++) rises.push(arr[i].y - arr[i - 1].y);
    const med = [...rises].sort((a, b) => a - b)[rises.length >> 1];
    for (let i = 1; i < arr.length; i++) {
      const r = rises[i - 1];
      const a = arr[i];
      const ar = Math.abs(r);
      if (ar < T.MIN_RISE || ar > T.MAX_RISE) {
        out.push({ check: 'stairs', id: `step#${a.i}`, tag: 'steps', pos: V(a.x, a.y, a.z),
          measured: Math.round(r * 1000) / 1000,
          tolerance: ar > T.MAX_RISE ? T.MAX_RISE : T.MIN_RISE,
          error: ar > T.MAX_RISE ? ar - T.MAX_RISE : ar - T.MIN_RISE,
          note: ar > T.MAX_RISE ? '蹴上が高すぎる(よじ登る)' : '蹴上が低すぎる(躓く)',
          cause: `run ${k}` });
      }
      if (Math.abs(r - med) > T.RISE_DEVIATION_MAX) {
        out.push({ check: 'stairs', id: `step#${a.i}`, tag: 'steps', pos: V(a.x, a.y, a.z),
          measured: Math.round(r * 1000) / 1000, tolerance: T.RISE_DEVIATION_MAX, error: r - med,
          note: `同じ run の中央値 ${med.toFixed(3)} から外れた 1 段(置き間違い)`, cause: `run ${k} deviation` });
      }
      // 踏面と蹴上の隙間: 次の段の踏板は前の段の踏板と水平方向に重なるべき。
      const adv = Math.hypot(a.x - arr[i - 1].x, a.z - arr[i - 1].z);
      const overlap = (a.d + arr[i - 1].d) / 2 - adv;
      if (overlap < -T.STEP_GAP_MAX) {
        out.push({ check: 'stairs', id: `step#${a.i}`, tag: 'steps', pos: V(a.x, a.y, a.z),
          measured: Math.round(-overlap * 1000) / 1000, tolerance: T.STEP_GAP_MAX, error: -overlap,
          note: '踏面と踏面の間に隙間(足が抜ける)', cause: `run ${k} gap` });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. 歩行 — カプセルを掃く
// ---------------------------------------------------------------------------
function walkPath(ctx, pts, label, opts = {}) {
  const { grid, owner, objects, plan } = ctx;
  const out = [];
  // 「床」は歩ける面に限る。何でも受けると、路地の上に張り出した軒を踏んで
  // 「3.8m の段差」と報告する(足の下にあるのは屋根であって床ではない)。
  const WALKABLE = new Set(['ground.near', 'ground.far', 'ground.paving', 'ground.stradun',
    'steps', 'wall.curtain', 'monument.stone', 'surround.pileBridge', 'surround.quayKerb',
    'surround.arsenal', 'surround.lovrijenac', 'arcade.arch']);
  const solidOk = (oi) => WALKABLE.has(objects[oi].tag);
  // 標本の間隔は踏面(0.30〜0.55m)より細かくなければならない。1.5m 刻みで
  // 階段を測ると「3 段ぶん = 0.46m の段差」を毎回報告することになる。
  // 測りたいのは「一度に登る段差」であって「1.5m 進むと何 m 上がるか」ではない。
  const step = opts.step ?? 0.25;
  let prevY = null;
  let n = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const L = Math.hypot(bx - ax, bz - az);
    const m = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k <= m; k++) {
      if (i > 1 && k === 0) continue;
      const t = k / m;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      n++;
      const hit = castDown(grid, owner, x, z, (prevY ?? 60) + 4.0, solidOk);
      if (!hit) {
        out.push({ check: 'walkability', id: `${label}@${V(x, 0, z)}`, tag: label, pos: V(x, 0, z),
          measured: null, tolerance: T.FALL_MAX, error: Infinity,
          note: '足の下に床が無い(踏み抜け)', cause: `${label} no-floor` });
        continue;
      }
      if (prevY !== null) {
        const d = hit.y - prevY;
        if (d > T.STEP_UP_MAX) {
          out.push({ check: 'walkability', id: `${label}@${V(x, hit.y, z)}`, tag: label, pos: V(x, hit.y, z),
            measured: Math.round(d * 1000) / 1000, tolerance: T.STEP_UP_MAX, error: d - T.STEP_UP_MAX,
            note: '登れない段差', cause: `${label} step-up` });
        } else if (d < -T.FALL_MAX) {
          out.push({ check: 'walkability', id: `${label}@${V(x, hit.y, z)}`, tag: label, pos: V(x, hit.y, z),
            measured: Math.round(d * 1000) / 1000, tolerance: -T.FALL_MAX, error: d + T.FALL_MAX,
            note: '落下', cause: `${label} fall` });
        }
      }
      prevY = hit.y;
      // 見えている床と、体が立つ床(衝突モデルの基準)が一致するか。
      // ここがずれていると、目には段の上に立っているのに体は段の中にいる。
      if (!opts.skipLateral) {
        const g = plan.groundAt(x, z);
        if (g && g.y !== undefined && Math.abs(hit.y - g.y) > 0.25) {
          out.push({ check: 'walkability', id: `${label}@${V(x, hit.y, z)}`, tag: label, pos: V(x, hit.y, z),
            measured: Math.round((hit.y - g.y) * 1000) / 1000, tolerance: 0.25, error: hit.y - g.y,
            note: '描かれた床と体が立つ床が食い違う', cause: `${label} floor mismatch` });
        }
      }
      // 横の閊え: 胸の高さで衝突モデルに押し戻されるか。基準は衝突モデル自身の
      // 床(groundAt)。描画の床を使うと、段の上に立っているつもりで段の中を
      // 突いてしまい、押し戻しを「道が塞がっている」と誤読する。
      if (!opts.skipLateral) {
        const gy = plan.groundAt(x, z);
        const push = plan.collide(x, z, T.PLAYER_RADIUS, (gy && gy.y !== undefined ? gy.y : hit.y) + 0.9);
        const d2 = Math.hypot(push.x - x, push.z - z);
        if (d2 > 0.25) {
          out.push({ check: 'walkability', id: `${label}@${V(x, hit.y, z)}`, tag: label, pos: V(x, hit.y, z),
            measured: Math.round(d2 * 1000) / 1000, tolerance: 0.25, error: d2 - 0.25,
            note: '歩ける道の上で横に阻まれる', cause: `${label} lateral` });
        }
      }
    }
  }
  return { out, samples: n };
}

export function checkWalkability(ctx) {
  const { plan } = ctx;
  const out = [];
  let samples = 0;
  // ストラドゥン
  const stradun = plan.streets.find((s) => s.kind === 'stradun');
  if (stradun) {
    const r = walkPath(ctx, stradun.pts, 'stradun');
    out.push(...r.out); samples += r.samples;
  }
  // 路地の全辺
  for (const s of plan.streets) {
    if (s.kind === 'stradun') continue;
    const r = walkPath(ctx, s.pts, `street:${s.id || s.kind}`, { step: 0.25 });
    out.push(...r.out); samples += r.samples;
  }
  // 城壁の周回。中心線だけを歩くと、歩廊の縁の穴と胸壁の抜けを一切見ない
  // (人は幅いっぱいを歩き、縁から下を覗く)。幅方向にも掃く。
  const wp = plan.wallPts.map((p) => [p[0], p[1]]);
  const r = walkPath(ctx, [...wp, wp[0]], 'wallCircuit', { step: 0.5, skipLateral: true });
  out.push(...r.out); samples += r.samples;
  out.push(...wallDeckSweep(ctx));
  // 周回が閉じているか(データと歩行の両方)
  const d = Math.hypot(wp[0][0] - wp[wp.length - 1][0], wp[0][1] - wp[wp.length - 1][1]);
  if (d > T.CIRCUIT_CLOSE_MAX) {
    out.push({ check: 'walkability', id: 'wallCircuit.close', tag: 'wallCircuit',
      pos: V(wp[0][0], 0, wp[0][1]), measured: Math.round(d * 1000) / 1000,
      tolerance: T.CIRCUIT_CLOSE_MAX, error: d - T.CIRCUIT_CLOSE_MAX,
      note: '城壁の周回が閉じていない', cause: 'wall circuit open' });
  }
  ctx.stats.walkSamples = samples;
  return out;
}

// ---------------------------------------------------------------------------
// 5. 包絡 — 閉じた空間から空が漏れないか
//    水平方向は「門は通り抜けるもの」なので上方向の漏れだけを見る。
//    屋根と壁の取り合い、階段室の天井の穴はこれで出る。
// ---------------------------------------------------------------------------
/**
 * 歩廊を幅方向に掃く。中心線から左右へ、歩ける半幅いっぱいまで。
 *   ・足の下に床が無い     → デッキの穴(下の海が見える)
 *   ・胸壁の高さで外へ抜ける → 壁の抜け(向こうの海が見える)
 * どちらも「板を貼っただけ」の構造が残っている所に必ず出る。
 */
function wallDeckSweep(ctx) {
  const { grid, owner, objects, plan } = ctx;
  const out = [];
  const WALKABLE = new Set(['ground.near', 'ground.paving', 'ground.stradun', 'steps',
    'wall.curtain', 'monument.stone', 'arcade.arch', 'surround.arsenal']);
  const floorOk = (oi) => WALKABLE.has(objects[oi].tag);
  const stoneOk = (oi) => objects[oi].solid && !objects[oi].thin && !objects[oi].backdrop;
  const pts = plan.wallPts;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.01) continue;
    const tx = (bx - ax) / L, tz = (bz - az) / L;
    const nx = -tz, nz = tx;
    const half = Math.min(plan.wallNodeHalf[i - 1] ?? 3, plan.wallNodeHalf[i] ?? 3);
    const m = Math.max(1, Math.ceil(L / 0.8));
    for (let k = 0; k <= m; k++) {
      const t = k / m;
      const cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
      // 歩廊面の高さは plan の唯一の定義から採る(描画と足がここで一致している)。
      const nw = nearestOnPolyline(pts, cx, cz);
      const y = plan.wallWalkYAt(nw);
      for (const off of [-half + 0.4, -half * 0.5, 0, half * 0.5, half - 0.4]) {
        const x = cx + nx * off, z = cz + nz * off;
        const hit = castDown(grid, owner, x, z, y + 2.0, floorOk);
        if (!hit || y - hit.y > 1.2) {
          out.push({ check: 'walkability', id: `wallDeck@${V(x, y, z)}`, tag: 'wallDeck',
            pos: V(x, y, z), measured: hit ? Math.round((y - hit.y) * 1000) / 1000 : null,
            tolerance: 1.2, error: hit ? y - hit.y : Infinity,
            note: hit ? '歩廊の床が歩廊面より 1.2m 以上下(縁の穴)' : '歩廊の床が無い(下が見える)',
            cause: 'wall deck hole' });
        }
      }
      // 胸壁の抜け: 胸の高さで真横(外向き・内向き)へ撃つ。
      // 外/内 は (−tz, tx) がどちらを向くか判らない — ポリラインの巻き方向
      // 次第なので、市の重心からの距離で決める。逆に書くと、報告を読んだ
      // 人間が毎回反対側を探しに行くことになる。
      for (const sgn of [1, -1]) {
        const dOut = Math.hypot(cx + nx * sgn * 3 - 0, cz + nz * sgn * 3 - 15);
        const dIn = Math.hypot(cx - nx * sgn * 3 - 0, cz - nz * sgn * 3 - 15);
        const outward = dOut > dIn;
        const h = castRay(grid, owner, cx, y + 0.95, cz, nx * sgn, 0, nz * sgn, 12, stoneOk);
        if (!h) {
          out.push({ check: 'walkability', id: `wallGap@${V(cx, y + 0.95, cz)}`, tag: 'wallParapet',
            pos: V(cx, y + 0.95, cz), measured: null, tolerance: 12, error: Infinity,
            note: `胸壁が${outward ? '外' : '内'}側に無い(胸の高さで 12m 先まで石が無い)`,
            cause: `parapet missing ${outward ? 'outer' : 'inner'}` });
        }
      }
    }
  }
  return out;
}

export function checkEnvelope(ctx) {
  const { grid, owner, objects, plan } = ctx;
  const out = [];
  const solidOk = (oi) => !objects[oi].thin && !objects[oi].decal && !objects[oi].backdrop;
  const volumes = [];
  for (const g of plan.GATES) {
    volumes.push({ id: `gate:${g.id || V(g.x, g.y, g.z)}`, x: g.x, z: g.z, y: g.y + g.h * 0.45, tag: 'gatePassage' });
  }
  for (const [k, t] of Object.entries(plan.TOWERS || {})) {
    volumes.push({ id: `tower:${k}`, x: t.x, z: t.z, y: (t.galleryY ?? 10) - 1.2, tag: 'towerInterior' });
  }
  // 城壁の階段は露天(空に開いているのが正しい姿)。閉じた空間ではないので
  // ここでは問わない。閉じているのは門の通路と塔の内部。
  const N = T.ESCAPE_RAYS;
  for (const vol of volumes) {
    let leaks = 0;
    let worst = null;
    for (let i = 0; i < N; i++) {
      // 上半球を黄金角で一様に。
      const u = (i + 0.5) / N;
      const cy = u;                     // 0..1 → 上向きのみ
      const sy = Math.sqrt(Math.max(0, 1 - cy * cy));
      const ph = i * 2.39996323;
      const dx = Math.cos(ph) * sy, dz = Math.sin(ph) * sy;
      if (cy < 0.20) continue;          // ほぼ水平は「通路の口」。上への漏れだけを見る
      const hit = castRay(grid, owner, vol.x, vol.y, vol.z, dx, cy, dz, 70, solidOk);
      if (!hit) {
        leaks++;
        if (!worst) worst = [dx, cy, dz];
      }
    }
    if (leaks > 0) {
      out.push({ check: 'envelope', id: vol.id, tag: vol.tag, pos: V(vol.x, vol.y, vol.z),
        measured: leaks, tolerance: 0, error: leaks,
        note: `閉じた空間から上へ ${leaks} 本のレイが抜けた(屋根または壁の穴)`,
        cause: vol.tag });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 6. 当たり判定と見た目の一致
// ---------------------------------------------------------------------------
export function checkColliderAgreement(ctx) {
  const { grid, owner, objects, plan } = ctx;
  const out = [];
  const solidOk = (oi) => objects[oi].solid && !objects[oi].thin && !objects[oi].backdrop && !objects[oi].noCollide;
  const WALKABLE = new Set(['ground.near', 'ground.paving', 'ground.stradun', 'steps',
    'wall.curtain', 'monument.stone', 'surround.pileBridge', 'surround.quayKerb', 'arcade.arch']);
  const walkOk = (oi) => WALKABLE.has(objects[oi].tag);
  const WALK_ZONES = new Set(['stradun', 'street', 'alley', 'square', 'plaza', 'gate', 'stair', 'wall', 'port']);
  // 市域を 2m 格子で掃く。
  const X0 = -300, X1 = 310, Z0 = -180, Z1 = 200, STEP = 2.0;
  let probes = 0, phantom = 0, ghost = 0;
  for (let z = Z0; z <= Z1; z += STEP) {
    for (let x = X0; x <= X1; x += STEP) {
      const g = plan.groundAt(x, z);
      if (!g || g.y === undefined) continue;
      // 描かれた歩ける床が実際にそこにあるか。無ければ「街の外の海や斜面」で、
      // 衝突モデルが何を言おうと人は立てない。ここを問うと、城壁の外の
      // 海面上で 10,770 回「見えない壁」と報告することになる。
      // 市街の歩ける区域だけを問う。海の上や城壁の外の斜面まで掃くと、
      // 「衝突は塞ぐが石が見えない」を 8,000 回報告することになる
      // (そこは歩ける場所ではないので、衝突モデルが何を言おうと関係ない)。
      if (!WALK_ZONES.has(g.zone) || g.y < 0.3) continue;
      const floor = castDown(grid, owner, x, z, g.y + 3, walkOk);
      if (!floor || Math.abs(floor.y - g.y) > 1.0) continue;
      const y = g.y + 0.9;     // 胸の高さ
      probes++;
      const push = plan.collide(x, z, T.PLAYER_RADIUS, y);
      const blocked = Math.hypot(push.x - x, push.z - z) > 0.02;
      // 見えている石が近くにあるか(水平 4 方向 + 上下は見ない)
      // 3m まで見る。0.55m しか見ないと、家の内部の点(石の中)で
      // 「衝突は塞ぐが石が見えない」と 16,000 回報告してしまう — そこは
      // 壁の中であって、見えない壁ではない。
      const FAR = 3.0;
      let near = Infinity;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
        const h = castRay(grid, owner, x, y, z, dx, 0, dz, FAR, solidOk);
        if (h && h.dist < near) near = h.dist;
      }
      const visible = near <= T.PLAYER_RADIUS + T.COLLIDER_DEVIATION_MAX;
      const anyStone = near <= FAR;   // 石の中/石の際にいる
      if (blocked && !anyStone) {
        phantom++;
        out.push({ check: 'colliderAgreement', id: `probe@${V(x, y, z)}`, tag: 'phantomWall',
          pos: V(x, y, z), measured: Math.round((near === Infinity ? 99 : near) * 1000) / 1000,
          tolerance: T.COLLIDER_DEVIATION_MAX, error: 1,
          note: '見えない壁: 衝突は塞ぐが石が見えない', cause: 'collider without geometry' });
      } else if (!blocked && visible && near < T.PLAYER_RADIUS * 0.6) {
        ghost++;
        out.push({ check: 'colliderAgreement', id: `probe@${V(x, y, z)}`, tag: 'ghostWall',
          pos: V(x, y, z), measured: Math.round(near * 1000) / 1000,
          tolerance: T.COLLIDER_DEVIATION_MAX, error: -1,
          note: '透ける壁: 石は見えるが衝突が無い', cause: 'geometry without collider' });
      }
    }
  }
  ctx.stats.colliderProbes = probes;
  ctx.stats.phantom = phantom;
  ctx.stats.ghost = ghost;
  return out;
}

// ---------------------------------------------------------------------------
// 7. 相互貫入
//    意図した接合(石積みの目地・瓦の重なり・壁に嵌める建具)は札で許す。
//    許可は「全体の許容差を緩める」ことでは決してしない。
// ---------------------------------------------------------------------------
const JOINT_ALLOW = [
  // [A の札, B の札, 理由]
  ['house.roof', 'house.body', '屋根は壁体に載り、軒で被る'],
  ['house.roof', 'house.roof', '瓦の重なり'],
  ['house.ridgeTile', 'house.roof', '棟瓦は屋根に被せる'],
  ['house.chimney', 'house.roof', '煙突は屋根を貫く'],
  ['house.gableFin', 'house.body', '妻壁は壁体の続き'],
  ['house.gableFin', 'house.roof', '妻壁は屋根に取り合う'],
  ['house.plinth', 'house.body', '巾木は壁体の足元に回す'],
  ['house.plinth', 'house.plinth', '隣り合う基礎石。傾いた地面では段差で重なる(石積みの目地)'],
  ['house.plinth', 'house.downpipe', '縦樋は基礎石の前を降りて地面に達する'],
  ['house.downpipe', 'house.body', '縦樋は壁に留める'],
  ['window.frame', 'house.body', '窓枠は壁に嵌める'],
  ['window.shutter', 'window.frame', '鎧戸は枠に付く'],
  ['window.shutter', 'house.body', '鎧戸は壁に開く'],
  ['door.frameRect', 'house.body', '扉枠は壁に嵌める'],
  ['door.frameArch', 'house.body', '扉枠は壁に嵌める'],
  ['wall.merlon', 'wall.curtain', 'メルロンは胸壁に載る'],
  ['steps', 'ground.paving', '段は舗装に沈める'],
  ['steps', 'ground.stradun', '段は舗装に沈める'],
  ['steps', 'steps', '段は隣の段に重ねる(隙間を作らないため)'],
  ['monument.column', 'monument.stone', '柱は躯体に取り合う'],
  ['surround.quayKerb', 'ground.paving', '見切り石は舗装に沈める'],
  ['life.folkTorso', 'life.folkLegs', '同じ人体'],
  ['life.folkHead', 'life.folkTorso', '同じ人体'],
  ['life.folkArms', 'life.folkTorso', '同じ人体'],
  ['life.folkHair', 'life.folkHead', '同じ人体'],
  ['life.stallGoods', 'life.stallLeg', '台の上の商品'],
];
const allowKey = new Set();
for (const [a, b] of JOINT_ALLOW) { allowKey.add(a + '|' + b); allowKey.add(b + '|' + a); }

export function checkInterpenetration(ctx) {
  const { objects } = ctx;
  const out = [];
  // AABB の重なりで語れるのは「1 個の物」だけ。701 棟をマージした house.body の
  // AABB は街全体なので、それと重なることには何の意味も無い。
  // マージ済みメッシュ(20m を超える AABB)は対象から外し、その旨を統計に残す。
  const merged = new Set();
  const cand = objects.filter((o) => {
    if (!o.solid || o.backdrop || o.thin) return false;
    const sx = o.box.max.x - o.box.min.x, sz = o.box.max.z - o.box.min.z;
    if (sx > 20 || sz > 20) { merged.add(o.tag); return false; }
    return true;
  });
  ctx.stats.interpenetrationSkippedMerged = [...merged];
  // 粗い格子で候補を絞る(総当たりは 10^8 対になる)
  const CELL = 6;
  const cells = new Map();
  cand.forEach((o, i) => {
    const i0 = Math.floor(o.box.min.x / CELL), i1 = Math.floor(o.box.max.x / CELL);
    const j0 = Math.floor(o.box.min.z / CELL), j1 = Math.floor(o.box.max.z / CELL);
    for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
      const k = `${ii},${j}`;
      (cells.get(k) || cells.set(k, []).get(k)).push(i);
    }
  });
  const seen = new Set();
  for (const list of cells.values()) {
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const ia = list[a], ib = list[b];
      const kk = ia < ib ? `${ia},${ib}` : `${ib},${ia}`;
      if (seen.has(kk)) continue;
      seen.add(kk);
      const A = cand[ia], B = cand[ib];
      if (A.tag === B.tag && A.mesh === B.mesh && A.instance >= 0 && Math.abs(A.instance - B.instance) === 0) continue;
      if (allowKey.has(A.tag + '|' + B.tag)) continue;
      // 人体と持ち物は 1 個の物。胴と腕が重なるのは「重なっている」のではない。
      if (A.composite && A.composite === B.composite) continue;
      if (!boxOverlap(A.box, B.box, -T.INTERSECT_MAX)) continue;
      const ox = Math.min(A.box.max.x, B.box.max.x) - Math.max(A.box.min.x, B.box.min.x);
      const oy = Math.min(A.box.max.y, B.box.max.y) - Math.max(A.box.min.y, B.box.min.y);
      const oz = Math.min(A.box.max.z, B.box.max.z) - Math.max(A.box.min.z, B.box.min.z);
      const depth = Math.min(ox, oy, oz);
      if (depth <= T.INTERSECT_MAX) continue;
      out.push({ check: 'interpenetration', id: `${A.id} ∩ ${B.id}`, tag: `${A.tag}|${B.tag}`,
        pos: V((A.box.min.x + A.box.max.x) / 2, (A.box.min.y + A.box.max.y) / 2, (A.box.min.z + A.box.max.z) / 2),
        measured: Math.round(depth * 1000) / 1000, tolerance: T.INTERSECT_MAX, error: depth - T.INTERSECT_MAX,
        note: '別々の立体が重なっている', cause: `${A.tag}|${B.tag}` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 8. 同一平面の深度衝突(Z ファイティングの巣)
//    100 万本の総当たりは不可能。面積の大きい面(0.25m² 以上)だけを見る。
//    小さい面のちらつきは画面上 1 画素未満で、人間は気づかない。
// ---------------------------------------------------------------------------
export function checkCoplanar(ctx) {
  const { grid, owner, objects } = ctx;
  const out = [];
  const area = (t) => {
    const ax = t[3] - t[0], ay = t[4] - t[1], az = t[5] - t[2];
    const bx = t[6] - t[0], by = t[7] - t[1], bz = t[8] - t[2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    return Math.hypot(nx, ny, nz) / 2;
  };
  const big = [];
  for (let i = 0; i < grid.tris.length; i++) {
    const o = objects[owner[i]];
    if (o.backdrop || o.decal) continue;
    if (area(grid.tris[i]) >= 0.25) big.push(i);
  }
  ctx.stats.coplanarCandidates = big.length;
  const CELL = 3;
  const cells = new Map();
  for (const i of big) {
    const c = triCentroid(grid.tris[i]);
    const k = `${Math.floor(c[0] / CELL)},${Math.floor(c[1] / CELL)},${Math.floor(c[2] / CELL)}`;
    (cells.get(k) || cells.set(k, []).get(k)).push(i);
  }
  const reported = new Set();
  for (const list of cells.values()) {
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const ta = grid.tris[list[a]], tb = grid.tris[list[b]];
      if (owner[list[a]] === owner[list[b]]) continue;
      const na = triNormal(ta), nb = triNormal(tb);
      const dot = Math.abs(na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2]);
      if (dot < T.COPLANAR_EPS) continue;
      const ca = triCentroid(ta), cb = triCentroid(tb);
      const sep = Math.abs((cb[0] - ca[0]) * na[0] + (cb[1] - ca[1]) * na[1] + (cb[2] - ca[2]) * na[2]);
      if (sep >= T.Z_SEP_MIN) continue;
      // 中心どうしが遠ければ「同じ平面上の別の場所」— 重なっていない
      const d = Math.hypot(cb[0] - ca[0], cb[1] - ca[1], cb[2] - ca[2]);
      if (d > 1.2) continue;
      const oa = objects[owner[list[a]]], ob = objects[owner[list[b]]];
      const key = `${oa.tag}|${ob.tag}`;
      if (allowKey.has(key)) continue;   // 意図した接合(目地・瓦の重なり・建具の嵌め込み)
      if (reported.has(key + Math.round(ca[0]) + Math.round(ca[2])) ) continue;
      reported.add(key + Math.round(ca[0]) + Math.round(ca[2]));
      out.push({ check: 'coplanar', id: `${oa.id} / ${ob.id}`, tag: key, pos: V(ca[0], ca[1], ca[2]),
        measured: Math.round(sep * 100000) / 100000, tolerance: T.Z_SEP_MIN, error: sep - T.Z_SEP_MIN,
        note: '同一平面で 4mm 未満しか離れていない(Z ファイティング)', cause: key });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 9. 表現どうしの一致 — 歩く網・建てた石・地図が同じ街を指すか
// ---------------------------------------------------------------------------
export function checkCrossRepresentation(ctx) {
  const { grid, owner, objects, plan } = ctx;
  const out = [];
  const paved = (oi) => objects[oi].tag === 'ground.paving' || objects[oi].tag === 'ground.stradun'
    || objects[oi].tag === 'steps' || objects[oi].terrain;
  // (a) 網の全ての辺の下に、実際に敷かれた面があるか
  for (const s of plan.streets) {
    for (let i = 1; i < s.pts.length; i++) {
      const [ax, az] = s.pts[i - 1], [bx, bz] = s.pts[i];
      const L = Math.hypot(bx - ax, bz - az);
      const m = Math.max(1, Math.ceil(L / 3));
      for (let k = 0; k <= m; k++) {
        const t = k / m, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const y = plan.streetY(s, x, z);
        const hit = castDown(grid, owner, x, z, y + 2.5, paved);
        if (!hit || Math.abs(hit.y - y) > 0.5) {
          out.push({ check: 'crossRepresentation', id: `street:${s.id || s.kind}@${V(x, y, z)}`,
            tag: 'graphVsGeometry', pos: V(x, y, z),
            measured: hit ? Math.round((hit.y - y) * 1000) / 1000 : null, tolerance: 0.5,
            error: hit ? hit.y - y : Infinity,
            note: hit ? '網の高さと敷かれた面の高さが食い違う' : '網の辺の下に舗装が無い',
            cause: `street ${s.kind}` });
        }
      }
    }
  }
  // (b) 網の連結性: 端点を NODE_MERGE_MAX で溶接し、連結成分を数える
  const nodes = [];
  const parent = [];
  const nodeOf = (x, z) => {
    for (let i = 0; i < nodes.length; i++) {
      if (Math.hypot(nodes[i].x - x, nodes[i].z - z) <= T.NODE_MERGE_MAX) return i;
    }
    nodes.push({ x, z }); parent.push(nodes.length - 1); return nodes.length - 1;
  };
  // 節点は「全部作ってから」union-find を初期化する。作りながら初期化すると、
  // 後から生えた節点の parent が undefined になり、連結成分が壊れて
  // 「街路網が 34 個に分断されている」という嘘の報告になる。
  for (const s of plan.streets) for (const p of s.pts) nodeOf(p[0], p[1]);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const edges = [];
  for (const s of plan.streets) {
    const a = nodeOf(s.pts[0][0], s.pts[0][1]);
    const b = nodeOf(s.pts[s.pts.length - 1][0], s.pts[s.pts.length - 1][1]);
    edges.push([a, b, s]);
  }
  const unite = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (const s of plan.streets) {
    let prev = null;
    for (const p of s.pts) {
      const n = nodeOf(p[0], p[1]);
      if (prev !== null) unite(prev, n);
      prev = n;
    }
  }
  // 路地は大通りの「中心線」ではなく「縁」で終わる。端点どうしの距離だけで
  // 判定すると、実際には繋がっている交差点が別々の島に見える(実測 34 島)。
  // 端点が相手の街路の帯(半幅 + 1m)に入っていれば、そこは交差点。
  for (const s of plan.streets) {
    for (const end of [s.pts[0], s.pts[s.pts.length - 1]]) {
      const a2 = nodeOf(end[0], end[1]);
      for (const t2 of plan.streets) {
        if (t2 === s) continue;
        const n2 = nearestOnPolyline(t2.pts, end[0], end[1]);
        // 射影点で節点を作ると、その点は相手の街路の鎖に属さない別の島になる
        // (実測: 全 32 街路が「孤立」と報告された)。相手の鎖そのものへ繋ぐ。
        if (n2.d <= t2.w / 2 + 1.0) unite(a2, nodeOf(t2.pts[0][0], t2.pts[0][1]));
      }
    }
  }
  const comps = new Set();
  for (let i = 0; i < nodes.length; i++) comps.add(find(i));
  ctx.stats.streetNodes = nodes.length;
  ctx.stats.streetComponents = comps.size;
  if (comps.size > 1) {
    // どの街路が孤立しているかを名指しする
    const main = (() => {
      const size = new Map();
      for (let i = 0; i < nodes.length; i++) { const r = find(i); size.set(r, (size.get(r) || 0) + 1); }
      return [...size.entries()].sort((a, b) => b[1] - a[1])[0][0];
    })();
    for (const [a, , s] of edges) {
      if (find(a) !== main) {
        out.push({ check: 'crossRepresentation', id: `street:${s.id || s.kind}`, tag: 'graphConnectivity',
          pos: V(s.pts[0][0], 0, s.pts[0][1]), measured: comps.size, tolerance: 1, error: comps.size - 1,
          note: '街路網から切り離された辺(地図には描かれるが歩いて到達できない)',
          cause: 'graph disconnected' });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 10. 立体であること — 閉じているか、巻きは揃っているか、体積はあるか
// ---------------------------------------------------------------------------
export function checkManifold(ctx) {
  const { objects } = ctx;
  const out = [];
  const done = new Set();
  for (const ob of objects) {
    if (!ob.solid || done.has(ob.mesh)) continue;
    done.add(ob.mesh);
    // 生成側が三角形の範囲に部位の札を付けているなら、部位ごとに測る。
    // 「城壁が閉じていない」では直せない。「城壁のどの作り方が閉じていないか」なら直せる。
    const parts = ob.mesh.geometry.userData?.parts;
    if (parts && parts.length) {
      const byName = new Map();
      for (const q of parts) (byName.get(q.name) || byName.set(q.name, []).get(q.name)).push(q);
      for (const [nm, rs] of byName) out.push(...topoViolations(ctx, ob, `${ob.tag}:${nm}`, rs));
      continue;
    }
    out.push(...topoViolations(ctx, ob, ob.tag, null));
  }
  return out;
}

function topoViolations(ctx, ob, label, ranges) {
  const out = [];
  {
    const topo = meshTopology(ob.mesh.geometry, null, ranges);
    const tag = label;
    ctx.stats.manifoldChecked = (ctx.stats.manifoldChecked || 0) + 1;
    if (topo.boundaryEdges > 0) {
      out.push({ check: 'manifold', id: tag, tag: tag,
        pos: V(...(topo.boundarySample[0] || [0, 0, 0])),
        measured: topo.boundaryEdges, tolerance: 0, error: topo.boundaryEdges,
        note: `境界稜線 ${topo.boundaryEdges} 本(= 穴)。三角 ${topo.triCount}`,
        cause: `${tag} not watertight`,
        extra: { samples: topo.boundarySample.map((p) => V(...p)) } });
    }
    if (topo.nonManifoldEdges > 0) {
      out.push({ check: 'manifold', id: tag, tag: tag,
        pos: V(...(topo.nonManifoldSample[0] || [0, 0, 0])),
        measured: topo.nonManifoldEdges, tolerance: 0, error: topo.nonManifoldEdges,
        note: `3 面以上が共有する稜線 ${topo.nonManifoldEdges} 本(非多様体)`,
        cause: `${tag} non-manifold` });
    }
    if (topo.flippedEdges > 0) {
      out.push({ check: 'manifold', id: tag, tag: tag, pos: V(0, 0, 0),
        measured: topo.flippedEdges, tolerance: 0, error: topo.flippedEdges,
        note: `正逆の数が釣り合わない稜線 ${topo.flippedEdges} 本(面の巻きが裏返っている)`,
        cause: `${tag} winding` });
    }
    if (topo.boundaryEdges === 0 && Math.abs(topo.volume) < T.MIN_VOLUME) {
      out.push({ check: 'manifold', id: tag, tag: tag, pos: V(0, 0, 0),
        measured: topo.volume, tolerance: T.MIN_VOLUME, error: topo.volume,
        note: '閉じているが体積が無い(ぺしゃんこ)', cause: `${tag} degenerate` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 11. 裏面が内側を向いていないか
//     ray-escape は「面が無い穴」を見るが、「面はあるが片面で内向き」は
//     素通しする。内部の標本点から、囲む面の向きを直接測る。
// ---------------------------------------------------------------------------
export function checkBackfaces(ctx) {
  const { objects } = ctx;
  const out = [];
  const done = new Set();
  // 1 メッシュにつき 1 インスタンスだけ見る。同じ形が 1600 個あっても、
  // 面の向きは同じ — 1600 回測る意味は無い(実測 404 秒 → 1 秒未満)。
  for (const ob of objects) {
    if (!ob.solid || ob.backdrop) continue;
    const mat = Array.isArray(ob.mesh.material) ? ob.mesh.material[0] : ob.mesh.material;
    if (!mat || mat.side !== THREE.FrontSide) continue;   // 両面材は別の話(#12 が見る)
    if (done.has(ob.mesh.uuid)) continue;
    done.add(ob.mesh.uuid);
    const size = ob.box.getSize(new THREE.Vector3());
    if (Math.min(size.x, size.y, size.z) < 0.25) continue;   // 細い物の内部は問えない
    // その物「だけ」の三角形で小さな索引を組む。周りの街は関係ない。
    const local = buildTriangles([ob], {});
    if (local.tris.length < 8) continue;
    const lgrid = new Grid(local.tris, Math.max(0.5, Math.min(size.x, size.z) / 2));
    // 枠・アーチ・脚のように「中身が空洞」の形では、AABB の中心は材料の外に
    // ある。そこから撃つと、開口に面した正しい面まで「裏向き」と数えてしまう
    // (実測: 窓枠 317 個の誤報)。パリティで本当に材料の中の点だけを選ぶ。
    const c = ob.box.getCenter(new THREE.Vector3());
    const cand = [[c.x, c.y, c.z]];
    for (let k = 0; k < 12; k++) {
      const u = (k * 0.618) % 1, v = (k * 0.379) % 1, w = (k * 0.911) % 1;
      cand.push([ob.box.min.x + size.x * (0.15 + 0.7 * u),
        ob.box.min.y + size.y * (0.15 + 0.7 * v),
        ob.box.min.z + size.z * (0.15 + 0.7 * w)]);
    }
    let p = null;
    for (const q of cand) {
      // +X 方向の交差回数が奇数なら内部
      let cross = 0;
      for (let ti = 0; ti < local.tris.length; ti++) {
        if (rayTri(q[0], q[1], q[2], 1, 0, 0, local.tris[ti]) > 0) cross++;
      }
      if (cross % 2 === 1) { p = q; break; }
    }
    if (!p) continue;      // 内部を持たない形(枠・板)— ここでは問えない
    let inward = 0, tested = 0;
    for (let i = 0; i < 32; i++) {
      const u = 1 - 2 * (i + 0.5) / 32;
      const sxy = Math.sqrt(Math.max(0, 1 - u * u));
      const ph = i * 2.39996323;
      const dx = Math.cos(ph) * sxy, dy = u, dz = Math.sin(ph) * sxy;
      let best = Infinity, bestTri = -1;
      for (let ti = 0; ti < local.tris.length; ti++) {
        const d = rayTri(p[0], p[1], p[2], dx, dy, dz, local.tris[ti]);
        if (d > 0 && d < best) { best = d; bestTri = ti; }
      }
      if (bestTri < 0) continue;
      tested++;
      const n = triNormal(local.tris[bestTri]);
      if (n[0] * dx + n[1] * dy + n[2] * dz < 0) inward++;
    }
    if (tested >= 8 && inward > tested * 0.5) {
      out.push({ check: 'backface', id: ob.id, tag: ob.tag, pos: V(p[0], p[1], p[2]),
        measured: `${inward}/${tested}`, tolerance: 0, error: inward,
        note: '内部から見て面の過半が裏を向いている(片面材で組んだ中空の殻)',
        cause: `${ob.tag} inward normals` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 12. 厚みゼロ — 石なのに板
// ---------------------------------------------------------------------------
export function checkThickness(ctx) {
  const { objects } = ctx;
  const out = [];
  const seen = new Set();
  for (const ob of objects) {
    if (ob.thin) continue;                     // 薄いと宣言された物は対象外
    // 「石には厚みがある」という主張なので、石(masonry)にだけ問う。
    // 人の腕や灯具は薄い立体であって、板に見えることが欠陥ではない。
    if (!ob.masonry) continue;
    const size = ob.box.getSize(new THREE.Vector3());
    const minDim = Math.min(size.x, size.y, size.z);
    if (minDim >= T.MIN_THICKNESS) continue;
    // マージ済みメッシュの AABB は街全体なので、そこは対象外
    if (size.x > 20 || size.z > 20) continue;
    const k = ob.tag;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ check: 'thickness', id: ob.id, tag: ob.tag,
      pos: V(ob.box.min.x, ob.box.min.y, ob.box.min.z),
      measured: Math.round(minDim * 1000) / 1000, tolerance: T.MIN_THICKNESS, error: minDim - T.MIN_THICKNESS,
      note: '石として札を付けた物の厚みが 10cm 未満(掠める角度で紙に見える)',
      cause: `${ob.tag} zero thickness` });
  }
  // 両面材で「立体」を装っていないか
  const dbl = new Set();
  for (const ob of objects) {
    if (!ob.solid || ob.thin) continue;
    const mat = Array.isArray(ob.mesh.material) ? ob.mesh.material[0] : ob.mesh.material;
    if (mat && mat.side === THREE.DoubleSide && !dbl.has(ob.tag)) {
      dbl.add(ob.tag);
      out.push({ check: 'thickness', id: ob.tag, tag: ob.tag, pos: V(0, 0, 0),
        measured: 'DoubleSide', tolerance: 'FrontSide', error: 1,
        note: '立体と宣言した物が両面材。中空の殻を両面で塗って立体に見せている疑い',
        cause: `${ob.tag} doubleSide solid` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 13. 地形の「関数」と「描かれた面」の一致
//     これが崩れると、地面に置く物すべてが静かにずれる(巾木・鉢・屋台・段)。
//     許容差ではなく構造で一致させる主張なので、ゼロを要求する。
// ---------------------------------------------------------------------------
export function checkTerrainAgreement(ctx) {
  const { grid, owner, objects, plan } = ctx;
  const out = [];
  const nearOnly = (oi) => objects[oi].tag === 'ground.near';
  const N = plan.NEAR;
  let n = 0, worst = 0;
  for (let x = N.x0 + 5; x < N.x1 - 5; x += 2.7) {
    for (let z = N.z0 + 5; z < N.z1 - 5; z += 2.7) {
      const hit = castDown(grid, owner, x, z, 400, nearOnly);
      if (!hit) continue;
      n++;
      const d = hit.y - plan.surfaceAt(x, z);
      if (Math.abs(d) > Math.abs(worst)) worst = d;
      if (Math.abs(d) > 0.005) {
        out.push({ check: 'terrainAgreement', id: `terrain@${V(x, hit.y, z)}`, tag: 'ground.near',
          pos: V(x, hit.y, z), measured: Math.round(d * 1000) / 1000, tolerance: 0.005, error: d,
          note: '地形関数と描かれた地形が食い違う(地面に置く物が全部ずれる)',
          cause: 'terrain function vs mesh' });
      }
    }
  }
  ctx.stats.terrainSamples = n;
  ctx.stats.terrainWorst = Math.round(worst * 10000) / 10000;
  return out;
}

// ---------------------------------------------------------------------------
// 14. 板 — 「面はあるが、その裏に石が無い」箇所
//     境界稜線(穴)は位相の話で、見た目には出ないこともある。人間が
//     「板を貼っただけ」と感じるのは、面の裏に体積が無いとき。
//     定義: 面の裏 6cm の点が、その物の内部でない。パリティで直接測る。
// ---------------------------------------------------------------------------
export function checkPlates(ctx) {
  const { objects } = ctx;
  const out = [];
  const done = new Set();
  const BACK = 0.06;
  for (const ob of objects) {
    if (!ob.solid || ob.thin || ob.backdrop) continue;
    if (done.has(ob.mesh.uuid)) continue;
    done.add(ob.mesh.uuid);
    const local = buildTriangles([ob], {});
    const n = local.tris.length;
    if (n < 12) continue;
    // 面積で重み付けて標本する(大きい面ほど「板」に見える)
    const area = (t) => {
      const ax = t[3] - t[0], ay = t[4] - t[1], az = t[5] - t[2];
      const bx = t[6] - t[0], by = t[7] - t[1], bz = t[8] - t[2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      return Math.hypot(nx, ny, nz) / 2;
    };
    const idxs = [];
    for (let i = 0; i < n; i++) if (area(local.tris[i]) >= 0.35) idxs.push(i);
    if (!idxs.length) continue;
    // 生成側の部位の札。「城壁が板だ」ではなく「城壁のどの作り方が板か」を言う。
    const parts = ob.mesh.geometry?.userData?.parts || null;
    const partAt = (i) => { if (!parts) return null;
      for (const q of parts) if (i >= q.from && i < q.to) return q.name; return '?'; };
    const byPart = new Map();
    const STEP = Math.max(1, Math.floor(idxs.length / 240));
    let plates = 0, tested = 0;
    const worst = [];
    for (let k = 0; k < idxs.length; k += STEP) {
      const t = local.tris[idxs[k]];
      const c = triCentroid(t), nn = triNormal(t);
      const p = [c[0] - nn[0] * BACK, c[1] - nn[1] * BACK, c[2] - nn[2] * BACK];
      // パリティ(偶奇)は「閉じた立体が重なっている」集合で誤る — 帯が壁体に
      // 食い込む家体では、内部の面を横切るたびに偶奇が反転して 50% が誤検出になる。
      // 巻き数を数える: 前向きの面を抜けたら +1、後ろ向きなら -1。和 > 0 なら内部。
      let wind = 0;
      for (let ti = 0; ti < n; ti++) {
        if (rayTri(p[0], p[1], p[2], 1, 0, 0, local.tris[ti]) > 0) {
          wind += triNormal(local.tris[ti])[0] > 0 ? 1 : -1;
        }
      }
      tested++;
      const pn = partAt(idxs[k]);
      if (pn) { const r = byPart.get(pn) || { n: 0, bad: 0 }; r.n++; byPart.set(pn, r); }
      if (wind <= 0) { plates++; if (worst.length < 30) worst.push({ c, a: area(t) });
        if (pn) byPart.get(pn).bad++; }
    }
    if (tested >= 8 && plates > 0) {
      const frac = plates / tested;
      worst.sort((p, q) => q.a - p.a);
      out.push({ check: 'plate', id: ob.tag, tag: ob.tag,
        pos: V(...(worst[0] ? worst[0].c : [0, 0, 0])),
        measured: `${plates}/${tested}`, tolerance: 0, error: frac,
        note: `裏に石の無い面が ${(frac * 100).toFixed(0)}%(標本 ${tested})。板を貼っただけの箇所`
          + ([...byPart].filter(([, r]) => r.bad).sort((x, y) => y[1].bad - x[1].bad)
            .map(([nm, r]) => ` ${nm} ${r.bad}/${r.n}`).join('') || ''),
        cause: `${ob.tag} plate faces`,
        extra: { samples: worst.slice(0, 12).map((q) => V(...q.c)) } });
    }
  }
  return out;
}

/**
 * seating — 「上に載せた石」が本当に載っているか。
 *
 * 狭間石(メルロン)は胸壁の上に置くインスタンス。胸壁は段の帯ごとに高さが
 * 変わるので、石の下を段の境が横切ると、片端が 0.17m 浮き片端が 0.20m 埋まる。
 * 歩廊から見ると「塀の上のブロックが飛び出ている」— 実測で 244 本中 89 本。
 *
 * 生成側が userData.seatOn に「載る相手のタグ」を宣言する。底面の四隅を
 * 内側へ 4cm 入れて標本し、その真下の石までの落差を測る。
 * 自分自身のメッシュは除く(除かないと自分の底面を拾って必ず「載っている」と出る)。
 */
export function checkSeating(ctx) {
  const { objects, grid, owner } = ctx;
  const out = [];
  for (const ob of objects) {
    const seat = ob.mesh.userData?.seatOn;
    if (!seat) continue;
    const bb = ob.mesh.geometry.boundingBox;
    const hw = (bb.max.x - bb.min.x) / 2 - 0.04, hd = (bb.max.z - bb.min.z) / 2 - 0.04;
    if (hw <= 0 || hd <= 0) continue;
    const y0 = bb.min.y;
    let float = 0, bury = 0, pos = null;
    for (const [cx, cz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [0, 0]]) {
      const p = new THREE.Vector3(cx, y0, cz).applyMatrix4(ob.matrix);
      const h = castDown(grid, owner, p.x, p.z, p.y + 0.30,
        (oi) => objects[oi].tag === seat);
      const d = h ? p.y - h.y : Infinity;
      if (d > float) { float = d; pos = [p.x, p.y, p.z]; }
      if (-d > bury) { bury = -d; if (!pos) pos = [p.x, p.y, p.z]; }
    }
    if (float > T.SEAT_GAP) {
      out.push({ check: 'seating', id: ob.id, tag: ob.tag, pos: V(...(pos || [0, 0, 0])),
        measured: float === Infinity ? null : Math.round(float * 1000) / 1000,
        tolerance: T.SEAT_GAP, error: float,
        note: float === Infinity ? `底の下に ${seat} が無い(宙に浮いている)`
          : `底の隅が ${float.toFixed(2)}m 浮いている(下の ${seat} が段で落ちている)`,
        cause: `${ob.tag} floats on ${seat}` });
    } else if (bury > T.SEAT_GAP) {
      out.push({ check: 'seating', id: ob.id, tag: ob.tag, pos: V(...(pos || [0, 0, 0])),
        measured: Math.round(bury * 1000) / 1000, tolerance: T.SEAT_GAP, error: bury,
        note: `底の隅が ${bury.toFixed(2)}m ${seat} に埋まっている(段が石の下を横切っている)`,
        cause: `${ob.tag} buried in ${seat}` });
    }
  }
  return out;
}

export const ALL_CHECKS = [
  ['seating', checkSeating],
  ['grounding', checkGrounding],
  ['footprintCorner', checkFootprintCorners],
  ['stairs', checkStairs],
  ['walkability', checkWalkability],
  ['envelope', checkEnvelope],
  ['colliderAgreement', checkColliderAgreement],
  ['interpenetration', checkInterpenetration],
  ['coplanar', checkCoplanar],
  ['crossRepresentation', checkCrossRepresentation],
  ['manifold', checkManifold],
  ['backface', checkBackfaces],
  ['thickness', checkThickness],
  ['terrainAgreement', checkTerrainAgreement],
  ['plate', checkPlates],
];
