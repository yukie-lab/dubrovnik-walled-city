// ============================================================================
// monuments.js — 街のしるべ。鐘楼(生きた時計)・オノフリオの大噴水・
// オルランドの柱・大聖堂と聖ヴラホのドーム・修道院の塔と回廊。
// 量塊(スポンザ・総督邸・教会の身廊)は家システムへ合成レコードとして
// 流し込み、屋根・窓・経年を自動で受け取る。
// ============================================================================
import * as THREE from 'three';
import { mulberry32, hash2, lerp, nearestOnPolyline, tagMesh } from './util.js';
import { rngFor } from './seed.js';
import { sharedSkyVis, specularEnvTargets } from './buildings.js';
import { makeSkyVis, patchSkyVis, bakeSkyVis } from './skyvis.js';

// 落水のアニメーション用(main.js が毎フレーム進める)
export const monumentTime = { value: 0 };

export function makeMonuments(plan, tex) {
  const group = new THREE.Group();
  const M = plan.MONUMENTS;
  const rng = rngFor(0x300a);

  // ---- 合成レコード(家システムに任せる量塊)
  const synth = (x, z, w, d, eaves, opts = {}) => {
    // 記念建築は広場の舗装に据わる。素地形から取ると 6 件が ±0.68m 浮く/沈む。
    // さらに、足元を「中心 1 点」だけで決めていた。28×8m の量塊が斜面に建つと、
    // 中心が地面に触れていても隅は 1.9m 浮く(実測: (-138,-18) で隙間 1.92m、
    // (-128,-8) で 1.09m。ストラドゥンの北側で家が宙に浮いて見える正体)。
    // plan.js の家生成器と同じ規則にする ―― 足元を外へ 0.6m まで格子で見て、
    // 最も低い所まで降ろす。地形「関数」ではなく描かれる面(surfaceAt)も見る。
    const groundAt = (sx, sz) => {
      for (const p2 of plan.PLAZAS)
        if (sx > p2.x0 - 2 && sx < p2.x1 + 2 && sz > p2.z0 - 2 && sz < p2.z1 + 2) return p2.y;
      return Math.min(plan.terrainHeight(sx, sz), plan.surfaceAt(sx, sz));
    };
    let base = Infinity;
    const nI = Math.max(2, Math.ceil(w / 3)), nJ = Math.max(2, Math.ceil(d / 3));
    for (let i = 0; i <= nI; i++) {
      for (let j = 0; j <= nJ; j++) {
        base = Math.min(base, groundAt(x + (i / nI - 0.5) * (w + 1.2), z + (j / nJ - 0.5) * (d + 1.2)));
      }
    }
    const yBase = base - 0.5;
    // 記念建築は plan.js の家生成器を通らないので、そこにある歩廊帯の判定
    // (WALK_CLEAR)が効かない。城壁の歩廊に石が上がってくると、そこが
    // 完全な行き止まりになる。棟まで歩廊面より下げる。
    let eavesAbs = yBase + eaves;
    {
      const ovX = w / 2 + 0.30, ovZ = d / 2 + 0.30;
      let dW = 1e9, wy = 0;
      for (const [ex, ez] of [[-ovX, -ovZ], [ovX, -ovZ], [-ovX, ovZ], [ovX, ovZ],
        [0, -ovZ], [0, ovZ], [-ovX, 0], [ovX, 0]]) {
        const q = nearestOnPolyline(plan.wallPts, x + ex, z + ez);
        if (q.d < dW) { dW = q.d; wy = q.y; }
      }
      if (dW < 4.2) eavesAbs = Math.min(eavesAbs, wy - 0.6 - (d / 2) * 0.36);
    }
    plan.houses.push({
      x, z, w, d, yBase,
      eaves: eavesAbs, floors: Math.max(2, Math.round(eaves / 3.2)),
      seed: rng(), ridgeAxis: 'x', roofH: (d / 2) * 0.36,
      stradunFront: false, band: 'main', side: Math.sign(z) || 1,
      monument: true, noChimney: true, ...opts,
    });
  };
  // 記念建築の足元は「広場の舗装」。素地形から取ると最大 1.3m ずれる。
  // synth() と同じ規則をここに出して、ドームや鐘塔もこれを使う。
  const plazaBase = (x, z) => {
    let base = plan.terrainHeight(x, z);
    for (const p2 of plan.PLAZAS) {
      if (x > p2.x0 - 2 && x < p2.x1 + 2 && z > p2.z0 - 2 && z < p2.z1 + 2) { base = p2.y; break; }
    }
    return base;
  };
  // 屋根面の高さ(棟から dz だけ外れた位置)。ドームのドラムはここを突き抜けて立つ。
  const roofTopAt = (m, dz) => {
    const h = plan.houses.find(q => Math.abs(q.x - m.x) < 0.6 && Math.abs(q.z - m.z) < 0.6);
    if (!h) return plazaBase(m.x, m.z) + 14;
    const half = Math.max(0.01, (h.ridgeAxis === 'z' ? h.w : h.d) / 2);
    const t = Math.min(1, Math.abs(dz) / half);
    return h.eaves + (h.roofH ?? 0) * (1 - t);
  };

  synth(M.sponza.x, M.sponza.z, M.sponza.w, M.sponza.d, 13.5);
  synth(M.stBlaise.x, M.stBlaise.z, M.stBlaise.w, M.stBlaise.d, 13, { frontN: [0, -1], steps: 0 });
  synth(M.rector.x, M.rector.z, M.rector.w, M.rector.d, 12.5);
  synth(M.cathedral.x, M.cathedral.z, M.cathedral.w, M.cathedral.d, 14, { frontN: [0, -1], steps: 0 });
  synth(M.jesuit.x, M.jesuit.z, M.jesuit.w, M.jesuit.d, 15, { frontN: [0, -1], steps: 0 });
  // 修道院の翼(回廊中庭を囲む)
  const cloister = (x0, x1, z0, z1) => {
    const cw = 8;
    synth((x0 + x1) / 2, z0 + cw / 2, x1 - x0, cw, 10);
    synth((x0 + x1) / 2, z1 - cw / 2, x1 - x0, cw, 10);
    synth(x0 + cw / 2, (z0 + z1) / 2, cw, z1 - z0 - cw * 2 - 1, 9.5);
    synth(x1 - cw / 2, (z0 + z1) / 2, cw, z1 - z0 - cw * 2 - 1, 9.5);
    return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0 - cw * 2, d: z1 - z0 - cw * 2 };
  };
  const franCourt = cloister(M.franciscan.x0, M.franciscan.x1, M.franciscan.z0, M.franciscan.z1);
  const domCourt = cloister(M.dominican.x0, M.dominican.x1, M.dominican.z0, M.dominican.z1);

  // ---- 石造(マージ)
  const P = [], N = [], U = [], C = [], I = [];
  const darkGeos = [];   // 鐘室などの暗い開口
  const leadGeos = [];   // 鉛葺き(ドーム・尖塔)
  const um = 1 / tex.wallStoneWarm.coverM;
  const tintC = new THREE.Color();
  // CylinderGeometry の u は周長全体で 0→1。そのまま appendGeo に渡すと、
  // 周長 31.7m の水盤で石が横 16m・縦 0.26m に伸びる(異方比 61:1)。実寸へ直す。
  // (appendGeo が UV を 2 倍するので、あらかじめ 1/2 して打ち消す)
  function cylUV(g, r, h) {
    const cm = tex.wallStoneWarm.coverM ?? 3.2;
    const CU = 2 * Math.PI * r / cm / 2, CV = h / cm / 2;
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * CU, uv.getY(i) * CV);
    return g;
  }
  // ラグーサ共和国は市内 30 箇所以上の門・稜堡・立面に守護聖人像を置いた。
  // これが街の署名で、歩いていて「同じ聖人が何度も見ている」体験は、
  // 他のどの追加よりも強く「ここはドゥブロヴニクだ」と名指しする。
  // 既存のマージ済み石メッシュに積むので draw call は 1 本も増えない。
  function statue(x, y, z, fz, sc = 1, attr = 'crozier') {
    const r = hash2((x * 7) | 0, (z * 7) | 0);
    const ry = fz < 0 ? 0 : Math.PI;
    box(x, y, z, 0.62 * sc, 0.22 * sc, 0.62 * sc, 1.04);                       // 台座
    box(x - 0.10 * sc, y + 0.22 * sc, z, 0.17 * sc, 0.78 * sc, 0.19 * sc, 0.97);
    box(x + 0.10 * sc, y + 0.22 * sc, z, 0.17 * sc, 0.78 * sc, 0.19 * sc, 0.97);
    box(x, y + 0.96 * sc, z, 0.46 * sc, 0.70 * sc, 0.27 * sc, 1.00, (r - 0.5) * 0.5 + ry);
    box(x, y + 1.62 * sc, z, 0.56 * sc, 0.15 * sc, 0.29 * sc, 1.02, (r - 0.5) * 0.5 + ry);
    box(x, y + 1.77 * sc, z, 0.20 * sc, 0.25 * sc, 0.21 * sc, 1.06);
    if (attr === 'city') {
      // 街の模型 — 聖ヴラホの持物。街のどこから見ても彼だと分かる唯一の印。
      box(x - 0.26 * sc, y + 1.14 * sc, z + fz * 0.17 * sc, 0.42 * sc, 0.30 * sc, 0.34 * sc, 1.08);
      box(x - 0.26 * sc, y + 1.44 * sc, z + fz * 0.17 * sc, 0.09 * sc, 0.22 * sc, 0.09 * sc, 1.10);
    } else if (attr === 'crozier') {
      box(x + 0.31 * sc, y + 0.16 * sc, z + fz * 0.05 * sc, 0.07 * sc, 1.78 * sc, 0.07 * sc, 1.03);
    } else {
      box(x, y + 1.68 * sc, z, 0.30 * sc, 0.09 * sc, 0.30 * sc, 1.09);
    }
  }

  // 壁龕(袖・貝殻のコンチ・庇)+ 聖人像。
  // xf: 開口の向き(-1 = -x を向く / +1 = +x を向く)。xFace は壁の外面の x。
  // 奥へ dep だけ掘り、袖は 0.10 しか出さない(出しすぎると「壁に貼った額縁」になる)。
  function nicheX(xFace, y, z, xf, w = 1.10, h = 2.05, dep = 0.45) {
    // ルネサンスの壁龕は壁体に彫り込む。袖を 0.10 出し、さらに dep+0.26 の
    // 庇を張り出すと、合計 0.56m が空中に残って「壁に立てかけた写真立て」になる。
    const JUT = 0.05;
    const inX = xFace + xf * -1 * dep;          // 奥の面
    const outX = xFace + xf * JUT;              // 袖の先端
    const jw = 0.20;
    // 袖(左右)— 外面から 0.10 出て、奥まで届く
    for (const sgn of [-1, 1]) {
      box(xFace + xf * (JUT - dep) / 2, y, z + sgn * (w / 2 + jw / 2),
        dep + JUT, h + 0.34, jw, 1.05);
    }
    // 奥の暗がり
    const back = new THREE.PlaneGeometry(w, h);
    back.rotateY(xf < 0 ? -Math.PI / 2 : Math.PI / 2);
    back.translate(inX, y + h / 2, z);
    darkGeos.push(back);
    // 底(沓摺)
    box(xFace + xf * (JUT - dep) / 2, y - 0.14, z, dep + JUT, 0.14, w + jw * 2, 1.02);
    // 貝殻のコンチ(半球を横に倒す)
    const conch = new THREE.SphereGeometry(w / 2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    conch.scale(1, 0.66, 1);
    conch.rotateX(xf < 0 ? -Math.PI / 2 : Math.PI / 2);
    conch.rotateY(xf < 0 ? Math.PI / 2 : -Math.PI / 2);
    conch.translate(inX, y + h, z);
    appendGeo(conch, 0.74, true);
    // 笠石(庇ではなく、影の線を作るだけの薄い蛇腹)
    box(xFace + xf * (0.09 - dep) / 2, y + h + 0.05, z, dep + 0.09, 0.16, w + jw * 2 + 0.12, 1.09);
    // 聖人像(全高 1.40m。壁龕の奥に立ち、手前へは出ない)
    statue(inX + xf * dep * 0.40, y, z, xf < 0 ? -1 : 1, 0.64, 'city');
  }

  function box(x, y, z, w, h, d, tint = 1, rotY = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    // BoxGeometry の UV は面ごとに 0..1 正規化。そのまま ×2 で流すと石の目が
    // 部材の大きさと無関係になり、0.13m の稜に石が 49 個並ぶ。実寸へ直す。
    {
      const cm = tex.wallStoneWarm.coverM ?? 3.2, uv = g.attributes.uv;
      const F = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];   // +x -x +y -y +z -z
      for (let fi = 0; fi < 6; fi++) {
        for (let k = 0; k < 4; k++) {
          const i = fi * 4 + k;
          uv.setXY(i, uv.getX(i) * F[fi][0] / cm / 2, uv.getY(i) * F[fi][1] / cm / 2);
        }
      }
    }
    if (rotY) g.rotateY(rotY);
    g.translate(x, y + h / 2, z);
    appendGeo(g, tint);
  }
  function appendGeo(g, tint = 1, flat = false) {
    const gg = g.index ? g.toNonIndexed() : g;
    if (flat) gg.computeVertexNormals();
    const pos = gg.attributes.position, nor = gg.attributes.normal, uv = gg.attributes.uv;
    const i0 = P.length / 3;
    for (let i = 0; i < pos.count; i++) {
      P.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      N.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      U.push(uv ? uv.getX(i) * 2 : 0, uv ? uv.getY(i) * 2 : 0);
      const tt = Math.min(tint, 1);
      C.push(tt, tt, tt * 0.99);
    }
    for (let i = 0; i < pos.count; i++) I.push(i0 + i);
  }

  // ==== 記念建築のオーダー ============================================
  // 教会が民家と同じ「箱に窓」で終わっていると、街に主題が生まれない。
  // 柱廊・エンタブレチュア・欄干・記念階段は全部この 1 つのマージ済み石
  // メッシュに積むので、ドローコールは 1 本も増えない。
  //
  // portico(m, o): m = MONUMENTS の記録、o = { face, nCol, colH, colR,
  //   terrace, steps, spanHalf, balustrade }
  //   face = 正面の法線([0,-1] なら -z 側が正面)
  function portico(cx, cz, faceN, plazaY, o) {
    const [fnx, fnz] = faceN;
    const along = fnz !== 0;                                  // 正面の長手が x 方向か
    // 面座標(u = 面に沿う / v = 面から手前へ)→ ワールド
    const W = (u, v) => (along ? [cx + u, cz + fnz * v] : [cx + fnx * v, cz + u]);
    const nCol = o.nCol ?? 4, colR = o.colR ?? 0.44, colH = o.colH ?? 8.5;
    const half = o.spanHalf ?? 5.6, terr = o.terrace ?? 1.35, riseN = o.steps ?? 3;
    const rise = 0.16, tread = o.tread ?? 0.30;
    const yT = plazaY + riseN * rise;                         // テラスの天端

    // テラスの版と、その小口
    {
      const a = W(-half - 0.5, 0.02), b = W(half + 0.5, 0.02);
      const c = W(half + 0.5, terr), d = W(-half - 0.5, terr);
      const g = new THREE.BufferGeometry();
      const pv = [a[0], yT, a[1], b[0], yT, b[1], c[0], yT, c[1], d[0], yT, d[1]];
      g.setAttribute('position', new THREE.Float32BufferAttribute(pv, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      g.setIndex(fnz > 0 || fnx > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
      appendGeo(g, 1.02);
      const m2 = W(0, terr);
      box(m2[0], plazaY - 0.1, m2[1], along ? (half + 0.5) * 2 : 0.30, yT - plazaY + 0.1,
        along ? 0.30 : (half + 0.5) * 2, 0.94);
    }
    // 記念階段(テラスの手前へ降りる)
    for (let k = 0; k < riseN; k++) {
      const v0 = terr + k * tread, v1 = v0 + tread;
      const y = yT - (k + 1) * rise;
      const m2 = W(0, (v0 + v1) / 2);
      box(m2[0], y, m2[1], along ? half * 2 : tread, rise + 0.02, along ? tread : half * 2, 1.03);
    }
    // 柱(柱礎 + 柱身 + 3 段の柱頭)。
    // 柱頭の天端をエンタブレチュアの下端と同じ高さに置くと、柱頭は視覚的に存在しない。
    // 必ず影の線を 1 本残す。
    for (let k = 0; k < nCol; k++) {
      const u = nCol === 1 ? 0 : (k / (nCol - 1) - 0.5) * half * 1.72;
      const p2 = W(u, terr * 0.52);
      // 柱礎: プリンス(方形)+ トールス(丸)
      box(p2[0], yT, p2[1], colR * 2.5, 0.18, colR * 2.5, 1.05);
      const tor = new THREE.CylinderGeometry(colR * 1.12, colR * 1.30, 0.16, 16);
      tor.translate(p2[0], yT + 0.26, p2[1]);
      appendGeo(tor, 1.03);
      // 柱身。石材テクスチャの目地は横に走るので、UV を入れ替えて縦目にする。
      // そのままだと切石が柱身を輪切りにし、煙突の積みブロックに見える。
      const sh = new THREE.CylinderGeometry(colR * 0.86, colR, colH, 20);
      {
        const cm = tex.wallStoneWarm.coverM ?? 3.2, uv = sh.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * colH / cm / 2, uv.getX(i) * 0.5);
      }
      sh.translate(p2[0], yT + 0.34 + colH / 2, p2[1]);
      appendGeo(sh, 1.0);
      // 柱頭: 頸 → 鐘 → 冠板
      const yc = yT + 0.34 + colH;
      const ast = new THREE.CylinderGeometry(colR * 1.06, colR * 1.06, 0.09, 16);
      ast.translate(p2[0], yc + 0.045, p2[1]);
      appendGeo(ast, 1.04);
      box(p2[0], yc + 0.09, p2[1], colR * 2.10, 0.26, colR * 2.10, 1.07);   // 鐘
      box(p2[0], yc + 0.35, p2[1], colR * 2.72, 0.17, colR * 2.72, 1.10);   // 冠板
    }
    // エンタブレチュア。冠板の天端(yT + 0.86 + colH)から 0.10 浮かせる。
    const yE = yT + 0.96 + colH;
    // 柱高 10.8m に対して 1.10m(1/10)では、柱が屋根を支える構造に見えず
    // 「壁に立てかけた煙突」になる。古典のエンタブレチュアは柱高の 1/4〜1/5。
    for (const [dy, hh, ex] of [[0, 0.62, 0.10], [0.62, 0.86, 0.26], [1.48, 0.76, 0.62]]) {
      const m2 = W(0, terr * 0.52);
      box(m2[0], yE + dy, m2[1], along ? (half * 1.72 + colR * 4 + ex * 2) : (colR * 2.6 + ex * 2),
        hh, along ? (colR * 2.6 + ex * 2) : (half * 1.72 + colR * 4 + ex * 2), 1.04 + dy * 0.03);
    }
    // 欄干(テラスの縁)
    if (o.balustrade !== false) {
      const n2 = Math.max(6, Math.round(half * 2 / 0.42));
      for (let k = 0; k <= n2; k++) {
        const u = (k / n2 - 0.5) * (half * 2 + 0.9);
        const p2 = W(u, terr - 0.16);
        const b2 = new THREE.CylinderGeometry(0.075, 0.09, 0.72, 6);
        b2.translate(p2[0], yT + 0.36, p2[1]);
        appendGeo(b2, 1.03);
      }
      const m2 = W(0, terr - 0.16);
      box(m2[0], yT + 0.72, m2[1], along ? half * 2 + 1.0 : 0.30, 0.14, along ? 0.30 : half * 2 + 1.0, 1.07);
      box(m2[0], yT + 0.02, m2[1], along ? half * 2 + 1.0 : 0.26, 0.18, along ? 0.26 : half * 2 + 1.0, 1.02);
    }
    // テラスと階段は「登れる段」ではなく塊として扱う(歩行判定は plan 側にしか
    // ないので、床として登録しないと足がテラスの下に潜って頭が石に入る)。
    {
      const c0 = W(-half - 0.6, -0.1), c1 = W(half + 0.6, terr + riseN * tread + 0.1);
      plan.extraColliders.push({
        x0: Math.min(c0[0], c1[0]), x1: Math.max(c0[0], c1[0]),
        z0: Math.min(c0[1], c1[1]), z1: Math.max(c0[1], c1[1]),
        y0: plazaY - 0.5, y1: yT + 0.9,
      });
    }
    return yE + 2.24;
  }

  // 柱廊を立てる。正面の面の位置(cz)は「壁面 - わずか」に置く。
  {
    // 聖ヴラホ(1715, Gropelli): 幅 14m、正面に 4 本の柱、テラスと欄干
    // 柱高は本体の軒から逆算する。先に柱高を決めると、ペディメントが軒の下に
    // 埋まって 1 枚も見えなくなる(前ラウンドの実害)。
    // pedimentTop = plazaY + steps*0.16 + 1.80 + colH === yBase + eaves
    const colHFor = (eavesP, steps) => eavesP - 3.70 - steps * 0.16;   // (yE-yT)=0.96 + 2.24 + 0.5
    const pt1 = portico(M.stBlaise.x, M.stBlaise.z - M.stBlaise.d / 2 - 0.02, [0, -1], 2.6,
      { nCol: 4, colR: 0.50, colH: colHFor(13, 3), spanHalf: 5.2, terrace: 2.90, steps: 3, tread: 0.30 });
    const hB = plan.houses.find(h => h.monument && h.x === M.stBlaise.x && h.z === M.stBlaise.z);
    if (hB) { hB.pedimentTop = pt1; hB.pedHalf = 5.2 * 0.86 + 0.50 * 2 + 0.46; }
    // 大聖堂(1713): 幅 18m、6 本の付柱に近い間隔で 4 本 + 深いテラス
    // 聖ヴラホ・大聖堂・イエズス会が同じ portico を 3 回呼ぶだけで、柱間・柱径・
    // 柱頭の 3 段構成まで一致していた(全パラメータが ±12% 以内)。この 3 つは
    // 「同じ格の別の建物」ではなく **別の設計言語**。せめて柱数と間口を分ける。
    // 大聖堂(1713)は 6 本柱・三つの入口・八角ドラムの大ドーム。
    const pt2 = portico(M.cathedral.x, M.cathedral.z - M.cathedral.d / 2 - 0.02, [0, -1], 3.1,
      { nCol: 6, colR: 0.56, colH: colHFor(14, 4), spanHalf: 7.4, terrace: 3.10, steps: 4, tread: 0.32 });
    const hC = plan.houses.find(h => h.monument && h.x === M.cathedral.x && h.z === M.cathedral.z);
    if (hC) { hC.pedimentTop = pt2; hC.pedHalf = 7.4 * 0.86 + 0.56 * 2 + 0.46; }
    // イエズス会(階段の上に立つ): テラスは階段の踊り場と兼ねる
    // イエズス会(聖イグナチオ)は **自立柱を持たない** — 巨大付柱と渦巻きで、
    // 正面の柱間が広い。柱を 2 本に減らし、間口を広げて別の言語にする。
    const pt3 = portico(M.jesuit.x, M.jesuit.z - M.jesuit.d / 2 - 0.02, [0, -1], 8.4,
      { nCol: 2, colR: 0.62, colH: colHFor(15, 3), spanHalf: 6.2, terrace: 3.30, steps: 3, tread: 0.32 });
    const hJ = plan.houses.find(h => h.monument && h.x === M.jesuit.x && h.z === M.jesuit.z);
    if (hJ) { hJ.pedimentTop = pt3; hJ.pedHalf = 6.2 * 0.86 + 0.62 * 2 + 0.46; }

    // ---- 彫刻スカイライン。ドゥブロヴニクのバロック聖堂は、空に対して必ず人体で終わる。
    // 城壁から街を見たとき、記念建築の帯と民家の帯を分けているのはこの輪郭。
    // 既存のマージ済み石メッシュに積むので draw call は 1 本も増えない(1 体 ≒ 46 三角形)。
    {
      const zB = M.stBlaise.z - M.stBlaise.d / 2 - 0.30;
      // 切妻の頂に聖ヴラホ、両脇のアクロテリアに随伴聖人
      statue(M.stBlaise.x, pt1 + 5.2 * 0.86 * 0.44 + 0.06, zB, -1, 1.15, 'city');
      for (const u of [-1, 1]) statue(M.stBlaise.x + u * 5.55, pt1 + 0.06, zB, -1, 0.92, u < 0 ? 'crozier' : 'book');
      // 大聖堂の欄干像(正面に 4 体)
      const zC = M.cathedral.z - M.cathedral.d / 2 - 0.34;
      for (let k = 0; k < 4; k++) {
        statue(M.cathedral.x + (k - 1.5) * 3.6, pt2 + 0.06, zC, -1, 0.95, k % 2 ? 'crozier' : 'book');
      }
      // イエズス会は両脇のアクロテリアだけ(正面は階段が主役)
      const zJ = M.jesuit.z - M.jesuit.d / 2 - 0.30;
      for (const u of [-1, 1]) statue(M.jesuit.x + u * 5.9, pt3 + 0.06, zJ, -1, 0.98, 'crozier');
      // 門の壁龕。ドゥブロヴニクで最初に撮られるのはピレ門のアーチ直上の聖ヴラホ。
      // 現状は無地の平板パネルだった。
      for (const g of plan.GATES) {
        const top = g.y + g.h + 0.75;
        // 門アーチの外面の実測値(mergeExtrudes 側)に合わせる。壁厚から計算すると
        // 0.4m ほど内側になり、壁龕が石の中に埋まる。
        // 壁体の外面は実測で門ノードから 2.62m(アーチの迫石はさらに 0.8m 手前へ出る)。
        // 壁厚の半分で置くと壁龕が 0.8m 宙に浮く。
        // 壁体の外面は場所で数十cm 揺れる。袖を深くして必ず石に食い込ませる。
        // 壁体の外面は実測で門ノードから 3.05m(アーチの迫石はさらに 0.35m 手前)。
        // 門ブロックの外面は buildGateArch の押し出しで決まる:
        //   中心線から (壁のノード半幅 + 0.20)。実測値を書き写すのはやめる。
        const nwG = nearestOnPolyline(plan.wallPts, g.x, g.z);
        const hiG = Math.max(0, Math.min(nwG.i ?? 0, plan.wallNodeHalf.length - 1));
        const faceD = plan.wallNodeHalf[hiG] + 0.20;
        // ピレ門の外面は、ドゥブロヴニクで最初に撮られる一枚。幅 1.10 × 高 2.05 は
        // 15m の壁面に対して小さすぎ、橋の上(約 55m 手前)からは数ピクセルしか
        // 無かった。アエディクラ(小柱で挟んだ壁龕)に格上げする。
        if (g.id === 'pile') {
          nicheX(nwG.x - faceD, top, g.z, -1, 1.55, 2.75, 0.55);
          // 壁龕は壁体を **彫り込んでいない**(奥の暗がりの板を置いているだけ)。
          // 門ブロックの外面がその上に描かれるので、実際には一度も見えていなかった。
          // 壁を彫る代わりに、壁面から 0.10 出した暗い背板 + その前に立つ像に
          // する — ルネサンスの付柱式アエディクラとして正しい形。
          box(nwG.x - faceD - 0.05, top + 2.75 / 2, g.z, 0.10, 2.75, 1.55, 0.34);
          statue(nwG.x - faceD - 0.30, top + 0.34, g.z, -1, 0.98, 'city');
          // 壁龕を挟む小柱と、その上の破風
          for (const sgn of [-1, 1]) {
            const cz = g.z + sgn * (1.55 / 2 + 0.20 + 0.22);
            const col = new THREE.CylinderGeometry(0.20, 0.22, 2.90, 10);
            col.translate(nwG.x - faceD - 0.16, top + 1.45, cz);
            appendGeo(col, 1.02);
            box(nwG.x - faceD - 0.16, top - 0.10, cz, 0.62, 0.20, 0.62, 1.06);   // 柱礎
            box(nwG.x - faceD - 0.16, top + 2.90, cz, 0.58, 0.18, 0.58, 1.08);   // 柱頭
          }
          // 跳ね橋の鎖と、鎖が上がる溝。ピレ門は外門 + 跳ね橋 + 内門の三段構えで、
          // 「壁に開いた穴」ではない。溝と鎖があるだけで、門が機械に見える。
          for (const sgn of [-1, 1]) {
            const cz = g.z + sgn * 2.05;
            // 溝(壁面に彫った 0.12m の凹み)— 影の縦線が門を機械にする
            box(nwG.x - faceD + 0.06, g.y + g.h * 0.5 + 0.9, cz, 0.12, g.h + 1.8, 0.30, 0.58);
            // 鎖(8 分割のテーパー箱)。実物は環だが、遠景では「太さの変わる線」で読む
            const y0c = g.y + g.h + 0.55, y1c = g.y + 0.35;
            for (let k = 0; k < 8; k++) {
              const t2 = k / 8, t3 = (k + 1) / 8;
              const yy = lerp(y0c, y1c, (t2 + t3) / 2);
              const wgt = 0.075 - 0.018 * t2;
              box(nwG.x - faceD - 0.05, yy, cz, wgt, (y0c - y1c) / 8 + 0.01, wgt, 0.42);
            }
          }
          // 破風(三角) — 二枚の傾いた板ではなく、厚みのある切妻
          {
            const pw = 1.55 + 0.40 + 0.44 + 0.30;
            box(nwG.x - faceD - 0.16, top + 3.08, g.z, 0.34, 0.22, pw, 1.10);
            for (let k = 0; k < 9; k++) {
              const t2 = k / 9, t3 = (k + 1) / 9;
              const w0 = pw * (1 - t2), w1 = pw * (1 - t3);
              box(nwG.x - faceD - 0.16, top + 3.30 + t2 * 0.72, g.z,
                0.34, 0.72 / 9 + 0.012, (w0 + w1) / 2, 1.04);
            }
          }
        }
        else if (g.id === 'ponte') nicheX(nwG.x + faceD, top, g.z, 1, 0.98, 1.82, 0.42);
        else if (g.id === 'ploce') nicheX(nwG.x + faceD, top, g.z + 0.6, 1, 0.98, 1.82, 0.42);
      }
    }
  }

  // ==== ヴェネツィア・ゴシックの四連窓(クァドリフォラ)
  // スポンザを他の建物から分ける唯一のしるし。半円ではなく尖頭アーチ。
  function quadrifora(cx, cz, faceN, y, nSets, spanHalf) {
    const [fnx, fnz] = faceN;
    const along = fnz !== 0;
    const W = (u, v) => (along ? [cx + u, cz + fnz * v] : [cx + fnx * v, cz + u]);
    const LW = 0.62, MW = 0.16, H = 2.35, SET = LW * 4 + MW * 3;
    for (let sIdx = 0; sIdx < nSets; sIdx++) {
      const u0 = nSets === 1 ? 0 : (sIdx / (nSets - 1) - 0.5) * spanHalf * 2;
      // 窓台
      const t0 = W(u0, 0.16);
      box(t0[0], y - 0.16, t0[1], along ? SET + 0.5 : 0.30, 0.16, along ? 0.30 : SET + 0.5, 1.06);
      for (let k = 0; k <= 4; k++) {
        // 方立(4 灯なので 5 本)
        const um = u0 + (k - 2) * (LW + MW);
        const m2 = W(um, 0.10);
        box(m2[0], y, m2[1], along ? MW : 0.22, H, along ? 0.22 : MW, 1.03);
      }
      for (let k = 0; k < 4; k++) {
        const uc = u0 + (k - 1.5) * (LW + MW);
        // 尖頭アーチ: 開口幅 LW を半径とする 2 本の弧。左半分は中心 (+LW/2, 0)、
        // θ = π → 2π/3。頂点は (0, 0.866·LW)。等辺アーチ。
        const NA = 7;
        for (const side of [-1, 1]) {
          const ccx = -side * LW / 2;   // 左半分の弧の中心は「右」の迫元
          const th0 = side < 0 ? Math.PI : 0, th1 = side < 0 ? Math.PI * 2 / 3 : Math.PI / 3;
          for (let q = 0; q < NA; q++) {
            const a0 = th0 + (th1 - th0) * (q / NA), a1 = th0 + (th1 - th0) * ((q + 1) / NA);
            const px0 = ccx + Math.cos(a0) * LW, py0 = Math.sin(a0) * LW;
            const px1 = ccx + Math.cos(a1) * LW, py1 = Math.sin(a1) * LW;
            const mid = W(uc + (px0 + px1) / 2, 0.10);
            const seg = Math.hypot(px1 - px0, py1 - py0);
            const g = new THREE.BoxGeometry(along ? seg + 0.06 : 0.22, 0.16, along ? 0.22 : seg + 0.06);
            g.rotateZ(along ? Math.atan2(py1 - py0, px1 - px0) : 0);
            g.rotateX(along ? 0 : Math.atan2(py1 - py0, px1 - px0));
            g.translate(mid[0], y + H + (py0 + py1) / 2, mid[1]);
            appendGeo(g, 1.05);
          }
        }
        // 開口の暗がり
        const dk = new THREE.PlaneGeometry(LW - 0.03, H + LW * 0.5);
        dk.rotateY(Math.atan2(fnx, fnz));
        const dp = W(uc, 0.02);
        dk.translate(dp[0], y + (H + LW * 0.5) / 2, dp[1]);
        darkGeos.push(dk);
      }
    }
  }
  {
    const sp = M.sponza;
    const yB = plazaBase(sp.x, sp.z) - 0.5;
    quadrifora(sp.x, sp.z + sp.d / 2 + 0.06, [0, 1], yB + 7.6, 3, 5.6);
  }

  // ==== 鐘楼(時計塔)— 街のどこからでも読む「しるべ」
  {
    const t = M.bellTower;
    const y0 = plazaBase(t.x, t.z) - 0.5;
    box(t.x, y0, t.z, t.w, t.h, t.d, 1.02);
    // 胴の水平の蛇腹 3 本。24m を無地で立てると塔ではなく給水塔に見える。
    for (const hy of [8.4, 15.6, 22.4]) {
      box(t.x, y0 + hy, t.z, t.w + 0.28, 0.30, t.d + 0.28, 1.06);
      box(t.x, y0 + hy + 0.30, t.z, t.w + 0.16, 0.12, t.d + 0.16, 1.04);
    }
    // 隅の細い付柱(4隅)— 塔の細長さを強調する
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      box(t.x + sx * (t.w / 2 - 0.16), y0 + 0.4, t.z + sz * (t.d / 2 - 0.16), 0.42, t.h - 0.8, 0.42, 1.05);
    }
    // 鐘室(上部の開口を持つ帯)
    box(t.x, y0 + t.h, t.z, t.w + 0.7, 3.4, t.d + 0.7, 1.05);
    box(t.x, y0 + t.h + 3.4, t.z, t.w + 1.05, 0.34, t.d + 1.05, 1.08);   // 鐘室の蛇腹
    // 八角の灯篭 + 玉
    const oct = new THREE.CylinderGeometry(1.65, 1.8, 2.4, 8);
    oct.translate(t.x, y0 + t.h + 3.74 + 1.2, t.z);
    appendGeo(oct, 1.04);
    const ball = new THREE.SphereGeometry(0.35, 10, 8);
    ball.translate(t.x, y0 + t.h + 3.74 + 2.4 + 0.35, t.z);
    appendGeo(ball, 1.08);
    plan.extraColliders.push({ x0: t.x - t.w / 2, z0: t.z - t.d / 2, x1: t.x + t.w / 2, z1: t.z + t.d / 2, y0, y1: y0 + t.h });
    // 鐘室の暗いアーチ開口(4面)
    for (const [ox, oz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const ry = Math.atan2(ox, oz);
      const niche = new THREE.PlaneGeometry(1.9, 2.2);
      niche.translate(0, -1.2 + 1.2, 0);
      const archTop = new THREE.CircleGeometry(0.95, 12, 0, Math.PI);
      archTop.translate(0, 1.1, 0);
      for (const g of [niche, archTop]) {
        g.rotateY(ry);
        g.translate(t.x + ox * (t.w / 2 + 0.37), y0 + t.h + 1.45, t.z + oz * (t.d / 2 + 0.37));
        darkGeos.push(g);
      }
    }
  }

  // ==== オノフリオの大噴水(16面のロタンダ + ドーム)
  {
    const f = M.onofrio;
    const y0 = plazaBase(f.x, f.z) - 0.3;
    // 16 の平面(円筒に石材テクスチャを巻くと、緯線に伸びた縞の卵になる)
    const NF = 16;
    // 板を 16 枚並べる方式は、隣接の重なりが向き次第で切れて穴が開く。
    // 閉じた 16 角の筒を 1 つ作り、彫り(マスカロン・吐水口)は外側に足す。
    {
      const drum = cylUV(new THREE.CylinderGeometry(f.r + 0.17, f.r + 0.17, 3.78, NF, 1, false), f.r + 0.17, 3.78);
      drum.translate(f.x, y0 + 1.89, f.z);
      appendGeo(drum, 1.02, true);   // 16 面の稜が実物の要。ここだけフラット
    }
    // 16 の稜(面の境の細い付柱)。これが無いと 16 角が「滑らかな円筒」に見える。
    for (let k = 0; k < NF; k++) {
      const a = ((k + 0.5) / NF) * Math.PI * 2;
      const rib = new THREE.BoxGeometry(0.13, 3.62, 0.15);
      rib.rotateY(Math.PI / 2 - a);
      rib.translate(f.x + Math.cos(a) * (f.r + 0.235), y0 + 1.87, f.z + Math.sin(a) * (f.r + 0.235));
      appendGeo(rib, 1.10);
    }
    for (let k = 0; k < NF; k++) {
      const a = (k / NF) * Math.PI * 2;
      // 各面のマスカロン(水を吐く彫刻面)。彫りは「窪み + 濃い影」で読ませる。
      const frame = new THREE.BoxGeometry(0.46, 0.58, 0.10);
      frame.rotateY(Math.PI / 2 - a);
      frame.translate(f.x + Math.cos(a) * (f.r + 0.185), y0 + 1.94, f.z + Math.sin(a) * (f.r + 0.185));
      appendGeo(frame, 0.66);
      const m = new THREE.SphereGeometry(0.155, 8, 6);
      m.scale(1, 1.20, 0.55);
      m.translate(f.x + Math.cos(a) * (f.r + 0.22), y0 + 1.92, f.z + Math.sin(a) * (f.r + 0.22));
      appendGeo(m, 0.72);
      const sp = new THREE.CylinderGeometry(0.045, 0.045, 0.22, 6);
      sp.rotateZ(Math.PI / 2); sp.rotateY(-a);
      sp.translate(f.x + Math.cos(a) * (f.r + 0.30), y0 + 1.88, f.z + Math.sin(a) * (f.r + 0.30));
      appendGeo(sp, 0.94);
    }
    // 水盤と落水。噴水は水が出て初めて噴水で、ここは街で唯一の「動く白」。
    {
      const basinR0 = f.r + 0.34, basinR1 = f.r + 1.15;
      // 水盤の外周壁(座れる高さ 0.52m)
      const rim = cylUV(new THREE.CylinderGeometry(basinR1, basinR1, 0.40, NF * 2, 1, true), basinR1, 0.40);
      rim.translate(f.x, y0 + 0.20, f.z);
      appendGeo(rim, 1.0);
      const cap = cylUV(new THREE.CylinderGeometry(basinR1 + 0.07, basinR1 + 0.07, 0.10, NF * 2), basinR1, 0.10);
      cap.translate(f.x, y0 + 0.45, f.z);
      appendGeo(cap, 1.08);
      const inner = cylUV(new THREE.CylinderGeometry(basinR0, basinR0, 0.60, NF * 2, 1, true), basinR0, 0.60);
      inner.scale(-1, 1, 1);
      inner.translate(f.x, y0 + 0.22, f.z);
      appendGeo(inner, 0.80);
      // 水面(1 mesh)。石灰岩の白の中で唯一の暗い鏡。
      const wg = new THREE.RingGeometry(basinR0, basinR1, NF * 3);
      wg.rotateX(-Math.PI / 2);
      wg.translate(f.x, y0 + 0.30, f.z);
      // roughness 0.045 は屋外の浅い水盤としては鏡すぎ、晴天では必ず空を返して
      // 白飛びする。噴水に水が無いように見えていた原因。
      const wmat = new THREE.MeshStandardMaterial({
        color: 0x1d3a40, roughness: 0.13, metalness: 0.0, envMapIntensity: 0.60,
      });
      specularEnvTargets.push(wmat);
      const wm = new THREE.Mesh(wg, wmat);
      wm.receiveShadow = true;
      group.add(tagMesh(wm, 'monument.fountainWater', { thin: true, reason: '水面', noCollide: true }));
      // 落水 16 条(1 InstancedMesh)
      // 直円柱は放物線を描かないので、水盤の縁を横切って空中で切れて終わる。
      // マスカロンから出た水は外向きの放物線で飛び、盤の中ほどに落ちる。
      const FALL = 1.58, V0 = 0.85, GACC = 9.8;
      const TFALL = Math.sqrt(2 * FALL / GACC);
      const jetGeo = (() => {
        // 帯 1 枚だと真横から見たとき紙になる。直交する 2 枚を十字に組む。
        const N = 10, P = [], NR = [], U = [], I = [];
        for (const cross of [0, 1]) {
          const base = P.length / 3;
          for (let k = 0; k <= N; k++) {
            const t = (k / N) * TFALL;
            const x = V0 * t, y = -0.5 * GACC * t * t;
            // 落ちるほど細く速くなる(連続の式)
            const w = (0.048 - 0.016 * (k / N)) / 2;
            // 進行方向(接線)。断面は接線に直交させる。
            const vx = V0, vy = -GACC * t;
            const vl = Math.hypot(vx, vy) || 1;
            const px = -vy / vl, py = vx / vl;      // 面内の法線
            if (cross === 0) { P.push(x, y, -w, x, y, w); NR.push(0, 0, 1, 0, 0, 1); }
            else { P.push(x - px * w, y - py * w, 0, x + px * w, y + py * w, 0);
              NR.push(0, 0, 1, 0, 0, 1); }
            U.push(0, k / N, 1, k / N);
          }
          for (let k = 0; k < N; k++) {
            const q = base + k * 2;
            I.push(q, q + 1, q + 3, q, q + 3, q + 2);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(NR, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
        g.setIndex(I);
        return g;
      })();
      const jetMat = new THREE.MeshStandardMaterial({
        color: 0xdfeef2, roughness: 0.12, transparent: true, opacity: 0.44,
        envMapIntensity: 1.4, depthWrite: false, side: THREE.DoubleSide,
      });
      // 静止した円柱は水に見えない。落ちる縞を流して、下ほど細く散らす。
      jetMat.onBeforeCompile = (sh) => {
        sh.uniforms.uJT = monumentTime;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\n varying float vJt;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n vJt = uv.y;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\n varying float vJt; uniform float uJT;')
          .replace('#include <alphamap_fragment>', `
            #include <alphamap_fragment>
            float fj = fract(vJt * 2.6 - uJT * 2.2);
            diffuseColor.a *= (0.38 + 0.62 * smoothstep(0.0, 0.30, fj) * smoothstep(1.0, 0.62, fj))
              * smoothstep(0.0, 0.09, vJt)                    // 吐水口の際で立ち上がる
              * (1.0 - 0.42 * smoothstep(0.84, 1.0, vJt));    // 水面際で砕ける`);
      };
      jetMat.customProgramCacheKey = () => 'fountainjet';
      const jets = new THREE.InstancedMesh(jetGeo, jetMat, NF);
      const jd = new THREE.Object3D();
      for (let k = 0; k < NF; k++) {
        const a = (k / NF) * Math.PI * 2;
        jd.position.set(f.x + Math.cos(a) * (f.r + 0.30), y0 + 1.88, f.z + Math.sin(a) * (f.r + 0.30));
        // 形状の局所 +x が半径方向の外を向く(rotY = -a)
        jd.rotation.set(0, -a, 0);
        jd.scale.set(1, 1, 1);
        jd.updateMatrix();
        jets.setMatrixAt(k, jd.matrix);
      }
      jets.renderOrder = 2;
      group.add(tagMesh(jets, 'monument.fountainJet', { thin: true, reason: '落水のリボン', noCollide: true }));
      // 落下点の波紋。街で唯一「動く白」であるべき場所に、動きがなかった。
      {
        const rg = new THREE.RingGeometry(0.62, 1.0, 20);
        rg.rotateX(-Math.PI / 2);
        const rmat = new THREE.MeshBasicMaterial({
          color: 0xdfeef0, transparent: true, opacity: 0.42,
          depthWrite: false, side: THREE.DoubleSide,
        });
        rmat.onBeforeCompile = (sh) => {
          sh.uniforms.uJT = monumentTime;
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nuniform float uJT; attribute float aRPh; varying float vRk;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
              float rk = fract(uJT * 1.15 + aRPh);
              vRk = rk;
              transformed.xz *= 0.16 + rk * 0.44;`);
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying float vRk;')
            .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\n diffuseColor.a *= (1.0 - vRk) * smoothstep(0.0, 0.12, vRk);');
        };
        rmat.customProgramCacheKey = () => 'fountainripple';
        const rings = new THREE.InstancedMesh(rg, rmat, NF);
        const rph = new Float32Array(NF);
        const rd = new THREE.Object3D();
        const LAND = f.r + 0.30 + V0 * TFALL;
        for (let k = 0; k < NF; k++) {
          const a = (k / NF) * Math.PI * 2;
          rd.position.set(f.x + Math.cos(a) * LAND, y0 + 0.305, f.z + Math.sin(a) * LAND);
          rd.rotation.set(0, 0, 0);
          rd.updateMatrix();
          rings.setMatrixAt(k, rd.matrix);
          rph[k] = (k * 0.37) % 1;
        }
        rg.setAttribute('aRPh', new THREE.InstancedBufferAttribute(rph, 1));
        rings.renderOrder = 3;
        group.add(tagMesh(rings, 'monument.fountainRipple', { thin: true, reason: '波紋', noCollide: true }));
      }
    }

    // 台輪 + 低いリブつきドーム
    const cor = cylUV(new THREE.CylinderGeometry(f.r + 0.26, f.r + 0.26, 0.26, NF), f.r + 0.26, 0.26);
    cor.translate(f.x, y0 + 3.52, f.z);
    appendGeo(cor, 1.06, true);
    // 球のキャップを中心 y0+3.62 に置くと、縁が台輪天端の 0.79m 上に来て
    // 「空飛ぶ円盤」になる。台輪の天端から始まる回転体で作る。
    const R0 = f.r + 0.26, DH = 1.52, Y0D = y0 + 3.78;
    const prof = [];
    for (let k = 0; k <= 10; k++) {
      const u = k / 10;
      prof.push(new THREE.Vector2(Math.max(R0 * Math.cos(u * Math.PI * 0.5) ** 0.72, 0.02), DH * Math.sin(u * Math.PI * 0.5) ** 1.15));
    }
    const dome = new THREE.LatheGeometry(prof, NF);
    dome.translate(f.x, Y0D, f.z);
    appendGeo(dome, 1.0, true);
    // 軒裏(下向きの円板)。回転体は外向きなので、見上げると中が透ける。
    const soff = new THREE.CircleGeometry(R0, NF);
    soff.rotateX(Math.PI / 2);
    soff.translate(f.x, Y0D - 0.01, f.z);
    appendGeo(soff, 0.62, true);
    // リブは弧に沿わせ、表面から 0.06m 出す(内側に置くと完全に埋まる)
    for (let k = 0; k < NF; k++) {
      const a = (k / NF) * Math.PI * 2;
      for (let q = 0; q < 5; q++) {
        const u = (q + 0.5) / 5;
        const rr = R0 * Math.cos(u * Math.PI * 0.5) ** 0.72 + 0.05;
        const yy = Y0D + DH * Math.sin(u * Math.PI * 0.5) ** 1.15;
        // 向きが直ると長辺 0.44 が半径方向に突き出て棘になるので、同時に寸法も直す
        const rib = new THREE.BoxGeometry(0.09, 0.12, 0.20);
        rib.rotateY(Math.PI / 2 - a);
        rib.translate(f.x + Math.cos(a) * rr, yy, f.z + Math.sin(a) * rr);
        appendGeo(rib, 1.07);
      }
    }
    const lant = new THREE.CylinderGeometry(0.34, 0.38, 0.46, 8);
    lant.translate(f.x, Y0D + DH + 0.20, f.z);
    appendGeo(lant, 1.05);
    const finial = new THREE.SphereGeometry(0.24, 10, 8);
    finial.translate(f.x, Y0D + DH + 0.58, f.z);
    appendGeo(finial, 1.08);
    // 水盤は上の 368 行のブロックが建てる。ここで二度目を建てると石の環が 3 段になる。
    plan.extraCylinders.push({ x: f.x, z: f.z, r: f.r + 1.15, y0, y1: y0 + 5 });
  }

  // ==== オルランドの柱(集合の場のしるし)
  {
    const o = M.orlando;
    const y0 = plazaBase(o.x, o.z) - 0.1;
    // 二段の台座 → 細い柱身 → 冠板 → 騎士。実物の柱身は径 0.5m ほどで、
    // 太いと「記念柱」ではなく「電柱の根巻き」に見える。
    box(o.x, y0, o.z, 2.5, 0.34, 2.5, 0.95);
    box(o.x, y0 + 0.34, o.z, 1.9, 0.30, 1.9, 0.99);
    box(o.x, y0 + 0.64, o.z, 1.32, 0.92, 1.32, 1.02);        // 銘板のある基壇
    box(o.x, y0 + 1.56, o.z, 0.86, 0.18, 0.86, 1.04);        // 柱礎の水切り
    // 実物は円柱ではなく方柱で、騎士は柱身の「前面の浮彫」。
    box(o.x, y0 + 1.74, o.z, 0.88, 3.30, 0.44, 1.0);
    box(o.x, y0 + 5.04, o.z, 0.72, 0.20, 0.72, 1.05);        // 冠板
    // 騎士(抽象の量塊 — 絵として読めれば良い)。盾と剣の輪郭だけは出す。
    // 騎士は柱身の前面(北向き)に彫られる。柱頭の上は旗竿。
    const fz = o.z - 0.24;
    box(o.x, y0 + 2.10, fz, 0.44, 1.05, 0.13, 0.90);          // 胴
    box(o.x, y0 + 3.15, fz, 0.22, 0.24, 0.12, 0.93);          // 頭
    box(o.x - 0.28, y0 + 2.28, fz - 0.03, 0.14, 0.70, 0.12, 0.86);   // 盾
    box(o.x + 0.24, y0 + 2.02, fz - 0.02, 0.08, 1.24, 0.08, 0.88, 0.10);   // 剣
    box(o.x - 0.13, y0 + 1.05, fz, 0.15, 1.05, 0.11, 0.89);   // 脚 左
    box(o.x + 0.13, y0 + 1.05, fz, 0.15, 1.05, 0.11, 0.89);   // 脚 右
    const mast = new THREE.CylinderGeometry(0.055, 0.065, 4.6, 8);
    mast.translate(o.x, y0 + 5.24 + 2.3, o.z);
    appendGeo(mast, 1.02);
    plan.extraCylinders.push({ x: o.x, z: o.z, r: 1.5, y0, y1: y0 + 6 });
  }

  // ==== 大聖堂のドーム(ドラム + 半球 + 灯篭)と聖ヴラホの小ドーム
  // 石のドームは「輪郭」でできている。半球にテクスチャを巻いただけだと風船になる。
  // 回転体で段付きドラム・軒蛇腹・オジー曲線・首・灯篭・球までを一息に作る。
  function domeAt(x, z, baseY, r, drumH) {
    const P2 = (rr, yy) => new THREE.Vector2(rr, yy);
    const prof = [
      P2(r, 0), P2(r, drumH * 0.16),
      P2(r * 1.09, drumH * 0.18), P2(r * 1.09, drumH * 0.26),   // 台輪
      P2(r, drumH * 0.28), P2(r, drumH * 0.86),
      P2(r * 1.13, drumH * 0.90), P2(r * 1.13, drumH * 1.00),   // 軒蛇腹
      P2(r * 0.99, drumH * 1.04),
    ];
    // オジー(尖り気味の)ドーム
    const domeH = r * 1.12;
    for (let i = 1; i <= 10; i++) {
      const u = i / 10;
      const rr = r * 0.99 * Math.cos(u * Math.PI * 0.5) ** 0.78;
      prof.push(P2(Math.max(rr, 0.02), drumH * 1.04 + domeH * Math.sin(u * Math.PI * 0.5) ** 1.12));
    }
    const topY = drumH * 1.04 + domeH;
    prof.push(P2(r * 0.19, topY + 0.05), P2(r * 0.19, topY + r * 0.44),      // 灯篭
      P2(r * 0.26, topY + r * 0.48), P2(r * 0.26, topY + r * 0.54),
      P2(r * 0.10, topY + r * 0.70), P2(0.02, topY + r * 0.80));
    const g = new THREE.LatheGeometry(prof, 24);
    g.translate(x, baseY, z);
    // ドラムの窓(8面)。無地のドラムは「石の樽」にしか見えない。
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2;
      const wn = new THREE.PlaneGeometry(r * 0.30, drumH * 0.42);
      wn.rotateY(Math.PI / 2 - a);
      wn.translate(x + Math.cos(a) * (r + 0.02), baseY + drumH * 0.56, z + Math.sin(a) * (r + 0.02));
      darkGeos.push(wn);
      const ah = new THREE.CircleGeometry(r * 0.15, 10, 0, Math.PI);
      ah.rotateY(Math.PI / 2 - a);
      ah.translate(x + Math.cos(a) * (r + 0.02), baseY + drumH * 0.56 + drumH * 0.21, z + Math.sin(a) * (r + 0.02));
      darkGeos.push(ah);
    }
    // 緯度方向に伸びない UV(実寸 1.2m の石 × 縦は弧長)
    const uv = g.attributes.uv, pos = g.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      const px = pos.getX(i) - x, pz = pos.getZ(i) - z, py = pos.getY(i) - baseY;
      uv.setXY(i, Math.atan2(pz, px) * r / 1.2, py / 0.55);
    }
    appendGeo(g, 1.03);
    // リブ(ドームの稜)— 細い箱を8本。輪郭に段が出て石造に見える
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      // 幅を固定にすると、頂点付近で rr→0 なのに箱の幅が残り、8本が互いに
      // 重なって外へ突き出す = ドームの頂に城の胸壁が生える。半径に比例させる。
      for (let i = 1; i <= 4; i++) {
        const u = i / 6;
        const rr = r * 0.99 * Math.cos(u * Math.PI * 0.5) ** 0.78;
        const yy = drumH * 1.04 + domeH * Math.sin(u * Math.PI * 0.5) ** 1.12;
        const rw = Math.max(0.06, rr * 0.30);
        const rib = new THREE.BoxGeometry(rw, domeH * 0.20, rw * 0.9);
        rib.rotateY(-a);
        rib.translate(x + Math.cos(a) * (rr + r * 0.03), baseY + yy, z + Math.sin(a) * (rr + r * 0.03));
        appendGeo(rib, 1.06);
      }
    }
  }
  {
    // 素地形 + 定数だと、屋根(広場の舗装から積む)より 3.3m 上に浮く。
    // 実際に描かれる屋根面から 0.9m 沈めて、ドラムが屋根を貫いて立つ形にする。
    // 大聖堂のドームは街の第二のシルエット。遠景で「白い瘤が 2 個」に見えて
    // いたので、聖ヴラホの交差部ドームと大きさで格を分ける。
    domeAt(M.cathedral.x, M.cathedral.z + 4, roofTopAt(M.cathedral, 4) - 0.9, 6.2, 7.4);
  }
  {
    // 聖ヴラホ(1715)は正面からドームが見える。ルジャ広場からペディメント越しに
    // ドラムが立つよう、少し前へ出して背を上げる。
    domeAt(M.stBlaise.x, M.stBlaise.z + 1.5, roofTopAt(M.stBlaise, 0) - 0.8, 4.2, 5.2);
  }

  // ==== 修道院の鐘塔(細身・四角 + ピラミッド屋根)
  function slimTower(x, z, h) {
    const y0 = plazaBase(x, z) - 0.5;
    box(x, y0, z, 4.2, h, 4.2, 1.0);
    box(x, y0 + h, z, 4.9, 1.6, 4.9, 1.04);
    const spire = new THREE.ConeGeometry(3.1, 3.4, 4);
    spire.rotateY(Math.PI / 4);
    spire.translate(x, y0 + h + 1.6 + 1.7, z);
    leadGeos.push(spire);
    plan.extraColliders.push({ x0: x - 2.1, z0: z - 2.1, x1: x + 2.1, z1: z + 2.1, y0, y1: y0 + h });
    // 鐘のアーチ開口
    for (const [ox, oz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const ry = Math.atan2(ox, oz);
      const niche = new THREE.PlaneGeometry(1.4, 1.5);
      const archTop = new THREE.CircleGeometry(0.7, 10, 0, Math.PI);
      archTop.translate(0, 0.75, 0);
      for (const g of [niche, archTop]) {
        g.rotateY(ry);
        g.translate(x + ox * 2.11, y0 + h - 1.8, z + oz * 2.11);
        darkGeos.push(g);
      }
    }
  }
  slimTower(M.franciscan.tower.x, M.franciscan.tower.z, M.franciscan.tower.h);
  slimTower(M.dominican.tower.x, M.dominican.tower.z, M.dominican.tower.h);

  // ==== 回廊の列柱(インスタンス)
  // 柱の天端は 0.16 + 2.20 + 0.18 = 2.38 だったが、アーチの迫元は 2.45。
  // 7cm の隙間が空き、近くで見ると柱が浮いて見える。柱身だけを
  // インスタンスごとに伸ばして、天端を迫元にぴたりと合わせる。
  const COL_SH0 = 2.20;   // 素の柱身の天端(この上が頸+冠板)
  const colGeo = (() => {
    const shaft = new THREE.CylinderGeometry(0.16, 0.185, COL_SH0, 12);
    shaft.translate(0, COL_SH0 / 2, 0);
    const ast = new THREE.CylinderGeometry(0.195, 0.195, 0.07, 12);   // 頸(アストラガル)
    ast.translate(0, COL_SH0 + 0.035, 0);
    const cap = new THREE.BoxGeometry(0.42, 0.18, 0.42);
    cap.translate(0, COL_SH0 + 0.16, 0);
    const base = new THREE.BoxGeometry(0.40, 0.16, 0.40);
    base.translate(0, 0.08, 0);
    return mergeSimple([shaft, ast, cap, base]);
  })();
  const colPositions = [];
  // ---- アーケード(柱 + 半円アーチ + 蛇腹)
  // 柱の上に平らな梁を渡しただけの形は、現代のカーポートに見える。
  // ロッジアも回廊も、実物は必ずアーチが架かっている。
  // back: 衝立の内側から建物の壁までの距離(m)。渡すと天井を張る。
  // 渡さないと「穴の開いた衝立」のままで、真上にレイを飛ばすと空へ抜ける
  // (城壁から見下ろすと宮殿の中に長さ 17m の溝が開く)。
  function arcadeRun(x0, z0, dirX, dirZ, n, S, y, T, back = 0, colTop = 2.45) {
    const ang = Math.atan2(-dirZ, dirX);
    const H2 = 0.85;
    const R = Math.max(0.5, (S - 0.46) / 2);
    const half = S / 2;
    for (let i = 0; i < n; i++) {
      const cx = x0 + dirX * S * (i + 0.5), cz = z0 + dirZ * S * (i + 0.5);
      const sh = new THREE.Shape();
      sh.moveTo(-half, 0);
      sh.lineTo(-half, R + H2);
      sh.lineTo(half, R + H2);
      sh.lineTo(half, 0);
      sh.lineTo(R, 0);
      sh.absarc(0, 0, R, 0, Math.PI, false);
      sh.lineTo(-half, 0);
      sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: T, bevelEnabled: false, curveSegments: 9 });
      g.translate(0, 0, -T / 2);
      g.rotateY(ang);
      g.translate(cx, y + colTop, cz);
      appendGeo(g, 0.99);
    }
    const L = S * n;
    if (back > 0.05) {
      // 天井(ヴォールトの代わりの平天井)と、その上の壁。
      // 建物側の法線。dirX=1 → (0,-1) / dirZ=1 → (+1,0)。
      // 符号を逆にすると天井が広場の上に浮く(ルジャの上に石の庇が出ていた)。
      const nx2 = dirZ, nz2 = -dirX;
      const bx = x0 + nx2 * (T / 2 + back / 2), bz = z0 + nz2 * (T / 2 + back / 2);
      const mx2 = bx + dirX * L / 2, mz2 = bz + dirZ * L / 2;
      const cw2 = Math.abs(dirX) > 0.5 ? L : back;
      const cd2 = Math.abs(dirX) > 0.5 ? back : L;
      // 天井スラブ(厚み 0.22m)
      box(mx2, y + colTop + R - 0.22, mz2, cw2, 0.22, cd2, 0.66);
      // 天井から蛇腹までの壁(空の溝を塞ぐ)
      box(mx2, y + colTop + R, mz2, cw2, H2 + 0.26, cd2, 0.94);
    }
    // 蛇腹(アーケードの上端に一本通す — 立面に「終わり」を与える)
    const mx = x0 + dirX * L / 2, mz = z0 + dirZ * L / 2;
    const cw = Math.abs(dirX) > 0.5 ? L + 0.5 : T + 0.34;
    const cd = Math.abs(dirX) > 0.5 ? T + 0.34 : L + 0.5;
    box(mx, y + colTop + R + H2, mz, cw, 0.26, cd, 1.04);
    // 柱
    for (let i = 0; i <= n; i++) {
      // 柱脚は実際に歩ける床に載せる。run の y(地形高さ - 0.2)のままだと、
      // 広場や舗装が別の高さのとき柱が浮くか埋まる。
      const cpx = x0 + dirX * S * i, cpz = z0 + dirZ * S * i;
      const cgy = plan.groundAt(cpx, cpz, 200);
      const cy = (cgy && cgy.y > -20 ? cgy.y : y) - 0.05;
      colPositions.push({ x: cpx, z: cpz, y: cy, top: colTop, dy: y - cy });
      // 柱は実体。当たり判定が無いと体が柱の中に立てる。
      plan.extraCylinders.push({ x: cpx, z: cpz, r: 0.34, y0: cy, y1: cy + colTop + 0.4 });
    }
  }

  function courtyardCols(court) {
    const y = plazaBase(court.cx, court.cz) - 0.2;
    const nx2 = Math.max(2, Math.round(court.w / 2.1)), nz2 = Math.max(2, Math.round(court.d / 2.1));
    const Sx = court.w / nx2, Sz = court.d / nz2;
    arcadeRun(court.cx - court.w / 2, court.cz - court.d / 2, 1, 0, nx2, Sx, y, 0.5);
    arcadeRun(court.cx - court.w / 2, court.cz + court.d / 2, 1, 0, nx2, Sx, y, 0.5);
    arcadeRun(court.cx - court.w / 2, court.cz - court.d / 2, 0, 1, nz2, Sz, y, 0.5);
    arcadeRun(court.cx + court.w / 2, court.cz - court.d / 2, 0, 1, nz2, Sz, y, 0.5);
  }
  courtyardCols(franCourt);
  courtyardCols(domCourt);
  // スポンザのロッジア(前面 5 本)
  {
    const y = plazaBase(M.sponza.x, M.sponza.z) - 0.2;
    // ロッジアはルジャ広場に面する南面に開く(西面は街区の中で、誰も見ない)
    const n2 = 7, S = M.sponza.w / n2;   // 奇数 = 中央がベイ。偶数だと大扉に柱が刺さる
    arcadeRun(M.sponza.x - M.sponza.w / 2, M.sponza.z + M.sponza.d / 2 + 1.6, 1, 0, n2, S, y, 0.62, 1.29, 3.30);
  }
  // 総督邸の前廊
  {
    const y = plazaBase(M.rector.x, M.rector.z) - 0.2;
    const n2 = 7, S = M.rector.d / n2;
    arcadeRun(M.rector.x - M.rector.w / 2 - 1.5, M.rector.z - M.rector.d / 2, 0, 1, n2, S, y, 0.62, 1.19, 3.20);
  }

  // ==== メッシュ化
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  const stoneMat = new THREE.MeshStandardMaterial({
    map: tex.wallStoneWarm.map, normalMap: tex.wallStoneWarm.normalMap,
    normalScale: new THREE.Vector2(1.7, 1.7),
    // color を省くと白(1,1,1)。民家には tint が掛かっているので、記念建築だけが
    // 白いプラスチックに見えていた。実物のコルチュラ石は暖かい生成り。
    color: 0xd4c9b4,
    vertexColors: true, roughness: 0.8, metalness: 0, envMapIntensity: 0.60,
  });
  // 記念建築の大面も 3.2m で反復する。壁と同じ低周波のうねりを重ねる。
  {
    const prev = stoneMat.onBeforeCompile;
    stoneMat.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        float qv1 = texture2D(map, vMapUv * 0.145 + vec2(0.51, 0.23)).g;
        float qv2 = texture2D(map, vMapUv * 0.043 + vec2(0.13, 0.79)).g;
        diffuseColor.rgb *= 1.0 + 0.16 * (qv1 - 0.5) + 0.11 * (qv2 - 0.5);`);
    };
    stoneMat.customProgramCacheKey = () => 'monMacro';
  }
  // I は appendGeo が積んだ連番なので、頂点は 1 つも共有されていない。
  // ここで computeVertexNormals() を呼ぶと、元ジオメトリが持っていた平滑法線が
  // 面法線で上書きされ、円柱も球もロートも全部フラットシェードになる。
  // (角張らせたい多面体だけは appendGeo(g, tint, true) で個別にフラット化する)
  geo.setIndex(I);
  bakeSkyVis(geo, sharedSkyVis || makeSkyVis(plan), { offsetY: 0.4 });
  patchSkyVis(stoneMat);
  const stone = new THREE.Mesh(geo, stoneMat);
  stone.castShadow = true; stone.receiveShadow = true;
  group.add(tagMesh(stone, 'monument.stone', { solid: true, masonry: true, groundContact: true }));

  // 鉛屋根(ドーム・尖塔)
  const lead = new THREE.Mesh(mergeSimple(leadGeos), new THREE.MeshStandardMaterial({
    color: 0x67706e, roughness: 0.72, metalness: 0.08,   // 古びた鉛(新品の銀にしない)
  }));
  lead.castShadow = true;
  group.add(tagMesh(lead, 'monument.lead', { solid: true, reason: 'ドームの鉛葺き' }));

  // 暗い開口(鐘室など)
  // 完全な黒は「穴」に見える。開口の奥にも間接光は回る(実測 sRGB 30〜45)。
  // 完全な黒は「穴」に見える。開口の奥にも間接光は回る(実測 sRGB 30〜45)。
  // 拡散だけでは日陰の記念建築で 8/255 に沈むので、自発光で床を作る。
  const dark = new THREE.Mesh(mergeSimple(darkGeos), new THREE.MeshStandardMaterial({
    color: 0x2c241a, roughness: 0.95, emissive: 0x2a1d11, emissiveIntensity: 1.9,
  }));
  group.add(tagMesh(dark, 'monument.dark', { thin: true, reason: '開口の奥の暗がり', noCollide: true, opening: true }));

  // 列柱
  // テクスチャ無しだと、柱だけが街で唯一の「素のプリミティブ」に見える
  // 柱身だけを伸縮させる(柱礎と柱頭は寸法を保つ)
  const stretchShaft = (mat) => {
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n attribute float aColH; const float SH0 = ${COL_SH0.toFixed(2)};`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          if (position.y > 0.16) {
            if (position.y <= SH0) transformed.y = 0.16 + (position.y - 0.16) * ((aColH - 0.16) / (SH0 - 0.16));
            else transformed.y = position.y + (aColH - SH0);
          }`);
    };
    mat.customProgramCacheKey = () => 'colshaft';
    return mat;
  };
  const colMat = stretchShaft(new THREE.MeshStandardMaterial({
    map: tex.wallStoneWarm.map, normalMap: tex.wallStoneWarm.normalMap,
    color: 0xc8bfa8, roughness: 0.62, envMapIntensity: 0.6,
  }));
  const cols = new THREE.InstancedMesh(colGeo, colMat, colPositions.length);
  {
    const dummy = new THREE.Object3D();
    const colH = new Float32Array(colPositions.length);
    colPositions.forEach((c, i) => {
      dummy.position.set(c.x, c.y, c.z);
      dummy.updateMatrix();
      cols.setMatrixAt(i, dummy.matrix);
      // 天端 = aColH + 0.07(頸) + 0.18(冠板)。柱脚を床に下ろしたぶん伸ばす。
      colH[i] = (c.top ?? 2.45) - 0.25 + (c.dy ?? 0);
    });
    colGeo.setAttribute('aColH', new THREE.InstancedBufferAttribute(colH, 1));
  }
  cols.castShadow = true;
  group.add(tagMesh(cols, 'monument.column', { solid: true, masonry: true, groundContact: true }));

  // 時計の文字盤(鐘楼の西面 — ストラドゥンの正面)
  const clockQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 3.4),
    new THREE.MeshBasicMaterial({ map: tex.clock.tex, transparent: true }),
  );
  const bt = M.bellTower;
  const btY = plazaBase(bt.x, bt.z) - 0.5;
  clockQuad.position.set(bt.x - bt.w / 2 - 0.06, btY + bt.h - 2.6, bt.z);
  clockQuad.rotation.y = -Math.PI / 2;
  group.add(tagMesh(clockQuad, 'monument.clockFace', { thin: true, reason: '時計盤', noCollide: true }));

  return {
    group,
    counts: { cloisterColumns: colPositions.length },
    bellPos: new THREE.Vector3(bt.x, btY + bt.h + 1.5, bt.z),
  };
}

function mergeSimple(geos) {
  const list = geos.map(g => (g.index ? g.toNonIndexed() : g));
  let total = 0;
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
