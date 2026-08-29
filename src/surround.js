// ============================================================================
// surround.js — 城壁の外の世界。
// ロクルム島(松の緑を読める距離に)・ロヴリイェナツ要塞・旧港の舟・
// スルジ山頂の十字架。遠景も「同じ世界の続き」であること。
// ============================================================================
import * as THREE from 'three';
import { mulberry32, hash2, clamp, lerp, smoothstep, fbm2, nearestOnPolyline, pointInPoly, tagMesh } from './util.js';
import { rngFor } from './seed.js';
import { LOKRUM, LOVRIJENAC } from './plan.js';
import { monumentTime } from './monuments.js';
import { farHeight } from './ground.js';
import { patchWet } from './wet.js';
import { TreeBuf, aleppoPine, cypress, olive, maquis, patchTreeWind } from './trees.js';

export function makeSurround(plan, tex) {
  const group = new THREE.Group();
  const rng = rngFor(0x10c2);

  // ---- ロクルム島(楕円の丘 + 岩の縁)— 位置は plan と共有
  const LOK = LOKRUM;
  function lokrumHeight(lx, lz) {
    // 島ローカル(回転補正)
    const c = Math.cos(-LOK.rot), s = Math.sin(-LOK.rot);
    const dx = lx - LOK.x, dz = lz - LOK.z;
    const u = (dx * c - dz * s) / LOK.rx, v = (dx * s + dz * c) / LOK.rz;
    const d = Math.hypot(u, v);
    if (d > 1) return -3;
    const n = hash2((lx * 2) | 0, (lz * 2) | 0);
    return Math.pow(Math.cos(d * Math.PI / 2), 0.9) * LOK.h * (0.85 + n * 0.3) - 0.5;
  }
  {
    const step = 9;
    const x0 = LOK.x - LOK.rx - 20, x1 = LOK.x + LOK.rx + 20;
    const z0 = LOK.z - LOK.rz - 60, z1 = LOK.z + LOK.rz + 60;
    const nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step);
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = lokrumHeight(x, z);
      pos.setY(i, y);
      const n = hash2((x * 3) | 0, (z * 3) | 0);
      // ロクルムは芝生の丘ではない。白い石灰岩の島に、松の落ち葉と乾いた
      // マキが斑に載る。彩度の高い緑で塗ると、島ごとゴルフ場に見える。
      // 松の下は針葉の絨毯で暗く、尾根と汀は剥き出しの石灰岩で明るい。
      // 一様に明るいと、島が砂丘に見える(実測でそうなった)。
      const s1 = fbm2(x * 0.030 + 3, z * 0.030 - 5);
      const s2 = fbm2(x * 0.085 - 17, z * 0.085 + 41);
      const scrub = clamp((s1 - 0.42) * 2.4 + (s2 - 0.5) * 0.9
        + smoothstep(28, 2, y) * 0.60, 0, 1);
      if (y < 0.8) {
        // ロクルムの縁は砂浜ではなく岩。明るい白い帯を回すと、環礁に見える。
        // ——そのコメントのとおりの症状が値として残っていた。実測 L* 51.9 で、
        // 樹冠(L* 16.9)との差 35 L*。真昼のアドリア海(L* 69)より 5 しか暗くない、
        // 明るい砂の帯が島の全周を回っていた。**帯を消し、白い岩は線として残す。**
        c.setHSL(0.095, 0.09, 0.28 + n * 0.13, THREE.SRGBColorSpace);
      } else {
        // 素地 = 石灰岩。そこへ松葉(赤みの茶)とマキ(灰緑)を混ぜる。
        c.setHSL(0.098 + n * 0.012, 0.11 + n * 0.05, 0.40 + n * 0.10, THREE.SRGBColorSpace);
        const litter = new THREE.Color().setHSL(0.072, 0.26, 0.20, THREE.SRGBColorSpace);
        const maq = new THREE.Color().setHSL(0.21, 0.20, 0.155, THREE.SRGBColorSpace);
        c.lerp(litter, clamp(scrub * 1.15, 0, 0.92));
        c.lerp(maq, clamp((scrub - 0.35) * 1.25, 0, 0.62));
      }
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    const lokMat = patchWet(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), { foam: 0.5 });
    const m = new THREE.Mesh(g, lokMat);
    m.receiveShadow = true;
    group.add(tagMesh(m, 'surround.lokrum', { terrain: true, openSurface: true, backdrop: true }));
  }

  // ---- 植生。ダルマチアの署名は「アレッポ松の平頂 + 糸杉の縦線 + 裸の石灰岩」。
  //
  // 1 形状を回して並べると、島ごと既製品に見える。木は 1 本ずつ成長から作り、
  // 空間の塊にまとめて焼く(インスタンスではないので、全ての木の輪郭が違う)。
  // 描画呼び出しは塊の数だけ。頂点属性で個体ごとに違う位相で風に揺れる。
  //
  // 配置は生態。勾配・斜面の向き・標高・谷筋・汀からの距離で密度が決まる。
  // 一様なランダム散布は失敗状態 — それは「木を置いた」であって「森」ではない。
  const vegChunks = new Map();
  const OPQ = tex.needle.userData?.opaqueUV ?? 0.04;
  const OPS = tex.needle.userData?.opaqueSize ?? 0.085;
  const vegBuf = (key) => {
    if (!vegChunks.has(key)) vegChunks.set(key, new TreeBuf(OPQ, OPS));
    return vegChunks.get(key);
  };
  let treeCount = 0;

  /** その場所の立地。高さ関数を渡して、勾配・向き・谷筋を測る。 */
  const siteAt = (hAt, x, z) => {
    const y = hAt(x, z);
    const hx = hAt(x + 4, z) - hAt(x - 4, z);
    const hz = hAt(x, z + 4) - hAt(x, z - 4);
    const slope = Math.hypot(hx, hz) / 8;
    // −z が北。斜面が北を向く(北側が低い)ほど日陰で湿り、木が濃くなる。
    const north = clamp(hz / 8 / Math.max(slope, 0.06), -1, 1);
    // 凹み(谷筋)。ラプラシアンが正 = 周りより低い = 水と土が集まる。
    const lap = (hAt(x + 7, z) + hAt(x - 7, z) + hAt(x, z + 7) + hAt(x, z - 7) - 4 * y) / 49;
    return { y, slope, north, gully: clamp(lap * 26, -1, 1) };
  };

  /**
   * 生態の散布。格子を揺らして疎密を作る(等間隔でも純ランダムでもない)。
   * @param cb (x, z, site, dens, rnd) — 木を生やすかどうかは呼び手が決める
   */
  const scatter = (bounds, step, hAt, cb) => {
    const [x0, x1, z0, z1] = bounds;
    for (let gz = z0; gz < z1; gz += step) {
      for (let gx = x0; gx < x1; gx += step) {
        const h1 = hash2((gx * 1.7) | 0, (gz * 1.7) | 0);
        const h2 = hash2((gz * 2.3) | 0 + 91, (gx * 2.3) | 0 - 37);
        const x = gx + (h1 - 0.5) * step * 1.5, z = gz + (h2 - 0.5) * step * 1.5;
        const site = siteAt(hAt, x, z);
        // 個体ごとの乱数列。座標から作るので、シードが同じなら同じ木が立つ。
        let sd = ((x * 7349.7) ^ (z * 9151.3)) >>> 0;
        const rnd = mulberry32(sd ^ 0x9e37);
        cb(x, z, site, rnd);
      }
    }
  };

  // ── ロクルム島 ────────────────────────────────────────────────
  // 島の主は松。尾根と汀は風が強く、木は途切れて裸岩とマキになる。
  {
    const TL0 = 20, TL1 = 27;                    // 樹林限界(島の高さは 30m)
    scatter([LOK.x - LOK.rx, LOK.x + LOK.rx, LOK.z - LOK.rz, LOK.z + LOK.rz], 6.0,
      lokrumHeight, (x, z, st, rnd) => {
        if (st.y < 1.4) return;
        // 密度 — 谷と北斜面で濃く、尾根・急斜面・汀で薄い
        let d = 0.86 + st.north * 0.22 + st.gully * 0.26
          - smoothstep(0.40, 1.05, st.slope) * 0.80
          - smoothstep(TL0, TL1, st.y) * 0.95
          - (1 - smoothstep(1.4, 5.5, st.y)) * 0.75;
        d += (fbm2(x * 0.035 + 11, z * 0.035 - 7) - 0.5) * 0.55;   // 群落の斑
        const key = `L${Math.floor(x / 150)},${Math.floor(z / 150)}`;
        const B = vegBuf(key);
        const exposure = clamp(smoothstep(6, 24, st.y) * 0.7 + smoothstep(0.3, 0.9, st.slope) * 0.5, 0, 1);
        if (rnd() > d) {
          // 木の無い所が空白ではいけない。マキと草の株が地面の真実を作る。
          if (rnd() < 0.34 + exposure * 0.3) {
            maquis(B, [x, st.y - 0.05, z], rnd,
              { h: 0.55 + rnd() * 0.95, foliage: [0.074 + rnd() * 0.022, 0.086, 0.052] });
            treeCount++;
          }
          return;
        }
        // 糸杉は単独か小さな群れ。道沿いと尾根に、縦の律動として立つ。
        const cyp = hash2((x * 0.09) | 0, (z * 0.09) | 0);
        if (cyp > 0.80 && st.y > 4) {
          cypress(B, [x, st.y - 0.1, z], rnd, { h: 9 + rnd() * 8 });
        } else if (st.y < 4.5 && rnd() < 0.35) {
          olive(B, [x, st.y - 0.1, z], rnd);
        } else {
          aleppoPine(B, [x, st.y - 0.15, z], rnd, {
            h: 7.5 + rnd() * 7.5 - smoothstep(TL0 - 6, TL1, st.y) * 3.5,
            exposure,
            // 乾いた石灰岩の松は濃緑ではない。灰がかった青緑。
            // 乾いた石灰岩の松は濃緑ではなく青緑。ただし線形空間の 0.25 は日向で
            // 白く飛ぶ(実測で島が霜に見えた)。石灰岩より確実に暗い値にする。
            // 642m 先では画素の輝度の約 6 割が大気側になる(霧は保護済み)。
            // 葉の実効アルベドが Y 0.023 しか無いと、自分の色を主張できず
            // 色相が空の 254° に飲まれる。実物の日向の樹冠は Y 0.09〜0.13。
            foliage: [0.070 + rnd() * 0.024, 0.130 + rnd() * 0.030, 0.090 + rnd() * 0.022],
          });
        }
        treeCount++;
      });
  }

  // ── 本土側の斜面 ──────────────────────────────────────────────
  // 城壁の外が裸の土だけだと、街が砂丘に建って見える。ただしここは
  // スルジの裾 — 森ではなく、乾いたマキに松が点在する斜面。
  {
    const loop = plan.wallPts.map(p => [p[0], p[1]]);
    const hAt = (x, z) => plan.outsideHeight(x, z);
    scatter([-300, 310, -190, 110], 8, hAt, (x, z, st, rnd) => {
      if (st.y < 3.5 || st.y > 120) return;
      if (pointInPoly(loop, x, z)) return;
      if (x > 150 && z > -58 && z < 84) return;                 // 港の水域
      if (nearestOnPolyline(plan.wallPts, x, z).d < 26) return;  // 壕と門前は開けておく
      if (Math.hypot(x - LOVRIJENAC.x, z - LOVRIJENAC.z) < 30) return;
      const key = `M${Math.floor(x / 170)},${Math.floor(z / 170)}`;
      const B = vegBuf(key);
      const exposure = clamp(smoothstep(10, 70, st.y) * 0.8 + smoothstep(0.3, 0.9, st.slope) * 0.4, 0, 1);
      // 標高が上がるほど木は減り、マキだけになる(スルジは森ではない)。
      let d = 0.46 + st.north * 0.26 + st.gully * 0.34
        - smoothstep(0.45, 1.15, st.slope) * 0.85
        - smoothstep(28, 72, st.y) * 0.80
        - (1 - smoothstep(3.5, 9, st.y)) * 0.55;
      d += (fbm2(x * 0.028 + 53, z * 0.028 + 17) - 0.5) * 0.6;
      if (rnd() > d) {
        // 木の無い所は「裸の土」ではない。風に刈られたマキの株が斜面を覆う。
        // ここが空白だと、スルジの裾が砂丘に見える。
        if (rnd() < 0.62 + exposure * 0.24) {
          maquis(B, [x, st.y - 0.05, z], rnd,
            { h: 0.55 + rnd() * 1.0, foliage: [0.070 + rnd() * 0.022, 0.082, 0.048] });
          treeCount++;
        }
        return;
      }
      const cyp = hash2((x * 0.07) | 0, (z * 0.07) | 0);
      const far = st.y > 45 || Math.abs(x) > 230;
      if (cyp > 0.84) {
        cypress(B, [x, st.y - 0.1, z], rnd, { h: 7 + rnd() * 7, detail: far ? 0.2 : 1 });
      } else if (rnd() < 0.22) {
        olive(B, [x, st.y - 0.1, z], rnd, { h: 2.8 + rnd() * 1.8 });
      } else {
        aleppoPine(B, [x, st.y - 0.15, z], rnd, {
          h: 5.5 + rnd() * 6 - smoothstep(30, 75, st.y) * 2.5,
          exposure, detail: far ? 0.2 : 1,
          foliage: [0.066 + rnd() * 0.022, 0.120 + rnd() * 0.028, 0.084 + rnd() * 0.020],
        });
      }
      treeCount++;
    });
  }

  // 塊ごとにメッシュにする。島と本土で風の強さを変える —
  // 露出した島の梢は、町に囲まれた木よりよく動く。
  const vegMats = {};
  for (const [key, B] of vegChunks) {
    if (!B.tris) continue;
    const isLok = key[0] === 'L';
    const mk = isLok ? 'L' : 'M';
    if (!vegMats[mk]) {
      vegMats[mk] = patchTreeWind(new THREE.MeshStandardMaterial({
        map: tex.needle, vertexColors: true, roughness: 0.92, metalness: 0,
        envMapIntensity: 0.12,
        // 房の絵はアルファで抜ける。alphaTest なら深度も影も素直に効く
        // (transparent にすると並べ替えが要り、樹冠が前後で瞬く)。
        alphaTest: 0.42,
        side: THREE.DoubleSide,          // 葉の板は裏からも見える(1 枚で 2 面)
      }), { wind: isLok ? 0.115 : 0.062, time: monumentTime });
    }
    const m = new THREE.Mesh(B.geometry(), vegMats[mk]);
    m.castShadow = true; m.receiveShadow = true;
    group.add(tagMesh(m, 'surround.pine', { thin: true, reason: '葉は板', noCollide: true }));
  }

  // ---- ロヴリイェナツ要塞(西の岩上 — 三角の量塊)
  {
    const P = [], N = [], U = [], C = [];
    const push = (g, tint) => {
      const gg = g.index ? g.toNonIndexed() : g;
      const pos = gg.attributes.position, nor = gg.attributes.normal, uv = gg.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        P.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        N.push(nor.getX(i), nor.getY(i), nor.getZ(i));
        U.push(uv ? uv.getX(i) * 3 : 0, uv ? uv.getY(i) * 3 : 0);
        C.push(tint, tint, tint);
      }
    };
    // 岩の天端は y=25.5・半径 16(plan.js の lov)。ここから積み上げる。
    // 底を岩に食い込ませないと、縁が宙に浮いて「山の上のコンクリート」になる。
    const LX = LOVRIJENAC.x, LZ = LOVRIJENAC.z, ROT = 0.5;
    const mk = (r0, r1, h, yc, tint) => {
      const g = new THREE.CylinderGeometry(r0, r1, h, 3, 1);
      g.rotateY(ROT); g.translate(LX, yc, LZ); push(g, tint);
    };
    // 岩の上に出るのが 16m しか無く、遠景で「なだらかな丘の上の三角柱」に
    // 見えていた。実物は 37m の岩の上にさらに 37m の壁が立ち、ミンチェタと
    // 並ぶ二大シルエット。段を増やして 28m まで積む(下段テラス + 主塔)。
    mk(15.6, 18.2, 6.0, 22.0, 0.86);    // 裾の勾配(talus)— 岩に 4m 食い込ませる
    mk(14.8, 15.6, 7.0, 28.5, 0.92);    // 下段テラスの壁
    mk(15.1, 14.8, 0.9, 32.4, 1.04);    // 下段の蛇腹
    // mk の第 4 引数は **中心** の y(CylinderGeometry は原点中心)。
    // 下段の蛇腹の天端 32.85 を「積み始め」だと思って 33.2 と書いたので、
    // 主塔は 26.7〜39.7 に置かれ、蛇腹(45.35)との間に **5.65m の空隙**が
    // 空いた。胸壁・蛇腹・メルロン環・旗竿が丸ごと宙に浮いていた。
    // 32.85〜45.85 に置く → 中心 39.35。
    mk(11.6, 12.4, 13.0, 39.35, 0.98);  // 主塔体
    mk(11.9, 11.6, 1.1, 45.9, 1.06);    // 胴蛇腹
    mk(10.4, 10.4, 2.6, 47.1, 1.00);    // 胸壁の内側
    // メルロン(三辺に並べる)— 遠景でも「要塞」と読ませる唯一のしるし
    // 環は 2 本。天端(主塔)と下段テラス。一本だけだと段の存在が読めない。
    // 1 辺に置ける数は辺の長さで決まる。三角形の外接半径 R の辺の半長は
    // R·sin60° = 0.866R。ピッチ 2.6m で ±half 個並べると half·2.6 まで伸びるので、
    // half を決め打ちすると **角からはみ出して宙に浮く**(実測 上の環で
    // ±10.4m 対 辺の半長 9.0m、下の環で ±13.0m 対 12.8m)。辺から出さない。
    for (const [ringR, ringY] of [[10.4, 49.15], [14.8, 33.55]]) {
      const half = Math.max(1, Math.floor((ringR * Math.sin(Math.PI / 3) - 0.9) / 2.6));
      for (let e = 0; e < 3; e++) {
        // 辺の中点方向は、**円柱が頂点を置く規則から** 出す。
        // ROT + e·120° + 60° という当て推量にしていたので位相が 30° ずれ、
        // メルロンが面の上ではなく角の脇に並んで、下に石が無いまま宙に浮いた。
        // three の CylinderGeometry は頂点 k を局所 (sin θ, cos θ)、θ = k·2π/3 に
        // 置く。辺の中点は θ = (k+0.5)·2π/3。それを rotateY(ROT) で回す。
        const th = (e + 0.5) * Math.PI * 2 / 3;
        const lx = Math.sin(th), lz = Math.cos(th);
        const mx = lx * Math.cos(ROT) + lz * Math.sin(ROT);
        const mz = -lx * Math.sin(ROT) + lz * Math.cos(ROT);
        // 辺に沿う接線
        const tx2 = -mz, tz2 = mx;
        const apo = ringR * Math.cos(Math.PI / 3);   // 三角形の辺までの距離
        for (let k = -half; k <= half; k++) {
          const off = k * 2.6;
          const bx2 = LX + mx * (apo + 0.30) + tx2 * off;
          const bz2 = LZ + mz * (apo + 0.30) + tz2 * off;
          const mg = new THREE.BoxGeometry(1.5, 1.7, 0.8);
          mg.rotateY(Math.atan2(mx, mz));
          mg.translate(bx2, ringY, bz2);
          push(mg, 1.0);   // 頂点色は 1.0 を超えない(色度は material.color が決める)
        }
      }
    }
    // 旗竿(遠景の一本の縦線が、要塞を「使われている場所」にする)
    const pole = new THREE.CylinderGeometry(0.20, 0.24, 11, 5);
    pole.translate(LX, 53.9, LZ);   // 胸壁の天端 48.4 に足を着ける(48.4〜59.4)
    push(pole, 0.72);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    // color も envMapIntensity も normalScale も無い = アルベド 1.0・環境 1.0・法線 1.0。
    // 城壁本体(walls.js)は color 0xc9c0ad / envMapIntensity 0.55 / normalScale で、
    // **同じ石灰岩が一枚の絵の中で 0.71 対 0.12 = 2.5 段に割れていた**
    // (実測 t1am で要塞 Y 0.709 > 日向の積雲 Y 0.674 — 石が雲より明るい)。
    // 城壁と一字一句同じにする。
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      map: tex.fortStone.map, normalMap: tex.fortStone.normalMap,
      normalScale: new THREE.Vector2(1.35, 1.35),
      color: 0xc9c0ad, vertexColors: true, roughness: 0.88, envMapIntensity: 0.55,
    }));
    m.castShadow = true;
    group.add(tagMesh(m, 'surround.lovrijenac', { solid: true, masonry: true, groundContact: true }));
  }

  // ---- 旧港の舟(白い小舟が数隻、静かに舫う)
  {
    const boats = [];
    const boatGeo = (() => {
      const hull = new THREE.CylinderGeometry(0.9, 0.4, 4.4, 7, 1);
      hull.rotateZ(Math.PI / 2);
      hull.scale(1, 0.5, 0.42);
      hull.translate(0, 0.42, 0);
      // 舷(ガンネル)— 影の線が一本入るだけで舟の形が読める
      const gun = new THREE.BoxGeometry(4.3, 0.10, 0.86);
      gun.translate(0, 0.62, 0);
      const gun2 = new THREE.BoxGeometry(3.4, 0.09, 1.0);
      gun2.translate(-0.2, 0.60, 0);
      // 前後の舟底の見切り + 小さなキャビン
      const cabin = new THREE.BoxGeometry(1.15, 0.44, 0.72);
      cabin.translate(-0.9, 0.80, 0);
      const mast = new THREE.CylinderGeometry(0.055, 0.075, 3.6, 5);
      mast.translate(0.4, 2.2, 0);
      const boom = new THREE.CylinderGeometry(0.04, 0.04, 2.2, 4);
      boom.rotateZ(Math.PI / 2); boom.translate(-0.2, 0.95, 0);
      return mergeSimple([hull, gun, gun2, cabin, mast, boom]);
    })();
    // z を 7m 等差にすると、港の舟が梯子に見える。舫った舟は風で開くので
    // 向きも ±20 度では足りない。
    // **岸壁の縁は x≒183.5**(実測: x 174〜183 は舗装と桟橋、x 184 から水)。
    // 181 から始めていたので、沖の 11 隻のうち手前の何隻かも陸に埋まっていた。
    for (let i = 0; i < 11; i++) {
      boats.push({
        x: 187 + rng() * 12, z: -17 + i * 6.6 + (rng() - 0.5) * 5.0,
        rot: (rng() - 0.5) * 1.8 + Math.PI / 2, s: 0.78 + rng() * 0.56, seed: rng(),
      });
    }
    // 舟が全部 岸壁から 9〜26m 沖に浮いていて、誰も繋いでいない。
    // 岸壁に平行に舫った 5 隻を足す — 「使われている港」に見える最小の条件。
    //
    // **岸壁の縁は x≒172 ではない。** 真上からのレイで実測すると、
    // x 174〜183 は舗装・縁石・桟橋で、水は **x 184 から**(z −20〜24 で一定)。
    // x 176.4〜177.8 に置いた 5 隻は **舗装の 1.0m 下に埋まり、マストだけが
    // 道に突き出た棒の列**になっていた(ユーザー報告)。舷が縁の 1.3m 沖に来る位置へ。
    for (let i = 0; i < 5; i++) {
      boats.push({
        x: 185.2 + rng() * 0.8, z: -14 + i * 6.2,
        rot: Math.PI / 2 + (rng() - 0.5) * 0.25, s: 0.72 + rng() * 0.34, seed: rng(),
      });
    }
    // 純白 + 低 roughness はトーンマップ後に必ず飛んで自己発光に見える
    // color 未指定はアルベド 1.0 = 新雪より白い。白ゲルコートでも 0.72 が上限。
    const boatMat = new THREE.MeshStandardMaterial({ color: 0xb9b3a6, roughness: 0.62, envMapIntensity: 0.55 });
    // 港の舟が静止しているのは、街のどの静止よりも嘘に見える。
    // 頂点シェーダで揺らす(行列も draw call も増えない)。
    boatMat.onBeforeCompile = (sh) => {
      sh.uniforms.uBT = monumentTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uBT; attribute float aBPh;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float bt = uBT * 0.62 + aBPh * 6.28318;
          float roll = sin(bt) * 0.034 + sin(bt * 1.7 + 2.1) * 0.012;
          float ptc = sin(bt * 0.73 + 1.3) * 0.017;
          transformed.y += sin(bt * 0.91) * 0.055;
          float cr = cos(roll), sr = sin(roll);
          transformed.xy = mat2(cr, -sr, sr, cr) * transformed.xy;
          float cp = cos(ptc), sp2 = sin(ptc);
          transformed.zy = mat2(cp, -sp2, sp2, cp) * transformed.zy;`);
    };
    boatMat.customProgramCacheKey = () => 'boatbob';
    const boatMesh = new THREE.InstancedMesh(boatGeo, boatMat, boats.length);
    boatGeo.setAttribute('aBPh', new THREE.InstancedBufferAttribute(
      new Float32Array(boats.map(b => b.seed)), 1));
    const dummy = new THREE.Object3D();
    const c = new THREE.Color();
    boats.forEach((b, i) => {
      dummy.position.set(b.x, 0.05, b.z);
      dummy.rotation.set(0, b.rot, 0);
      dummy.scale.setScalar(b.s);
      dummy.updateMatrix();
      boatMesh.setMatrixAt(i, dummy.matrix);
      if (b.seed < 0.5) c.setHSL(0.09, 0.07, 0.56, THREE.SRGBColorSpace);        // 生成りの白(飛ばさない)
      else if (b.seed < 0.75) c.setHSL(0.58, 0.35, 0.34, THREE.SRGBColorSpace);
      else c.setHSL(0.06, 0.43, 0.36, THREE.SRGBColorSpace);
      boatMesh.setColorAt(i, c);
    });
    boatMesh.castShadow = true;
    group.add(tagMesh(boatMesh, 'surround.boat', { solid: true, floating: true }));
  }

  // ---- 岸壁の係船柱(石のボラード)— 腰の高さの物が1つあれば縮尺が決まる
  {
    const quay = plan.streets.find(s2 => s2.id === 'quay');
    if (quay) {
      const bolGeo = (() => {
        const b = new THREE.CylinderGeometry(0.15, 0.19, 0.52, 10);
        b.translate(0, 0.26, 0);
        const cap = new THREE.SphereGeometry(0.155, 10, 6);
        cap.scale(1, 0.62, 1); cap.translate(0, 0.52, 0);
        return mergeSimple([b, cap]);
      })();
      const bolMat = new THREE.MeshStandardMaterial({ color: 0xa9a08e, roughness: 0.78 });
      const items = [];
      const [x0, z0] = quay.pts[0], [x1, z1] = quay.pts[quay.pts.length - 1];
      const L = Math.hypot(x1 - x0, z1 - z0);
      for (let d = 3; d < L - 2; d += 8.5) {
        const t = d / L;
        items.push([lerp(x0, x1, t) + quay.w / 2 - 0.7, lerp(z0, z1, t)]);
      }
      const bol = new THREE.InstancedMesh(bolGeo, bolMat, items.length);
      const dm = new THREE.Object3D();
      items.forEach((p2, i) => {
        dm.position.set(p2[0], 1.7, p2[1]);
        dm.rotation.set(0, i * 1.7, 0);
        dm.updateMatrix();
        bol.setMatrixAt(i, dm.matrix);
      });
      bol.castShadow = true; bol.receiveShadow = true;
      group.add(tagMesh(bol, 'surround.bollard', { solid: true, masonry: true, groundContact: true }));
    }
  }

  // ---- ピレの橋(3連アーチ)。壕を渡る石橋。これが無いと、門は
  // 「地面に開いた穴」にしか見えない。
  {
    const P = [], N = [], U = [], I = [];
    const q4 = (a, b, c, d) => {
      const i0 = P.length / 3;
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      for (const v of [a, b, c, d]) P.push(v[0], v[1], v[2]);
      for (let k = 0; k < 4; k++) N.push(nx / nl, ny / nl, nz / nl);
      U.push(0, 0, 1, 0, 1, 1, 0, 1);
      I.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
    };
    const z0b = -0.6, z1b = 5.0;                 // 橋の幅 5.6m(欄干込み)
    const yD = 2.72;                              // 桁下端(デッキ 2.8 の少し下)
    const spans = [[-176.5, -170.9], [-170.1, -164.9], [-164.1, -159.4]];
    const rises = [2.15, 2.0, 1.75];
    for (let b = 0; b < spans.length; b++) {
      const [sa, sb] = spans[b], R = (sb - sa) / 2, cx = (sa + sb) / 2;
      const y0 = yD - rises[b];                   // 迫元
      const NA = 12;
      for (const zz of [z0b, z1b]) {
        for (let k = 0; k < NA; k++) {
          const a0 = Math.PI * (k / NA), a1 = Math.PI * ((k + 1) / NA);
          const xa = cx + Math.cos(a0) * R, xb = cx + Math.cos(a1) * R;
          const ya = y0 + Math.sin(a0) * rises[b], yb = y0 + Math.sin(a1) * rises[b];
          const xa2 = cx + Math.cos(a0) * (R + 0.42), xb2 = cx + Math.cos(a1) * (R + 0.42);
          const ya2 = y0 + Math.sin(a0) * (rises[b] + 0.42), yb2 = y0 + Math.sin(a1) * (rises[b] + 0.42);
          q4([xa, ya, zz], [xb, yb, zz], [xb2, yb2, zz], [xa2, ya2, zz]);   // 環石(妻面)
        }
      }
      for (let k = 0; k < NA; k++) {              // 迫の内輪
        const a0 = Math.PI * (k / NA), a1 = Math.PI * ((k + 1) / NA);
        const xa = cx + Math.cos(a0) * R, xb = cx + Math.cos(a1) * R;
        const ya = y0 + Math.sin(a0) * rises[b], yb = y0 + Math.sin(a1) * rises[b];
        q4([xa, ya, z0b], [xb, yb, z0b], [xb, yb, z1b], [xa, ya, z1b]);
      }
      // 橋脚(アーチの間)と迫元下の壁
      for (const zz of [z0b, z1b]) {
        q4([sa, y0, zz], [sa, y0 - 3.2, zz], [sb, y0 - 3.2, zz], [sb, y0, zz]);
      }
      // 橋脚の小口と底。両側に板を 2 枚立てただけでは、端から見たときに
      // 石に厚みが無く「壁紙を渡した橋」に見える。
      q4([sa, y0, z0b], [sa, y0, z1b], [sa, y0 - 3.2, z1b], [sa, y0 - 3.2, z0b]);
      q4([sb, y0, z1b], [sb, y0, z0b], [sb, y0 - 3.2, z0b], [sb, y0 - 3.2, z1b]);
      q4([sa, y0 - 3.2, z0b], [sa, y0 - 3.2, z1b], [sb, y0 - 3.2, z1b], [sb, y0 - 3.2, z0b]);
    }
    // 橋脚(壕の底まで)。側面 4 枚だけを立てていたので、天も地も無い
    // 「板を貼り合わせた空き箱」だった。西端の橋脚(-177.6)はデッキ(-176)より
    // 外に出ているので、上が開いたまま空に向いて、まさに空箱に見えていた。
    // 天と地を張って閉じた石にする。
    for (const px of [-177.6, -170.5, -164.5, -158.8]) {
      for (const zz of [z0b, z1b]) {
        q4([px - 0.8, -0.8, zz], [px + 0.8, -0.8, zz], [px + 0.8, yD, zz], [px - 0.8, yD, zz]);
      }
      q4([px - 0.8, -0.8, z0b], [px - 0.8, yD, z0b], [px - 0.8, yD, z1b], [px - 0.8, -0.8, z1b]);
      q4([px + 0.8, -0.8, z1b], [px + 0.8, yD, z1b], [px + 0.8, yD, z0b], [px + 0.8, -0.8, z0b]);
      q4([px - 0.8, yD, z0b], [px + 0.8, yD, z0b], [px + 0.8, yD, z1b], [px - 0.8, yD, z1b]);      // 天
      q4([px - 0.8, -0.8, z1b], [px + 0.8, -0.8, z1b], [px + 0.8, -0.8, z0b], [px - 0.8, -0.8, z0b]); // 地
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      map: tex.fortStone.map, normalMap: tex.fortStone.normalMap,
      color: 0xa8a08e, roughness: 0.84, side: THREE.DoubleSide, envMapIntensity: 0.45,
    }));
    m.castShadow = true; m.receiveShadow = true;
    group.add(tagMesh(m, 'surround.pileBridge', { solid: true, masonry: true }));
  }

  // ---- 旧港の造作: 見切り石・係船環・アルセナル(中世の造船所)の三連アーチ
  {
    const quay = plan.streets.find(s2 => s2.id === 'quay');
    if (quay) {
      // 岸壁は折れ線 (169,-46)→(172,-12)→(174,16)→(174,50)。始点と終点を結ぶ
      // 直線で置くと、折れの所で最大 1.8m 内陸にずれ、見切り石が舗石の真ん中に
      // 破線状に浮く。必ず区間ごとに、その区間の法線で外へ出すこと。
      const segs = [];
      let total = 0;
      for (let i = 1; i < quay.pts.length; i++) {
        const [ax, az] = quay.pts[i - 1], [bx, bz] = quay.pts[i];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.01) continue;
        const dx = (bx - ax) / len, dz = (bz - az) / len;
        let nx = dz, nz = -dx;                       // 海側(+x)へ
        if (nx < 0) { nx = -nx; nz = -nz; }
        segs.push({ ax, az, dx, dz, nx, nz, len, s0: total, yaw: Math.atan2(dx, dz) });
        total += len;
      }
      const at = (s) => {
        const sg = segs.find(q => s <= q.s0 + q.len) || segs[segs.length - 1];
        const t = Math.max(0, Math.min(s - sg.s0, sg.len));
        return { x: sg.ax + sg.dx * t, z: sg.az + sg.dz * t, nx: sg.nx, nz: sg.nz, yaw: sg.yaw };
      };
      const EDGE = quay.w / 2;
      // 見切り石(天端の縁に一段)。板が水に突き刺さっている岸壁は無い。
      const KL = 2.2;
      const kerbGeo = new THREE.BoxGeometry(0.52, 0.20, 1);
      const kerbMat = new THREE.MeshStandardMaterial({ color: 0xbdb3a0, roughness: 0.72, envMapIntensity: 0.6 });
      const nK = Math.floor(total / KL);
      const kerb = new THREE.InstancedMesh(kerbGeo, kerbMat, nK);
      const dm2 = new THREE.Object3D();
      for (let i = 0; i < nK; i++) {
        const p = at((i + 0.5) * KL);
        dm2.position.set(p.x + p.nx * (EDGE - 0.26), 1.70 + 0.02, p.z + p.nz * (EDGE - 0.26));
        dm2.rotation.set(0, p.yaw, 0);
        dm2.scale.set(1, 1, KL + 0.04);
        dm2.updateMatrix();
        kerb.setMatrixAt(i, dm2.matrix);
      }
      kerb.castShadow = true; kerb.receiveShadow = true;
      group.add(tagMesh(kerb, 'surround.quayKerb', { solid: true, masonry: true, groundContact: true }));
      // 係船環(鋳鉄・5.5m ピッチ・天端下 0.35m。岸壁の立ち上がりに打ってある)
      const ringGeo = new THREE.TorusGeometry(0.11, 0.022, 6, 12);
      const ringMat = new THREE.MeshStandardMaterial({ color: 0x3a352e, roughness: 0.55, metalness: 0.7 });
      const nR = Math.floor(total / 5.5);
      const rings = new THREE.InstancedMesh(ringGeo, ringMat, nR);
      for (let i = 0; i < nR; i++) {
        const p = at((i + 0.5) * 5.5);
        dm2.position.set(p.x + p.nx * (EDGE + 0.03), 1.70 - 0.34, p.z + p.nz * (EDGE + 0.03));
        dm2.rotation.set(0.35, p.yaw + Math.PI / 2, 0);
        dm2.scale.setScalar(1);
        dm2.updateMatrix();
        rings.setMatrixAt(i, dm2.matrix);
      }
      group.add(tagMesh(rings, 'surround.mooringRing', { solid: true, small: true }));
    }
    // アルセナル — 中世の造船所。港に正対して三連の大アーチが開く。
    // 壁面と同一平面に置くと、壁の外面のほうが手前に来て「輪郭線だけのアーチ」
    // になり、しかも壁と共平面なので影のアクネで縁が毛羽立つ。
    // 必ず壁体より前へ「量塊」として出し、開口の奥行きで影を作らせる。
    {
      const P = [], N = [], U = [], I = [], C = [];
      const um = 1 / 4.2;                       // fortStone.coverM
      // 面の向きは ref(外向きの想定方向)で自動補正する。26 枚の四角形の
      // 巻き方を手で合わせようとすると必ずどこかが裏返り、そこだけ黒く沈む。
      // UV は実寸(1 クアッド 1 タイルだと 26m の立面に石が 1 個しか出ない)。
      const quadA = (a, b, c, d, tint = 1, ref = null) => {
        let ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        let vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (ref && nx * ref[0] + ny * ref[1] + nz * ref[2] < 0) {
          const t2 = b; b = d; d = t2;
          ux = b[0] - a[0]; uy = b[1] - a[1]; uz = b[2] - a[2];
          vx = d[0] - a[0]; vy = d[1] - a[1]; vz = d[2] - a[2];
          nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
        }
        const nl = Math.hypot(nx, ny, nz) || 1;
        const uL = Math.hypot(ux, uy, uz) * um, vL = Math.hypot(vx, vy, vz) * um;
        const i0 = P.length / 3;
        for (const v of [a, b, c, d]) P.push(v[0], v[1], v[2]);
        for (let k = 0; k < 4; k++) { N.push(nx / nl, ny / nl, nz / nl); C.push(tint, tint, tint); }
        U.push(0, 0, uL, 0, uL, vL, 0, vL);
        I.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
      };
      // 港側の壁は (166,-6)→(170,38) の一直線。局所座標 s(壁沿い)/o(外向き)。
      const nwO = nearestOnPolyline(plan.wallPts, 168, 5);
      const nwT = nearestOnPolyline(plan.wallPts, 168, 25);
      let tx = nwT.x - nwO.x, tz = nwT.z - nwO.z;
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      let nx0 = tz, nz0 = -tx;
      if (nx0 < 0) { nx0 = -nx0; nz0 = -nz0; }  // 港(+x)側へ
      const OX = nwO.x, OZ = nwO.z;
      const p3 = (s, o, y) => [OX + tx * s + nx0 * o, y, OZ + tz * s + nz0 * o];
      const OUTN = [nx0, 0, nz0], UPN = [0, 1, 0], DNN = [0, -1, 0];
      const TN = [tx, 0, tz], NTN = [-tx, 0, -tz];
      // 迫の外向き(半径方向)。ヴォールトはその逆。
      const rad = (a) => [Math.cos(a) * tx, Math.sin(a), Math.cos(a) * tz];
      const nrad = (a) => [-Math.cos(a) * tx, -Math.sin(a), -Math.cos(a) * tz];

      const HW = 3.10, RG = 0.40, PITCH = 8.6;
      const yQ = 1.70, SPRY = yQ + 3.20, CROWN = SPRY + HW;
      // 城壁の外面は「半厚 2.0」ではない。裾に BAT=0.95 の勾配(scarp)があり、
      // 岸壁の高さでは o=2.74 まで張り出す。さらに y≈5.9 に胴蛇腹が o=2.22 で出る。
      // 壁龕の奥をそれより内側に置くと、壁の裾と胴蛇腹が壁龕を貫いて生えてくる。
      const RB = 2.02;                          // 天端側の壁面(躯体の背)
      const BACK = 2.85;                        // 壁龕の奥。裾勾配の先端より外
      const FR = BACK + 2.00;                   // 立面。ここまで量塊が出る
      const FB = FR + 0.14;                     // 環石の面
      const yTop = CROWN + 1.15, yCor = yTop + 0.34, yCap = yCor + 0.16;
      const BAYS = [0, PITCH, PITCH * 2];
      const S0 = BAYS[0] - HW - 2.2, S1 = BAYS[2] + HW + 2.2;
      const NA = 16;
      const PIERS = [[S0, BAYS[0] - HW], [BAYS[0] + HW, BAYS[1] - HW],
        [BAYS[1] + HW, BAYS[2] - HW], [BAYS[2] + HW, S1]];

      for (const [sa, sb] of PIERS) {
        // 立面(柱)。足元 1.3m は雨と潮の跳ね返りで黒ずむ。実測では
        // 足元 V74% / 高さ 2.5m で V78% — 差 4 ポイントは AO の分でしかなく、
        // 「接地の汚れが無い新品の石」に見えていた。柱の面を 2 枚に割って
        // 下だけ沈める(汚れ帯のデカールはここに届かない — 家にしか無い)。
        // quadA の tint は面ごとに 1 値なので、帯を 3 枚に割って勾配にする。
        // 1 枚で 0.72 を当てると、高さ 1.3m に横一線の段差が出る。
        const GR = [[0.00, 0.42, 0.66], [0.42, 0.86, 0.82], [0.86, 1.55, 0.93]];
        for (const [d0, d1, tn] of GR) {
          quadA(p3(sa, FR, yQ + d0), p3(sb, FR, yQ + d0),
            p3(sb, FR, yQ + d1), p3(sa, FR, yQ + d1), tn, OUTN);
        }
        quadA(p3(sa, FR, yQ + 1.55), p3(sb, FR, yQ + 1.55), p3(sb, FR, yTop), p3(sa, FR, yTop), 1, OUTN);
        // 迫元の帯(インポスト)— 水平線が三連アーチを一つの建物にまとめる
        quadA(p3(sa, FR, SPRY - 0.26), p3(sb, FR, SPRY - 0.26),
          p3(sb, FR + 0.13, SPRY - 0.26), p3(sa, FR + 0.13, SPRY - 0.26), 0.78, DNN);
        quadA(p3(sa, FR + 0.13, SPRY - 0.26), p3(sb, FR + 0.13, SPRY - 0.26),
          p3(sb, FR + 0.13, SPRY), p3(sa, FR + 0.13, SPRY), 1.05, OUTN);
        quadA(p3(sa, FR + 0.13, SPRY), p3(sb, FR + 0.13, SPRY),
          p3(sb, FR, SPRY), p3(sa, FR, SPRY), 1.10, UPN);
        // 巾木 — 建物が舗石から生えている感じを作る
        quadA(p3(sa, FR + 0.11, yQ), p3(sb, FR + 0.11, yQ),
          p3(sb, FR + 0.11, yQ + 0.46), p3(sa, FR + 0.11, yQ + 0.46), 0.63, OUTN);
        quadA(p3(sa, FR + 0.11, yQ + 0.46), p3(sb, FR + 0.11, yQ + 0.46),
          p3(sb, FR, yQ + 0.46), p3(sa, FR, yQ + 0.46), 1.08, UPN);
      }

      for (const cs of BAYS) {
        for (let k = 0; k < NA; k++) {
          const a0 = Math.PI * (k / NA), a1 = Math.PI * ((k + 1) / NA);
          const am = (a0 + a1) / 2;
          const s0 = cs + Math.cos(a0) * HW, s1 = cs + Math.cos(a1) * HW;
          const y0 = SPRY + Math.sin(a0) * HW, y1 = SPRY + Math.sin(a1) * HW;
          const s0b = cs + Math.cos(a0) * (HW + RG), s1b = cs + Math.cos(a1) * (HW + RG);
          const y0b = SPRY + Math.sin(a0) * (HW + RG), y1b = SPRY + Math.sin(a1) * (HW + RG);
          // 迫の内輪(トンネル・ヴォールト)— 環石の面まで通す
          quadA(p3(s0, FB, y0), p3(s1, FB, y1), p3(s1, BACK, y1), p3(s0, BACK, y0), 0.70, nrad(am));
          // 環石の見付(立面より 0.14 出る)— 逆光でこの陰影だけがアーチを描く
          quadA(p3(s0, FB, y0), p3(s1, FB, y1), p3(s1b, FB, y1b), p3(s0b, FB, y0b), 1.05, OUTN);
          // 環石の外周(小口)
          quadA(p3(s0b, FB, y0b), p3(s1b, FB, y1b), p3(s1b, FR, y1b), p3(s0b, FR, y0b), 0.86, rad(am));
          // 迫上の立面(スパンドレル)
          quadA(p3(s0b, FR, y0b), p3(s1b, FR, y1b), p3(s1b, FR, yTop), p3(s0b, FR, yTop), 1, OUTN);
        }
        // 開口の側面(迫元まで)
        for (const sg of [-1, 1]) {
          const s = cs + sg * HW, sb = cs + sg * (HW + RG);
          const inw = sg > 0 ? NTN : TN;        // 開口の内側を向く
          quadA(p3(s, FB, yQ), p3(s, FB, SPRY), p3(s, BACK, SPRY), p3(s, BACK, yQ), 0.72, inw);
          quadA(p3(s, FB, yQ), p3(s, FB, SPRY), p3(sb, FB, SPRY), p3(sb, FB, yQ), 1.05, OUTN);
          quadA(p3(sb, FB, yQ), p3(sb, FB, SPRY), p3(sb, FR, SPRY), p3(sb, FR, yQ), 0.86, sg > 0 ? TN : NTN);
        }
        // 奥の壁(造船所の中)— 壁体の外面より 0.02 手前。暗がりが奥行きを作る。
        quadA(p3(cs - HW, BACK - 0.02, yQ), p3(cs + HW, BACK - 0.02, yQ),
          p3(cs + HW, BACK - 0.02, CROWN), p3(cs - HW, BACK - 0.02, CROWN), 0.42, OUTN);
      }
      // 軒蛇腹と陸屋根
      quadA(p3(S0, FR, yTop), p3(S1, FR, yTop),
        p3(S1, FR + 0.36, yTop), p3(S0, FR + 0.36, yTop), 0.56, DNN);
      quadA(p3(S0, FR + 0.36, yTop), p3(S1, FR + 0.36, yTop),
        p3(S1, FR + 0.36, yCor), p3(S0, FR + 0.36, yCor), 1.04, OUTN);
      quadA(p3(S0, FR + 0.36, yCor), p3(S1, FR + 0.36, yCor),
        p3(S1, FR, yCap), p3(S0, FR, yCap), 1.12, UPN);
      quadA(p3(S0, FR, yCap), p3(S1, FR, yCap),
        p3(S1, RB, yCap), p3(S0, RB, yCap), 1.00, UPN);
      // 妻(両端)
      for (const [s, sg] of [[S0, -1], [S1, 1]]) {
        quadA(p3(s, RB, yQ), p3(s, FR + 0.36, yQ),
          p3(s, FR + 0.36, yCap), p3(s, RB, yCap), 0.94, sg > 0 ? TN : NTN);
      }
      // 衝突 — 柱だけを塞ぐ。三つのアーチの下は「入れる日陰」になる。
      for (const [sa, sb] of PIERS) {
        const q0 = p3(sa, RB, 0), q1 = p3(sb, FR + 0.36, 0);
        plan.extraColliders.push({
          x0: Math.min(q0[0], q1[0]), x1: Math.max(q0[0], q1[0]),
          z0: Math.min(q0[2], q1[2]), z1: Math.max(q0[2], q1[2]),
          y0: yQ - 2, y1: yCap,
        });
      }

      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
      g.setIndex(I);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
        map: tex.fortStone.map, normalMap: tex.fortStone.normalMap, vertexColors: true,
        color: 0xb8b09d, roughness: 0.86, envMapIntensity: 0.5,
      }));
      m.castShadow = true; m.receiveShadow = true;
      group.add(tagMesh(m, 'surround.arsenal', { solid: true, masonry: true, groundContact: true }));
    }
  }

  // ---- スルジ山頂の十字架と帝国要塞(遠景のしるし)
  // 高さを手置きの定数にしていたので、実際の稜線(y 360〜375)に対して
  // 十字架も要塞も 20〜25m 地中に埋まっていて、一度も見えていなかった。
  // farHeight から座らせ、裾を長く伸ばして格子の補間ずれを吸収する。
  {
    // 遠景地形は 42m 格子の補間なので、点の値ではなく近傍の最大を取る。
    const seat = (x, z) => {
      let y = -1e9;
      for (let dx = -30; dx <= 30; dx += 15) for (let dz = -30; dz <= 30; dz += 15) {
        y = Math.max(y, farHeight(x + dx, z + dz));
      }
      return y;
    };
    const stoneMat = new THREE.MeshStandardMaterial({
      map: tex.fortStone.map, normalMap: tex.fortStone.normalMap,
      color: 0xa79c88, roughness: 0.92, envMapIntensity: 0.45,
    });
    // 帝国要塞 — 1806年ナポレオン期。低い矩形の稜堡に四隅の塔。
    {
      const FX = -80, FZ = -1015, FY = seat(FX, FZ) - 6;
      const parts = [];
      const bx = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y + h / 2, z); return g; };
      parts.push(bx(52, 26, 24, 0, FY - 12, 0));            // 裾(地中まで伸ばす)
      parts.push(bx(48, 9.5, 20, 0, FY + 14, 0));           // 主郭
      parts.push(bx(50, 1.2, 22, 0, FY + 23.5, 0));         // 胸壁の笠石
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        parts.push(bx(9, 15, 9, sx * 21, FY + 12, sz * 8));  // 四隅の塔
        parts.push(bx(10.2, 1.2, 10.2, sx * 21, FY + 27, sz * 8));
      }
      const g = mergeSimple(parts);
      const m = new THREE.Mesh(g, stoneMat);
      m.position.set(FX, 0, FZ);
      group.add(tagMesh(m, 'surround.fortImperial', { solid: true, masonry: true, groundContact: true, backdrop: true }));
    }
    // 頂上の白い十字架(1935年・内戦後の再建)。段のある台座に立つ。
    {
      const CX = 20, CZ = -1042, CY = seat(CX, CZ) - 4;
      const crossMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.62, envMapIntensity: 0.45 });
      const parts = [];
      const bx = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y + h / 2, z); return g; };
      parts.push(bx(14, 14, 14, 0, CY - 8, 0));             // 台座(地中まで)
      parts.push(bx(9, 1.6, 9, 0, CY + 6, 0));
      parts.push(bx(6.4, 1.4, 6.4, 0, CY + 7.6, 0));
      parts.push(bx(2.4, 26, 2.4, 0, CY + 9, 0));           // 縦木
      parts.push(bx(11, 2.4, 2.0, 0, CY + 26, 0));          // 横木(上から 1/3)
      const m = new THREE.Mesh(mergeSimple(parts), crossMat);
      m.position.set(CX, 0, CZ);
      m.castShadow = false;
      group.add(tagMesh(m, 'surround.srdjCross', { solid: true, backdrop: true }));
    }
  }

  return { group, counts: { pines: treeCount } };
}

function mergeSimple(geos) {
  const list = geos.map(g => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const P = new Float32Array(total * 3), N = new Float32Array(total * 3), U = new Float32Array(total * 2);
  const C = new Float32Array(total * 3);
  let o = 0, hasC = false;
  for (const g of list) {
    P.set(g.attributes.position.array, o * 3);
    N.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) U.set(g.attributes.uv.array, o * 2);
    if (g.attributes.color) { C.set(g.attributes.color.array, o * 3); hasC = true; }
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  if (hasC) out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return out;
}
