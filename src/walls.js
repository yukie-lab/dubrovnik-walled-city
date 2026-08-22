// ============================================================================
// walls.js — 城壁回廊。全周を実際に歩ける一筆のループ。
// 主体積・塔・門・階段の石はぜんぶ同じ要塞石材ファミリー → 1 ドローコール。
// 狭間胸壁(メルロン)とミンチェタの持ち送りだけインスタンス。
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash2, clamp, lerp, smoothstep, nearestOnPolyline, tagMesh } from './util.js';
import { sharedSkyVis } from './buildings.js';
import { makeSkyVis, patchSkyVis, bakeSkyVis, patchSkyVisInstanced, bakeSkyVisInstanced } from './skyvis.js';
import { patchWet } from './wet.js';

export function makeWalls(plan, tex, stepPool, outsideHeight) {
  const group = new THREE.Group();
  const P = [], N = [], U = [], C = [], I = [];
  const um = 1 / tex.fortStone.coverM;

  const baseTint = new THREE.Color();
  // outv を渡すと、巻きをその外向きに合わせる。
  // 渡さなかった呼び出しは従来どおり「巻きから法線を決める」。
  // 巻き任せにしていた結果、壁の垂直面の 40.8%(2,410 三角)が中心線を向いて
  // いた — 法線が石の内側を向くので太陽に対して常に裏、どんな時刻でも
  // 平坦に潰れて「板を貼っただけ」に見えていた。
  const UP1 = [0, 1, 0], DOWN1 = [0, -1, 0];
  // 部位の札。三角形の範囲に名前を付けておくと、構造検査が「壁体が板だ」では
  // なく「塔の王冠が板だ」と言える。束ねられない報告は人間に同じ判断を
  // 何十回もさせる。
  const PARTS = [];
  let PART_CUR = 'misc';
  const part = (name) => {
    const at = I.length / 3;
    const last = PARTS[PARTS.length - 1];
    if (last) last.to = at;
    PARTS.push({ name, from: at, to: at });
    PART_CUR = name;
    return last ? last.name : 'misc';    // 呼び出し元へ戻すための前の札
  };
  // 零面積の四角は捨てる。掃引の段差では断面環が完全に重なるので必ず出る。
  // 残すと法線が未定義の三角形が混ざり、裏表の検査も光も破綻する
  // (実測 1,541 枚 = 全三角の 13.7%)。頂点は一致しているので穴は開かない。
  const xprod = (p, q, r) => {
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
    const vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  };
  const quadArea = (a, b, c, d) => {
    const t3 = (p, q, r) => {
      const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
      const vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
      return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) * 0.5;
    };
    return t3(a, b, c) + t3(a, c, d);
  };
  function quad(a, b, c, d, tintA = 1, tintB = 1, uvScale = 1, outv = null) {
    // a,b 下辺 / d,c 上辺(反時計回りで法線が手前)
    // 法線は「(b-a)×(d-a)」一本では駄目。掃引の蹴上では b-a が零ベクトルに
    // なり、normalize() が (0,0,0) を返して真っ黒の面が焼き付く。
    // 二つの三角の外積を面積のまま足す = 四角形の面積加重法線。
    let na = xprod(a, b, c), nb = xprod(a, c, d);
    const A1 = Math.hypot(...na) * 0.5, A2 = Math.hypot(...nb) * 0.5;
    if (A1 + A2 < 1e-6) return;
    let nvx = na[0] + nb[0], nvy = na[1] + nb[1], nvz = na[2] + nb[2];
    let nl = Math.hypot(nvx, nvy, nvz);
    if (nl < 1e-9) { if (!outv) return; nvx = outv[0]; nvy = outv[1]; nvz = outv[2]; nl = 1; }
    nvx /= nl; nvy /= nl; nvz /= nl;
    let flipped = false;
    if (outv && nvx * outv[0] + nvy * outv[1] + nvz * outv[2] < 0) {
      const t2 = a; a = d; d = t2;      // [a,b,c,d] → [d,c,b,a]
      const t3 = b; b = c; c = t3;
      nvx = -nvx; nvy = -nvy; nvz = -nvz; flipped = true;
    }
    const n = { x: nvx, y: nvy, z: nvz };
    let i0 = P.length / 3;
    const w = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const h1 = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    P.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) N.push(n.x, n.y, n.z);
    U.push(0, 0, w * um * uvScale, 0, w * um * uvScale, h1 * um * uvScale, 0, h1 * um * uvScale);
    // 潮の帯: 水面から 1.2m は藻と塩で濃く緑に沈む。海に立つ石でここが
    // 明るいままだと、壁が水面に「置いてある」ように見える。
    const ys = [a[1], b[1], c[1], d[1]];
    for (let k = 0; k < 4; k++) {
      const t = k < 2 ? tintA : tintB;
      const tt = Math.min(t, 1);   // 1 超えは緑被りになる(チャンネル不均衡)
      // 分割で潮線を作るので、ここは飛沫のごく薄い名残だけ
      // 実測: 水面直上 V45% / その上 V53% — **水際が周囲より明るい**。
      // 無彩色 14% の減光では藻にも塩にもならず、測定にすら出ない。
      // 石灰岩の色度はテクスチャに一任するという規約の **唯一の例外** が
      // ここ。潮間帯だけは色を持つ(黒緑の藻 → 白い塩 → 乾いた石の層序)。
      const wl = smoothstep(1.35, -0.4, ys[k]);                          // 水際で 1
      const alg = smoothstep(0.9, 0.15, ys[k]) * (1 - smoothstep(0.15, -0.6, ys[k]) * 0.4);
      const slt = smoothstep(0.85, 1.4, ys[k]) * (1 - smoothstep(1.4, 1.9, ys[k]));
      C.push(tt * (1 - 0.34 * wl - 0.30 * alg) * (1 + 0.10 * slt),
        tt * (1 - 0.30 * wl - 0.16 * alg) * (1 + 0.10 * slt),
        tt * (1 - 0.38 * wl - 0.34 * alg) * (1 + 0.09 * slt));
    }
    // 縮退した半分は出さない。出すと同じ稜線が三重四重に数えられ、
    // 「閉じているか」の判定そのものが壊れる。
    const B1 = flipped ? A2 : A1, B2 = flipped ? A1 : A2;
    if (B1 > 1e-9) I.push(i0, i0 + 1, i0 + 2);
    if (B2 > 1e-9) I.push(i0, i0 + 2, i0 + 3);
  }

  // 水平面はワールドXZ投影でUVを与える(石の目が床の向きに揃い、扇で伸びない)
  function quadUV(a, b, c, d, tintA = 1, tintB = 1, outv = UP1) {
    if (quadArea(a, b, c, d) < 1e-6) return;
    // 法線を (0,1,0) と決め打ちしていたので、巻きが裏返った床は「上向きの
    // 法線を持つ裏面」になり、裏面カリングで消えて板一枚に見えていた。
    {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * outv[0] + ny * outv[1] + nz * outv[2] < 0) {
        const t2 = a; a = d; d = t2; const t3 = b; b = c; c = t3;
      }
    }
    const i0 = P.length / 3;
    P.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) N.push(outv[0], outv[1], outv[2]);
    for (const q of [a, b, c, d]) U.push(q[0] * um, q[2] * um);
    for (const t of [tintA, tintA, tintB, tintB]) {
      const tt = Math.min(t, 1);
      // 頂点色は「明度の器」に徹する。石の色度を決めてよいのは
      // tex.fortStone と material.color の 2 か所だけ、という規約。
      // ここが 3.4% の暖色、メルロンが 5.5%、壁面が無彩色と三方向に
      // 脱色していたので、同じ日向の同じ石が H38°/S16% と H79°/S7.7% に割れていた。
      C.push(tt, tt, tt);
    }
    if (Math.hypot(...xprod(a, b, c)) > 2e-9) I.push(i0, i0 + 1, i0 + 2);
    if (Math.hypot(...xprod(a, c, d)) > 2e-9) I.push(i0, i0 + 2, i0 + 3);
  }

  const CX = 0, CZ = 15; // 市の重心(外向きの判定に使う)
  const angGap = (a, b) => {
    const d = Math.abs(a - b) % (Math.PI * 2);
    return d > Math.PI ? Math.PI * 2 - d : d;
  };
  const pts = plan.wallPts, kinds = plan.wallKinds;
  const gateGeos = [];
  const slitGeos = [];

  // 階段の到着点 → 内側手すりに開ける開口(区間ごと)。
  // 囲い階段も歩廊の内縁へ出てくる — 開けないと手すりが到着点を塞ぐ。
  const railGaps = [];
  for (const st of plan.WALL_STAIRS) {
    if (st.spiral) continue;
    const e = st.pts[st.pts.length - 1];
    if (Math.abs(nearestOnPolyline(pts, e[0], e[1]).y - e[2]) > 1.5) continue;   // 歩廊に着かない階段
    const nw2 = nearestOnPolyline(pts, e[0], e[1]);
    const A = pts[nw2.i - 1], B = pts[nw2.i];
    const segL = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const tC = Math.hypot(nw2.x - A[0], nw2.z - A[1]) / segL;
    const hw = 2.1 / segL;   // 踊り場より広く開ける
    railGaps.push({ i: nw2.i, t0: tC - hw, t1: tC + hw, top: e });
  }

  // ---- 主体積: ノードのマイター(留め継ぎ)展開による連続ストリップ。
  // 区間ごとの「延長」で角を埋める方式は、勾配の変わる継ぎ目で
  // 斜めの板が歩廊を貫き、メルロンが浮く。頂点をノードで共有すれば根絶できる。
  const NN = pts.length - 1;    // 末尾は始点の複製
  const nodes = [];
  for (let k = 0; k < NN; k++) {
    const p = pts[k], pPrev = pts[(k - 1 + NN) % NN], pNext = pts[(k + 1) % NN];
    let d1x = p[0] - pPrev[0], d1z = p[1] - pPrev[1];
    let d2x = pNext[0] - p[0], d2z = pNext[1] - p[1];
    const l1 = Math.hypot(d1x, d1z) || 1, l2 = Math.hypot(d2x, d2z) || 1;
    d1x /= l1; d1z /= l1; d2x /= l2; d2z /= l2;
    const n1x = -d1z, n1z = d1x, n2x = -d2z, n2z = d2x;
    let mmx = n1x + n2x, mmz = n1z + n2z;
    const ml = Math.hypot(mmx, mmz) || 1;
    mmx /= ml; mmz /= ml;
    const scale = 1 / Math.max(0.55, Math.abs(mmx * n2x + mmz * n2z));   // 鋭角の留めは制限
    const wkA = plan.WALL_KIND[kinds[k]] || plan.WALL_KIND.sea;
    const wkB = plan.WALL_KIND[kinds[(k - 1 + NN) % NN]] || plan.WALL_KIND.sea;
    nodes.push({ x: p[0], z: p[1], y: p[2], mx: mmx, mz: mmz, scale, half: plan.wallNodeHalf[k] });   // デッキ半幅は plan と共有
  }
  // 外向きの符号は一括決定(巻き方向は一定なので全ノード同符号)
  {
    const n0 = nodes[0];
    const dOut = Math.hypot(n0.x + n0.mx * 3 - CX, n0.z + n0.mz * 3 - CZ);
    const dIn = Math.hypot(n0.x - n0.mx * 3 - CX, n0.z - n0.mz * 3 - CZ);
    if (dIn > dOut) for (const nd of nodes) { nd.mx = -nd.mx; nd.mz = -nd.mz; }
  }
  const oPt = nodes.map(nd => [nd.x + nd.mx * nd.half * nd.scale, nd.z + nd.mz * nd.half * nd.scale]);
  const iPt = nodes.map(nd => [nd.x - nd.mx * nd.half * nd.scale, nd.z - nd.mz * nd.half * nd.scale]);
  // 基部の高さもノードで共有(外面の縦継ぎ目を消す)
  const outBase = nodes.map(nd => Math.min(outsideHeight(nd.x + nd.mx * (nd.half + 2), nd.z + nd.mz * (nd.half + 2)), nd.y - 4) - 1.2);
  const inBase = nodes.map(nd => Math.min(plan.terrainHeight(nd.x - nd.mx * (nd.half + 2), nd.z - nd.mz * (nd.half + 2)), nd.y - 2) - 1.2);
  const lerp2 = (A, B, t) => [lerp(A[0], B[0], t), lerp(A[1], B[1], t)];

  // ---- 壁体 = 城壁一周を「閉じた断面の掃引」で一気に作る ------------------
  //
  // 区間ごとに掃いて門でだけ塞いでいた頃、ノードごとに開いた断面環が二つ
  // 残った。しかも裾と胴蛇腹の張り出しを区間ごとの内→外方向へ出していたので、
  // 二つの環は座標すら一致しない。実測: 境界稜線 3,108 本、3 面以上が共有する
  // 稜線 1,482 本。レイはその穴から抜けるので「面の裏に石が無い」= 板に見える。
  // 段差も長さ 0 の span として掃いていて、法線が定義できない零面積の三角形を
  // 1,541 枚出していた。
  //
  // 直し方は構造で。station を「周回全体の (区間, t)」で持ち、横の張り出しは
  // ノードのマイター二等分線を補間した向きへ出す。すると区間 k の t=1 と
  // 区間 k+1 の t=0 は同じ頂点になり、環は閉じる。切れるのは門だけ。門と門の
  // 間の一続き(run)を両端で小口に塞ぐ。
  {
    part('body');
    const BAT = 0.95;                       // 裾(バッター)の張り出し
    const gateNode = [];
    const segLen = [];
    for (let k = 0; k < NN; k++) {
      const kd = kinds[k] || '';
      gateNode[k] = kd.startsWith('gate')
        ? (plan.GATES.find(g => Math.hypot(g.x - pts[k][0], g.z - pts[k][1]) < 9) || null) : null;
      segLen[k] = Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
    }
    const GATE_TRIM = 4.35;                 // buildGateArch の幅 9 と必ず重ねる
    // マイター量まで込めた張り出し方向。oPt/iPt と同じベクトルなので、
    // 鋭角のノードでも外面の平面オフセットが BAT のまま保たれる。
    const mDir = nodes.map(nd => [nd.mx * nd.scale, nd.mz * nd.scale]);

    // 断面。頂点の意味と数は station によらず一定 — 分岐で数や意味を変えると
    // 切り替わる所で輪郭が飛び、掃引が途切れる(実際に壁体が丸ごと消えた)。
    // (s,y) 平面で反時計回り。外向きは辺 (ds,dy) に対して (dy,-ds)。
    const profileAt = (k, t, yD) => {
      const b = (k + 1) % NN;
      const I = lerp2(iPt[k], iPt[b], t), O = lerp2(oPt[k], oPt[b], t);
      const off = lerp2(mDir[k], mDir[b], t);
      const ob = lerp(outBase[k], outBase[b], t), ib = lerp(inBase[k], inBase[b], t);
      const Hf = Math.max(yD - ob, 0.02);                 // 外面の総高
      const yBat = ob + Math.min(1.35, Hf * 0.22);        // 裾が消える高さ(潮線)
      const yCor = ob + Math.min(5.40, Hf * 0.62);        // 胴蛇腹の下端
      const cor = smoothstep(0.8, 2.2, yCor - yBat);      // 蛇腹の張り出し率
      const pt = (sv, e, y) => [
        I[0] + (O[0] - I[0]) * sv + off[0] * e, y,
        I[1] + (O[1] - I[1]) * sv + off[1] * e];
      return [
        { p: pt(0, 0, ib), tint: 0.78 },                              // 0 内面の足
        { p: pt(1, BAT, ob), tint: 0.50 },                            // 1 外面の裾
        { p: pt(1, 0, yBat), tint: 0.56 },                            // 2 潮線
        { p: pt(1, 0, yCor), tint: 0.80 },                            // 3 蛇腹の下
        { p: pt(1, 0.22 * cor, yCor + 0.20 * cor), tint: 1.10 },      // 4 蛇腹の張り
        { p: pt(1, 0.02 * cor, yCor + 0.34 * cor), tint: 0.98 },      // 5 蛇腹の上
        { p: pt(1, 0, yD), tint: 1.02 },                              // 6 外面の天端
        { p: pt(0, 0, yD), tint: 0.97 },                              // 7 デッキ内縁
      ];
    };
    const NV = 8;
    // 断面の辺ごとの外向き(ワールド)。s は水平の内→外単位ベクトル。
    const edgeOut = (ring, i) => {
      const j = (i + 1) % NV, a = ring[i].p, b2 = ring[j].p;
      const sx = ring[6].p[0] - ring[7].p[0], sz = ring[6].p[2] - ring[7].p[2];
      const sl = Math.hypot(sx, sz) || 1;
      const ux = sx / sl, uz = sz / sl;
      const ds = (b2[0] - a[0]) * ux + (b2[2] - a[2]) * uz;   // 断面内の横成分
      const dy = b2[1] - a[1];
      const ol = Math.hypot(dy, ds) || 1;
      return [ux * (dy / ol), -ds / ol, uz * (dy / ol)];
    };

    // station 列。区間内は plan.wallSegN と同じ格子で刻み、帯の端で二重化して
    // 段差を垂直な蹴上として掃く。YQ を帯の端で読むと既に次の段の高さなので、
    // 段が消えて滑らかな斜路になる(実際に消えた)。
    const runs = [];
    let run = null;
    let start = 0;
    const anyGate = gateNode.some(Boolean);
    if (anyGate) for (let k = 0; k < NN; k++) if (gateNode[k]) { start = k; break; }
    for (let n2 = 0; n2 < NN; n2++) {
      const k = (start + n2) % NN, b = (k + 1) % NN;
      if (segLen[k] < 0.01) { run = null; continue; }
      const tr = Math.min(0.45, GATE_TRIM / segLen[k]);
      const tr0 = gateNode[k] ? tr : 0, tr1 = gateNode[b] ? 1 - tr : 1;
      if (tr1 - tr0 < 1e-3) { run = null; continue; }
      if (!run || gateNode[k]) runs.push(run = []);
      const ay2 = pts[k][2], by2 = pts[k + 1][2];
      const segN2 = plan.wallSegN[b] || 1;
      // 蹴上の奥行き。段を「同じ t で高さだけ違う station 対」にすると、
      // 内面の段差が幅ゼロの切れ目になり、閉じようのない穴が段の数だけ
      // 開く(実測 115 個)。段鼻の出として 4cm 持たせれば構造的に閉じる。
      const dtN = 0.02 / Math.max(segLen[k], 0.5);
      // segN=1 は「段」ではなく斜路。帯に刻むと区間の真ん中に段が生まれ、
      // plan.wallWalkYAt(= 足の高さ)は直線補間なので、歩廊の石と足の高さが
      // 半段ぶんずれる(実測 238 点で最大 0.37m 沈んだ)。
      if (segN2 <= 1) {
        // 斜路。塔の天端では歩廊を水平に寄せてあるので、区間の高さは
        // もう直線ではない。両端だけ読むと塔の上で石だけ斜めのまま残る
        // (実測 0.38m の食い違い)。塔に近い区間は細かく刻む。
        const nearT = Object.values(plan.TOWERS).some((t2) => {
          const rT2 = (t2.terraceR ?? (t2.crownR - 0.8)) + 4;
          return Math.hypot(pts[k][0] - t2.x, pts[k][1] - t2.z) < segLen[k] + rT2
            && Math.hypot(pts[k + 1][0] - t2.x, pts[k + 1][1] - t2.z) < segLen[k] + rT2;
        });
        const NS2 = nearT ? Math.max(2, Math.ceil(segLen[k] / 2.0)) : 1;
        for (let j = 0; j <= NS2; j++) {
          const t = tr0 + (tr1 - tr0) * (j / NS2);
          run.push({ k, t, y: plan.wallWalkYOn(b, t) + 0.02 });
        }
        if (gateNode[b]) run = null;
        continue;
      }
      for (let j = 0; j <= segN2; j++) {
        const t0 = Math.max(tr0, j === 0 ? 0 : (j - 0.5) / segN2 + dtN);
        const t1 = Math.min(tr1, j === segN2 ? 1 : (j + 0.5) / segN2 - dtN);
        if (t1 - t0 < 1e-5) continue;
        const yk = plan.wallWalkYOn(b, j / segN2) + 0.02;
        run.push({ k, t: t0, y: yk }, { k, t: t1, y: yk });
      }
      if (gateNode[b]) run = null;
    }
    // 門が一つも無いなら周回は閉じた輪。切れ目が無いので小口も要らない。
    const closedLoop = !anyGate && runs.length === 1;

    const capRing = (ring, k, sign) => {
      const dxx = pts[k + 1][0] - pts[k][0], dzz = pts[k + 1][1] - pts[k][1];
      const dl = Math.hypot(dxx, dzz) || 1;
      const want = [(dxx / dl) * sign, 0, (dzz / dl) * sign];
      // 断面は凸ではないが、内面の足(0)から全頂点が見える(星形)。
      for (let i = 1; i < NV - 1; i++) {
        const A = ring[0].p, B2 = ring[i].p, C2 = ring[i + 1].p;   // C は色配列。影を作らない
        const ux = B2[0] - A[0], uy = B2[1] - A[1], uz = B2[2] - A[2];
        const vx = C2[0] - A[0], vy = C2[1] - A[1], vz = C2[2] - A[2];
        let nx2 = uy * vz - uz * vy, ny2 = uz * vx - ux * vz, nz2 = ux * vy - uy * vx;
        const nl = Math.hypot(nx2, ny2, nz2);
        if (nl < 1e-6) continue;
        nx2 /= nl; ny2 /= nl; nz2 /= nl;
        const flip = (nx2 * want[0] + nz2 * want[2]) < 0;
        const vs = flip ? [A, C2, B2] : [A, B2, C2];
        if (flip) { nx2 = -nx2; ny2 = -ny2; nz2 = -nz2; }
        const i0 = P.length / 3;
        for (const v of vs) P.push(v[0], v[1], v[2]);
        for (let q = 0; q < 3; q++) { N.push(nx2, ny2, nz2); C.push(0.86, 0.86, 0.86); }
        U.push(0, 0, 1, 0, 1, 1);
        I.push(i0, i0 + 1, i0 + 2);
      }
    };

    for (const list of runs) {
      if (list.length < 2) continue;
      const rings = list.map(s => profileAt(s.k, s.t, s.y));
      const M = rings.length;
      const lim = closedLoop ? M : M - 1;
      for (let s = 0; s < lim; s++) {
        const A = rings[s], B = rings[(s + 1) % M];
        // 辺 6→7 は歩廊の床。ただし蹴上の span では垂直な立ち上がりになる。
        // ここに上向きの法線を押し付けていたので、段が「浮いた板」に見えた。
        // 水平か立っているかは t ではなく実際の形で決める。
        const dxs = B[7].p[0] - A[7].p[0], dzs = B[7].p[2] - A[7].p[2];
        const hs = Math.hypot(dxs, dzs), dys = B[7].p[1] - A[7].p[1];
        const riser = hs < Math.abs(dys) * 0.6;
        const sgn = dys > 0 ? -1 : 1;      // 外向きはデッキが低い側
        const riserOut = hs > 1e-6 ? [(dxs / hs) * sgn, 0, (dzs / hs) * sgn] : UP1;
        for (let i = 0; i < NV; i++) {
          const j = (i + 1) % NV;
          // 段差の二重 station では環の下半分が完全に重なる。そこは零面積 —
          // 捨ててよい(頂点が一致しているので穴は開かない)。
          if (i === 6 && !riser) quadUV(A[i].p, B[i].p, B[j].p, A[j].p, 0.97, 0.97, UP1);
          else quad(A[i].p, B[i].p, B[j].p, A[j].p, A[i].tint, B[j].tint, 1,
            i === 6 ? riserOut : edgeOut(A, i));
        }
      }
      if (!closedLoop) {
        capRing(rings[0], list[0].k, -1);
        capRing(rings[M - 1], list[M - 1].k, +1);
      }
    }
  }
  const merlons = [];
  for (let a = 0; a < NN; a++) {
    const b = (a + 1) % NN;
    const kind = kinds[a];
    const wk = plan.WALL_KIND[kind] || plan.WALL_KIND.sea;
    const [ax, az, ay] = pts[a];
    const bx = pts[a + 1][0], bz = pts[a + 1][1], by = pts[a + 1][2];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    let nx = -dz, nz = dx;
    if (nx * nodes[a].mx + nz * nodes[a].mz < 0) { nx = -nx; nz = -nz; }

    // 面の外向き。巻きではなくこれで法線を決める。
    const OUTV = [nx, 0, nz], INV = [-nx, 0, -nz], UPV = [0, 1, 0], DNV = [0, -1, 0];
    // 門: 始端/終端が門なら立面をその分だけ短く(内挿パラメータで)
    const endKind = kinds[b] || '';
    const startGate = kind.startsWith('gate') ? plan.GATES.find(g => Math.hypot(g.x - ax, g.z - az) < 9) : null;
    const endGate = endKind.startsWith('gate') ? plan.GATES.find(g => Math.hypot(g.x - bx, g.z - bz) < 9) : null;
    if (startGate) buildGateArch(startGate, { dx, dz, nx, nz, half: wk.thick / 2, walkYA: ay, walkYB: by });
    // 門ブロックの幅は W=9(buildGateArch)。壁を左右 4.6 ずつ = 9.2 削ると、
    // 差の 0.2m が「壁を貫いて海に抜ける細い隙間」になる。必ず重ねる。
    const GATE_TRIM = 4.35;
    const f0 = startGate ? Math.min(0.45, GATE_TRIM / len) : 0;
    const f1 = endGate ? 1 - Math.min(0.45, GATE_TRIM / len) : 1;

    const yA = lerp(ay, by, f0), yB = lerp(ay, by, f1);

    // 歩廊デッキの段。plan.wallSegN と同じ格子で刻む(足の高さと必ず一致)。
    const segN = plan.wallSegN[b] || 1;
    // 胸壁・内縁・メルロンの高さも同じ入口から取る。
    const ylev = (k) => plan.wallWalkYOn(b, k / segN);
    const tlo = (k) => Math.max(0, (k - 0.5) / segN);
    const thi = (k) => Math.min(1, (k + 0.5) / segN);
    // 段の格子で評価した高さ(胸壁・内縁・メルロンも必ずこれを使う)
    // 足の高さ(plan.wallWalkYAt)と必ず同じ式。segN=1 は段ではなく斜路なので
    // 直線補間 — round() を通すと区間の真ん中に段が生まれ、胸壁と内縁とメルロンが
    // 歩廊の石から半段ぶん浮く/沈む。
    // 足の高さと同じ式を **同じ関数から** 取る。ここで式を書き写すと、
    // plan 側だけ直したときに描画が取り残される(塔の天端で実測 0.35m の浮き)。
    const YQ = (t) => plan.wallWalkYOn(b, t);


    // 塔の王冠の中では胸壁も内縁も建てない — 王冠がそれを兼ねる。
    // 建てると塔のギャラリー床を胸壁が突き抜け、体がその石の中に立つ。
    const towerCuts = [];
    for (const tw of Object.values(plan.TOWERS)) {
      const sp = segInCircle(ax, az, bx, bz, tw.x, tw.z, tw.crownR + 0.35);
      if (sp) towerCuts.push(sp);
    }
    const cutRuns = (gaps) => {
      let runs = [[0, 1]];
      for (const g of gaps) {
        const next = [];
        for (const [r0, r1] of runs) {
          if (g[1] <= r0 || g[0] >= r1) { next.push([r0, r1]); continue; }
          if (g[0] > r0) next.push([r0, Math.max(r0, g[0])]);
          if (g[1] < r1) next.push([Math.min(r1, g[1]), r1]);
        }
        runs = next;
      }
      return runs.filter(([r0, r1]) => r1 - r0 > 0.015);
    };

    // 外側の胸壁(マイター点基準の連続ストリップ)
    const pH = wk.parapet;   // 1.30 固定は WALL_KIND の宣言値を全部捨てていた
    // 胸壁と内縁は「デッキの縁から walkHalf まで」を埋める。歩ける帯を
    // 中心線に対して対称にしないと、歩ける範囲の中に石が生える(体が埋まる)。
    // 半幅はノードごとに違うので、必ず小さい方で測る。
    const halfMin = Math.min(plan.wallNodeHalf[a], plan.wallNodeHalf[b]);
    const whMax = Math.max(wk.walkHalf,
      (plan.WALL_KIND[kinds[b]] || wk).walkHalf, (plan.WALL_KIND[kinds[a]] || wk).walkHalf);
    // 厚みは WALL_KIND の宣言値。「壁厚の余り」を全部胸壁に化けさせない。
    const kA = plan.WALL_KIND[kinds[a]] || wk, kB = plan.WALL_KIND[kinds[b]] || wk;
    const pT = Math.min(halfMin - 0.55, Math.max(wk.pT ?? 0.70, kA.pT ?? 0.70, kB.pT ?? 0.70));
    const rT = Math.min(halfMin - pT - 0.60, Math.max(wk.rT ?? 0.55, kA.rT ?? 0.55, kB.rT ?? 0.55));
    const OL = (t) => [lerp(oPt[a][0], oPt[b][0], t), lerp(oPt[a][1], oPt[b][1], t)];
    const MOut2 = (t) => [lerp(nodes[a].mx, nodes[b].mx, t), lerp(nodes[a].mz, nodes[b].mz, t)];
    const YL = (t) => YQ(t);
    const bands = (r0, r1) => {          // ラン [r0,r1] を段の帯に割る
      if (segN <= 1) return [[r0, r1]];
      const out = [];
      for (let k = 0; k <= segN; k++) {
        const t0 = Math.max(r0, tlo(k)), t1 = Math.min(r1, thi(k));
        if (t1 - t0 > 1e-4) out.push([t0, t1]);
      }
      return out.length ? out : [[r0, r1]];
    };
    // 胸壁は「外面・内面・天端」の 3 枚では板でしかない。段の帯ごとに切ると、
    // 帯と帯の間(蹴上のぶん)に隙間が開き、塔の切り欠きでは端から中空が見える。
    // 内縁(下の rH ブロック)は同じ問題を裾と小口で塞いである。胸壁も同じにする:
    //   ・裾を歩廊面より DROP だけ下ろす → 段差の隙間は壁体の中で埋まる
    //   ・両端に小口を張る            → 切り欠きの端から中が見えない
    // 余った石は壁体の中に隠れるので、外からは何も増えない。
    const pDROP = 1.30;

    // 帯ごとに閉じた箱を積むと、隣り合う箱が同じ面を二重に持つ(実測で
    // 胸壁 840 本・内縁 702 本の稜線が巻き重複、非多様体 715 本)。
    // 見た目には Z 争いの継ぎ目として出る。ラン単位で一本の掃引にすれば、
    // 段差は蹴上として掃かれ、小口はランの両端だけになる。
    //   secAt(t) → { v: 断面 4 頂点(ワールド), uv: 断面 (u,y), m: 外向き水平単位 }
    // 断面は (u,y) 平面で反時計回り。辺 (du,dy) の外向きは (dy,−du)。
    const sweepSection = (run, secAt, TN) => {
      const [r0, r1] = run;
      const bs = bands(r0, r1);
      const dtq = 0.02 / Math.max(len, 0.5);        // 蹴上の奥行き 4cm
      const ts = [];
      for (let k = 0; k < bs.length; k++) {
        const lo = k === 0 ? bs[k][0] : Math.min(bs[k][1], bs[k][0] + dtq);
        const hi = k === bs.length - 1 ? bs[k][1] : Math.max(bs[k][0], bs[k][1] - dtq);
        if (hi - lo < 1e-6) continue;
        ts.push(lo, hi);
      }
      if (ts.length < 2) return;
      const R = ts.map(secAt);
      const eO = (S, i) => {
        const j = (i + 1) % 4;
        const du = S.uv[j][0] - S.uv[i][0], dy = S.uv[j][1] - S.uv[i][1];
        const L = Math.hypot(du, dy) || 1;
        return [S.m[0] * (dy / L), -du / L, S.m[1] * (dy / L)];
      };
      for (let k = 0; k + 1 < R.length; k++) {
        const A = R[k], B = R[k + 1];
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 4;
          quad(A.v[i], B.v[i], B.v[j], A.v[j], TN[i], TN[j], 1, eO(A, i));
        }
      }
      // ランの両端の小口(切り欠きの端で中空を見せない)
      const tang = [dx, 0, dz];
      quad(R[0].v[0], R[0].v[1], R[0].v[2], R[0].v[3], 0.86, 0.86, 1, [-tang[0], 0, -tang[2]]);
      const E = R[R.length - 1];
      quad(E.v[0], E.v[1], E.v[2], E.v[3], 0.86, 0.86, 1, tang);
    };

    const secPara = (t) => {
      const o = OL(t), m = MOut2(t), y = YL(t);
      const ml = Math.hypot(m[0], m[1]) || 1;
      const pi = [o[0] - m[0] * pT, o[1] - m[1] * pT];
      const lo = y - pDROP, hi = y + pH;
      return { m: [m[0] / ml, m[1] / ml],
        uv: [[0, lo], [pT, lo], [pT, hi], [0, hi]],
        v: [[pi[0], lo, pi[1]], [o[0], lo, o[1]], [o[0], hi, o[1]], [pi[0], hi, pi[1]]] };
    };
    for (const run of cutRuns(towerCuts)) {
      part('parapet');
      sweepSection(run, secPara, [0.72, 0.90, 1.02, 1.04]);
    }

    // 内側の胸壁(階段の到着点には開口)— railGaps の i はポリライン区間番号(a+1)
    // 0.95m だった。25m の歩廊で腰の高さの縁は手すりであって胸壁ではなく、
    // 構造検査の「胸の高さ(+0.95)で石が無い」が 414 点で鳴っていた原因。
    // 実物の市側の胸壁は腰から胸(1.0〜1.2m)。
    const rH = 1.12;
    {
      const gapsHere = railGaps.filter(g => g.i === a + 1).map(g => [g.t0, g.t1]);
      const P3 = (t) => [lerp(iPt[a][0], iPt[b][0], t), YQ(t), lerp(iPt[a][1], iPt[b][1], t)];
      const MOut = (t) => [lerp(nodes[a].mx, nodes[b].mx, t), lerp(nodes[a].mz, nodes[b].mz, t)];
      // 裾を 1.2m 下ろす。段差と階段の切り欠きの所で下端が空中に浮くのを
      // 壁体の中で塞ぐ(余った石は外からは見えない)。
      const DROP = 1.2;
      const secKerb = (t) => {
        const p = P3(t), m = MOut(t);
        const ml = Math.hypot(m[0], m[1]) || 1;
        const r = [p[0] + m[0] * rT, p[2] + m[1] * rT];
        const lo = p[1] - DROP, hi = p[1] + rH;
        return { m: [m[0] / ml, m[1] / ml],
          uv: [[0, lo], [rT, lo], [rT, hi], [0, hi]],
          v: [[p[0], lo, p[2]], [r[0], lo, r[1]], [r[0], hi, r[1]], [p[0], hi, p[2]]] };
      };
      for (const run of cutRuns([...towerCuts, ...gapsHere])) {
        if (run[1] - run[0] < 0.015) continue;
        part('kerb');
        sweepSection(run, secKerb, [0.72, 0.90, 1.02, 1.02]);
      }
    }

    // ---- 矢狭間(外面に穿つ凹み)。実物の陸側主壁には 1.5〜2.5m ピッチで
    // 狭間と銃眼が並ぶ。無地の 300m の壁は、どれだけ石を作り込んでも板に見える。
    if (wk.merlon && !startGate && !endGate) {
      part('slitNiche');
      const SW = 0.11, SH = 0.52, SD = 0.35;      // 半幅 / 半高 / 奥行き
      const nS = Math.floor(len / 1.9);
      for (let k = 0; k < nS; k++) {
        const t = (k + 0.5) / nS;
        if (towerCuts.some(g => t > g[0] && t < g[1])) continue;
        const o = OL(t), m2 = MOut2(t);
        const yc = YQ(t) - 2.6;
        if (yc < outBase[a] + 1.6) continue;
        const px2 = -m2[1], pz2 = m2[0];           // 壁に沿う方向
        const F = (u, d2, yy) => [o[0] + px2 * u - m2[0] * d2, yy, o[1] + pz2 * u - m2[1] * d2];
        // 側面 2 / 天井 / 床 / 奥
        quad(F(-SW, 0, yc - SH), F(-SW, SD, yc - SH), F(-SW, SD, yc + SH), F(-SW, 0, yc + SH), 0.44, 0.58);
        quad(F(SW, SD, yc - SH), F(SW, 0, yc - SH), F(SW, 0, yc + SH), F(SW, SD, yc + SH), 0.44, 0.58);
        quad(F(-SW, 0, yc + SH), F(-SW, SD, yc + SH), F(SW, SD, yc + SH), F(SW, 0, yc + SH), 0.30, 0.36);
        quad(F(SW, 0, yc - SH), F(SW, SD, yc - SH), F(-SW, SD, yc - SH), F(-SW, 0, yc - SH), 0.52, 0.62);
        quad(F(-SW, SD, yc - SH), F(SW, SD, yc - SH), F(SW, SD, yc + SH), F(-SW, SD, yc + SH), 0.22, 0.26);
      }
    }

    // メルロン(胸壁ストリップの中心線上)。胸壁と同じランの中にだけ、
    // かつ半幅ぶん内側にクランプして置く — 端からはみ出すと空中に石が浮く。
    // 等間隔・同寸・同じ石目の行列は一目で手続き生成に見えるので、必ず崩す。
    if (wk.merlon) {
      const halfT = 0.62 / len;
      // 一本置く。cO/mm/tint は共通。
      const place = (t, hj, wMax) => {
        const cO = lerp2(oPt[a], oPt[b], t);
        const mm = [lerp(nodes[a].mx, nodes[b].mx, t), lerp(nodes[a].mz, nodes[b].mz, t)];
        const sx = Math.min(0.90 + hj * 0.22, wMax / 1.06);
        if (sx < 0.45) return;
        merlons.push({
          // メルロンは胸壁の全厚。内側へずらすと、狭間の底に石の縁が残って外が見えない。
          x: cO[0] - mm[0] * (pT / 2), z: cO[1] - mm[1] * (pT / 2),
          y: (segN > 1 ? YQ(t) : lerp(ay, by, t)) + pH - 0.03,               // 3cm 埋めて毛筋を消す
          rotY: Math.atan2(-dz, dx),
          // 斜路の区間では胸壁の天端も傾いている。水平な箱を置くと、
          // 幅 1.09m の石の片端が 7cm 浮き片端が 7cm 埋まる。石工は
          // 段で刻むか、目地を斜めに切る。ここは石ごと傾ける。
          tilt: segN > 1 ? 0 : Math.atan2(by - ay, len),
          sx, sy: hj > 0.86 ? 0.62 : 1.0,
          sz: Math.min(1, (pT - 0.06) / 0.72),        // 胸壁より薄く。はみ出したら板が浮いて見える
          uo: hj, vo: hash2((cO[0] * 9) | 0, (cO[1] * 9) | 0),
        });
      };
      for (const [r0, r1] of cutRuns(towerCuts)) {
        const s0 = r0 + halfT, s1 = r1 - halfT;
        if (s1 - s0 < 0.004) continue;
        const runLen = (s1 - s0) * len;
        if (runLen < 1.2) continue;
        if (segN > 1) {
          // 段のある区間では、メルロンは「一つの帯の中」に収める。
          // 帯の境(蹴上)がメルロンの下を横切ると、片端が段に 0.2m 埋まり
          // 片端が 0.17m 浮く。歩廊から見ると「石が飛び出している」に見える
          // — 実測で 244 本中 29 本がそうなっていた。
          const bs = bands(s0, s1);
          let since = 9;
          bs.forEach(([b0, b1], k) => {
            const bl = (b1 - b0) * len;
            since += bl;
            if (bl < 0.55 || since < 1.90) return;      // 狭間 ≒ 0.86m ぶん空ける
            since = 0;
            const tc = (b0 + b1) / 2;
            const hj = hash2(((ax + k * 7.3) * 5) | 0, ((az + a * 3.1) * 5) | 0);
            if (hj > 0.955) return;                     // 5% は欠け(戦の跡)
            place(tc, hj, bl - 0.10);
          });
        } else {
          const n = Math.max(1, Math.round(runLen / 2.06));   // メルロン 1.20m + 狭間 0.86m = 石:隙間 1.40:1
          for (let m2 = 0; m2 < n; m2++) {
            const hj = hash2(((ax + m2 * 7.3) * 5) | 0, ((az + a * 3.1) * 5) | 0);
            if (hj > 0.955) continue;
            place(s0 + (s1 - s0) * ((m2 + 0.5) / n + (hj - 0.5) * 0.30 / n), hj, 9);
          }
        }
      }
    }
  }

  // ---- 露天階段の到着踊り場(頂部からデッキへ渡す)
  for (const g of railGaps) {
    part('landing');
    const e = g.top;
    const lg = plan.landings.find(l => Math.abs(l.x - e[0]) < 1e-6 && Math.abs(l.z - e[1]) < 1e-6);
    if (!lg) continue;
    const nw2 = nearestOnPolyline(pts, e[0], e[1]);
    const dirIn = [(e[0] - nw2.x) / nw2.d, (e[1] - nw2.z) / nw2.d];   // 中心線→市側
    const px2 = -dirIn[1], pz2 = dirIn[0];
    const inEdge = [nw2.x + dirIn[0] * 1.2, nw2.z + dirIn[1] * 1.2];  // デッキ内縁より内側へ
    const y = nw2.y + 0.03;
    // 幅は plan の踊り場と同じ(階段側には張り出さない)。
    // ここの px2 は plan の法線と逆向き(dirIn = 中心線→市側)なので入れ替える。
    const wP = lg.halfNeg, wN = lg.halfPos;
    // 上を向く巻きで(逆に巻くと踊り場は裏面になり、上から消える)
    quad(
      [e[0] + px2 * wP, y, e[1] + pz2 * wP],
      [e[0] - px2 * wN, y, e[1] - pz2 * wN],
      [inEdge[0] - px2 * wN, y, inEdge[1] - pz2 * wN],
      [inEdge[0] + px2 * wP, y, inEdge[1] + pz2 * wP],
      1.0, 1.0, 2.2,
    );
    // 踊り場の前板(下から見て浮かない)
    quad(
      [e[0] + px2 * wP, y - 1.1, e[1] + pz2 * wP],
      [e[0] - px2 * wN, y - 1.1, e[1] - pz2 * wN],
      [e[0] - px2 * wN, y, e[1] - pz2 * wN],
      [e[0] + px2 * wP, y, e[1] + pz2 * wP],
      0.85, 0.95,
    );
  }

  // ---- 門アーチ(穴あき押し出し)
  function buildGateArch(gate, f) {
    const _pp = part('gateArch');
    const W = 9;  // 門ブロックの幅(壁に沿う)
    const H0 = gate.y, archT = gate.y + gate.h;
    // 天端は歩廊のランプに沿わせる(区間端の高い方に合わせると、門が歩廊の上に
    // 数メートル突き出し、体だけがその石を素通りする)。
    const yWalk = (x, z) => nearestOnPolyline(pts, x, z).y - 0.04;
    // 形状の局所 +x は rotateY 後に (nz, −nx) を向く = 外向き法線の取り方次第で ±d。
    // ここを取り違えると天端の傾きが前後逆になり、門が歩廊の上へ突き出す。
    const ex = (f.nz * f.dx - f.nx * f.dz) >= 0 ? 1 : -1;
    const topA = yWalk(gate.x - f.dx * (W / 2) * ex, gate.z - f.dz * (W / 2) * ex);
    const topB = yWalk(gate.x + f.dx * (W / 2) * ex, gate.z + f.dz * (W / 2) * ex);
    const shape = new THREE.Shape();
    shape.moveTo(-W / 2, H0 - 2);
    shape.lineTo(W / 2, H0 - 2);
    shape.lineTo(W / 2, topB);
    shape.lineTo(-W / 2, topA);
    shape.closePath();
    const hole = new THREE.Path();
    const r = gate.w / 2;
    hole.moveTo(-r, H0 - 2);
    hole.lineTo(-r, archT - r);
    hole.absarc(0, archT - r, r, Math.PI, 0, true);
    hole.lineTo(r, H0 - 2);
    hole.closePath();
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: f.half * 2 + 0.4, bevelEnabled: false });
    // 壁に沿う向きへ(形状の x = 壁方向, 押し出し z = 外向き)
    const yaw = Math.atan2(f.nx, f.nz);
    geo.rotateY(yaw);
    geo.translate(gate.x - f.nx * (f.half + 0.2), 0, gate.z - f.nz * (f.half + 0.2));
    // UV を実寸っぽく整える
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * um * 1.0, uv.getY(i) * um * 1.0);
    gateGeos.push(geo);
    part(_pp);
  }

  // ---- 塔(円筒 + 王冠)
  function tower(t, { crownGap = null } = {}) {
    const _pp = part('tower');
    const seg = 26;
    // 門口は「中心の方位 ± 幅」で持つ(0/2π をまたいでも切れないように角度差で判定)
    const midIn = (a0, a1, g) => angGap(((a0 + a1) / 2), g.a) < g.w;
    const TAU = Math.PI * 2;
    const PT = (a, r, y) => [t.x + Math.cos(a) * r, y, t.z + Math.sin(a) * r];

    // ---- 塔は「厚みを持つ環状の立体」。回転面 1 枚ではない。
    //
    // 旧 ring() は外周の曲面だけを張っていた。実測で塔の面の 76% が
    // 「裏に石が無い面」= 湾曲した板で、境界稜線 1,570 本(壁全体の半分)が
    // ここから出ていた。円筒の内側に何も無いのだから、当然そう見える。
    //
    // silh = [[外半径, 高さ, 内半径], …] を下から上へ。外面・内面・天地の環・
    // 門口の小口を作り方から出すので、閉じていることが保証される。
    const drum = (silh, opt = {}) => {
      const gaps = opt.gaps || null;
      const t0 = opt.tint0 ?? 0.8, t1 = opt.tint1 ?? 1.0;
      const M = silh.length;
      if (M < 2) return;
      const kept = [];
      for (let s = 0; s < seg; s++) {
        const a0 = (s / seg) * TAU, a1 = ((s + 1) / seg) * TAU;
        kept[s] = !(gaps && gaps.some(g => midIn(a0, a1, g)));
      }
      // 母線の外向き法線(断面 (r,y) で辺 (dr,dy) に対して (dy,−dr))
      const genOut = (m, ro) => {
        const dr = silh[m + 1][0] - silh[m][0], dy = silh[m + 1][1] - silh[m][1];
        const L = Math.hypot(dr, dy) || 1;
        return [ro[0] * (dy / L), -dr / L, ro[2] * (dy / L)];
      };
      const jamb = (e, sign) => {
        const tang = [-Math.sin(e) * sign, 0, Math.cos(e) * sign];
        for (let m = 0; m + 1 < M; m++) {
          const A = silh[m], B = silh[m + 1];
          quad(PT(e, A[2], A[1]), PT(e, A[0], A[1]), PT(e, B[0], B[1]), PT(e, B[2], B[1]),
            t0 * 0.94, t1 * 0.94, 1, tang);
        }
      };
      for (let s = 0; s < seg; s++) {
        if (!kept[s]) continue;
        const a0 = (s / seg) * TAU, a1 = ((s + 1) / seg) * TAU, am = (a0 + a1) / 2;
        const ro = [Math.cos(am), 0, Math.sin(am)];
        for (let m = 0; m + 1 < M; m++) {
          const A = silh[m], B = silh[m + 1];
          const ti = t0 + (t1 - t0) * (m / Math.max(M - 2, 1));
          const nOut = genOut(m, ro);
          quad(PT(a0, A[0], A[1]), PT(a1, A[0], A[1]), PT(a1, B[0], B[1]), PT(a0, B[0], B[1]),
            ti, ti, 1, nOut);                                                   // 外面
          quad(PT(a0, A[2], A[1]), PT(a1, A[2], A[1]), PT(a1, B[2], B[1]), PT(a0, B[2], B[1]),
            ti * 0.84, ti * 0.84, 1, [-nOut[0], -nOut[1], -nOut[2]]);           // 内面
        }
        const B0 = silh[0], BT = silh[M - 1];
        quadUV(PT(a0, B0[2], B0[1]), PT(a1, B0[2], B0[1]), PT(a1, B0[0], B0[1]), PT(a0, B0[0], B0[1]),
          t0 * 0.5, t0 * 0.5, DOWN1);                                           // 地の環
        quadUV(PT(a0, BT[2], BT[1]), PT(a1, BT[2], BT[1]), PT(a1, BT[0], BT[1]), PT(a0, BT[0], BT[1]),
          t1 * 1.04, t1 * 1.04);                                                // 天の環(笠石)
        if (!kept[(s - 1 + seg) % seg]) jamb(a0, -1);
        if (!kept[(s + 1) % seg]) jamb(a1, +1);
      }
    };

    // drum() は「面の中点が門口に入っていれば落とす」ので、実際の開口の縁は
    // 26 角形の面の境目になる。迫や袖壁を g.a±g.w で作ると最大 π/26
    // (半径 9m で 1.1m)ずれ、薄い板が宙に立ったり隙間から空が見えたりする。
    // 実際に落ちた面の範囲を返して、そちらに合わせる。
    const gapEdges = (g) => {
      const wrap = (a) => { let d = a - g.a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
      let lo = 9, hi = -9;
      for (let s2 = 0; s2 < seg; s2++) {
        const a0 = (s2 / seg) * TAU, a1 = ((s2 + 1) / seg) * TAU;
        if (!midIn(a0, a1, g)) continue;
        lo = Math.min(lo, wrap(a0)); hi = Math.max(hi, wrap(a1));
      }
      return lo > hi ? [-g.w, g.w] : [lo, hi];
    };

    // 歩廊がこの高さ帯を通るリングだけ門口を開ける。
    // (塞いだままだと、歩廊のランプがリングや持ち送りの下をくぐって頭がめり込む)
    const walkY = t.galleryY ?? t.topY;
    const bodyBlocks = walkY < t.crownY0;                                  // 胴を突き抜ける
    const corbelBlocks = walkY > t.crownY0 - 3 && walkY < t.crownY0 + 1.7; // 持ち送りが庇になる
    const topBlocks = walkY > t.topY - 0.6;                                // 天板の縁が庇になる
    const rTop = t.terraceR ?? (t.crownR - 0.80);
    const TH = Math.min(2.6, t.r * 0.42);       // 石の厚み(内部は空洞のドラム)
    const rin = (r) => Math.max(r * 0.25, r - TH);

    // 胴(わずかに裾広がり)。門口は歩廊の高さ帯だけ開ける。
    if (bodyBlocks) {
      const f = (walkY - 1.4 - (t.baseY - 2)) / (t.crownY0 - (t.baseY - 2));
      const rMid = lerp(t.r * 1.12, t.r, clamp(f, 0, 1));
      drum([[t.r * 1.12, t.baseY - 2, rin(t.r * 1.12)], [rMid, walkY - 1.4, rin(rMid)]],
        { tint0: 0.72, tint1: 0.95 });
      drum([[rMid, walkY - 1.4, rin(rMid)], [t.r, t.crownY0, rin(t.r)]],
        { tint0: 0.95, tint1: 1.0, gaps: crownGap });
    } else {
      drum([[t.r * 1.12, t.baseY - 2, rin(t.r * 1.12)], [t.r, t.crownY0, rin(t.r)]],
        { tint0: 0.72, tint1: 1.0 });
    }
    // 王冠 = 持ち送りの張り出し + 胸壁。内面は天板(rTop)に合わせる。
    // ここは「半径 crownR の曲面 1 枚」だった。厚みが無いので塔がドラムでは
    // なく「立てた湾曲した衝立」に見えていた(聖ヨハネの門口から正面に見える)。
    // 持ち送りと胸壁は別々に切る。歩廊が通らない高さ帯まで一緒に切ると、
    // 門口の上が空まで抜けた切り欠きになり、テラスの床裏が「宙に浮いた
    // 濃い板」として空に貼りつく(ミンチェタで実際にそう見えていた)。
    drum([[t.r, t.crownY0, Math.min(t.r - 0.35, rTop)], [t.crownR, t.crownY0 + 1.1, rTop]],
      { tint0: 0.95, tint1: 1.02, gaps: corbelBlocks ? crownGap : null });
    // テラスの胸壁。天端が床上 1.30m + 狭間石 1.02m = 2.32m あり、ミンチェタの
    // 頂上から外が見える割合は実測 21.0% しかなかった。眺めるための場所なので
    // 天端を床上 0.95m(= 手すりとして成立する下限に近い)まで下げる。
    drum([[t.crownR, t.crownY0 + 1.1, rTop], [t.crownR, t.topY + 1.00, rTop]],
      { tint0: 1.0, tint1: 1.05, gaps: topBlocks ? crownGap : null });

    // ---- 天板(テラス)。厚みのある円盤として閉じる。
    // 扇 1 枚 + 縁 + 退化した「裏板」で作っていたので、下から見ると紙だった。
    const inWell = (a) => t.well && angGap(a, (t.well.a0 + t.well.a1) / 2) < (t.well.a1 - t.well.a0) / 2;
    const yDeck = t.topY + 0.05, ySoff = t.topY - 0.55;
    const fan = (a0, a1, rr, y, up) => {
      const i0 = P.length / 3;
      const p1x = t.x + Math.cos(a0) * rr, p1z = t.z + Math.sin(a0) * rr;
      const p2x = t.x + Math.cos(a1) * rr, p2z = t.z + Math.sin(a1) * rr;
      P.push(t.x, y, t.z, p1x, y, p1z, p2x, y, p2z);
      for (let k = 0; k < 3; k++) N.push(0, up ? 1 : -1, 0);
      // ワールドXZ投影。扇の頂点で共有する局所UVは放射状に伸びる。
      U.push(t.x * um, t.z * um, p1x * um, p1z * um, p2x * um, p2z * um);
      const c = up ? [1.05, 1.05, 1.03] : [0.5, 0.5, 0.49];
      for (let k = 0; k < 3; k++) C.push(c[0], c[1], c[2]);
      if (up) I.push(i0, i0 + 2, i0 + 1); else I.push(i0, i0 + 1, i0 + 2);
    };
    for (let s = 0; s < seg; s++) {
      const a0 = (s / seg) * TAU, a1 = ((s + 1) / seg) * TAU;
      // 天板は切らない。以前は門口の角度で切っていたが、角度で切ると
      // 半径の小さい所で歩廊の帯より広く切れ、天板(厚み 0.6m)の縁が
      // 歩廊の脇に「斜めに浮いた板」として露出した(聖イヴァンで報告)。
      // 歩廊は塔の中で天端の高さに揃えてあるので(plan.wallWalkYAt)、
      // 天板そのものが歩廊。切り欠きは胸壁と持ち送りだけでよい。
      // 階段室の切り欠き — ここだけ外周を張らない(螺旋が上がってくる井筒)
      const rr = inWell((a0 + a1) / 2) ? t.well.r : rTop;
      const am = (a0 + a1) / 2;
      fan(a0, a1, rr, yDeck, true);
      fan(a0, a1, rr, ySoff, false);
      // 縁 — 厚みゼロの扇は横から消え、裏から見ると紙が浮いて見える。
      // ただし縁が rTop にあるときは胸壁ドラムの内面と同一平面で、
      // 深度が争って塔の中から見上げると天井の縁に帯が走る(実測 11,037px)。
      // その場合は胸壁が閉じているので縁は要らない。井筒の切り欠きだけ張る。
      if (rr < rTop - 0.01) {
        quad(PT(a0, rr, ySoff), PT(a1, rr, ySoff), PT(a1, rr, yDeck), PT(a0, rr, yDeck),
          0.72, 0.98, 1, [Math.cos(am), 0, Math.sin(am)]);
      }
    }
    // 門口の迫(アーチ)— 歩廊が塔を貫く所は「壁に開いた矩形の穴」ではなく
    // 半円アーチの通路。開けっぱなしにすると、上のギャラリー床が宙に浮く。
    // 迫を組めるのは「デッキの上に石が積んである」ときだけ。テラスの高さで
    // 歩廊が入る塔では、門口は胸壁の切り欠きであってアーチではない。
    // 高さを確かめずに 2m の迫元から半円を立てていたので、聖ヨハネでは
    // アーチが王冠より 2.8m 高くせり上がり、空に角のような殻が二本出ていた。
    // 迫を組めるのは、歩廊の上に石が積んであるときだけ。天井は塔の一番上
    // (topY+1.35)であって、その帯の天端ではない — 帯の天端で測ると
    // ミンチェタ(余地 1.5m と出る)の門口からアーチが消える。
    const archCeil = t.topY + 1.00;
    if (crownGap && (bodyBlocks || corbelBlocks) && archCeil - walkY > 2.6) {
      const deckY = walkY;
      // 門口は「歩廊が通る戸口」であって凱旋門ではない。半幅 1.75m・迫元 2.0m
      // だと開口が 3.5m 幅 × 3.75m 高になり、塔の中に巨大なアーチが立つ。
      // ただし歩ける帯(半幅 1.4m)は必ず通さないと、体が袖壁にめり込む。
      // 迫元は胸より上に。deckY+1.20 だと、塔の手前で歩廊が少し高い所に立つ人の
      // 胸が迫の曲線に入る(実測 2 点で八方レイの 6/8 が石)。
      const HW = 1.35;                       // 一番細い所(内面)の半幅 = 開口 2.7m
      // 迫の頂(yC)より低い天板を指定すると、アーチの上の壁が下向きに
      // 張られて「歩廊に生えた丸い殻」になる。必ず迫の上に置く。
      const yTopRaw = topBlocks ? t.topY + 1.35 : (corbelBlocks ? t.crownY0 + 1.1 : t.crownY0);
      for (const g of crownGap) {
        // 半径は drum の実際の面に合わせる。t.r〜t.r*1.03 の 3% の殻を張って
        // いたので、袖壁が胴から 0.26m せり出した「浮いた板」になっていた。
        const rO = bodyBlocks ? t.r : t.crownR;
        const rI = bodyBlocks ? rin(t.r) : rTop;
        const [gLo, gHi] = gapEdges(g);
        // 敷居の高さは塔の walkY 固定ではなく、門口の下を実際に通る歩廊の
        // 一番低い所。固定にすると、斜路の途中に立つ塔(ミンチェタ)で
        // 「足より 1.36m 上に床」が出る(実測 10 点)。
        let yFlG = deckY;
        for (let k3 = 0; k3 <= 8; k3++) {
          const aa = g.a + gLo + (gHi - gLo) * (k3 / 8);
          for (const rr of [rI, (rI + rO) / 2, rO]) {
            const q3 = nearestOnPolyline(pts, t.x + Math.cos(aa) * rr, t.z + Math.sin(aa) * rr);
            yFlG = Math.min(yFlG, plan.wallWalkYAt(q3));
          }
        }
        // さらに 0.75m 埋める。敷居は「見せる床」ではなく体積を閉じるための面。
        // 歩廊の面より上に出ると、そこが「足より上にある床」になる(実測 10 点)。
        yFlG -= 0.75;
        // 門口の塊の底。deckY − 0.6 で固定していたが、敷居 yFlG は「門口の下を
        // 実際に通る歩廊の一番低い所 − 0.75」なので、斜路の途中に立つ塔では
        // 底が敷居より上に来る。見付が上下逆に張られ、下向きの板が通路の床の
        // 0.45m 上に浮いていた(実測 1 視点 194,217px)。必ず敷居より下に置く。
        const yBot = yFlG - 0.55;
        const yS = deckY + 1.75;             // 迫元(頂は デッキ +3.10m)
        // 迫の高さが天端を突き抜けないよう、半幅も頭で抑える。
        // 一番細い所(内面)で HW を確保する。外へ向かって開く = 実物の狭間喉。
        const wa = Math.min((gHi - gLo) / 2 * 0.92, HW / Math.max(rI, 1.0),
          Math.max(0.05, (archCeil - 0.4 - yS) / Math.max(rI, 1.0)));
        const yC = yS + wa * rI;             // 半円 = 半幅ぶん立ち上がる(内面基準)
        const yTop = Math.min(Math.max(yTopRaw, yC + 0.40), archCeil);
        const pt = (a, r, y) => [t.x + Math.cos(a) * r, y, t.z + Math.sin(a) * r];
        const NA = 14;
        // 迫の裏は「rI から rO へ 2.6m 渡した 1 枚」だった。奥行きに継ぎ目が
        // 無いので、樽天井ではなく曲げた紙に見える(ミンチェタの中で
        // 「アーチっぽいところが板」と見えていた面がこれ)。奥行きを分けて、
        // 通路の真ん中を暗く落とす。
        const ND = 5;
        const barrelTint = (f, j2) => (0.80 - 0.36 * Math.sin(Math.PI * f)) * (1 + ((j2 % 2) ? 0.035 : -0.035));
        for (let k = 0; k < NA; k++) {
          const u0 = -1 + (2 * k) / NA, u1 = -1 + (2 * (k + 1)) / NA;
          const a0 = g.a + u0 * wa, a1 = g.a + u1 * wa;
          const h0 = yS + (yC - yS) * Math.sqrt(Math.max(0, 1 - u0 * u0));
          const h1 = yS + (yC - yS) * Math.sqrt(Math.max(0, 1 - u1 * u1));
          const am5 = (a0 + a1) / 2, ro5 = [Math.cos(am5), 0, Math.sin(am5)];
          quad(pt(a0, rO, h0), pt(a1, rO, h1), pt(a1, rO, yTop), pt(a0, rO, yTop), 0.96, 1.0, 1, ro5);
          quad(pt(a1, rI, h1), pt(a0, rI, h0), pt(a0, rI, yTop), pt(a1, rI, yTop), 0.86, 0.96, 1,
            [-ro5[0], 0, -ro5[2]]);
          // 迫の裏(通路の天井)。巻き任せにしていたので法線が真上を向き、
          // 「足より 1.2m 上にある床」として検出され、FrontSide では真っ黒に
          // 抜けていた。外向きは「迫の中心(g.a, yS)から見て外」の逆 = 通路側。
          {
            const um5 = ((-1 + (2 * k) / NA) + (-1 + (2 * (k + 1)) / NA)) / 2;
            const tx5 = -Math.sin(g.a), tz5 = Math.cos(g.a);
            let ox = tx5 * (um5 * wa * rI), oy = (h0 + h1) / 2 - yS, oz = tz5 * (um5 * wa * rI);
            const L5 = Math.hypot(ox, oy, oz) || 1;
            const nIn5 = [-ox / L5, -oy / L5, -oz / L5];
            for (let j2 = 0; j2 < ND; j2++) {
              const rA = lerp(rI, rO, j2 / ND), rB = lerp(rI, rO, (j2 + 1) / ND);
              quad(pt(a0, rA, h0), pt(a1, rA, h1), pt(a1, rB, h1), pt(a0, rB, h0),
                barrelTint(j2 / ND, j2 + k), barrelTint((j2 + 1) / ND, j2 + k), 1, nIn5);
            }
          }
        }
        // ---- 迫の輪(アーキヴォルト)。
        // 開口の縁が「厚みゼロの切り口」だと、塔の中から見上げたとき壁の縁が
        // 刃になり、迫の裏だけが宙に張った帆に見える。面から 0.13m せり出した
        // 迫石の輪を両面に巻いて、縁に実体を与える。
        // 輪の内法は開口より 0.10m 広く取る — 歩ける帯(半幅 1.4m)を 1mm も
        // 削らないため。輪は開口を狭めるものではなく、縁を包むもの。
        const archivolt = (rFace, outSign) => {
          const PR = 0.13, BW = 0.40, DROP = 0.38;   // せり出し / 輪の幅 / 迫元より下へ伸ばす
          const rP = rFace + outSign * PR;
          // 輪の背は壁の面そのもの。ぴたり同じ半径だと Z が争うので 1cm 石に埋める。
          const rB = rFace - outSign * 0.01;
          const Wm = wa * rFace + 0.10;              // 輪の内法(実寸)
          const R5 = yC - yS;
          if (R5 < 0.25 || Wm < 0.25) return;
          const aOf = (xm, r) => g.a + xm / Math.max(r, 0.5);
          const nf = (am) => [outSign * Math.cos(am), 0, outSign * Math.sin(am)];
          const NR = 22;
          const P5 = (xm, yy, r) => { const aa = aOf(xm, r); return [t.x + Math.cos(aa) * r, yy, t.z + Math.sin(aa) * r]; };
          const sta = [];
          // 迫元より下へ真っ直ぐ伸ばす脚 → 半円 → 反対側の脚
          sta.push({ x: -Wm, y: yS - DROP, ex: -(Wm + BW), ey: yS - DROP, nx: -1, ny: 0 });
          for (let k5 = 0; k5 <= NR; k5++) {
            const u5 = -1 + (2 * k5) / NR;
            const sq = Math.sqrt(Math.max(0, 1 - u5 * u5));
            const x5 = u5 * Wm, y5 = yS + sq * R5;
            // 楕円の外向き法線(輪は開口の外へ張り出す)
            let nx5 = u5 / Wm, ny5 = sq / R5;
            const nl5 = Math.hypot(nx5, ny5) || 1; nx5 /= nl5; ny5 /= nl5;
            sta.push({ x: x5, y: y5, ex: x5 + nx5 * BW, ey: y5 + ny5 * BW, nx: nx5, ny: ny5 });
          }
          sta.push({ x: Wm, y: yS - DROP, ex: Wm + BW, ey: yS - DROP, nx: 1, ny: 0 });
          const tgv = (am, sx) => [-Math.sin(am) * sx, 0, Math.cos(am) * sx];
          for (let k5 = 0; k5 + 1 < sta.length; k5++) {
            const A5 = sta[k5], B5 = sta[k5 + 1];
            const am5 = aOf((A5.x + B5.x) / 2, rP);
            const ti5 = 0.90 + ((k5 % 2) ? 0.10 : 0);          // 迫石の目地
            // 見付(せり出した面)
            quad(P5(A5.x, A5.y, rP), P5(B5.x, B5.y, rP), P5(B5.ex, B5.ey, rP), P5(A5.ex, A5.ey, rP),
              ti5, ti5 * 0.97, 1, nf(am5));
            // 内法の返し(開口側)と、輪の外側の返し
            const nIn5 = (S) => {
              const am6 = aOf(S.x, rP), tv = tgv(am6, -S.nx);
              return [tv[0], -S.ny, tv[2]];
            };
            const nA = nIn5(A5), nB = nIn5(B5);
            quad(P5(A5.x, A5.y, rB), P5(B5.x, B5.y, rB), P5(B5.x, B5.y, rP), P5(A5.x, A5.y, rP),
              0.72, 0.86, 1, [(nA[0] + nB[0]) / 2, (nA[1] + nB[1]) / 2, (nA[2] + nB[2]) / 2]);
            quad(P5(A5.ex, A5.ey, rP), P5(B5.ex, B5.ey, rP), P5(B5.ex, B5.ey, rB), P5(A5.ex, A5.ey, rB),
              0.86, 0.78, 1, [-(nA[0] + nB[0]) / 2, -(nA[1] + nB[1]) / 2, -(nA[2] + nB[2]) / 2]);
            // 背。壁に貼り付いて見えない面だが、張らないと輪が「開いた殻」になる。
            quad(P5(B5.x, B5.y, rB), P5(A5.x, A5.y, rB), P5(A5.ex, A5.ey, rB), P5(B5.ex, B5.ey, rB),
              0.7, 0.7, 1, [-nf(am5)[0], 0, -nf(am5)[2]]);
          }
          // 脚の下端を塞ぐ(切り口を刃にしない)
          // 脚は二本とも下端。片方に上向きを渡していたので、その面は
          // 塔の中から見上げると消えていた。
          for (const S of [sta[0], sta[sta.length - 1]]) {
            quad(P5(S.x, S.y, rB), P5(S.ex, S.ey, rB), P5(S.ex, S.ey, rP), P5(S.x, S.y, rP),
              0.6, 0.6, 1, DOWN1);
          }
        };
        archivolt(rI, -1);
        archivolt(rO, +1);

        // 門口のうちアーチの外側は壁で塞ぐ(歩ける帯より外なので通行は妨げない)
        for (const side of [-1, 1]) {
          const b0 = g.a + side * wa, b1 = g.a + (side > 0 ? gHi : gLo);
          const NB = 4;
          for (let k = 0; k < NB; k++) {
            const c0 = lerp(b0, b1, k / NB), c1 = lerp(b0, b1, (k + 1) / NB);
            // 外向きを渡さないと、方位の走査向きが side で入れ替わるので
            // 片側の袖壁だけ法線が石の中を向き、塔の中から壁が透ける
            // (実測 1 視点 66,075px = 画面の 4%)。
            const cm7 = (c0 + c1) / 2, ro7 = [Math.cos(cm7), 0, Math.sin(cm7)];
            quad(pt(c0, rO, yFlG), pt(c1, rO, yFlG), pt(c1, rO, yTop), pt(c0, rO, yTop), 0.94, 1.0, 1, ro7);
            quad(pt(c1, rI, yFlG), pt(c0, rI, yFlG), pt(c0, rI, yTop), pt(c1, rI, yTop), 0.84, 0.94, 1,
              [-ro7[0], 0, -ro7[2]]);
          }
        }
        // 通路の袖(迫元 yS より下)の返し。ここが無いと、門口に立ったとき
        // 開口の縁が厚みゼロの切り口になる — 「石に厚みが無い」の正体。
        for (const side of [-1, 1]) {
          const e = g.a + side * wa;
          const sg = -side;                                     // 外向きは通路の内側
          const tg = [-Math.sin(e) * sg, 0, Math.cos(e) * sg];
          // 迫の裏を ND 帯に割ったので、袖もそれに合わせて割る。
          // 割らないと稜線が 1 対 ND で当たり、T 字の継ぎ目(= 穴)になる。
          for (let j3 = 0; j3 < ND; j3++) {
            const rA = lerp(rI, rO, j3 / ND), rB3 = lerp(rI, rO, (j3 + 1) / ND);
            quad(pt(e, rA, yFlG), pt(e, rB3, yFlG), pt(e, rB3, yS), pt(e, rA, yS), 0.80, 0.90, 1, tg);
          }
        }
        // 敷居の見付(下床の縁)。下の板だけ張ると、通路の下から見て
        // 厚み 0 の床が宙に浮く。
        {
          const NB2 = 8;
          for (let k = 0; k < NB2; k++) {
            const c0 = lerp(g.a + gLo, g.a + gHi, k / NB2), c1 = lerp(g.a + gLo, g.a + gHi, (k + 1) / NB2);
            const am2 = (c0 + c1) / 2, ro2 = [Math.cos(am2), 0, Math.sin(am2)];
            quad(pt(c0, rO, yBot), pt(c1, rO, yBot), pt(c1, rO, yFlG), pt(c0, rO, yFlG), 0.72, 0.86, 1, ro2);
            quad(pt(c0, rI, yBot), pt(c1, rI, yBot), pt(c1, rI, yFlG), pt(c0, rI, yFlG), 0.66, 0.80, 1, [-ro2[0], 0, -ro2[2]]);
            // 敷居の天端。ここが無いと通路は「底の抜けたトンネル」で、
            // 塔ごとに境界稜線が 106 本残る(歩廊のデッキが床を兼ねるので
            // 見た目には気づけない — 2cm 下げて Z 争いを避ける)。
            quadUV(pt(c0, rI, yFlG), pt(c1, rI, yFlG),
              pt(c1, rO, yFlG), pt(c0, rO, yFlG), 0.98, 0.98);
          }
        }
        // 小口と天端。内外の二枚を張っただけでは「二枚の板」で、
        // 通路の脇と上から殻の切り口が見える(石に厚みが無いように見える)。
        // 両端の返しと天端の水切りを張って、通路の周りを塊に閉じる。
        for (const side of [-1, 1]) {
          const e = g.a + (side > 0 ? gHi : gLo);
          const tg7 = [-Math.sin(e) * side, 0, Math.cos(e) * side];
          if (side > 0) quad(pt(e, rI, yFlG), pt(e, rO, yFlG), pt(e, rO, yTop), pt(e, rI, yTop), 0.88, 0.96, 1, tg7);
          else quad(pt(e, rO, yFlG), pt(e, rI, yFlG), pt(e, rI, yTop), pt(e, rO, yTop), 0.88, 0.96, 1, tg7);
        }
        {
          const NB = 8;
          for (let k = 0; k < NB; k++) {
            const c0 = lerp(g.a + gLo, g.a + gHi, k / NB), c1 = lerp(g.a + gLo, g.a + gHi, (k + 1) / NB);
            quad(pt(c0, rI, yTop), pt(c1, rI, yTop), pt(c1, rO, yTop), pt(c0, rO, yTop), 1.04, 1.04, 1, UP1);
            quad(pt(c1, rI, yBot), pt(c0, rI, yBot), pt(c0, rO, yBot), pt(c1, rO, yBot),
              0.55, 0.55, 1, DOWN1);
          }
        }
      }
    }

    // 王冠の上のメルロン。壁と同じく WALL_KIND の merlon を見る —
    // 見ないと砲台型の要塞(聖イヴァン・ボカール)にも中世の狭間が生える。
    const tKind = Object.entries(plan.TOWERS).find(([, v]) => v === t)?.[0];
    const tk = { minceta: 'minceta', bokar: 'bokar', stjohn: 'stjohn', neCorner: 'tower' }[tKind];
    if (!(plan.WALL_KIND[tk] || { merlon: true }).merlon) return;
    const nM = Math.floor((Math.PI * 2 * t.crownR) / 2.45);   // 狭間を広く(眺めのため)
    for (let m = 0; m < nM; m++) {
      const a = (m / nM) * Math.PI * 2;
      // 支えの環は中点判定(粒度 2π/26)で消える。点判定のままだと、その差分ぶんの
      // メルロンが支えを失って空中に浮く。半セグメント分ひろく間引く。
      if (topBlocks && crownGap && crownGap.some(g => angGap(a, g.a) < g.w + Math.PI / 26)) continue;
      // 王冠の帯(rTop〜crownR)のちょうど真ん中に、帯の厚みに合わせて置く。
      // crownR−0.3 に奥行き 0.72 の箱を置いていたので、0.55m の帯から前後に
      // 0.09m ずつはみ出し、実測で塔の狭間石 60 本の隅が宙に浮いていた。
      const rMid = (rTop + t.crownR * Math.cos(Math.PI / 26)) / 2;
      merlons.push({
        x: t.x + Math.cos(a) * rMid, z: t.z + Math.sin(a) * rMid,
        y: t.topY + 1.00 - 0.03, rotY: Math.atan2(-Math.cos(a), -Math.sin(a)),
        sy: 0.72,                                   // 塔の頂は眺望が主。歯は低く
        // 王冠は 26 角形なので、面の真ん中は半径 crownR·cos(π/26) しかない。
        // 円だと思って詰めると、隅がその外へ出て宙に浮く。
        sz: Math.min(1, (t.crownR * Math.cos(Math.PI / 26) - rTop - 0.12) / 0.72),
      });
    }
    part(_pp);
  }

  // 塔の王冠には、歩廊が通る 2 つの門口を必ず開ける(角度は plan と共有)。
  const gapsOf = (name, w = 0.42) => (plan.towerGaps[name] || []).map(a => ({ a, w }));
  // ミンチェタ
  {
    part('minceta');
    const t = plan.TOWERS.minceta;
    const gaps = gapsOf('minceta');
    tower(t, { crownGap: gaps });
    // ギャラリー床(歩廊高さの円盤)。歩廊が塔を貫くので、その帯は張らない —
    // 塞ぐと、登ってくるランプがこの床の下をくぐって歩く者の頭がめり込む。
    // 内側の境界は plan.deckEdgeAt(= デッキの縁)そのもの。頂点ごとに縁まで
    // 測って折れ線でなぞる — 扇の中点で代表すると、帯に食い込むか、逆に
    // デッキとの間に「床の無い数センチ」が空いて落ちる。
    // 円盤の内側の境界は歩廊の縁をなぞる。26 分割の弦でなぞっていたので、
    // station の間で最大 7cm の隙間(または重なり)が開き、そこから下の空が
    // 見えて「床が板で、周りに継ぎ目がある」ように見えていた。
    // 104 分割にして弦の矢を 4mm に落とし、さらに歩廊の下へ 0.30m もぐらせる。
    const seg = 104, rG = t.crownR - 0.3;
    // 円盤は歩廊より 3cm 低く置く。上に出すと縁が段差(見た目の刃)になる。
    const y = t.galleryY - 0.01;
    const outside = (a, r) => {
      const e = plan.deckEdgeAt(t.x + Math.cos(a) * r, t.z + Math.sin(a) * r);
      return e.nw.d >= e.edge;
    };
    const rInAt = (a) => {
      let lo = 0.2, hi = -1;
      if (outside(a, lo)) return lo;
      for (let r = 0.25; r < rG; r += 0.05) {
        if (outside(a, r)) { hi = r; break; }
        lo = r;
      }
      if (hi < 0) return rG;
      for (let k = 0; k < 12; k++) {       // 二分して縁にぴたりと合わせる
        const m = (lo + hi) / 2;
        if (outside(a, m)) hi = m; else lo = m;
      }
      return hi;
    };
    // 持ち送り(マシコリ)の環 — ギャラリー床の下。これが無いと床が宙に浮く。
    {
      const yC0 = y - 1.55, rIn2 = t.r - 0.05;
      const NC = 48;
      // 受けは「円錐の面 1 枚」だった。厚みが無いので、下から見上げると
      // 門口で切られた縁が刃になり、石ではなく張った帆に見える
      // (ミンチェタの中で「アーチっぽい板」と見えていたのはこれ)。
      // 母線の法線方向へ 0.42m 押した内面を持たせ、両端の環と門口の小口で閉じる。
      const TH2 = 0.42;
      const p2 = (a, r, yy) => [t.x + Math.cos(a) * r, yy, t.z + Math.sin(a) * r];
      const gA = [rIn2, yC0], gB = [rG + 0.06, y - 0.04];
      const dR = gB[0] - gA[0], dY = gB[1] - gA[1];
      const gL = Math.hypot(dR, dY) || 1;
      // 断面の内向き(上・内)。外向きは (dY, −dR)/L なのでその逆。
      const iR = -(dY / gL) * TH2, iY = (dR / gL) * TH2;
      const hA = [gA[0] + iR, gA[1] + iY], hB = [gB[0] + iR, gB[1] + iY];
      const kept = [];
      for (let k = 0; k < NC; k++) {
        const a0 = (k / NC) * Math.PI * 2, a1 = ((k + 1) / NC) * Math.PI * 2;
        kept[k] = !gaps.some(g => angGap((a0 + a1) / 2, g.a) < g.w);
      }
      for (let k = 0; k < NC; k++) {
        if (!kept[k]) continue;
        const a0 = (k / NC) * Math.PI * 2, a1 = ((k + 1) / NC) * Math.PI * 2;
        const am = (a0 + a1) / 2, ro = [Math.cos(am), 0, Math.sin(am)];
        const nOut = [ro[0] * (dY / gL), -dR / gL, ro[2] * (dY / gL)];
        // 下面(裾広がりの受け)と上面(ギャラリー床の下に隠れる)
        quad(p2(a0, gA[0], gA[1]), p2(a1, gA[0], gA[1]), p2(a1, gB[0], gB[1]), p2(a0, gB[0], gB[1]),
          0.62, 0.92, 1, nOut);
        quad(p2(a0, hA[0], hA[1]), p2(a1, hA[0], hA[1]), p2(a1, hB[0], hB[1]), p2(a0, hB[0], hB[1]),
          0.58, 0.82, 1, [-nOut[0], -nOut[1], -nOut[2]]);
        // 胴側の小口と、ギャラリー側の小口
        quad(p2(a0, hA[0], hA[1]), p2(a1, hA[0], hA[1]), p2(a1, gA[0], gA[1]), p2(a0, gA[0], gA[1]),
          0.5, 0.5, 1, [-ro[0], 0, -ro[2]]);
        quad(p2(a0, gB[0], gB[1]), p2(a1, gB[0], gB[1]), p2(a1, hB[0], hB[1]), p2(a0, hB[0], hB[1]),
          0.95, 0.95, 1, ro);
        // 門口の縁に返しを張る(切り口を刃にしない)
        for (const [e, sg] of [[a0, -1], [a1, 1]]) {
          if (kept[(k + (sg > 0 ? 1 : NC - 1)) % NC]) continue;
          const tg = [-Math.sin(e) * sg, 0, Math.cos(e) * sg];
          quad(p2(e, hA[0], hA[1]), p2(e, gA[0], gA[1]), p2(e, gB[0], gB[1]), p2(e, hB[0], hB[1]),
            0.8, 0.9, 1, tg);
        }
      }
      // 1.05m ピッチの持ち送りブロック(0.28幅 × 0.55出 × 0.34高)
      const NB = Math.max(8, Math.round((Math.PI * 2 * rG) / 0.95));
      for (let k = 0; k < NB; k++) {
        const a = (k / NB) * Math.PI * 2 + 0.03;
        if (gaps.some(g => angGap(a, g.a) < g.w)) continue;
        const w2 = 0.17 / rG;
        const p2 = (aa, r, yy) => [t.x + Math.cos(aa) * r, yy, t.z + Math.sin(aa) * r];
        const yb0 = y - 0.62, yb1 = y - 0.04;
        // 持ち送りは「円盤の下」に無ければ支えに見えない。外端は円盤の縁 rG まで。
        const rb2 = [Math.cos(a), 0, Math.sin(a)];
        const tL = [Math.sin(a - w2), 0, -Math.cos(a - w2)], tR = [-Math.sin(a + w2), 0, Math.cos(a + w2)];
        quad(p2(a - w2, rG, yb0), p2(a + w2, rG, yb0), p2(a + w2, rG, yb1), p2(a - w2, rG, yb1), 0.78, 1.0, 1, rb2);
        quad(p2(a - w2, t.r, yb0), p2(a - w2, rG, yb0), p2(a - w2, rG, yb1), p2(a - w2, t.r, yb1), 0.7, 0.92, 1, tL);
        quad(p2(a + w2, rG, yb0), p2(a + w2, t.r, yb0), p2(a + w2, t.r, yb1), p2(a + w2, rG, yb1), 0.7, 0.92, 1, tR);
        quad(p2(a - w2, t.r, yb0), p2(a + w2, t.r, yb0), p2(a + w2, rG, yb0), p2(a - w2, rG, yb0), 0.55, 0.62, 1, DOWN1);
        // 内面と天端。無いと持ち送りは「3 枚の板」で、横から見ると空洞。
        quad(p2(a + w2, t.r, yb0), p2(a - w2, t.r, yb0), p2(a - w2, t.r, yb1), p2(a + w2, t.r, yb1), 0.6, 0.7, 1,
          [-rb2[0], 0, -rb2[2]]);
        quad(p2(a - w2, rG, yb1), p2(a + w2, rG, yb1), p2(a + w2, t.r, yb1), p2(a - w2, t.r, yb1), 0.9, 0.95, 1, UP1);
      }
    }
    // 円盤の外縁にファシア帯(高さ 0.45m)。紙のように薄い縁は必ず浮いて見える。
    for (let k = 0; k < 48; k++) {
      const a0 = (k / 48) * Math.PI * 2, a1 = ((k + 1) / 48) * Math.PI * 2;
      if (gaps.some(g => angGap((a0 + a1) / 2, g.a) < g.w)) continue;
      const p3 = (a, r, yy) => [t.x + Math.cos(a) * r, yy, t.z + Math.sin(a) * r];
      const am3 = (a0 + a1) / 2, ro3 = [Math.cos(am3), 0, Math.sin(am3)];
      quad(p3(a0, rG + 0.05, y - 0.50), p3(a1, rG + 0.05, y - 0.50),
        p3(a1, rG + 0.05, y + 0.05), p3(a0, rG + 0.05, y + 0.05), 0.80, 1.02, 1, ro3);
    }
    const rIns = [], yUns = [];
    for (let s = 0; s <= seg; s++) {
      const a = ((s % seg) / seg) * Math.PI * 2;
      const rr0 = rInAt(a);
      rIns.push(rr0);
      // 歩廊は塔の中を斜路で登る。円盤は水平なので、低い側では円盤の縁が
      // 床から 0.8m 浮き、下腹(y−0.50)が見えて「宙に浮いた板」になる。
      // 内縁の下端は、その真下の歩廊まで下ろす(擁壁として閉じる)。
      const rq = Math.max(rr0 - 0.30, 0.2);
      const e2 = plan.deckEdgeAt(t.x + Math.cos(a) * rq, t.z + Math.sin(a) * rq);
      yUns.push(Math.min(y - 0.50, plan.wallWalkYAt(e2.nw) - 0.08));
    }
    for (let s = 0; s < seg; s++) {
      const a0 = (s / seg) * Math.PI * 2, a1 = ((s + 1) / seg) * Math.PI * 2;
      const r0 = Math.min(Math.max(rIns[s] - 0.30, 0.2), rG);
      const r1 = Math.min(Math.max(rIns[s + 1] - 0.30, 0.2), rG);
      if (rIns[s] > rG - 0.4 && rIns[s + 1] > rG - 0.4) continue;   // この方位は最後まで歩廊の帯
      const p = (a, r) => [t.x + Math.cos(a) * r, y, t.z + Math.sin(a) * r];
      quadUV(p(a0, r0), p(a1, r1), p(a1, rG), p(a0, rG), 1.02, 1.0);
      // 円盤の裏と内縁。片面の板 1 枚だと、塔の中や下の街路から見上げたとき
      // ギャラリーが「浮いた円い板」になる(実測で標本 6 面のうち 5 面が板)。
      // 裏は鼻隠し(rG+0.05, y−0.50..y+0.05)と同じ高さで閉じる。
      const yU = y - 0.50;
      const u0 = yUns[s], u1 = yUns[s + 1];
      const pu = (a, r, yy) => [t.x + Math.cos(a) * r, yy, t.z + Math.sin(a) * r];
      quadUV(pu(a0, r0, u0), pu(a1, r1, u1), pu(a1, rG, yU), pu(a0, rG, yU), 0.52, 0.52, DOWN1);
      const am4 = (a0 + a1) / 2;
      quad(pu(a0, r0, u0), pu(a1, r1, u1), pu(a1, r1, y), pu(a0, r0, y), 0.62, 0.74, 1,
        [-Math.cos(am4), 0, -Math.sin(am4)]);
    }
  }
  tower(plan.TOWERS.bokar, { crownGap: gapsOf('bokar') });
  tower(plan.TOWERS.stjohn, { crownGap: gapsOf('stjohn') });
  tower(plan.TOWERS.neCorner, { crownGap: gapsOf('neCorner') });

  // ---- 聖イヴァンの砲座(カヴァリエ)。稜堡の上に一段高い砲座を載せるのは
  // 実在の作りで、要塞にも上段のテラスがある。
  //
  // 場所は目で選んでいない。行ける 1,785 点を射線で測って、
  // **歩廊の上では手前を塞ぐ石が最小でも 17% 残る**(胸壁は必ず 22m 以内に
  // ある)ことを確かめたうえで、天端 17.4m なら 0% になる高さを求めた。
  // だから縁は胸壁ではなく膝より低い縁石にする — 立てた瞬間に 0% は消える。
  {
    const _pv = part('cavalier');
    const C = plan.CAVALIER;
    const SEG = 26, TAU2 = Math.PI * 2;
    const y0 = C.base - 0.4, y1 = C.y;
    const rB = C.rMass, rT = C.r;
    const P2 = (a, r, y) => [C.x + Math.cos(a) * r, y, C.z + Math.sin(a) * r];
    const aStair = Math.atan2(59.6 - C.z, 176.0 - C.x);   // 階段が着く方位
    for (let k = 0; k < SEG; k++) {
      const a0 = (k / SEG) * TAU2, a1 = ((k + 1) / SEG) * TAU2, am = (a0 + a1) / 2;
      const ro = [Math.cos(am), 0, Math.sin(am)];
      const nro = [-ro[0], 0, -ro[2]];
      // 胴(わずかな裾広がり)
      quad(P2(a0, rB, y0), P2(a1, rB, y0), P2(a1, rT, y1 - 0.36), P2(a0, rT, y1 - 0.36), 0.84, 1.0, 1, ro);
      // 蛇腹 — 天端の下に影の線が要る。無いと箱を置いただけに見える。
      quad(P2(a0, rT, y1 - 0.36), P2(a1, rT, y1 - 0.36),
        P2(a1, rT + 0.18, y1 - 0.36), P2(a0, rT + 0.18, y1 - 0.36), 0.62, 0.62, 1, DOWN1);
      quad(P2(a0, rT + 0.18, y1 - 0.36), P2(a1, rT + 0.18, y1 - 0.36),
        P2(a1, rT + 0.18, y1 - 0.12), P2(a0, rT + 0.18, y1 - 0.12), 1.04, 1.04, 1, ro);
      quad(P2(a0, rT + 0.18, y1 - 0.12), P2(a1, rT + 0.18, y1 - 0.12),
        P2(a1, rT, y1), P2(a0, rT, y1), 1.08, 1.08, 1, UP1);
      // 天端と底
      quadUV(P2(a0, 0.02, y1), P2(a1, 0.02, y1), P2(a1, rT, y1), P2(a0, rT, y1), 1.02, 1.0);
      quadUV(P2(a1, 0.02, y0), P2(a0, 0.02, y0), P2(a0, rB, y0), P2(a1, rB, y0), 0.5, 0.5, DOWN1);
      // 縁石。膝より低い見切りで、視界には入らない(実測 仰角 −8° では当たらない)。
      // 階段の着く一区画だけ開ける。
      if (angGap(am, aStair) > 0.55) {
        const rk = rT - 0.34, yk = y1 + 0.26;
        quad(P2(a0, rk, y1), P2(a1, rk, y1), P2(a1, rk, yk), P2(a0, rk, yk), 0.88, 0.96, 1, nro);
        quad(P2(a0, rT, y1), P2(a1, rT, y1), P2(a1, rT, yk), P2(a0, rT, yk), 0.94, 1.02, 1, ro);
        quadUV(P2(a0, rk, yk), P2(a1, rk, yk), P2(a1, rT, yk), P2(a0, rT, yk), 1.06, 1.06);
        // 切り口(階段側の小口)
        for (const [e, sg] of [[a0, -1], [a1, 1]]) {
          if (angGap(e + sg * (TAU2 / SEG) * 0.5, aStair) > 0.55) continue;
          const tg = [-Math.sin(e) * sg, 0, Math.cos(e) * sg];
          quad(P2(e, rk, y1), P2(e, rT, y1), P2(e, rT, yk), P2(e, rk, yk), 0.9, 0.98, 1, tg);
        }
      }
    }
    part(_pv);
  }

  // 石の角柱(ポータルの門枠用: 4面)
  function pier(x, z, w, d, y0, y1, tint = 0.95) {
    const _pp = part('pier');
    const hw = w / 2, hd = d / 2;
    quad([x - hw, y0, z + hd], [x + hw, y0, z + hd], [x + hw, y1, z + hd], [x - hw, y1, z + hd], tint, tint);
    quad([x + hw, y0, z - hd], [x - hw, y0, z - hd], [x - hw, y1, z - hd], [x + hw, y1, z - hd], tint, tint);
    quad([x + hw, y0, z + hd], [x + hw, y0, z - hd], [x + hw, y1, z - hd], [x + hw, y1, z + hd], tint, tint);
    quad([x - hw, y0, z - hd], [x - hw, y0, z + hd], [x - hw, y1, z + hd], [x - hw, y1, z - hd], tint, tint);
    // 天と地。塞がないと門枠が「4 枚の板」で、中を覗くと空洞が見える。
    quadUV([x - hw, y1, z - hd], [x + hw, y1, z - hd], [x + hw, y1, z + hd], [x - hw, y1, z + hd], tint * 1.05, tint * 1.05);
    quadUV([x - hw, y0, z + hd], [x + hw, y0, z + hd], [x + hw, y0, z - hd], [x - hw, y0, z - hd], tint * 0.5, tint * 0.5, [0, -1, 0]);
    part(_pp);
  }

  // ---- 城壁への階段(石段は StepPool・囲いはここで)
  for (const st of plan.WALL_STAIRS) {
    part('stairWall');
    stepPool.addRun(st.pts, st.w);
    const stLen = st.pts.reduce((acc, p2, i2) => i2 ? acc + Math.hypot(p2[0] - st.pts[i2 - 1][0], p2[1] - st.pts[i2 - 1][1]) : 0, 0);
    let sCum = 0;
    // 囲い階段の入口 = 街に開く石のポータル(見つけられない入口は存在しないのと同じ)
    if (st.enclosed && !st.spiral) {
      const [ex, ez, ey] = st.pts[0];
      const [nx1, nz1] = [st.pts[1][0] - ex, st.pts[1][1] - ez];
      const L1 = Math.hypot(nx1, nz1);
      const dx1 = nx1 / L1, dz1 = nz1 / L1;      // 奥へ向かう向き
      const px1 = -dz1, pz1 = dx1;                // 開口の横方向
      const hw = st.w / 2 + 0.32;
      // 門柱(左右)
      pier(ex + px1 * hw, ez + pz1 * hw, 0.5, 0.5, ey - 0.4, ey + 2.75, 1.0);
      pier(ex - px1 * hw, ez - pz1 * hw, 0.5, 0.5, ey - 0.4, ey + 2.75, 1.0);
      // まぐさ(横架材)と上の壁
      quad(
        [ex - px1 * (hw + 0.25), ey + 2.55, ez - pz1 * (hw + 0.25)],
        [ex + px1 * (hw + 0.25), ey + 2.55, ez + pz1 * (hw + 0.25)],
        [ex + px1 * (hw + 0.25), ey + 3.3, ez + pz1 * (hw + 0.25)],
        [ex - px1 * (hw + 0.25), ey + 3.3, ez - pz1 * (hw + 0.25)],
        1.02, 1.02,
      );
      quad(
        [ex + px1 * (hw + 0.25), ey + 2.55, ez + pz1 * (hw + 0.25)],
        [ex - px1 * (hw + 0.25), ey + 2.55, ez - pz1 * (hw + 0.25)],
        [ex - px1 * (hw + 0.25), ey + 3.3, ez - pz1 * (hw + 0.25)],
        [ex + px1 * (hw + 0.25), ey + 3.3, ez + pz1 * (hw + 0.25)],
        1.0, 1.0,
      );
    }
    // ---- 囲い階段は「閉じた П 断面の掃引」で作る -------------------------
    //
    // 側壁 2 枚・天井 1 枚・屋根 4 枚を別々の面として張っていた。厚みが無く、
    // 端も塞がっていないので、実測で三角 264 枚に対し境界稜線が 232 本
    // (= 88% が穴の縁)。歩廊から見ると「刃のような茶色い斜面」が空中に
    // 出るのはこれ。断面を閉じて掃けば、厚みも小口も作り方から出る。
    if (st.enclosed && !st.spiral) {
      const half = st.w / 2 + 0.18;         // 衝突シェルと同じ内法(見える壁に実体がある)
      const hI = half, hO = half + 0.50, hR = hO + 0.18;
      const CH = 2.5, RT = 0.16;            // 天井高 / 屋根の厚み
      const cutS = stLen - 1.7;             // 上端は歩廊の手前で切る
      // station 列(折れ点 + 切り口)
      const stn = [];
      let cum = 0;
      for (let k = 0; k < st.pts.length; k++) {
        if (k > 0) cum += Math.hypot(st.pts[k][0] - st.pts[k - 1][0], st.pts[k][1] - st.pts[k - 1][1]);
        if (cum > cutS + 1e-6) {
          const kp = k - 1;
          const segL = Math.hypot(st.pts[k][0] - st.pts[kp][0], st.pts[k][1] - st.pts[kp][1]);
          const tt = segL > 1e-6 ? (cutS - (cum - segL)) / segL : 0;
          if (tt > 1e-3) stn.push({ k: kp, t: tt });
          break;
        }
        stn.push({ k, t: 0 });
      }
      const latAt = (k) => {
        const m = st.miter[k];
        return [m.mx * m.scale, m.mz * m.scale];   // マイター量込み(角で外面が平行に保たれる)
      };
      const ringAt = (sn) => {
        const k = sn.k, k2 = Math.min(k + 1, st.pts.length - 1);
        const p0 = st.pts[k], p1 = st.pts[k2];
        const cx = lerp(p0[0], p1[0], sn.t), cz = lerp(p0[1], p1[1], sn.t);
        const y0 = lerp(p0[2], p1[2], sn.t);
        const L0 = latAt(k), L1 = latAt(k2);
        const lx = lerp(L0[0], L1[0], sn.t), lz = lerp(L0[1], L1[1], sn.t);
        const f = Math.min(y0 - 0.4, plan.terrainHeight(cx, cz) - 0.3);
        const c = y0 + CH, r = c + RT;
        const P2 = (u, y) => [cx + lx * u, y, cz + lz * u];
        return { lx, lz, f, c, r,
          v: [[-hO, f], [-hI, f], [-hI, c], [hI, c], [hI, f], [hO, f],
            [hO, c], [hR, c], [hR, r], [-hR, r], [-hR, c], [-hO, c]].map(([u, y]) => P2(u, y)),
          uv: [[-hO, f], [-hI, f], [-hI, c], [hI, c], [hI, f], [hO, f],
            [hO, c], [hR, c], [hR, r], [-hR, r], [-hR, c], [-hO, c]] };
      };
      // 断面の頂点ごとの明度。頂点 i の値は面 (i→j) と面 (h→i) の両方に効く。
      // 外壁を裾で 0.38 まで落としていたので、8m の階段塔の大半が黒に沈み、
      // 歩廊から見ると「石ではなく穴」に見えていた。外は明るく、通路の中だけ暗く。
      //           0外裾 1内裾 2内上 3内上 4内裾 5外裾 6外上 7軒裏 8鼻隠 9鼻隠 10軒裏 11外上
      const TN = [0.86, 0.42, 0.36, 0.36, 0.42, 0.86, 0.98, 0.70, 1.02, 1.02, 0.70, 0.98];
      const rings = stn.map(ringAt);
      const NVe = 12;
      // 断面は (u,y) 平面で反時計回り。辺 (du,dy) の外向きは (dy,−du)。
      const eOut = (R, i) => {
        const j = (i + 1) % NVe;
        const du = R.uv[j][0] - R.uv[i][0], dy = R.uv[j][1] - R.uv[i][1];
        const L = Math.hypot(du, dy) || 1;
        const hl = Math.hypot(R.lx, R.lz) || 1;
        return [(R.lx / hl) * (dy / L), -du / L, (R.lz / hl) * (dy / L)];
      };
      for (let s = 0; s + 1 < rings.length; s++) {
        const A = rings[s], B = rings[s + 1];
        for (let i = 0; i < NVe; i++) {
          const j = (i + 1) % NVe;
          quad(A.v[i], B.v[i], B.v[j], A.v[j], TN[i], TN[j], 1, eOut(A, i));
        }
      }
      // 小口(入口側と上端)。П 断面は星形ではない — 頂点 0 から扇にすると
      // 三角形が通路の空洞を横切り、入口を石で塞ぐ(実際に塞がった)。
      // 脚 2 本と屋根の 3 つの凸な四角に割る。
      const CAP_Q = [[0, 1, 2, 11], [4, 5, 6, 3], [10, 7, 8, 9]];
      const capE = (R, k0, sign) => {
        const k2 = Math.min(k0 + 1, st.pts.length - 1);
        const dxx = st.pts[k2][0] - st.pts[k0][0], dzz = st.pts[k2][1] - st.pts[k0][1];
        const dl = Math.hypot(dxx, dzz) || 1;
        const want = [(dxx / dl) * sign, 0, (dzz / dl) * sign];
        for (const q of CAP_Q) quad(R.v[q[0]], R.v[q[1]], R.v[q[2]], R.v[q[3]], 0.86, 0.86, 1, want);
      };
      if (rings.length >= 2) {
        capE(rings[0], stn[0].k, -1);
        capE(rings[rings.length - 1], stn[stn.length - 1].k, 1);
      }
      // 段の下腹 = 内法いっぱいの独立した閉じた台。段を支える石が無いと、
      // 入口から覗いたとき段が宙に浮いて見える(П は下が開いている)。
      {
        const plinth = rings.map((R) => {
          const sf = R.c - CH - 0.42;                    // 段の裏 = 踏面 −0.42
          const hl = Math.hypot(R.lx, R.lz) || 1;
          const cx = (R.v[1][0] + R.v[4][0]) / 2, cz = (R.v[1][2] + R.v[4][2]) / 2;
          const q = (u, y) => [cx + (R.lx / hl) * u, y, cz + (R.lz / hl) * u];
          return { lx: R.lx / hl, lz: R.lz / hl,
            v: [q(-hI, R.f), q(hI, R.f), q(hI, sf), q(-hI, sf)],
            uv: [[-hI, R.f], [hI, R.f], [hI, sf], [-hI, sf]] };
        });
        const eO4 = (R, i) => {
          const j = (i + 1) % 4;
          const du = R.uv[j][0] - R.uv[i][0], dy = R.uv[j][1] - R.uv[i][1];
          const L = Math.hypot(du, dy) || 1;
          return [R.lx * (dy / L), -du / L, R.lz * (dy / L)];
        };
        for (let s = 0; s + 1 < plinth.length; s++) {
          const A = plinth[s], B = plinth[s + 1];
          for (let i = 0; i < 4; i++) {
            const j = (i + 1) % 4;
            quad(A.v[i], B.v[i], B.v[j], A.v[j], i === 3 ? 0.58 : 0.46, i === 3 ? 0.58 : 0.46, 1, eO4(A, i));
          }
        }
        for (const [R, k0, sg] of [[plinth[0], stn[0].k, -1],
          [plinth[plinth.length - 1], stn[stn.length - 1].k, 1]]) {
          if (!R) continue;
          const k2 = Math.min(k0 + 1, st.pts.length - 1);
          const dxx = st.pts[k2][0] - st.pts[k0][0], dzz = st.pts[k2][1] - st.pts[k0][1];
          const dl = Math.hypot(dxx, dzz) || 1;
          quad(R.v[0], R.v[1], R.v[2], R.v[3], 0.5, 0.5, 1, [(dxx / dl) * sg, 0, (dzz / dl) * sg]);
        }
      }
    }

    // 露天階段: 外縁の手すり壁 / 階段室: 壁と天井
    for (let i = 1; i < st.pts.length; i++) {
      let [ax, az, ay] = st.pts[i - 1];
      let [bx, bz, by] = st.pts[i];
      let len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      const nx = -dz, nz = dx;
      const half = st.w / 2 + 0.18;
      const segStart = sCum;
      sCum += len;
      if (st.enclosed) {
        // 囲いの本体は上の掃引で作った。ここは北面の銃眼(細い光のスリット)だけ。
        const cut = (stLen - 1.7) - segStart;
        if (cut <= 0.05) continue;
        if (i % 2 === 1) {
          const mx2 = (ax + bx) / 2 + nx * (half - 0.02);
          const mz2 = (az + bz) / 2 + nz * (half - 0.02);
          const my2 = (ay + by) / 2 + 1.5;
          slitGeos.push([mx2, my2, mz2, Math.atan2(nx, nz)]);
        }
      } else if (st.spiral) {
        // 螺旋にも下腹を張る(手すりは塔の王冠が兼ねるので立てない)。
        // これが無いと段が「壁に貼った板の階段」になる。
        const sv2 = st.segs.find(s3 => s3.i === i)?.railSign ?? 1;
        // 桁は踏面より 0.18m 外に立っていた。踏面(StepPool の箱)は半幅
        // st.w/2 なので、両側に 0.18m の隙間が開き、そこから梁の中が見える
        // (実測 1 視点 6,908px)。踏面のすぐ脇に立てる。
        const hs2 = st.w / 2 + 0.03;
        const [Ua, Ub] = [st.offAt(i - 1, sv2, hs2), st.offAt(i, sv2, hs2)];
        const [Va, Vb] = [st.offAt(i - 1, -sv2, hs2), st.offAt(i, -sv2, hs2)];
        // 下腹と両側の桁。外向きを渡さずに三枚を同じ巻きで張っていたので、
        // 谷側の桁は法線が石の中を向いて消え、螺旋が「片側だけの板」になっていた
        // (塔の中から実測 1 視点 23,697px)。
        // さらに厚みが 0.50m しか無く、塔の中を斜めに横切る「板」に見えていた。
        // 石の階段は梁として成立する背を持つ。1.00m の斜梁にして、踏面の下に
        // 出の帯(ストリング)を回す — 縁が刃でなくなると、板ではなく石になる。
        const DP = 1.00, SP2 = 0.10;
        quad([Ua[0], ay - DP, Ua[1]], [Ub[0], by - DP, Ub[1]],
          [Vb[0], by - DP, Vb[1]], [Va[0], ay - DP, Va[1]], 0.52, 0.60, 1, DOWN1);
        // 斜めの天端。踏面は段ごとに離れた箱なので、天端が無いと段と段の
        // 隙間から梁の中(向こう側の桁の裏)が見える。
        quadUV([Ua[0], ay - 0.30, Ua[1]], [Ub[0], by - 0.30, Ub[1]],
          [Vb[0], by - 0.30, Vb[1]], [Va[0], ay - 0.30, Va[1]], 0.94, 0.98);
        // 斜めの天端。踏面(StepPool の箱)は段ごとに離れているので、天端が
        // 無いと段と段の隙間から梁の中が見え、外側の面を裏から見ることになる。
        // 石の階段は中身が詰まっている。踏面のすぐ下に斜めの天端を張る。
        for (const [A, B, so] of [[Ua, Ub, 1], [Vb, Va, -1]]) {
          // 外向きは区間の法線ではなく「実際に振った先」から取る。offAt は
          // 折れ点でマイターするので、区間の法線とはずれる。ずれた向きを
          // 基準にすると、折れの強い所で quad が巻きを直せず、両面が同じ側を
          // 向いて片方が消える(螺旋の桁で実測)。
          let ovx = (A[0] - ax + B[0] - bx) / 2, ovz = (A[1] - az + B[1] - bz) / 2;
          const ovl = Math.hypot(ovx, ovz) || 1; ovx /= ovl; ovz /= ovl;
          const ov2 = [ovx, 0, ovz];
          quad([A[0], ay - DP, A[1]], [B[0], by - DP, B[1]],
            [B[0], by - 0.46, B[1]], [A[0], ay - 0.46, A[1]], 0.70, 0.80, 1, ov2);
          quad([A[0], ay - 0.16, A[1]], [B[0], by - 0.16, B[1]],
            [B[0], by + 0.02, B[1]], [A[0], ay + 0.02, A[1]], 0.86, 0.94, 1, ov2);
          // 出の帯。桁の面から 0.10m せり出す。
          const [Ap, Bp] = [[A[0] + ov2[0] * SP2, A[1] + ov2[2] * SP2],
            [B[0] + ov2[0] * SP2, B[1] + ov2[2] * SP2]];
          quad([Ap[0], ay - 0.46, Ap[1]], [Bp[0], by - 0.46, Bp[1]],
            [Bp[0], by - 0.16, Bp[1]], [Ap[0], ay - 0.16, Ap[1]], 1.0, 1.06, 1, ov2);
          quad([A[0], ay - 0.46, A[1]], [B[0], by - 0.46, B[1]],
            [Bp[0], by - 0.46, Bp[1]], [Ap[0], ay - 0.46, Ap[1]], 0.62, 0.68, 1, DOWN1);
          quad([Ap[0], ay - 0.16, Ap[1]], [Bp[0], by - 0.16, Bp[1]],
            [B[0], by - 0.16, B[1]], [A[0], ay - 0.16, A[1]], 1.02, 1.05, 1, UP1);
        }
        // 端の小口。螺旋は塔の中で始まり中で終わるので、切り口が必ず見える。
        for (const [A, V, sg2] of [[Ua, Va, -1], [Ub, Vb, 1]]) {
          if ((sg2 < 0 && i !== 1) || (sg2 > 0 && i !== st.pts.length - 1)) continue;
          const yy = sg2 < 0 ? ay : by;
          const eN = [dx * sg2, 0, dz * sg2];
          quad([A[0], yy - DP, A[1]], [V[0], yy - DP, V[1]],
            [V[0], yy + 0.02, V[1]], [A[0], yy + 0.02, A[1]], 0.8, 0.9, 1, eN);
          // 出の帯の小口。ここを塞がないと帯だけが切り口のまま宙に出る。
          const [cx9, cz9] = sg2 < 0 ? [ax, az] : [bx, bz];
          for (const Q of [A, V]) {
            let ox9 = Q[0] - cx9, oz9 = Q[1] - cz9;
            const ol9 = Math.hypot(ox9, oz9) || 1; ox9 /= ol9; oz9 /= ol9;
            const qx = Q[0] + ox9 * SP2, qz = Q[1] + oz9 * SP2;
            quad([Q[0], yy - 0.46, Q[1]], [qx, yy - 0.46, qz],
              [qx, yy - 0.16, qz], [Q[0], yy - 0.16, Q[1]], 0.8, 0.9, 1, eN);
          }
        }
      } else if (!st.spiral) {
        // 露天: 谷側(城壁中心線から遠い側)に「厚みのある」手すり壁。
        // 螺旋(塔頂への回り階段)は塔の王冠の内側を回るので手すりは要らない。
        // 立てると塔の内部に板が宙吊りになる(plan.js の衝突側は既に除外済み)。
        // 一枚板は真横から消え、上端が刃物になる — 必ず2面+笠石+端部キャップ。
        // 谷側の判定は plan.js が持つ(衝突と同じ定義を使う — ここで再計算しない)。
        const sv = st.segs.find(s2 => s2.i === i).railSign;
        const rx = nx * sv, rz = nz * sv;
        const railT = 0.26;
        const isLast = i === st.pts.length - 1;
        const isFirst = i === 1;
        // 手すり天端: 最上段は歩廊へすぼめる(空に板を立てない)
        const topA = ay + (isLast ? 0.9 : 1.0);
        const topB = by + (isLast ? 0.2 : 1.0);
        // 面は plan のマイター定義から(折れ点で板が隣の通路を横切らない)
        const rail = (dist) => [st.offAt(i - 1, sv, dist), st.offAt(i, sv, dist)];
        // 平行な二枚を「同じ巻き」で張っていた。quad は巻きから法線を出すので、
        // 内側の一枚は法線が石の中を向き、FrontSide で消える。
        // = 手すりが空洞になり、外から中の壁の裏側が見える(実測で報告あり)。
        // 面ごとに外向きを渡す。二枚組を張るときは必ず外向きを明示する。
        for (const [off, so] of [[half, 1], [half - railT, -1]]) {
          const [A, B] = rail(off);
          quad(
            [A[0], ay - 2.0, A[1]],
            [B[0], by - 2.0, B[1]],
            [B[0], topB, B[1]],
            [A[0], topA, A[1]],
            0.8, 1.0, 1, [rx * so, 0, rz * so],
          );
        }
        // 笠石(上面)
        const [Ri, Rj] = rail(half - railT), [Ro, Rk] = rail(half);
        quad(
          [Ri[0], topA, Ri[1]], [Rj[0], topB, Rj[1]],
          [Rk[0], topB, Rk[1]], [Ro[0], topA, Ro[1]],
          1.02, 1.02, 1, UP1,
        );
        // 端部キャップ(始端と終端の小口)
        if (isFirst) {
          quad(
            [Ri[0], ay - 2.0, Ri[1]], [Ro[0], ay - 2.0, Ro[1]],
            [Ro[0], topA, Ro[1]], [Ri[0], topA, Ri[1]],
            0.9, 0.95, 1, [-dx, 0, -dz],
          );
        }
        if (isLast) {
          quad(
            [Rk[0], by - 2.0, Rk[1]], [Rj[0], by - 2.0, Rj[1]],
            [Rj[0], topB, Rj[1]], [Rk[0], topB, Rk[1]],
            0.9, 0.95, 1, [dx, 0, dz],
          );
        }
        // 段の下のスラブ(浮いた箱にしない)
        const [Sa, Sb] = [st.offAt(i - 1, -sv, half), st.offAt(i, -sv, half)];
        // 下腹(通りから見上げる面)。下向きに張り替えたら、段が「支えの上に
        // 載っていない」と 79 段で鳴った。段はこの下腹の上面に載っていたのが、
        // 正しく下を向いた途端に受けが消えたため。石の階段は中身が詰まって
        // いるのだから、踏面のすぐ下に斜めの天端を張る。
        quad(
          [Sa[0], ay - 0.52, Sa[1]], [Sb[0], by - 0.52, Sb[1]],
          [Rk[0], by - 0.52, Rk[1]], [Ro[0], ay - 0.52, Ro[1]],
          0.82, 0.9, 1, DOWN1,
        );
        quadUV(
          [Sa[0], ay - 0.14, Sa[1]], [Sb[0], by - 0.14, Sb[1]],
          [Rk[0], by - 0.14, Rk[1]], [Ro[0], ay - 0.14, Ro[1]],
          0.94, 0.98,
        );
        // 山側スカート(厚み付き: 2面 + 笠)
        const [Si, Sj] = [st.offAt(i - 1, -sv, half - railT), st.offAt(i, -sv, half - railT)];
        for (const [A, B, so] of [[Sa, Sb, -1], [Si, Sj, 1]]) {
          quad(
            [A[0], ay - 1.6, A[1]], [B[0], by - 1.6, B[1]],
            [B[0], by - 0.3, B[1]], [A[0], ay - 0.3, A[1]],
            0.78, 0.92, 1, [rx * so, 0, rz * so],
          );
        }
        quad(
          [Sa[0], ay - 0.3, Sa[1]], [Sb[0], by - 0.3, Sb[1]],
          [Sj[0], by - 0.3, Sj[1]], [Si[0], ay - 0.3, Si[1]],
          0.95, 0.95, 1, UP1,
        );
      }
    }
  }

  // ---- ピレ橋(西門の外の石橋)+ プロチェ橋
  function bridge(x0, z0, x1, z1, y, y1 = null) {
    const _pp = part('bridge');
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const nx = -uz, nz = ux;
    const half = 2.6;
    const yb = y1 ?? y;
    // デッキ(勾配つき — 端で高さが違う橋は y1 を渡す)
    quad([x0 + nx * half, y, z0 + nz * half], [x1 + nx * half, yb, z1 + nz * half],
      [x1 - nx * half, yb, z1 - nz * half], [x0 - nx * half, y, z0 - nz * half], 1.02, 1.02);
    // 側壁(桁下の腹起こし)。ここは石積みの中なので 1 枚でよい。
    for (const s of [-1, 1]) {
      quad([x0 + nx * half * s, y - 8.5, z0 + nz * half * s], [x1 + nx * half * s, yb - 8.5, z1 + nz * half * s],
        [x1 + nx * half * s, yb + 0.02, z1 + nz * half * s], [x0 + nx * half * s, y + 0.02, z0 + nz * half * s], 0.7, 1.0);
    }
    // 欄干は「面 1 枚」ではなく厚みのある石。1 枚だと天端が刃になり、
    // 上から見たときに橋が「壁を 2 枚立てた空き箱」に見える。
    // 欄干の厚み。歩ける帯(walk:ploceBridge の半幅)に食い込むと、
    // 天端が「足の上 1.0m にある床」として検出される。帯の外に収める。
    const PT2 = 0.18, PH2 = 1.00;
    for (const s of [-1, 1]) {
      const oX = nx * half * s, oZ = nz * half * s;               // 外面
      const iX = nx * (half - PT2) * s, iZ = nz * (half - PT2) * s;  // 内面
      const A = (ox, oz, yy) => [x0 + ox, yy, z0 + oz];
      const B = (ox, oz, yy) => [x1 + ox, yy + (yb - y), z1 + oz];
      const outv = [nx * s, 0, nz * s];
      quad(A(oX, oZ, y - 0.3), B(oX, oZ, y - 0.3), B(oX, oZ, y + PH2), A(oX, oZ, y + PH2), 0.86, 1.0, 1, outv);
      quad(A(iX, iZ, y - 0.3), B(iX, iZ, y - 0.3), B(iX, iZ, y + PH2), A(iX, iZ, y + PH2), 0.82, 0.96, 1,
        [-outv[0], 0, -outv[2]]);
      quadUV(A(iX, iZ, y + PH2), B(iX, iZ, y + PH2), B(oX, oZ, y + PH2), A(oX, oZ, y + PH2), 1.04, 1.04);
      quadUV(A(iX, iZ, y - 0.3), B(iX, iZ, y - 0.3), B(oX, oZ, y - 0.3), A(oX, oZ, y - 0.3), 0.5, 0.5, DOWN1);
      // 小口(両端)
      quad(A(iX, iZ, y - 0.3), A(oX, oZ, y - 0.3), A(oX, oZ, y + PH2), A(iX, iZ, y + PH2), 0.9, 0.9, 1, [-ux, 0, -uz]);
      quad(B(oX, oZ, y - 0.3), B(iX, iZ, y - 0.3), B(iX, iZ, y + PH2), B(oX, oZ, y + PH2), 0.9, 0.9, 1, [ux, 0, uz]);
    }
    // 端の小口は張らない。両端とも地面に着くので不要で、ピレ橋では
    // 門の手前に高さ 1m の壁が立って通路を塞いだ。
    part(_pp);
  }
  // 西端は橋台(surround の橋脚 -177.6)の上まで伸ばす。デッキがそこで
  // 切れていたので、橋台だけが 2.4m せり出して「石の空箱」に見えていた。
  bridge(-178.6, 2.2, -160, 2.2, 2.8);
  // プロチェ橋。旧: (160,-52)→(174,-60) は門から 4.5m 離れた所で始まり、
  // しかも OUTSIDE_WALKS に無いので歩けなかった。門の敷居から対岸の地面へ。
  // 幅 19m の空堀を渡り、向こう岸(y≒3.85)へ登る。
  bridge(153.9, -48.6, 159.3, -51.7, 5.58, 5.58);
  bridge(159.3, -51.7, 172.0, -59.0, 5.58, 3.85);

  // ---- ポルポレラ防波堤(歩ける)
  part('breakwater');
  // 防波堤は「天板と側面 2 枚」だった。端も底も無いので、上から見ると
  // 水面に浮いた板、横から見ると中が空。閉じた石の塊にする。
  // 二枚組を同じ巻きで張ると片面が消えるので、外向きは必ず明示する。
  const mole = (x0, x1, z0, z1, yTop, yBot, t0, t1) => {
    quadUV([x0, yTop, z1], [x1, yTop, z1], [x1, yTop, z0], [x0, yTop, z0], t1, t1);
    quadUV([x0, yBot, z0], [x1, yBot, z0], [x1, yBot, z1], [x0, yBot, z1], t0 * 0.7, t0 * 0.7, DOWN1);
    for (const [zz, sg] of [[z0, -1], [z1, 1]]) {
      quad([x0, yBot, zz], [x1, yBot, zz], [x1, yTop, zz], [x0, yTop, zz], t0, t1, 1, [0, 0, sg]);
    }
    for (const [xx, sg] of [[x0, -1], [x1, 1]]) {
      quad([xx, yBot, z0], [xx, yBot, z1], [xx, yTop, z1], [xx, yTop, z0], t0, t1, 1, [sg, 0, 0]);
    }
  };
  {
    const w = plan.OUTSIDE_WALKS.find(o => o.id === 'porporela');
    mole(w.x0, w.x1, w.z0, w.z1, w.y, -1.5, 0.62, 1.04);
  }
  // カセ突堤(沖の防波堤・眺めるだけ)
  mole(202, 210, -20, 16, 1.1, -1.5, 0.7, 1.0);

  // ---- 門アーチを本体に取り込む
  // 別メッシュ + mat.clone() にしていたが、three の Material.copy() は
  // onBeforeCompile も customProgramCacheKey も複製しない。つまり門だけ
  // 天空可視率もマクロ変調も消えたまま描かれ、日陰で塗装金属に見えていた。
  // 本体の配列に足せばシェーダも共有でき、ドローコールも 1 減る。
  if (gateGeos.length) {
    const gg = mergeExtrudes(gateGeos);
    const gp = gg.attributes.position.array, gn = gg.attributes.normal.array;
    const gu = gg.attributes.uv.array;
    const n0 = P.length / 3;
    for (let i = 0; i < gp.length; i += 3) {
      P.push(gp[i], gp[i + 1], gp[i + 2]);
      N.push(gn[i], gn[i + 1], gn[i + 2]);
      C.push(1, 1, 1);
    }
    for (let i = 0; i < gu.length; i += 2) U.push(gu[i], gu[i + 1]);
    for (let i = 0, c = gp.length / 3; i < c; i++) I.push(n0 + i);
  }

  // ---- 本体メッシュ化
  { const last = PARTS[PARTS.length - 1]; if (last) last.to = I.length / 3; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  geo.setIndex(I);
  const mat = new THREE.MeshStandardMaterial({
    map: tex.fortStone.map, normalMap: tex.fortStone.normalMap,
    normalScale: new THREE.Vector2(1.7, 1.7),
    // color を省くと白(アルベド 1.0)。日向と日陰の差が 3/255 しか出ず、
    // 要塞の面の向きが読めなくなる。実物のコルチュラ石は生成り。
    color: 0xc9c0ad,
    vertexColors: true, roughness: 0.88, metalness: 0,
    envMapIntensity: 0.55,
    // FrontSide。城壁の全部位を閉じた立体にしたので、両面材で中空の殻を
    // 隠す必要がなくなった。裏返った面はここで即座に「穴」として見える —
    // DoubleSide は欠陥を隠す道具であって、厚みを作る道具ではない。
  });
  // 4.2m 周期のタイリングが城壁の大面で露骨に見える(最大特徴 0.42m)。
  // 同じマップを 1/7・1/23 の尺で引いて低周波のうねりを重ねる。テクスチャ追加なし。
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      float wv1 = texture2D(map, vMapUv * 0.145 + vec2(0.29, 0.67)).g;
      float wv2 = texture2D(map, vMapUv * 0.043 + vec2(0.83, 0.19)).g;
      diffuseColor.rgb *= 1.0 + 0.19 * (wv1 - 0.5) + 0.13 * (wv2 - 0.5);`);
  };
  mat.customProgramCacheKey = () => 'fortMacro';
  const skyAt = sharedSkyVis || makeSkyVis(plan);
  bakeSkyVis(geo, skyAt, { offsetY: 0.4 });
  patchSkyVis(mat);
  patchWet(mat, { wet: 0.52, top: 0.55, foam: 0.60 });   // 海に立つ稜堡の足元は常に濡れている
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  geo.userData.parts = PARTS.filter(q => q.to > q.from);
  group.add(tagMesh(mesh, 'wall.curtain', { solid: true, masonry: true, groundContact: true }));

  // ---- 銃眼スリット(空の光を細く落とす)
  if (slitGeos.length) {
    const sg = [];
    for (const [x, y, z, ry] of slitGeos) {
      const q = new THREE.PlaneGeometry(0.24, 1.1);
      q.rotateY(ry);
      q.translate(x, y, z);
      sg.push(q);
    }
    const slitMesh = new THREE.Mesh(mergeExtrudes(sg.map(g => g.toNonIndexed())), new THREE.MeshStandardMaterial({ color: 0x141a20, roughness: 0.95, envMapIntensity: 0.15 }));   // 矢狭間の奥は暗がり。発光する穴は無い
    slitMesh.renderOrder = 1;
    group.add(tagMesh(slitMesh, 'wall.arrowSlit', { thin: true, reason: '矢狭間の奥の暗がり(面 1 枚)' }));
  }

  // ---- メルロン(インスタンス)
  // 素の直方体は、掠める角度で「立てた板」にしか見えない。実物の狭間石は
  // 天端に笠(面取り)があり、そこに必ず一本のハイライトが乗る。
  // 面取りを 8cm 入れるだけで、同じ石が板ではなく塊として読める。
  const merlonGeo = (() => {
    // 高さ 1.20 + 胸壁 1.10 = 目線(1.62)より 0.68m 上。狭間の隙間からしか
    // 外が見えず、「上から海が見たいのに景色が見えない」の主因になっていた。
    // 1.02 に下げ、狭間の間隔も広げる(実測の可視率は _view.mjs で測る)。
    // 8cm の面取りで天端が幅 14% / 奥行 20% 縮む = 高さ 8cm の切頭ピラミッドが
    // 必ず乗り、狭間石が「笠を被ったコンクリート・ブロック」に見えていた。
    // 実物の狭間石は胸壁と同じ切石で、天端はほぼ平ら(水切りの数 cm だけ)。
    // そして **石は幅広く隙間は狭い**(石 1.3〜1.6m 対 隙間 0.6〜0.9m)。
    // だから城壁は「離れた石が並ぶ柵」ではなく「切り欠きの入った連続した壁」に読める。
    // ただし幅を 1.45m まで広げると、段のある胸壁で石が蹴上を跨ぎ、底の隅が
    // 最大 0.14m 浮く(seating が 0 → 27 件)。実測で幅と浮きは
    // 1.20→5 / 1.24→15 / 1.28→25 / 1.45→27。据わりを壊さない上限は 1.20m。
    // 石:隙間は 0.97:1 → 1.40:1 になる — 「柵」から「切り欠きのある壁」へ。
    const W = 1.20, H = 1.06, D = 0.72, CH = 0.035, SX = 0.955, SZ = 0.95;
    const hw = W / 2, hd = D / 2, tw = hw * SX, td = hd * SZ;
    const P2 = [], N2 = [], U2 = [], I2 = [];
    const face = (vs, nn, uv) => {
      const i0 = P2.length / 3;
      for (const v of vs) P2.push(...v);
      for (let k = 0; k < 4; k++) N2.push(...nn);
      U2.push(...uv);
      I2.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
    };
    // UV は壁と同じ実寸。0〜1(= 4.2m のテクスチャを 1.06m の面に全面貼り)に
    // していたので、石目が 4 倍に拡大され、しかもインスタンス毎の UV ずらし
    // (最大 0.85 タイル)で一つ一つが石の別の場所を映していた。
    // 結果、隣り合う狭間石が「灰色の板」と「生成りの石」に割れて見えていた。
    const y1 = H - CH;
    const uvW = [0, 0, W * um, 0, W * um, y1 * um, 0, y1 * um];
    const uvD = [0, 0, D * um, 0, D * um, y1 * um, 0, y1 * um];
    const uvCW = [0, 0, W * um, 0, W * um, CH * 2 * um, 0, CH * 2 * um];
    const uvCD = [0, 0, D * um, 0, D * um, CH * 2 * um, 0, CH * 2 * um];
    const uvTop = [0, 0, W * um, 0, W * um, D * um, 0, D * um];
    // 側面(下→肩)。石を 1.06m → 1.45m と幅広くしたので、段のある胸壁の上で
    // 底の隅が最大 0.14m 浮くようになった(seating が 25 件鳴った)。
    // 底を胸壁の中へ 0.26m 埋める — 実物の狭間石も胸壁に据え付けられている。
    const BY = 0.0;
    face([[-hw, BY, hd], [hw, BY, hd], [hw, y1, hd], [-hw, y1, hd]], [0, 0, 1], uvW);
    face([[hw, BY, -hd], [-hw, BY, -hd], [-hw, y1, -hd], [hw, y1, -hd]], [0, 0, -1], uvW);
    face([[hw, BY, hd], [hw, BY, -hd], [hw, y1, -hd], [hw, y1, hd]], [1, 0, 0], uvD);
    face([[-hw, BY, -hd], [-hw, BY, hd], [-hw, y1, hd], [-hw, y1, -hd]], [-1, 0, 0], uvD);
    // 笠石の面取り(肩→天端)。ここに乗る一本のハイライトが、
    // 「立てた板」と「石の塊」を分ける。
    const nc = 0.7071;
    face([[-hw, y1, hd], [hw, y1, hd], [tw, H, td], [-tw, H, td]], [0, nc, nc], uvCW);
    face([[hw, y1, -hd], [-hw, y1, -hd], [-tw, H, -td], [tw, H, -td]], [0, nc, -nc], uvCW);
    face([[hw, y1, hd], [hw, y1, -hd], [tw, H, -td], [tw, H, td]], [nc, nc, 0], uvCD);
    face([[-hw, y1, -hd], [-hw, y1, hd], [-tw, H, td], [-tw, H, -td]], [-nc, nc, 0], uvCD);
    // 天端と底
    face([[-tw, H, td], [tw, H, td], [tw, H, -td], [-tw, H, -td]], [0, 1, 0], uvTop);
    face([[-hw, BY, -hd], [hw, BY, -hd], [hw, BY, hd], [-hw, BY, hd]], [0, -1, 0], uvTop);
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute(P2, 3));
    g2.setAttribute('normal', new THREE.Float32BufferAttribute(N2, 3));
    g2.setAttribute('uv', new THREE.Float32BufferAttribute(U2, 2));
    g2.setIndex(I2);
    return g2;
  })();
  const merlonMat = new THREE.MeshStandardMaterial({
    map: tex.fortStone.map, normalMap: tex.fortStone.normalMap, roughness: 0.88,
    normalScale: new THREE.Vector2(1.7, 1.7), color: 0xc9c0ad,
    envMapIntensity: 0.55,
  });
  // 天空可視率が無いと、日陰のメルロンだけが胸壁と違う色で塗装金属に見える。
  bakeSkyVisInstanced(merlonGeo, merlons, skyAt, { offsetY: 1.0 });
  patchSkyVisInstanced(merlonMat);
  // 石目を個体ごとにずらす(全部同じ模様の行列は一目で複製とわかる)
  const merlonUv = new Float32Array(merlons.length * 2);
  // ずらしは頂点側で行う(vMapUv はフラグメントでは入力なので代入できない)
  merlonMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aUvOff;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvMapUv += aUvOff;\n\tvNormalMapUv += aUvOff;');
  };
  const merlonMesh = new THREE.InstancedMesh(merlonGeo, merlonMat, merlons.length);
  {
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    merlons.forEach((m, i) => {
      dummy.position.set(m.x, m.y, m.z);
      // YXZ: Z は局所軸まわり = 壁の横断軸まわりの傾き(斜路の追従)
      dummy.rotation.set(0, m.rotY, m.tilt ?? 0, 'YXZ');
      dummy.scale.set(m.sx ?? 1, m.sy ?? 1, m.sz ?? 1);
      dummy.updateMatrix();
      merlonMesh.setMatrixAt(i, dummy.matrix);
      col.setHSL(0.0, 0.0, 0.66 + hash2((m.x * 5) | 0, (m.z * 5) | 0) * 0.14, THREE.SRGBColorSpace);   // 色度は材質に一任
      merlonMesh.setColorAt(i, col);
      // 実寸 UV になったので、ずらしは「石を一つ二つ分」で足りる。
      // 0.9 タイル(= 3.8m)ずらすと、狭間石ごとに別の石材に見える。
      merlonUv[i * 2] = (m.uo ?? 0) * 0.28;
      merlonUv[i * 2 + 1] = (m.vo ?? 0) * 0.18;
    });
    merlonGeo.setAttribute('aUvOff', new THREE.InstancedBufferAttribute(merlonUv, 2));
  }
  merlonMesh.castShadow = true; merlonMesh.receiveShadow = true;
  // seatOn: 胸壁の上に載る石であることを宣言する。構造検査 seating が
  // 「本当に載っているか」を毎回測る。
  group.add(tagMesh(merlonMesh, 'wall.merlon', { solid: true, masonry: true, seatOn: 'wall.curtain' }));

  return { group, counts: { merlons: merlons.length } };
}

// 線分 a→b が円(cx,cz,r)の中にある区間 [t0,t1](0..1)。掛からなければ null。
function segInCircle(ax, az, bx, bz, cx, cz, r) {
  const dx = bx - ax, dz = bz - az;
  const fx = ax - cx, fz = az - cz;
  const A = dx * dx + dz * dz;
  if (A < 1e-9) return null;
  const B = 2 * (fx * dx + fz * dz);
  const C = fx * fx + fz * fz - r * r;
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return null;
  const s = Math.sqrt(disc);
  const t0 = Math.max(0, (-B - s) / (2 * A));
  const t1 = Math.min(1, (-B + s) / (2 * A));
  return t1 > t0 ? [t0, t1] : null;
}

function mergeExtrudes(geos) {
  let total = 0;
  const list = geos.map(g => g.toNonIndexed());
  for (const g of list) total += g.attributes.position.count;
  const P = new Float32Array(total * 3), N = new Float32Array(total * 3), U = new Float32Array(total * 2);
  let o = 0;
  for (const g of list) {
    P.set(g.attributes.position.array, o * 3);
    N.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) U.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  return out;
}
