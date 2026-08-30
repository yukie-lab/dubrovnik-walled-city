// ============================================================================
// buildings.js — 家並み。
// ・家体(石の箱+妻壁)= 全戸マージで 1 ドローコール(頂点色で石の個体差)
// ・屋根 = InstancedMesh + シェーダ注入:
//     per-instance の基調色(新瓦/褪せ瓦/古瓦のパッチワーク)
//     瓦列ごとの色相ジッター / 補修の明るい継ぎ当て / 実寸 UV 補正
// ・窓枠・ガラス・鎧戸・扉・煙突・汚れ帯 = すべてインスタンス
// ============================================================================
import * as THREE from 'three';
import { mulberry32, hash2, clamp, lerp, smoothstep, nearestOnPolyline, pointInPoly, tagMesh } from './util.js';
import { rngFor } from './seed.js';
import { streetY , HOUSE_BASE_BURY } from './plan.js';
import { makeSkyVis, patchSkyVis, bakeSkyVis, urbanTint, bounceRad, groundRefY,
  patchSkyVisInstanced, bakeSkyVisInstanced } from './skyvis.js';

// 太陽入りの環境マップを割り当てる材質(鏡面だけ太陽を映す)。
// 拡散 IBL に太陽を入れると、影の中まで太陽が降って日向:日陰の比が潰れる。
export const specularEnvTargets = [];
export let sharedSkyVis = null;
export const getSharedSkyVis = () => sharedSkyVis;

// 石壁テクスチャの実寸(m)。tex 側を変えたら壁のUVも必ず追随させる。
let WALL_COVER = 3.2;

// ---- 家体ジオメトリ(マージ) --------------------------------------------
function pushFace(P, N, U, C, verts, normal, uvScale, tint, A, plas, S, skyFn) {
  // verts: 4点(反時計回り)。UV は実寸(m)。
  const i0 = P.length / 3;
  for (let k = 0; k < 4; k++) {
    P.push(...verts[k]);
    N.push(...normal);
    C.push(tint.r, tint.g, tint.b);
    if (A) A.push(plas);
    if (S) S.push(skyFn ? skyFn(verts[k][0], verts[k][2], verts[k][1], normal) : 1);
  }
  U.push(0, 0, uvScale[0], 0, uvScale[0], uvScale[1], 0, uvScale[1]);
  return [i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3];
}

function houseBody(P, N, U, C, I, h, tint, A, S, skyFn) {
  const pushFaceP = (v, n, u, t) => pushFace(P, N, U, C, v, n, u, t, A, h.plaster ? 1 : 0, S, skyFn);

  const x0 = h.x - h.w / 2, x1 = h.x + h.w / 2;
  const z0 = h.z - h.d / 2, z1 = h.z + h.d / 2;
  const y0 = h.yBase, y1 = h.eaves;
  const H = y1 - y0;
  const um = 1 / WALL_COVER;
  // ---- 閉じた箱を積む。
  // 以前は「4 面(上面は屋根が覆う・底面不要)」としていた。見えないから
  // 張らない、は板を立てているのと同じで、掠める角度・軒の下・帯の下端から
  // 中空が見える。実測では家体 26,638 三角のうち 26,260 稜線が境界(= 穴)
  // だった — つまりほぼ全ての面が、どの面とも繋がっていない一枚板。
  // 閉じた箱にすれば、余分な面は石の中に隠れて外からは何も増えない。
  // 巻きの約束: cross(b-a, d-a) が与えた法線と同じ向きになること。
  const boxP = (bx0, bx1, by0, by1, bz0, bz1, tt, uvS) => {
    const W2 = bx1 - bx0, D2 = bz1 - bz0, H2 = by1 - by0;
    const uv = uvS || [W2 * um, H2 * um];
    const uvD = uvS || [D2 * um, H2 * um];
    I.push(...pushFaceP([[bx0, by0, bz1], [bx1, by0, bz1], [bx1, by1, bz1], [bx0, by1, bz1]], [0, 0, 1], uv, tt));
    I.push(...pushFaceP([[bx1, by0, bz0], [bx0, by0, bz0], [bx0, by1, bz0], [bx1, by1, bz0]], [0, 0, -1], uv, tt));
    I.push(...pushFaceP([[bx1, by0, bz1], [bx1, by0, bz0], [bx1, by1, bz0], [bx1, by1, bz1]], [1, 0, 0], uvD, tt));
    I.push(...pushFaceP([[bx0, by0, bz0], [bx0, by0, bz1], [bx0, by1, bz1], [bx0, by1, bz0]], [-1, 0, 0], uvD, tt));
    I.push(...pushFaceP([[bx0, by1, bz1], [bx1, by1, bz1], [bx1, by1, bz0], [bx0, by1, bz0]], [0, 1, 0], [W2 * um, D2 * um], tt));
    I.push(...pushFaceP([[bx0, by0, bz0], [bx1, by0, bz0], [bx1, by0, bz1], [bx0, by0, bz1]], [0, -1, 0], [W2 * um, D2 * um], tt));
  };
  boxP(x0, x1, y0, y1, z0, z1, tint);
  // 妻壁(棟は東西 → 三角は東西の面)
  const ridgeY = y1 + h.roofH, zm = (z0 + z1) / 2;
  // 立面に走る水平の帯。実測の近景平坦率は 59% — カメラから 3〜4m の壁の
  // 半分が無地だった。石の帯を出すと、その下に必ず影の線が一本入る。
  // 頂点を積むだけなのでドローコールは増えない。
  // 帯も箱。4 面だけだと、帯の下から覗いたときに壁との隙間が抜けて見える
  // (実物の蛇腹は必ず下端に水切りの面がある)。
  const band4 = (yLo, yHi, ex, tt) => {
    boxP(x0 - ex, x1 + ex, yLo, yHi, z0 - ex, z1 + ex, tt, [h.w * um, (yHi - yLo) * um]);
  };
  // 軒蛇腹(2 段の持ち出し — 段差そのものが影の線になる)
  if (!h.garden) {
    const pale = new THREE.Color(tint).multiplyScalar(1.04);
    band4(y1 - 0.36, y1 - 0.20, 0.10, tint);   // 下段(引っ込む)
    band4(y1 - 0.20, y1, 0.22, pale);          // 上段(出る)
    // 階間の水切り。実物の立面はここで必ず一本切れる。
    if (!h.monument && H > 6.5) {
      const fh2 = h.stradunFront ? 4.35 : 2.98;
      for (let fl = 1; fl * fh2 + 1.1 < H - 1.6; fl++) {
        const yb = y0 + 0.5 + fl * fh2;
        band4(yb, yb + 0.11, 0.065, tint);
      }
    }
  }
  // 記念建築は民家と同じ文法では建たない。台座・付柱・三段コーニスが
  // 「格の違い」を作る。教会に鎧戸を付けないのと同じくらい根本的な差。
  if (h.monument) {
    const band = (ex, ey0, ey1, tt) => {
      boxP(x0 - ex, x1 + ex, ey0, ey1, z0 - ex, z1 + ex, tt, [(x1 - x0 + ex * 2) * um, (ey1 - ey0) * um]);
    };
    const warm = new THREE.Color(tint).multiplyScalar(1.05);
    band(0.07, y0, y0 + 0.75, warm);                       // 台座
    band(0.10, y1 - 0.38, y1 - 0.26, warm);                // 蛇腹 下段
    band(0.22, y1 - 0.26, y1 - 0.10, warm);                // 蛇腹 中段(最も影が出る)
    band(0.34, y1 - 0.10, y1 + 0.02, warm);                // 蛇腹 上段
    // 付柱(巨大オーダー)— ベイ境界に立てる。奇数ベイで中央に主軸ができる。
    const pil = (len, along, fx, fz, nx2, nz2) => {
      let n2 = Math.max(3, Math.round(len / 4.6)); if (n2 % 2 === 0) n2++;
      const pw = Math.min(0.72, (len / n2) * 0.28), dep = 0.24;
      for (let k = 0; k <= n2; k++) {
        const o2 = (k / n2 - 0.5) * (len - pw);
        const cx2 = along ? fx + o2 : fx, cz2 = along ? fz : fz + o2;
        const hx = along ? pw / 2 : dep / 2, hz = along ? dep / 2 : pw / 2;
        const bx0 = cx2 - hx + nx2 * dep / 2, bx1 = cx2 + hx + nx2 * dep / 2;
        const bz0 = cz2 - hz + nz2 * dep / 2, bz1 = cz2 + hz + nz2 * dep / 2;
        const py0 = y0 + 0.75, py1 = y1 - 0.38;
        boxP(bx0, bx1, py0, py1, bz0, bz1, warm, [0.5, (py1 - py0) * um]);
      }
    };
    pil(h.w, true, h.x, z1 + 0.02, 0, 1);
    pil(h.w, true, h.x, z0 - 0.02, 0, -1);
    pil(h.d, false, x1 + 0.02, h.z, 1, 0);
    pil(h.d, false, x0 - 0.02, h.z, -1, 0);

    // ---- 正面(frontN)にペディメントと記念階段。
    // 教会が民家と同じ「箱に窓」で終わっていると、街に主題が生まれない。
    if (h.frontN) {
      const [fnx, fnz] = h.frontN;
      const along = fnz !== 0;                       // 正面の長手が x 方向か
      const W = along ? h.w : h.d;
      // 柱廊がある面では、ペディメントはエンタブレチュアに直接乗る。
      // 間に無地の壁が 4m 挟まると、オーダーは構造ではなく装飾に落ちる。
      const pw = h.pedHalf ?? Math.min(W * 0.86, 16) / 2;   // ペディメント半幅
      // 教会の正面は屋根より高い「衝立」。軒で終わると、後ろの寄棟が主役になる。
      const attic = Math.max(0.7, h.roofH * 0.62);
      const yB = h.pedimentTop ?? (y1 + attic);
      const rise = pw * 0.44;                        // 勾配 tan ≒ 0.22
      const fx0 = along ? h.x : (fnx > 0 ? x1 : x0);
      const fz0 = along ? (fnz > 0 ? z1 : z0) : h.z;
      // 面座標 → ワールド(u = 面に沿う, v = 面法線方向の出)
      const W3 = (u, v, y) => (along ? [fx0 + u, y, fz0 + fnz * v] : [fx0 + fnx * v, y, fz0 + u]);
      // 巻きは必ず法線に合わせる。逆に巻いた面は背面カリングで丸ごと消える。
      const wind = (a, b, c, nn) => {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const gx = uy * vz - uz * vy, gy2 = uz * vx - ux * vz, gz = ux * vy - uy * vx;
        return (gx * nn[0] + gy2 * nn[1] + gz * nn[2]) >= 0;
      };
      const quadN = (q, nn, uv, tt) => {
        const ok = wind(q[0], q[1], q[2], nn);
        I.push(...pushFaceP(ok ? q : [q[3], q[2], q[1], q[0]], nn, uv, tt));
      };
      const tri = (a0, b0, c0, nn, tt) => {
        const ok = wind(a0, b0, c0, nn);
        const [a, b, c] = ok ? [a0, b0, c0] : [b0, a0, c0];
        const i0 = P.length / 3;
        P.push(...a, ...b, ...c);
        for (let k = 0; k < 3; k++) {
          N.push(...nn); C.push(tt.r, tt.g, tt.b);
          A.push(0); S.push(0.95);
        }
        U.push(0, 0, pw * 2 * um, 0, pw * um, rise * um);
        I.push(i0, i0 + 1, i0 + 2);
      };
      const pale = new THREE.Color(tint).multiplyScalar(1.1);
      // アティック(軒とペディメントの間の帯)— これが無いと衝立が屋根に埋まる
      for (const [v, nn] of [[0.34, [fnx, 0, fnz]], [0.34, [0, 1, 0]]]) {
        if (nn[1] === 1) continue;
        const q = [W3(-pw - 0.5, v, y1 - 0.30), W3(pw + 0.5, v, y1 - 0.30), W3(pw + 0.5, v, yB), W3(-pw - 0.5, v, yB)];
        const ok = (() => { const a = q[0], b = q[1], c = q[2];
          const gx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
          const gz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
          return gx * nn[0] + gz * nn[2] >= 0; })();
        I.push(...pushFaceP(ok ? q : [q[3], q[2], q[1], q[0]], nn, [(pw + 0.5) * 2 * um, (yB - y1 + 0.3) * um], pale));
      }
      // ティンパヌム。アティック帯の出は 0.34 なので、それより手前でないと裏に隠れる。
      for (const [v, nn] of [[0.46, [fnx, 0, fnz]], [0.02, [-fnx, 0, -fnz]]]) {
        tri(W3(-pw, v, yB), W3(pw, v, yB), W3(0, v, yB + rise), nn, pale);
      }
      // 斜辺の蛇腹(勾配に沿う板)+ 水平の蛇腹
      const NR = 8;
      for (let side = -1; side <= 1; side += 2) {
        for (let k = 0; k < NR; k++) {
          const t0 = k / NR, t1 = (k + 1) / NR;
          const u0 = side * pw * (1 - t0), u1 = side * pw * (1 - t1);
          const h0 = yB + rise * t0, h1 = yB + rise * t1;
          quadN([W3(u0, 0.58, h0), W3(u1, 0.58, h1), W3(u1, 0.58, h1 + 0.34), W3(u0, 0.58, h0 + 0.34)],
            [fnx, 0, fnz], [pw * um, 0.34 * um], pale);
          quadN([W3(u0, 0.02, h0 + 0.34), W3(u1, 0.02, h1 + 0.34), W3(u1, 0.58, h1 + 0.34), W3(u0, 0.58, h0 + 0.34)],
            [0, 1, 0], [pw * um, 0.4 * um], pale);
        }
      }
      // 記念階段(正面の中央 3 ベイぶん)
      if (h.steps) {
        const sw = Math.min(W * 0.5, 11) / 2;
        for (let k = 0; k < h.steps; k++) {
          const v0 = 0.1 + k * 0.38, v1 = v0 + 0.38;
          const yy = y0 + 0.75 - (k + 1) * 0.155;
          quadN([W3(-sw, v1, yy), W3(sw, v1, yy), W3(sw, v0, yy), W3(-sw, v0, yy)],
            [0, 1, 0], [sw * 2 * um, 0.38 * um], pale);
          quadN([W3(-sw, v1, yy - 0.155), W3(sw, v1, yy - 0.155), W3(sw, v1, yy), W3(-sw, v1, yy)],
            [fnx, 0, fnz], [sw * 2 * um, 0.155 * um], pale);
        }
      }
    }
  }

  const xm = (x0 + x1) / 2;
  if (h.ridgeAxis === 'z') {
    // 棟が南北 → 妻壁は南北の面
    const gz = (z, nz) => {
      const i0 = P.length / 3;
      P.push(nz > 0 ? x1 : x0, y1, z, nz > 0 ? x0 : x1, y1, z, xm, ridgeY, z);
      N.push(0, 0, nz, 0, 0, nz, 0, 0, nz);
      for (let k = 0; k < 3; k++) { C.push(tint.r, tint.g, tint.b); A.push(h.plaster ? 1 : 0); S.push(1); }
      U.push(0, 0, h.w * um, 0, h.w * um / 2, h.roofH * um);
      I.push(i0, i0 + 1, i0 + 2);
    };
    gz(z1, 1); gz(z0, -1);
  } else {
    const gable = (x, nx) => {
      const i0 = P.length / 3;
      P.push(x, y1, nx > 0 ? z1 : z0, x, y1, nx > 0 ? z0 : z1, x, ridgeY, zm);
      N.push(nx, 0, 0, nx, 0, 0, nx, 0, 0);
      for (let k = 0; k < 3; k++) { C.push(tint.r, tint.g, tint.b); A.push(h.plaster ? 1 : 0); S.push(1); }
      U.push(0, 0, h.d * um, 0, h.d * um / 2, h.roofH * um);
      I.push(i0, i0 + 1, i0 + 2);
    };
    gable(x1, 1); gable(x0, -1);
  }
}

// ---- 屋根のシェーダ注入 ----------------------------------------------------
function patchRoofMaterial(mat, coverM) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRowH = { value: 0.15 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aSeed;
        varying float vSeed;
        varying vec2 vTileUv;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // 何百年ぶんの沈み。**棟がいちばん下がり、軒と妻の端では 0** になる形にすると、
        // 鼻隠し・軒天・妻の三角・棟瓦の取り合いを一切変えずに屋根だけがうねる。
        //   t = position.x ∈ [-0.5, 0.5](棟方向)、端で (1-4t²) = 0
        //   s = 1 - 2|position.z| (棟で 1、軒で 0)
        {
          float st = 1.0 - 4.0 * position.x * position.x;
          float ss = max(0.0, 1.0 - 2.0 * abs(position.z));
          float wob = sin(position.x * 11.0 + aSeed * 6.2832);
          transformed.y -= (0.040 + 0.022 * wob) * st * ss;
        }`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vSeed = aSeed;
        // 実寸 UV: インスタンスのスケールで補正(瓦が伸びない)
        vec2 instScale = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
        // **斜面は z 方向に D/2 しか張らないのに、uv.y は 0..1 を張る。**
        // そのため x は 1 単位 = 2m、y は 1 単位 = 1m の非等方(実測 2.000 / 1.000)。
        // 結果、瓦の働き長さが 181mm(実物 290〜330mm)に潰れ、さらに下の
        // シェーダの縞(0.36/0.185 を「m」のつもりで書いてある)が実寸 383/370mm
        // になって、アルベドの目と 2.06〜2.12 倍の **二重の格子** を作っていた。
        // 城壁から屋根海を見る 72〜149m の帯は、まさに偽の 370mm の縞しか
        // 見えない距離帯。y を半分にして等方に戻す。
        vTileUv = uv * vec2(instScale.x, instScale.y * 0.5) / ${coverM.toFixed(2)};
        #ifdef USE_NORMALMAP
          vNormalMapUv = vTileUv;   // 法線マップも実寸 UV で引く(生の uv だと色と 2〜3 倍ずれる)
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vSeed;
        varying vec2 vTileUv;
        float hashR(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <map_fragment>', `
        vec4 sampledDiffuseColor = texture2D(map, vTileUv);
        // 列ごとの焼きむら(瓦は一列ずつ違う窯から来た)
        // 一度に葺くのは 1 列ではなく 4〜6 段。窯むらはその単位で変わる。
        float row = floor(vTileUv.y / 0.375 + vSeed * 7.0);
        float rj = hashR(vec2(row, vSeed * 91.0));
        float rh = hashR(vec2(row * 3.7, vSeed * 17.0));
        // リニア空間の乗算スカラーは **色度を変えない**。窯むらとは本来
        // 「窯の中の位置で酸化/還元が変わった」ことで、赤紫〜黄土へ色相が回る。
        // チャンネルごとに違う量を掛けて、明度だけでなく色相も動かす。
        sampledDiffuseColor.rgb *= vec3(0.90 + rj * 0.18,
                                        0.87 + rj * 0.22 + (rh - 0.5) * 0.09,
                                        0.84 + rj * 0.26 + (rh - 0.5) * 0.20);
        // 瓦の谷の陰。屋根の海を上から見るとき、これが無いと赤い板になる。
        // 垂直な鼻隠し(小口)には谷影も稜も掛けない — 掛けると軒に黒帯が出る
        float faceUp = step(0.30, abs(vNormal.y));
        // 段の重なりの影。地図側でも引いていたので **同じ横線が二回** 出ていた。
        // 地図側を微かにしたぶん、こちらは据え置き。周期は 1 段 = 0.30m。
        float vv = fract(vTileUv.y / 0.15);
        sampledDiffuseColor.rgb *= mix(1.0, 0.70 + 0.30 * smoothstep(0.0, 0.32, vv), faceUp);
        // クパ・カナリツァは「幅の広い凹んだ溝瓦」と「幅の狭い高い丸瓦」の交互。
        // 対称な半正弦は同じ山が並ぶだけで、これはトタンの波板の断面。
        // 1 モジュール 180mm を 丸 76mm(0.42)+ 溝 104mm に割り、非対称にする。
        float uu = fract(vTileUv.x / 0.09);
        float crown = sin(clamp(uu / 0.42, 0.0, 1.0) * 3.14159);
        float chan = max(0.0, 1.0 - abs((uu - 0.71) / 0.29));
        float prof = uu < 0.42 ? (0.76 + 0.36 * crown) : (0.64 + 0.14 * chan);
        sampledDiffuseColor.rgb *= mix(1.0, prof, faceUp);
        // 縞は fract/sin なのでミップに落ちない。遠景でエイリアスになるので、
        // 画素あたりの UV の伸び(fwidth)で振幅を殺す。1 命令。
        float lodK = 1.0 - smoothstep(0.35, 1.1, length(fwidth(vTileUv)) / 0.09);
        sampledDiffuseColor.rgb = mix(texture2D(map, vTileUv).rgb, sampledDiffuseColor.rgb, lodK);
        // 補修の継ぎ当て(明るい新品の区画がまだらに)
        // 葺き替えの継ぎ当ては、瓦の列(0.185 × 0.36m)にスナップし、
        // 縁を段々にする。軸に平行な長方形は付箋にしか見えない。
        vec2 tile = vTileUv / vec2(0.09, 0.15);
        // 一度に葺く単位は百枚 = 約 3.5m 角。5×3 枚(0.45×0.45m)は付箋。
        vec2 cell = floor(tile / vec2(18.0, 12.0) + vSeed * 13.0);
        float pj = hashR(cell + vSeed * 7.7);
        float edge = hashR(floor(tile) + cell * 3.1);        // 瓦 1 枚単位で縁を崩す
        if (pj > 0.93 && edge > 0.25) sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, vec3(0.80, 0.44, 0.30), 0.38);
        else if (pj < 0.04 && edge > 0.25) sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, vec3(0.44, 0.36, 0.30), 0.30);
        diffuseColor *= sampledDiffuseColor;`);
  };
}

// ---- 開口部の配置 ----------------------------------------------------------
function facesOnStreet(plan, h) {
  // 4面それぞれの 0.9m 外の点が街路/広場に接するか
  const out = [];
  const test = (x, z, nx, nz, len, faceY) => {
    let best = null;
    for (const s of plan.streets) {
      const near = nearestOnPolyline(s.pts, x, z);
      if (near.d < s.w / 2 + 1.35) {
        const y = streetY(s, near.x, near.z);
        // 舗装の帯は幅 s.w + 0.9。帯の外なら、そこに「描かれた街路の面」は無い。
        // 帯の外を街路の高さで扱うと、巾木が地面から浮く/埋まる。
        const paved = near.d <= (s.w + 0.9) / 2 - 0.05;
        if (!best || near.d < best.d) best = { d: near.d, y, kind: s.kind, paved };
      }
    }
    for (const p of plan.PLAZAS) {
      if (x > p.x0 - 1 && x < p.x1 + 1 && z > p.z0 - 1 && z < p.z1 + 1) {
        if (!best || best.d > 0.5) best = { d: 0.4, y: p.y, kind: 'plaza', paved: true };
      }
    }
    // 街路に面していない面も、隣に建物が無ければ「光庭に面した壁」として
    // 少しだけ開口を持つ。上から見たとき、無地の白い箱が並ぶのを防ぐ。
    if (!best) best = { d: 3, y: null, kind: 'court', paved: false };
    // 面の 0.6m 外が別の家の体積の中なら、その面は「見えていない面」。
    // ここに窓枠や巾木を出すと、隣家の壁を突き抜けた石が宙に浮く。
    const px2 = x - nx * 0.3, pz2 = z - nz * 0.3;
    for (const o of plan.houses) {
      if (o === h) continue;
      if (px2 > o.x - o.w / 2 - 0.05 && px2 < o.x + o.w / 2 + 0.05
        && pz2 > o.z - o.d / 2 - 0.05 && pz2 < o.z + o.d / 2 + 0.05
        && faceY > o.yBase + 0.2 && faceY < o.eaves - 0.2) return;
    }
    // 街路に面さない面(中庭面)は best.y が null。ここを `h.yBase + 0.5` の
    // ような定数で代用すると、巾木・汚れ帯・縦樋・窓台がその面だけ
    // 「地面と無関係な高さ」に並ぶ(実測: 313 枚の巾木が最大 0.82m 浮くか、
    //  下に支持面が無かった)。高さは必ず地形関数から引く。
    // 「見えている地面」を見る。関数 outsideHeight は 3.2m 格子で描かれる面と
    // 最大 0.3m 食い違うので、そちらを使うと巾木が地面に埋まる/浮く。
    // 標本点は「巾木が立つ場所」— 面より 0.06m 外。0.35m 内側を測ると、
    // 斜面では面の前後で 0.3m 違う高さを拾う。
    const gy = best.y ?? plan.surfaceAt(x + nx * 0.06, z + nz * 0.06);
    out.push({ nx, nz, len, groundY: gy, kind: best.kind, paved: !!best.paved, x, z, faceY });
  };
  const fy = h.yBase + 2.2;   // 面の腰の高さ(ここが隣家の体積内なら埋まっている)
  test(h.x, h.z + h.d / 2 + 0.9, 0, 1, h.w, fy);
  test(h.x, h.z - h.d / 2 - 0.9, 0, -1, h.w, fy);
  test(h.x + h.w / 2 + 0.9, h.z, 1, 0, h.d, fy);
  test(h.x - h.w / 2 - 0.9, h.z, -1, 0, h.d, fy);
  return out;
}

// ---------------------------------------------------------------------------
export function makeBuildings(plan, tex) {
  WALL_COVER = tex.wallStone.coverM;
  const group = new THREE.Group();
  const rng = rngFor(0xca5a);

  // ===== 家体(マージ)
  const P = [], N = [], U = [], C = [], I = [], A = [], S = [];
  const tint = new THREE.Color();
  const skyAt0 = makeSkyVis(plan);
  sharedSkyVis = skyAt0;
  const skyAt = (x, z, y, nrm) => skyAt0(x, z, y, nrm[0], nrm[1], nrm[2]);
  for (const h of plan.houses) {
    // 街の3割は石灰モルタルの塗り壁。素の切石だけの街は存在しない。
    // (記念建築は必ず石。塗り壁の教会は無い)
    // ストラドゥン正面は例外なく素の切石。ここに漆喰を混ぜると、街で最も
    // 規律の効いた一列が崩れる。
    h.plaster = !h.monument && !h.garden && !h.stradunFront
      && hash2((h.x * 5) | 0, (h.z * 5 + 3) | 0) < 0.34;
    const t = h.seed;
    // **街全部が同じ石**でできていることが、この街の統一の正体。
    // tex.js は石ひとつの色相を ±0.3° に固定しているのに、家ごとの頂点色が
    // 22.1°〜43.6° に散らしてこの規約を破っていた(実測 一枚の絵の中で
    // 右のファサード 37.8° / アーケード 31.3° / 桃色の分岐 22.1° = 三つの石)。
    // 色相は 35.3°±2.2° に固定し、彩度の振れも 1/3 に詰める。
    // **明度の振れ(±0.095)は残す** — 街の情報はそこにある。
    if (h.plaster) tint.setHSL(0.098, 0.15 + t * 0.05, 0.775 + (t - 0.5) * 0.15, THREE.SRGBColorSpace);
    else if (t > 0.9) tint.setHSL(0.098, 0.19 + t * 0.04, 0.735 + (t - 0.9) * 0.85, THREE.SRGBColorSpace);
    else tint.setHSL(0.098 + (t - 0.5) * 0.012, 0.16 + t * 0.05, 0.742 + (t - 0.5) * 0.19, THREE.SRGBColorSpace);
    houseBody(P, N, U, C, I, h, tint, A, S, skyAt);
  }
  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  bodyGeo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  bodyGeo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  bodyGeo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  bodyGeo.setAttribute('aPlas', new THREE.Float32BufferAttribute(A, 1));
  bodyGeo.setAttribute('aSky', new THREE.Float32BufferAttribute(S, 1));
  bodyGeo.setIndex(I);
  const bodyMat = new THREE.MeshStandardMaterial({
    map: tex.wallStone.map, normalMap: tex.wallStone.normalMap,
    normalScale: new THREE.Vector2(1.7, 1.7),
    vertexColors: true, roughness: 0.82, metalness: 0,
    envMapIntensity: 0.60,   // 日陰の主光源は IBL。ここを絞ると影が黒紙になる
  });
  // 石と漆喰を 1 マテリアルで混ぜる(ドローコールは増やさない)。
  bodyMat.onBeforeCompile = (sh) => {
    sh.uniforms.uPlasMap = { value: tex.plaster.map };
    sh.uniforms.uPlasNrm = { value: tex.plaster.normalMap };
    sh.uniforms.uPlasScale = { value: tex.wallStone.coverM / tex.plaster.coverM };
    sh.uniforms.uUrban = urbanTint;
    sh.uniforms.uBounce = bounceRad;
    sh.uniforms.uGroundY = groundRefY;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n attribute float aPlas; attribute float aSky; varying float vPlas; varying float vSky; varying float vBnc; varying float vUp; uniform float uGroundY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vPlas = aPlas; vSky = aSky;\n vBnc = clamp(0.75 - normal.y * 0.35, 0.25, 1.0) * exp(-max(position.y - uGroundY, 0.0) / 2.4);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uPlasMap; uniform sampler2D uPlasNrm; uniform float uPlasScale;
        uniform vec3 uUrban; uniform vec3 uBounce;
        varying float vPlas; varying float vSky; varying float vBnc; varying float vUp;
        float wnHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wnNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(wnHash(i), wnHash(i + vec2(1,0)), f.x),
                     mix(wnHash(i + vec2(0,1)), wnHash(i + vec2(1,1)), f.x), f.y); }`)
      .replace('#include <aomap_fragment>', `
        // 天空率は「間接光の量」。直射には掛けない(掛けると影が二重になる)。
        reflectedLight.indirectDiffuse *= vSky * mix(uUrban, vec3(1.0), vSky);
        // 舗石からの照り返しは天空率と独立の加算項。これが無いと軒裏が黒くなる。
        reflectedLight.indirectDiffuse += diffuseColor.rgb * uBounce * vBnc * (0.30 + 0.70 * vSky);
        reflectedLight.indirectSpecular *= mix(0.55, 1.0, vSky) * mix(0.25, 1.0, 1.0);`)
      .replace('#include <map_fragment>', `
        // タイリングを消す(1): 低周波の UV ゆらぎ。
        // 明度の変調(下の mv1/mv2)はアルベドにしか効かず、目地の陰影を
        // 作っているのは法線マップ側なので、「同じ石の割りがまた出る」反復は
        // 残ったままだった(実測: 横方向の自己相関 r=0.33)。
        // サンプル座標そのものを 19m 周期・±0.35m で揺らすと、目地の格子が
        // ゆっくり歩いて 3.2m の拍が読めなくなる。石積みは実際に沈んで歪む。
        // 揺らぎの種に石壁テクスチャ自身を使っていたが、その g/b は 0.75±0.05
        // しか振れず、ほぼ一定のオフセット = ただの平行移動だった(実測 r 不変)。
        // 0〜1 を使い切る値ノイズで、周期 10.7m・振幅 ±0.48m の歪みを与える。
        // 単一の尺で歪ませると、その尺(10.7m)が新しい反復として測れてしまう。
        // 約分できない二層を重ねて、卓越する周期を作らない。
        vec2 wv = ((vec2(wnNoise(vMapUv * 0.21), wnNoise(vMapUv * 0.21 + 37.1)) - 0.5) * 0.62
                +  (vec2(wnNoise(vMapUv * 0.53 + 7.3), wnNoise(vMapUv * 0.53 + 61.7)) - 0.5) * 0.38) * 0.18;
        vec2 mUv = vMapUv + wv;
        vec4 sd = texture2D(map, mUv);
        if (vPlas > 0.5) sd = texture2D(uPlasMap, mUv * uPlasScale);
        // 一枚の壁に「二色目」を置く唯一の機構。ここが空回りしていた。
        // 変調源に石テクスチャ自身の .g を使っていたが、sRGB 復号後の実測は
        // **平均 0.4651 / SD 0.0837**。式は 0.5 中心を仮定しているので中心が
        // 0.035 ずれ、(a) 一度も明るくせず常に暗くするだけ、(b) 振幅は ±2.3%
        // = ΔL* 0.7 = **1 段の 1/14** しか出ていなかった。4m の石の端から端まで
        // 0.15 段 = 一筆で塗り終わる面。
        // 0〜1 を使い切る値ノイズの二層に差し替える(68m と 21m、約分できない)。
        float lf = wnNoise(vMapUv * 0.047 + 5.1) * 0.60 + wnNoise(vMapUv * 0.155 + 19.3) * 0.40;
        sd.rgb *= 1.0 + 0.36 * (lf - 0.5);
        // 第三層。上の二層は周期 68m と 21m で、**腕の届く壁が張る 3m では
        // どちらも直流になって消える**。第5パスが空で見つけたのと同じ故障
        // (支配周期 13° は視野 12〜18° の路地の帯では直流になる)。実測でも
        // 局所 SD 8px は日陰の三時刻で 0.53〜0.61 L* = 弁別閾未満で、
        // 直射のある正午だけ 2.03 — いまの肌理は法線マップ頼りで、
        // 「太陽が床を照らして跳ね返る時だけ」現れる光依存の肌理だった。
        // 路地の視野に入る 2.4m と 0.9m を足す。湿気も雨だれも縦に走るので、
        // 垂直の周期は水平の 1/3。
        float hf = wnNoise(vMapUv * vec2(0.42, 1.25) + 31.7) * 0.62
                 + wnNoise(vMapUv * vec2(1.10, 3.30) + 57.3) * 0.38;
        sd.rgb *= 1.0 + 0.22 * (hf - 0.5);
        // 上り湿気。実在の路地壁は下 1.2〜1.6m が必ず暗い — 目が歩く高さにある
        // 唯一の縦の階調。乾かない壁だけが湿るので、天空可視率で門を掛ける
        // (= 開けた広場やストラドゥンの正面には出ない。第2パスの石を守る)。
        float damp = smoothstep(1.65, 0.0, vUp) * smoothstep(0.38, 0.18, vSky) * (0.55 + 0.45 * hf);
        sd.rgb *= mix(vec3(1.0), vec3(0.60, 0.645, 0.60), damp * 0.55);
        // 雨に洗われた面は寒色へ、庇の下と風下は暖色へ。**色相は動かさず色温度だけ。**
        sd.rgb *= mix(vec3(1.020, 1.000, 0.955), vec3(0.975, 0.995, 1.030), lf);
        diffuseColor *= sd;`)
      .replace('#include <normal_fragment_maps>', `
        vec3 mapN = (vPlas > 0.5 ? texture2D(uPlasNrm, (vMapUv + wv) * uPlasScale) : texture2D(normalMap, vNormalMapUv + wv)).xyz * 2.0 - 1.0;
        // タイリングを消す(2): 法線にも約分できない第二層を重ねる。
        // 3.2m と 7.7m は約分できないので、合成の見かけの周期は 25m 近くなる。
        mapN.xy += (texture2D(normalMap, vNormalMapUv * 0.413 + vec2(0.37, 0.62)).xy - 0.5) * 0.45;
        mapN.xy *= normalScale;
        normal = normalize(tbn * mapN);`);
  };
  bodyMat.customProgramCacheKey = () => 'houseBodyPlaster';
  const bodies = new THREE.Mesh(bodyGeo, bodyMat);
  bodies.castShadow = true; bodies.receiveShadow = true;
  group.add(tagMesh(bodies, 'house.body', { solid: true, masonry: true, groundContact: true, merged: 'plan.houses' }));

  // ===== 屋根(インスタンス)— テラコッタの海
  const roofUnit = new THREE.BufferGeometry();
  {
    // 単位屋根: x∈[-0.5,0.5] 棟, z∈[-0.5,0.5], y∈[0,1]。軒の張り出しは スケール側で吸収。
    const p = [], n = [], u = [], idx = [];
    // **一斜面が四角一枚だった。平面は、定義上、うねれない。**
    // 手で伏せた瓦の屋根は波打ち、棟の線も軒の線もまっすぐではない。
    // 何百年ぶんの沈みを置く場所を作るために、棟方向 6 × 勾配方向 2 に割る。
    // 三角は 586 × +80 = 47k 増(全体 3.0M に対し 1.6%)、draw call は不変。
    const NS = 8, NT = 3;
    const slope = (sgn) => {
      const i0 = p.length / 3;
      for (let j = 0; j <= NT; j++) for (let k = 0; k <= NS; k++) {
        const t = -0.5 + k / NS, q = j / NT;            // q: 0 = 棟, 1 = 軒
        p.push(sgn > 0 ? t : -t, 1 - q, sgn * 0.5 * q);
        u.push(t + 0.5, 1 - q);   // 元の 4 頂点版と同じ向き(北斜面は x=+0.5 側が u=0)
      }
      for (let j = 0; j < NT; j++) for (let k = 0; k < NS; k++) {
        const a = i0 + j * (NS + 1) + k, b = a + 1, c = a + NS + 1, d = c + 1;
        idx.push(a, c, d, a, d, b);
      }
    };
    slope(1); slope(-1);
    // 単位形状の勾配は dy/dz = 1/0.5 = 2。法線は (0, 0.5, ±1) の正規化。
    // 0.55/0.84 は 33° 相当で、実勾配 17〜24° と 10〜16° ずれ、両斜面の N·L が
    // ほぼ同じになって屋根の海が平板になる(インスタンスの非一様スケールは
    // normalMatrix が補正するので、基準法線さえ正しければよい)。
    // **基準法線は斜面ごとに一つのまま。** 沈みから頂点法線を計算し直すと、
    // 南北二斜面の N·L 比 1.50(真昼の屋根の海に「折り目」を作っている唯一の物)が
    // 崩れる。沈みは position だけを動かす。
    const nrmS = [0, 0.4472, 0.8944], nrmN = [0, 0.4472, -0.8944];
    const nSlope = (NS + 1) * (NT + 1);
    for (let k = 0; k < nSlope; k++) n.push(...nrmS);
    for (let k = 0; k < nSlope; k++) n.push(...nrmN);
    // 軒先の小口(瓦の厚み)と軒天。ここに濃い陰が入るかどうかで、
    // 屋根が「載っている」か「紙が浮いている」かが決まる。
    const FA = 0.05;   // 単位高さでの鼻隠しの深さ(実寸 0.05〜0.09m。0.16 だと 0.30m の黒帯になる)
    const eave = (zs, nz) => {
      const i0 = p.length / 3;
      p.push(-0.5, 0, zs, 0.5, 0, zs, 0.5, -FA, zs, -0.5, -FA, zs);   // 鼻隠し(垂直)
      for (let k = 0; k < 4; k++) n.push(0, 0, nz);
      u.push(0, 0.12, 1, 0.12, 1, 0, 0, 0);
      // 裏面カリングは「法線の属性」ではなく「巻き」で決まる。同じ巻きで
      // 南北の軒を作っていたので、南の鼻隠しは面が家の中を向いて消え、
      // 軒先が「厚みゼロの紙」になっていた(実測 s09 で 11,549px)。
      if (nz > 0) idx.push(i0, i0 + 2, i0 + 1, i0, i0 + 3, i0 + 2);
      else idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
      const i1 = p.length / 3;
      // 単位屋根の座標なので、非一様スケールで実寸が建物の大きさに比例する。
      // 0.10 だと大聖堂(d=27)で軒天の奥行が 2.77m の黒帯になる。
      const zi = zs - nz * 0.024;
      p.push(-0.5, -FA, zs, 0.5, -FA, zs, 0.5, -FA, zi, -0.5, -FA, zi);  // 軒天(下向き)
      for (let k = 0; k < 4; k++) n.push(0, -1, 0);
      u.push(0, 0, 1, 0, 1, 0.06, 0, 0.06);
      // 軒天も同じ。北側は巻きが上を向いていた(下から見ると消える)。
      if (nz > 0) idx.push(i1, i1 + 2, i1 + 1, i1, i1 + 3, i1 + 2);
      else idx.push(i1, i1 + 1, i1 + 2, i1, i1 + 2, i1 + 3);
    };
    eave(0.5, 1); eave(-0.5, -1);
    // 妻側の小口(三角)と底。屋根は 2 枚の斜面と軒先だけの筒だったので、
    // 妻側から中が抜けて見え、下からは「浮いた紙」に見えた。
    const gableEnd = (xs, nx2) => {
      const i0 = p.length / 3;
      if (nx2 > 0) p.push(xs, 1, 0, xs, 0, 0.5, xs, 0, -0.5);
      else p.push(xs, 1, 0, xs, 0, -0.5, xs, 0, 0.5);
      for (let k = 0; k < 3; k++) n.push(nx2, 0, 0);
      u.push(0.5, 1, 1, 0, 0, 0);
      idx.push(i0, i0 + 1, i0 + 2);
    };
    gableEnd(0.5, 1); gableEnd(-0.5, -1);
    {
      const zi = 0.5 - 0.024, i0 = p.length / 3;
      p.push(-0.5, -FA, -zi, 0.5, -FA, -zi, 0.5, -FA, zi, -0.5, -FA, zi);
      for (let k = 0; k < 4; k++) n.push(0, -1, 0);
      u.push(0, 0, 1, 0, 1, 1, 0, 1);
      // 巻きは下向き(cross(b-a, d-a) が -Y)。逆に巻くと屋根の底が
      // 内向きになり、下から見て「板が浮いている」ままになる。
      idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
    }
    roofUnit.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    roofUnit.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    roofUnit.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
    roofUnit.setIndex(idx);
  }
  const roofMat = new THREE.MeshStandardMaterial({
    map: tex.roof.map, normalMap: tex.roof.normalMap,
    // 家の本体(buildings.js の bodyMat)は 0.60 で「日陰の主光源は IBL。
    // ここを絞ると影が黒紙になる」と書いてある。屋根だけ 0.40 だったので、
    // 太陽項がほぼゼロの夜に屋根が青い IBL を本体より 33% 少なく受け、
    // 石が青灰に落ちるなかで瓦だけが煉瓦色で残っていた(実測 夜の相対彩度
    // C/L が 正午 0.69 → 夜 1.33 と **倍近く増える**逆転)。
    // 釉なし多孔質の鏡面の弱さは roughness 0.82 が担当する量で、環境の重みではない。
    roughness: 0.82, metalness: 0, envMapIntensity: 0.62,   // 釉なし多孔質の素焼き
  });
  patchRoofMaterial(roofMat, tex.roof.coverM);
  const roofHouses = plan.houses.filter(h => !h.garden);
  const roofs = new THREE.InstancedMesh(roofUnit, roofMat, roofHouses.length);
  const seeds = new Float32Array(roofHouses.length);
  {
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    roofHouses.forEach((h, i) => {
      dummy.position.set(h.x, h.eaves, h.z);
      const zAx = h.ridgeAxis === 'z';
      dummy.scale.set((zAx ? h.d : h.w) + 0.62, h.roofH, (zAx ? h.w : h.d) + 0.70);
      dummy.rotation.set(0, zAx ? Math.PI / 2 : 0, 0);
      dummy.updateMatrix();
      roofs.setMatrixAt(i, dummy.matrix);
      // 基調のパッチワーク: 新しい鮮やかな瓦 / 中庸 / 褪せた古瓦
      const r = hash2((h.x * 3) | 0, (h.z * 3) | 0);
      // 実物のドゥブロヴニクの屋根は「一色の赤」ではなく、明度の幅が非常に広い
      // モザイク(新瓦の橙 〜 地衣類に覆われた灰褐色)。彩度を上げるより
      // 明度の幅を広げるほうが、写真の印象に近づく。
      // 四段が (明度, 彩度) の **完全に単調な一本の対角線** だった(実測 586 個の
      // r(L*,C*) = +0.769)。古い瓦は「暗く」なるだけで決して「淡く」ならず、
      // 「明るくて鈍い瓦」= 褪せた薔薇色が 586 軒中 **0 軒**。色相の幅も
      // 17.6°〜25.9° の 8.3° しかなく、画面の軒間σh° は 6.6°(= 一つの橙)。
      // 明度と彩度を独立に動かし、色相の幅を倍にする。
      // 構成比は史実に合わせる — 1991-92 年の砲撃で屋根の約 7 割が壊れ、
      // 90 年代に葺き替えられた。**新瓦が多数派で、古い屋根が点々と混じる。**
      let hueR, satR, litR;
      // 屋根は「一段暗く、一段強い色」。海に対する輝度比が 0.82 まで上がると、
      // 補色の主役が入れ替わって屋根が支える側になる(目標 0.65〜0.72)。
      if (r < 0.40) { hueR = 0.043; satR = 0.80; litR = 0.515; }        // 1992 年以後の新瓦 — 明るく濃い橙
      else if (r < 0.62) { hueR = 0.056; satR = 0.67; litR = 0.462; }   // 中庸
      else if (r < 0.88) { hueR = 0.072; satR = 0.52; litR = 0.482; }   // 褪せた薔薇 — **明るくて鈍い**
      else { hueR = 0.080; satR = 0.42; litR = 0.392; }                 // 地衣類・灰の煉瓦
      // offsetHSL は色空間引数を取れず、必ずワーキング空間(リニア)で働く。
      // 暗い瓦ほど揺らぎが 3 倍強く効き、彩度が二峰に割れる。sRGB のまま足す。
      const r2 = hash2((h.z * 7) | 0, (h.x * 11) | 0);
      // 色相と明度に **同じ h.seed** を使っていたので両者が完全相関し(実測 0.880)、
      // 「暗くて黄色い瓦」「明るくて赤い瓦」が原理的に存在しなかった。別の種にする。
      col.setHSL(hueR + (h.seed - 0.5) * 0.048, Math.max(0.04, satR - r2 * 0.055),
        litR + (r2 - 0.5) * 0.105, THREE.SRGBColorSpace);
      roofs.setColorAt(i, col);
      seeds[i] = h.seed;
    });
    roofUnit.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  }
  roofs.castShadow = true; roofs.receiveShadow = true;
  group.add(tagMesh(roofs, 'house.roof', { solid: true, tileOverlap: true }));

  // ===== 妻壁(火返し)— 屋根の海を家1軒(4.5〜6m)の粒に刻む石のフィン。
  // これが無いと軒線が10m以上つながり、屋根が「1枚の大きな面」に見える。
  {
    const P = [], N = [], U = [], C = [], IDX = [];
    // 単色 0xa9a08d(L*61 の新品の石灰岩)を捨て、家ごとの煤けた頂点色にする。
    // メッシュは 1 枚のままなので draw call は増えない。
    let finTint = [0.34, 0.32, 0.29];
    // RISE 0.22 は屋根面より 22cm 立ち上がり、日を受ける白い天端を作る。
    // 実測: 屋根に左右を挟まれた画素の 42〜67% がこのフィンで、L* は屋根より
    // 明るい。**四つの視点のうち三つで、谷のほうが屋根より明るかった**
    // (黄金時間では谷 55.1 対 屋根 24.3 = 谷が 2.3 倍明るい)。
    // 記憶は逆 — 「屋根と屋根のあいだはほとんど見えない黒い線。その黒があるから橙が輝く」。
    const T = 0.26, RISE = 0.10, DROP = 0.30;
    // 巻きは「与えた外向き」に合わせる。巻きから法線を決めていたので、
    // 棟が z 方向の家(全体の約 1/4)ではフィンの全面が内向きになり、
    // 背面カリングで外から消えていた — 石が在るのに見えない、の正体。
    const quad = (a, b, c, d, uv, out) => {
      const i0 = P.length / 3;
      const ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2];
      const bx = d[0] - a[0], by = d[1] - a[1], bz = d[2] - a[2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      let vs = [a, b, c, d];
      if (out && nx * out[0] + ny * out[1] + nz * out[2] < 0) {
        vs = [d, c, b, a]; nx = -nx; ny = -ny; nz = -nz;
      }
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      for (const v of vs) P.push(v[0], v[1], v[2]);
      for (let k = 0; k < 4; k++) N.push(nx, ny, nz);
      for (let k = 0; k < 4; k++) C.push(finTint[0], finTint[1], finTint[2]);
      U.push(...uv);
      IDX.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
    };
    for (const h of roofHouses) {
      const zAx = h.ridgeAxis === 'z';
      // 棟方向は「家の実体積の端」に立てる。屋根の出(+0.62)まで伸ばすと
      // フィンが隣家の壁を突き抜けて、宙に石の板が現れる。
      const halfR = (zAx ? h.d : h.w) / 2 + 0.04;
      const halfS = ((zAx ? h.w : h.d) + 0.70) / 2;   // 勾配方向の半長
      const n = 6;
      const pw2 = hash2((h.x * 3.7) | 0, (h.z * 3.7) | 0);
      {
        // 火返しは煤と雨で黒ずむ。屋根より必ず暗く(目標 L* 25〜35)。
        const tc = new THREE.Color().setHSL(0.070 + pw2 * 0.030, 0.06 + h.seed * 0.08,
          0.30 + pw2 * 0.12, THREE.SRGBColorSpace);
        finTint = [tc.r, tc.g, tc.b];
      }
      // 屋根の海の骨格は瓦の色ではなく **白い石の妻壁** が作る。フィンが
      // 屋根の 31% にしか付かず、残りは妻が赤い瓦の三角で終わっていた。
      if (pw2 > 0.62) continue;
      // 0.22 未満は両側に立てる(棟割りの端の家は両妻が出る)
      for (const side of (pw2 < 0.22 ? [-1, 1] : [pw2 < 0.42 ? -1 : 1])) {
        const ox = side * halfR;
        for (let k = 0; k < n * 2; k++) {
          const t0 = -1 + k / n, t1 = -1 + (k + 1) / n;
          const s0 = halfS * t0, s1 = halfS * t1;
          const y0 = h.eaves + h.roofH * (1 - Math.abs(t0)) + RISE;
          const y1 = h.eaves + h.roofH * (1 - Math.abs(t1)) + RISE;
          const yb = h.eaves - DROP;
          // ローカル(棟方向 = ox、勾配方向 = s)→ ワールド
          const W = (o, sv, y) => (zAx ? [h.x + sv, y, h.z + o] : [h.x + o, y, h.z + sv]);
          const uv = [0, 0, 1, 0, 1, 1, 0, 1];
          const a0 = W(ox - T / 2, s0, yb), a1 = W(ox - T / 2, s1, yb);
          const a2 = W(ox - T / 2, s1, y1), a3 = W(ox - T / 2, s0, y0);
          const b0 = W(ox + T / 2, s0, yb), b1 = W(ox + T / 2, s1, yb);
          const b2 = W(ox + T / 2, s1, y1), b3 = W(ox + T / 2, s0, y0);
          // 外向きは世界座標で明示する(棟方向 o と勾配方向 s の割り当ては
          // ridgeAxis で入れ替わるので、巻きの向きも一緒に入れ替わってしまう)。
          const oDir = zAx ? [0, 0, 1] : [1, 0, 0];
          const sDir = zAx ? [1, 0, 0] : [0, 0, 1];
          const neg = (v) => [-v[0], -v[1], -v[2]];
          quad(a0, a1, a2, a3, uv, neg(oDir));
          quad(b1, b0, b3, b2, uv, oDir);
          quad(a3, a2, b2, b3, uv, [0, 1, 0]);   // 笠石の上端
          // 底(壁の中に隠れる)と両端の小口。張らないと、フィンは
          // 「二枚の板に笠を載せた筒」のままで、下と端から中空が見える。
          quad(a0, b0, b1, a1, uv, [0, -1, 0]);
          if (k === 0) quad(b0, a0, a3, b3, uv, neg(sDir));
          if (k === n * 2 - 1) quad(a1, b1, b2, a2, uv, sDir);
        }
      }
    }
    // ---- 路地を跨ぐ控えアーチ(sottoportego / 控え壁)
    // ジュディオスカ、ボシュコヴィチェヴァ、パルモティチェヴァ — 北の階段路地は
    // 向かい合う家の間に高さ 4〜6m のアーチが架かり、そこをくぐって登る。
    // これが路地に「奥行きの目盛り」を与え、遠近を段階に切る唯一の要素。
    // 全 *.js を grep して 0 件だった。
    {
      const arng = hash2;
      for (const a of plan.streets) {
        if (a.kind !== 'alley') continue;
        const zMin = Math.min(a.pts[0][1], a.pts[a.pts.length - 1][1]);
        const zMax = Math.max(a.pts[0][1], a.pts[a.pts.length - 1][1]);
        for (let z = zMin + 9; z < zMax - 7; z += 9 + arng((a.pts[0][0] * 7) | 0, (z * 3) | 0) * 4) {
          const ax = plan.alleyXAt(a, z);
          // 両側が 3 階以上でないと架けない(2 階建てに 4.6m のアーチは載らない)
          const near = plan.houses.filter(h => Math.abs(h.z - z) < h.d / 2 + 0.8);
          const L2 = near.filter(h => h.x < ax && ax - h.x < 9);
          const R2 = near.filter(h => h.x > ax && h.x - ax < 9);
          if (!L2.length || !R2.length) continue;
          const hl = L2.reduce((p2, c) => (c.x > p2.x ? c : p2));
          const hr = R2.reduce((p2, c) => (c.x < p2.x ? c : p2));
          const x0 = hl.x + hl.w / 2 - 0.10, x1 = hr.x - hr.w / 2 + 0.10;
          const span = x1 - x0;
          if (span < 1.35 || span > 5.2) continue;   // 南の路地は 1.67m から
          const gy = plan.groundAt((x0 + x1) / 2, z, 200);
          if (!gy || gy.y === undefined) continue;
          const yS = gy.y + 4.6;                       // 迫元
          if (Math.min(hl.eaves, hr.eaves) < yS + 1.4) continue;
          const R = span / 2, cx2 = (x0 + x1) / 2, D2 = 0.55, TH = 0.38;
          const NS = 9;
          const ring = (zz, sgn) => {
            for (let k = 0; k < NS; k++) {
              const a0 = Math.PI * (k / NS), a1 = Math.PI * ((k + 1) / NS);
              const p0 = [cx2 + Math.cos(a0) * R, yS + Math.sin(a0) * R, zz];
              const p1 = [cx2 + Math.cos(a1) * R, yS + Math.sin(a1) * R, zz];
              const q0 = [cx2 + Math.cos(a0) * (R + D2), yS + Math.sin(a0) * (R + D2), zz];
              const q1 = [cx2 + Math.cos(a1) * (R + D2), yS + Math.sin(a1) * (R + D2), zz];
              quad(p0, p1, q1, q0, [0, 0, 1, 0, 1, 1, 0, 1], [0, 0, sgn]);
            }
          };
          ring(z - TH / 2, -1); ring(z + TH / 2, 1);
          for (let k = 0; k < NS; k++) {              // 迫の内輪と背
            const a0 = Math.PI * (k / NS), a1 = Math.PI * ((k + 1) / NS);
            const i0 = [cx2 + Math.cos(a0) * R, yS + Math.sin(a0) * R, 0];
            const i1 = [cx2 + Math.cos(a1) * R, yS + Math.sin(a1) * R, 0];
            const o0 = [cx2 + Math.cos(a0) * (R + D2), yS + Math.sin(a0) * (R + D2), 0];
            const o1 = [cx2 + Math.cos(a1) * (R + D2), yS + Math.sin(a1) * (R + D2), 0];
            const uv2 = [0, 0, 1, 0, 1, 1, 0, 1];
            quad([i0[0], i0[1], z - TH / 2], [i1[0], i1[1], z - TH / 2],
              [i1[0], i1[1], z + TH / 2], [i0[0], i0[1], z + TH / 2], uv2,
              [-Math.cos((a0 + a1) / 2), -Math.sin((a0 + a1) / 2), 0]);
            quad([o0[0], o0[1], z - TH / 2], [o1[0], o1[1], z - TH / 2],
              [o1[0], o1[1], z + TH / 2], [o0[0], o0[1], z + TH / 2], uv2,
              [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0]);
          }
          // 迫元の小口(両端)
          for (const sgn of [-1, 1]) {
            const bx = cx2 + sgn * R, ox = cx2 + sgn * (R + D2);
            quad([bx, yS, z - TH / 2], [ox, yS, z - TH / 2],
              [ox, yS, z + TH / 2], [bx, yS, z + TH / 2], [0, 0, 1, 0, 1, 1, 0, 1], [0, -1, 0]);
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g.setIndex(IDX);
    const fmat = new THREE.MeshStandardMaterial({
      map: tex.wallStone.map, normalMap: tex.wallStone.normalMap,
      normalScale: new THREE.Vector2(1.35, 1.35),
      vertexColors: true, roughness: 0.84, metalness: 0, envMapIntensity: 0.55,
    });
    // 16,992 三角の大面。天空可視率が無いと、屋根の海の中でここだけスレート緑灰になる。
    bakeSkyVis(g, skyAt0, { offsetY: 0.2 });
    patchSkyVis(fmat);
    const m = new THREE.Mesh(g, fmat);
    m.castShadow = true; m.receiveShadow = true;
    group.add(tagMesh(m, 'house.gableFin', { solid: true, masonry: true }));
  }

  // ===== 棟瓦(ridge)
  // 半割(thetaLength = π)の樋にしていたので、底が無い「開いた筒」だった。
  // 棟は視線より下にあることが多く、斜め上から覗くと中が見える(実測 s09 で
  // 1 視点あたり 4,500px)。丸のまま棟に半分埋める — 下半分は屋根の中。
  // 7 角では見えている上半分に 51° 刻みの面が並び、太陽から外れた面が平均を下げる。
  // 長さ分割 1 では「継ぎ目の無い塩ビ管」。棟瓦は 400mm の半円筒を重ねて伏せる物で、
  // **重ね目が棟の表情のすべて**。三角は 586 × +40 = 23k 増、draw call は不変。
  const ridgeGeo = new THREE.CylinderGeometry(0.125, 0.125, 1, 10, 5, false);
  {
    // 分割ごとに半径を刻んで、瓦一枚ずつの重なりを出す
    const pos = ridgeGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);                       // -0.5..0.5(回転前は長さ方向)
      const k = Math.round((y + 0.5) * 5);
      const rk = 1 + (k % 2 === 0 ? 0.055 : -0.03);
      pos.setX(i, pos.getX(i) * rk); pos.setZ(i, pos.getZ(i) * rk);
    }
    ridgeGeo.computeVertexNormals();
  }
  ridgeGeo.rotateZ(Math.PI / 2);
  // color 0xa05a38 と setColorAt の HSL が **両方掛かり**、実効アルベドが
  // sRGB(84,17,2) = L* 16.9 の「乾いた血の色」になっていた。正午の太陽高度 61° で、
  // 真上を向く棟が 20° の斜面より 2 段暗いのは光の理屈に合わない。
  // 色は個体色だけが持つ。地図も与える(棟だけ無地だった)。
  const ridgeMat = new THREE.MeshStandardMaterial({
    map: tex.roof.map, normalMap: tex.roof.normalMap,
    roughness: 0.84, envMapIntensity: 0.62,
  });
  // 屋根が沈むのに棟だけ真っ直ぐだと、棟が空中に残る。同じ式を掛ける。
  // 棟瓦はワールド寸法なので、単位空間の沈み量に roofH を掛ける必要がある。
  {
    const rh = new Float32Array(roofHouses.length);
    roofHouses.forEach((h, i) => { rh[i] = h.roofH; });
    ridgeGeo.setAttribute('aRoofH', new THREE.InstancedBufferAttribute(rh, 1));
    const prevOBC = ridgeMat.onBeforeCompile;
    ridgeMat.onBeforeCompile = (sh, r) => {
      if (prevOBC) prevOBC.call(ridgeMat, sh, r);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n attribute float aRoofH; attribute float aSeedR;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          { float st = 1.0 - 4.0 * position.x * position.x;
            transformed.y -= (0.040 + 0.022 * sin(position.x * 11.0 + aSeedR * 6.2832)) * st * aRoofH; }`);
    };
    ridgeMat.customProgramCacheKey = () => 'ridgeSag';
  }
  const ridges = new THREE.InstancedMesh(ridgeGeo, ridgeMat, roofHouses.length);
  {
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const seedsR = new Float32Array(roofHouses.length);
    roofHouses.forEach((h, i) => { seedsR[i] = h.seed; });
    ridgeGeo.setAttribute('aSeedR', new THREE.InstancedBufferAttribute(seedsR, 1));
    roofHouses.forEach((h, i) => {
      dummy.position.set(h.x, h.eaves + h.roofH + 0.02, h.z);
      dummy.rotation.set(0, h.ridgeAxis === 'z' ? Math.PI / 2 : 0, 0);
      dummy.scale.set((h.ridgeAxis === 'z' ? h.d : h.w) + 0.10, 1, 1);   // 0.4 だと両妻から 0.20m ずつ飛び出す
      dummy.updateMatrix();
      ridges.setMatrixAt(i, dummy.matrix);
      // 棟瓦は屋根と同じ窯の瓦を伏せたもの。**独立の色ではない。**
      // 586 軒すべてに同じ HSL を配っていたので、暗い古屋根には明るすぎる棒が、
      // 明るい新屋根には暗すぎる棒が載っていた(t3gold で棟 L*39 対 屋根 L*10.9)。
      const rr = hash2((h.x * 3) | 0, (h.z * 3) | 0);
      const rr2 = hash2((h.z * 7) | 0, (h.x * 11) | 0);
      let hR, sR, lR;
      if (rr < 0.40) { hR = 0.043; sR = 0.80; lR = 0.515; }
      else if (rr < 0.62) { hR = 0.056; sR = 0.67; lR = 0.462; }
      else if (rr < 0.88) { hR = 0.072; sR = 0.52; lR = 0.482; }
      else { hR = 0.080; sR = 0.42; lR = 0.392; }
      col.setHSL(hR + (h.seed - 0.5) * 0.048 - 0.004, Math.max(0.04, sR - rr2 * 0.055) * 0.94,
        (lR + (rr2 - 0.5) * 0.105) * 0.90, THREE.SRGBColorSpace);
      ridges.setColorAt(i, col);
    });
  }
  ridges.castShadow = true;
  group.add(tagMesh(ridges, 'house.ridgeTile', { solid: true, tileOverlap: true }));

  // ===== 煙突(ドゥブロヴニク特有の小さな傘つき)
  const chimneyGeo = (() => {
    // ドゥブロヴニクの煙突は「石の立ち上がり + 4本の小柱 + 平らな笠石」の
    // 開放フード。円錐の帽子は別の土地のもの。
    const parts = [];
    const g1 = new THREE.BoxGeometry(0.58, 1.15, 0.58); g1.translate(0, 0.575, 0); parts.push(g1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const pcol = new THREE.BoxGeometry(0.09, 0.26, 0.09);
      pcol.translate(sx * 0.22, 1.15 + 0.13, sz * 0.22);
      parts.push(pcol);
    }
    const cap = new THREE.BoxGeometry(0.80, 0.09, 0.80); cap.translate(0, 1.15 + 0.26 + 0.045, 0);
    parts.push(cap);
    const drip = new THREE.BoxGeometry(0.68, 0.05, 0.68); drip.translate(0, 1.15 + 0.26 + 0.115, 0);
    parts.push(drip);
    return mergeGeoSimple(parts);
  })();
  const chimneyPos = [];
  roofHouses.forEach(h => {
    if (h.seed > 0.42 && !h.noChimney) {
      chimneyPos.push({
        x: h.x + (h.seed - 0.5) * h.w * 0.7, z: h.z + (h.seed > 0.7 ? 0.3 : -0.3) * h.d * 0.5,
        y: h.eaves + h.roofH * (0.4 + h.seed * 0.3), s: 0.8 + h.seed * 0.4, seed: h.seed,
      });
    }
  });
  const chimneyMat = new THREE.MeshStandardMaterial({
    map: tex.wallStone.map, normalMap: tex.wallStone.normalMap, roughness: 0.85,
    normalScale: new THREE.Vector2(1.7, 1.7), envMapIntensity: 0.55,
  });
  bakeSkyVisInstanced(chimneyGeo, chimneyPos, skyAt0, { offsetY: 0.9 });
  patchSkyVisInstanced(chimneyMat);
  const chimneys = new THREE.InstancedMesh(chimneyGeo, chimneyMat, chimneyPos.length);
  {
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    chimneyPos.forEach((c, i) => {
      dummy.position.set(c.x, c.y, c.z);
      // rotation を設定しないと、街中の煙突が全部ワールド X/Z 軸に整列する
      dummy.rotation.set(0, (c.seed ?? hash2((c.x * 9) | 0, (c.z * 9) | 0)) * Math.PI * 2, 0);
      dummy.scale.setScalar(c.s);
      dummy.updateMatrix();
      chimneys.setMatrixAt(i, dummy.matrix);
      col.setHSL(0.08, 0.16, 0.56 + c.seed * 0.10, THREE.SRGBColorSpace);
      chimneys.setColorAt(i, col);
    });
  }
  chimneys.castShadow = true;
  group.add(tagMesh(chimneys, 'house.chimney', { solid: true, masonry: true }));

  // ===== 開口部を集める
  const OPEN_H_HALF = 1.30;   // 窓枠(水切り込み)の半高。開口 1.66 + 枠 + 窓台。
  const windows = [], doors = [], grimes = [], plinths = [], pipes = [], shops = [];
  const isAlleyFace = (f) => f.kind === 'alley';
  for (const h of plan.houses) {
    if (h.garden) continue;   // 庭は塀だけ(開口なし)
    const faces = facesOnStreet(plan, h);
    // 主要面(東西街路 > 広場 > 路地)順に
    faces.sort((a, b) => (a.kind === 'alley' ? 1 : 0) - (b.kind === 'alley' ? 1 : 0));
    for (const f of faces) {
      let doorPlaced = false;   // 扉は面ごとに 1 つ。家ごとにすると路地側が永久に無開口になる
      const isAlley = f.kind === 'alley' || f.kind === 'court';
      const isCourt = f.kind === 'court';
      // 街路が家の土台よりずっと低い(家は斜面の上の段にある)場合、
      // その面の「1階」は空中になる。開口を出すと窓枠だけが宙に浮く。
      if (f.kind !== 'court' && (f.groundY < h.yBase - 0.8 || f.groundY > h.eaves - 2.4)) continue;
      const wallLen = f.len;
      // 1667年の震災後、ストラドゥン沿いは完全な規格で再建された。その署名が
      // 1階の "na koljeno"(膝立ち)アーチ — 扉と店の陳列窓が一つの円弧に同居し、
      // 4.1m ピッチで通りの全長を貫く。上階の窓はその真上に乗る(厳格な垂直ベイ)。
      const shopFace = h.stradunFront && f.kind === 'stradun';
      let nCols;
      if (shopFace) nCols = Math.max(1, Math.round(wallLen / 4.1));
      else if (h.monument) { nCols = Math.max(3, Math.round(wallLen / 4.6)); if (nCols % 2 === 0) nCols++; }
      else if (isAlley && !isCourt) nCols = Math.max(1, Math.round(wallLen / 4.2));
      else nCols = Math.max(1, Math.floor(wallLen / (isCourt ? 3.0 : 2.15)));
      const groundY = f.groundY ?? (h.yBase + HOUSE_BASE_BURY);
      // f.groundY は面の中点 1 点で測ったスカラー。路地は勾配 25% で登るので、
      // 面長 8.5m では 2.1m の落差を 1 つの高さで代表している。巾木は石ごとに
      // 地面を測り直しているのに(下の emit)、扉と地上階の窓だけがそれをせず、
      // 実測で敷居が p25 で 0.13m 舗装に埋まり、p75 で 0.43m 宙に浮いていた
      // (最大 0.66m)。同じ解決を開口にも与える。
      const groundAtOpening = (px, pz) => {
        const g3 = plan.groundAt(px, pz);
        const ty = plan.surfaceAt(px, pz);
        const dg = (g3 && g3.y !== undefined) ? g3.y - ty : -1;
        const onPaving = f.paved || (h.monument && dg > 0.08 && dg < 0.24);
        return onPaving ? Math.max(g3 && g3.y !== undefined ? g3.y : groundY, ty) : ty;
      };
      // 階高 3.05m、窓台 0.95m。上に 0.5m 以上の壁が残らない割付は構造的に嘘。
      // 幅 0.22m では「全市が同じ階高」になる。実際の町家は 2.8〜3.4m に散る。
      const fh = h.monument ? 5.2 : 2.80 + h.seed * 0.58;
      // ストラドゥン正面の 1 階だけ別(中2階を抱く 4.35m)
      const fh0 = (h.stradunFront && f.kind === 'stradun') ? 4.35 : fh;
      const nFloors = h.monument
        ? Math.max(1, Math.min(2, Math.floor((h.eaves - groundY - 3.4) / fh)))
        : Math.max(1, 1 + Math.floor((h.eaves - groundY - fh0 - 2.75) / fh));
      // 面の基準(壁面上の位置)
      const fx = f.nx !== 0 ? h.x + f.nx * h.w / 2 : h.x;
      const fz = f.nz !== 0 ? h.z + f.nz * h.d / 2 : h.z;
      const rotY = Math.atan2(f.nx, f.nz);
      const alongX = f.nz !== 0;   // 面の長手が x 方向か
      // 汚れ帯(接地面)
      // 中庭面(= 城壁の歩廊から見下ろす背面)は見える面の 34% を占める。
      // ここに巾木も汚れも樋も無いと、赤瓦の合間に「のっぺら坊の白い板」が立つ。
      // 巾木と汚れ帯は「地面に沿う物」。街路の高さだけを見ると、舗装の帯が
      // 届かない所(中庭・広場の縁)で地形に 0.6m 埋まる。見えている地面
      // — 街路と地形の高いほう — に合わせる。
      // 舗装が届いている面は街路の高さ、届いていない面は地形の面。
      // 一律に max を採ると、街路が地形より高い所で巾木が宙に浮く。
      const terrY = plan.surfaceAt(fx + f.nx * 0.06, fz + f.nz * 0.06);
      const skirtY = f.paved ? Math.max(groundY, terrY) : terrY;
      grimes.push({ x: fx + f.nx * 0.03, z: fz + f.nz * 0.03, rotY, w: wallLen * 0.98, h: 0.9 + h.seed * 0.9, y: skirtY });
      // 巾木(base course)— 壁は地面に「刺さって」いない。ここに影が一本入るだけで
      // 建物が地面に立ちはじめる。手続き生成がバレる最大の箇所。
      // 店口の面には巾木を回さない。開口を横切る 0.40m の帯は実物に無い。
      // 巾木は開口の位置が判ってから出す(下のループで戸口が決まる)。
      // 面の全幅に一本で回すと、基礎の帯が戸口の真ん中を横切る
      // (実測: 扉枠・扉葉・縦樋と 1,900 箇所で重なり、Z ファイティングも出た)。
      const doorCuts = [];
      // 縦樋(角と 10m ごと)— 使われている建物にしか付かないもの
      // 路地面を除外していたので、路地の壁に垂直線が一本も無かった(実測
      // alleyN2 の左壁 0 本・右壁 7 本、右の 7 本は court/street と判定された面)。
      // 実物では雨は必ず路地へ落とす。切石の無地の壁に律を与える唯一の物。
      if (!h.monument) {
        // 縦樋は隣家との境(= 立面の端)に降りる。壁の真ん中に樋は立たない。
        const nPipe = wallLen > 7.5 ? 2 : 1;
        for (let q = 0; q < nPipe; q++) {
          const o2 = nPipe === 1 ? 0.06 : (q === 0 ? 0.045 : 0.955);
          const pxp = alongX ? fx + (o2 - 0.5) * (wallLen - 0.35) : fx;
          const pzp = alongX ? fz : fz + (o2 - 0.5) * (wallLen - 0.35);
          pipes.push({ x: pxp + f.nx * 0.09, z: pzp + f.nz * 0.09, y: groundY, h: Math.max(2.5, h.eaves - groundY - 0.1), seed: hash2((pxp * 13) | 0, (pzp * 13) | 0) });
        }
      }
      // 実物の立面は「1階(店)→ ピアノ・ノビレ(最も高い)→ 上へ行くほど低い」。
      // 全階が同じ階高だと、窓が方眼紙の穴になる。
      const FHK = [1.0, 1.13, 0.99, 0.94, 0.92];
      const fhK = (k) => FHK[Math.min(k, 4)];
      const sillAt = (fl) => {
        if (fl === 0) return groundY + 1.96;
        let y = groundY + fh0;
        for (let k = 1; k < fl; k++) y += fh * fhK(k);
        return y + 1.72 * fhK(fl);
      };
      for (let fl = 0; fl < nFloors; fl++) {
        const isGround = fl === 0;
        const wy = h.monument ? groundY + 3.5 + fl * fh : sillAt(fl);   // 窓台は床上 0.89m
        if (isAlley && wy > groundY + 9.6) continue;   // 路地の窓は3層まで(庭越しの浮遊防止)
        // 窓は必ず家体の中に収める(体の外に出た枠は宙に浮いた石になる)
        if (wy - OPEN_H_HALF < h.yBase + 0.35 || wy + OPEN_H_HALF > h.eaves - 0.30) continue;
        // 店口・記念建築は壁の全長に均等割り(ピッチ 4.1m / 4.6m を守る)。
        // 0.86 に縮めるとピッチが 3.5m になり、開口の間の壁が消えてロッジアに見える。
        const spread = (shopFace || h.monument) ? 1.0 : 0.86;
        for (let cix = 0; cix < nCols; cix++) {
          // ストラドゥンと記念建築は規律が主題なので揺らさない。それ以外の町家は
          // 増改築の積み重ねなので、ベイが数センチずれる。
          const jit = (shopFace || h.monument) ? 0
            : (hash2((h.x * 13 + cix * 7) | 0, (h.z * 17 + fl * 5) | 0) - 0.5) * 0.052;
          const off = (cix + 0.5) / nCols - 0.5 + jit;
          const wx = alongX ? fx + off * wallLen * spread : fx;
          const wz = alongX ? fz : fz + off * wallLen * spread;
          const s = hash2((wx * 11) | 0, (wy * 11 + wz * 3) | 0);
          if (h.monument) {
            // 中央ベイは大ポータル、他は縦長窓。間引かない(格式は規律から来る)
            if (isGround && cix === ((nCols / 2) | 0) && !doorPlaced) {
              doors.push({ x: wx, z: wz, y: groundY, rotY, seed: s, arch: true, big: true });
              doorCuts.push({ c: off * wallLen * spread, half: 1.15 });
              doorPlaced = true;
              continue;
            }
            if (cix % 2 === 1) continue;   // 付柱の間だけに開口
          } else if (shopFace) {
            if (isGround) { shops.push({ x: wx, z: wz, y: groundY, rotY, seed: s }); continue; }
            // 通りの規律が命 — 間引かない
          } else {
            if (isGround && !doorPlaced && cix === ((nCols / 2) | 0) && f.kind !== 'plaza' && !isCourt) {
              doors.push({ x: wx, z: wz, y: isAlleyFace(f) ? groundAtOpening(wx, wz) : groundY, rotY, seed: s, arch: h.stradunFront });
              doorCuts.push({ c: off * wallLen * spread, half: 1.15 });
              doorPlaced = true;
              continue;
            }
            if (isCourt && isGround) {
              // 地上階: 25% に勝手口、40% に高窓(手の届かない高さの明かり取り)。
              // 全部塞ぐと、背面が 3 層ぶん無開口の崖になる。
              if (!doorPlaced && s > 0.75 && cix === ((nCols / 2) | 0)) {
                doors.push({ x: wx, z: wz, y: groundY, rotY, seed: s, arch: false });
                doorCuts.push({ c: off * wallLen * spread, half: 0.95 });
                doorPlaced = true;
              } else if (s > 0.60) {
                windows.push({ x: wx, z: wz, y: groundY + 2.55, rotY, seed: s, fl: 0, small: true, big: false, shutter: false });
              }
              continue;
            }
            if (isCourt && s < 0.30) continue;   // 光庭の上階は 7 割に窓
            if (isGround && s < 0.18) continue;   // 地上階は窓少なめ
            if (s < 0.12) continue;               // 塞がれた窓の跡はあえて壁のまま
          }
          windows.push({
            x: wx, z: wz, y: wy, rotY, seed: s, fl,
            small: !h.monument && (isAlley || fl === nFloors - 1),
            big: !!h.monument,
            shutter: !h.monument && s > 0.25,
          });
        }
      }
      // ---- 巾木は戸口で切れる。石の基礎の帯が敷居を横切る建物は無い。
      if (!shopFace) {
        const half = wallLen / 2 + 0.08;
        const cuts = doorCuts.slice().sort((a2, b2) => a2.c - b2.c);
        let from = -half;
        const emit = (a2, b2) => {
          const len = b2 - a2;
          if (len < 0.25) return;                    // 石 1 枚に満たない切れ端は出さない
          const mid = (a2 + b2) / 2;
          const ux = alongX ? 1 : 0, uz = alongX ? 0 : 1;
          // 平らな地面なら 1 本の帯。傾いた地面や階段の脇でだけ石 1 枚ぶん
          // (最長 1.2m)に割る — 実際の石積みも段状に切る。
          // 常に割ると、平坦なストラドゥン沿いまで刻んだ帯になって粗く見える。
          const eGround = (t3) => {
            const q3 = fx + f.nx * 0.055 + ux * t3, r3 = fz + f.nz * 0.055 + uz * t3;
            const gg = plan.groundAt(q3, r3);
            const tt = plan.surfaceAt(q3, r3);
            return f.paved ? Math.max(gg && gg.y !== undefined ? gg.y : groundY, tt) : tt;
          };
          const drop = Math.abs(eGround(a2 + 0.1) - eGround(b2 - 0.1));
          const n3 = drop < 0.06 ? 1 : Math.max(1, Math.ceil(len / 1.2));
          for (let q = 0; q < n3; q++) {
            const w3 = len / n3;
            const m3 = a2 + w3 * (q + 0.5);
            const px3 = fx + f.nx * 0.055 + ux * m3, pz3 = fz + f.nz * 0.055 + uz * m3;
            // 高さは「その石が立つ場所の、歩ける面と地形の高いほう」。
            // f.paved の判定に頼ると、街路の縁から少し外れた面(修道院の
            // ストラドゥン面など)が「舗装ではない」と判定され、巾木が
            // 舗装より 0.16m 低く沈む。0.40m の巾木のうち 0.15m しか出ず、
            // 躯体の足元が切れて「家が浮いている」ように読める。
            // 歩ける面が地形とほぼ同じ高さ(= その場の舗装)なら、常にそれに乗せる。
            const g3 = plan.groundAt(px3, pz3);
            const ty = plan.surfaceAt(px3, pz3);
            // 舗装は地形の上に 0.1〜0.2m 敷かれる。歩ける面がその範囲だけ
            // 高いなら、そこは舗装。f.paved の判定に頼ると、街路の縁から
            // 少し外れた面(修道院のストラドゥン面)が「舗装ではない」と出て、
            // 巾木が 0.16m 沈み、0.40m のうち 0.15m しか見えず、躯体の足元が
            // 切れて「家が浮いている」ように読める。
            const dg = (g3 && g3.y !== undefined) ? g3.y - ty : -1;
            const onPaving = f.paved || (h.monument && dg > 0.08 && dg < 0.24);
            let sy = onPaving ? Math.max(g3 && g3.y !== undefined ? g3.y : groundY, ty) : ty;
            // **描かれている舗装に乗せる。** surfaceAt は地形の格子しか見ないので、
            // 帯の下に居る巾木が石畳に 0.12〜0.30m 沈んでいた(実測 159 個)。
            // 帯の高さは plan.pavedY が ground.js と同じ式で返す。地形から
            // 0.45m 以上離れた値は舗装ではない(歩廊や段)ので拾わない。
            const pv = plan.pavedY(px3, pz3);
            if (pv !== null && pv > sy && pv - ty < 0.45) sy = pv;
            // 段のある路地では、描かれる踏面は帯より 1 蹴上ぶん高い。
            // groundAt は路地を **段と同じ格子で量子化して** 返すので、それに乗せる。
            const ga = plan.groundAt(px3, pz3, ty + 0.6);
            if (ga && ga.zone === 'alley' && ga.y > sy && ga.y - ty < 0.45) sy = ga.y;
            plinths.push({ x: px3, z: pz3, rotY, w: w3 + 0.02, y: sy - 0.06 });
          }
        };
        for (const c of cuts) { emit(from, c.c - c.half); from = c.c + c.half; }
        emit(from, half);
      }
    }
  }

  // ===== 窓 = 壁に穿たれた穴。石の見込み(reveal)が影を作らないと「貼った絵」になる。
  // 開口 0.92×1.66(実測 1:1.8)、枠は面から 0.16m 出し、ガラスはその奥。
  const OPEN_W = 0.92, OPEN_H = 1.66, REV = 0.22;   // 見込み 0.22m = 石枠の実寸
  const REVZ = -0.075;   // 枠の起点を壁の内側へ。外へ積むと「壁に貼った額縁」になる
  const frameGeo = (() => {
    const parts = [];
    const mk = (w, hh, dd, x, y, z) => { const g = new THREE.BoxGeometry(w, hh, dd); g.translate(x, y, z); return g; };
    parts.push(mk(0.17, OPEN_H + 0.30, REV, -(OPEN_W / 2 + 0.085), 0, REV / 2 + REVZ));    // 縦枠
    parts.push(mk(0.17, OPEN_H + 0.30, REV, (OPEN_W / 2 + 0.085), 0, REV / 2 + REVZ));
    parts.push(mk(OPEN_W + 0.34, 0.17, REV, 0, OPEN_H / 2 + 0.085, REV / 2 + REVZ));        // まぐさ
    parts.push(mk(OPEN_W + 0.40, 0.12, 0.23, 0, -OPEN_H / 2 - 0.06, 0.10 + REVZ));          // 窓台(水切りで出る)
    parts.push(mk(OPEN_W + 0.34, 0.045, 0.055, 0, -OPEN_H / 2 - 0.14, 0.185 + REVZ));       // 水切り
    // 中桟と無目(ガラス面を1枚のべた塗りにしない)
    // 桟はガラス(壁面 +0.02)より手前でなければ見えない
    parts.push(mk(0.058, OPEN_H - 0.02, 0.055, 0, 0, 0.062));
    parts.push(mk(OPEN_W - 0.02, 0.052, 0.055, 0, OPEN_H * 0.12, 0.062));
    parts.push(mk(OPEN_W - 0.02, 0.046, 0.050, 0, -OPEN_H * 0.26, 0.060));
    return mergeGeoSimple(parts);
  })();
  // 枠は塗装ではなく石。周囲と同じ色で、仕上げの滑らかさだけが違う。
  // 框は一枚石。切石のテクスチャ(coverM 3.2)を UV 0..1 の面に貼ると、
  // 幅 0.17m の縦枠に 3.2m 分の目地が入って 13.8mm の縞になる。
  const frameMat = new THREE.MeshStandardMaterial({
    map: tex.dressed.map, normalMap: tex.dressed.normalMap,
    color: 0xb3aa98, roughness: 0.70, envMapIntensity: 0.55,
  });
  // 窓の寸法はこの 2 式だけで決める(枠・ガラス・鎧戸・夜の灯り・雨だれが同じ形になる)
  const scOf = (w) => (w.big ? 1.42 : w.small ? 0.84 + w.seed * 0.10 : (w.fl === 1 ? 1.12 : 0.92) + w.seed * 0.17);
  const aspOf = (w) => (w.big ? 1 : 0.94 + hash2((w.x * 41) | 0, (w.z * 37 + w.y * 3) | 0) * 0.13);
  const winFrames = new THREE.InstancedMesh(frameGeo, frameMat, windows.length);
  const glassGeo = new THREE.PlaneGeometry(OPEN_W - 0.03, OPEN_H - 0.03);
  // ガラスは空を映す。映らないガラスは「紺色の長方形」にしか見えない。
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x1c2128, roughness: 0.055, metalness: 0.0, envMapIntensity: 0.95,
  });
  glassMat.specularIntensity = 1.0;   // envMap 7.0 × spec 1.4 は実効 39% = 物理の 10 倍
  // 街路から見たガラスに映るのは、大半が「向かいの石の壁」で、空は上端の帯だけ。
  // env をそのまま映すと全面が同じ青の板になり、これが街を最も嘘くさく見せていた。
  glassMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n varying float vGy;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vGy = position.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n varying float vGy;')
      .replace('#include <aomap_fragment>', `
        // 上端 = 空、下端 = 向かいの壁の足元と路面。縦のグラデーションが要。
        float gT = clamp(vGy / 0.83 * 0.5 + 0.5, 0.0, 1.0);
        reflectedLight.indirectSpecular *= mix(0.18, 1.0, pow(gT, 1.35));
        // 下半分は室内が透けて見える(暖色・ごく暗い)
        reflectedLight.indirectDiffuse += vec3(0.030, 0.023, 0.016) * (1.0 - gT) * 0.8;`);
  };
  glassMat.customProgramCacheKey = () => 'glasspane';
  specularEnvTargets.push(glassMat);
  const winGlass = new THREE.InstancedMesh(glassGeo, glassMat, windows.length);
  const litArr = new Float32Array(windows.length);
  {
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    windows.forEach((w, i) => {
      // 離散 4 段だと「同じ比率の窓が同一画面に 20 個」並ぶ。連続にし、
      // 縦横を独立に振って比率そのものを散らす(1:1.62 〜 1:2.05)。
      const sc = scOf(w), asp = aspOf(w);
      dummy.position.set(w.x, w.y, w.z);
      // Z 回転は法線軸まわりなので法線を変えない。X で振らないと全窓が同時に白飛びする。
      dummy.rotation.set((w.seed - 0.5) * 0.032, w.rotY, 0);
      dummy.scale.set(sc * asp, sc / asp, 1);
      dummy.updateMatrix();
      winFrames.setMatrixAt(i, dummy.matrix);
      col.setHSL(0.112, 0.08, 0.76 + (w.seed - 0.5) * 0.08, THREE.SRGBColorSpace);
      winFrames.setColorAt(i, col);
      // ガラスは壁面から 0.02 手前。桟はさらに手前(local z +0.062)に置く。
      // 以前は桟がガラスの裏に隠れて窓が「1枚の板」になっていた。
      dummy.position.set(w.x + Math.sin(w.rotY) * 0.02, w.y, w.z + Math.cos(w.rotY) * 0.02);
      dummy.updateMatrix();
      winGlass.setMatrixAt(i, dummy.matrix);
      // 室内の明るさは窓ごとに違う。全窓が同じ値だと「紺色の長方形」に見える。
      const rin = hash2((w.x * 19) | 0, (w.y * 23) | 0);
      col.setHSL(0.09 + rin * 0.06, 0.10 + rin * 0.10, 0.14 + rin * 0.22, THREE.SRGBColorSpace);
      winGlass.setColorAt(i, col);
      litArr[i] = w.seed;
    });
  }
  // 窓台は 0.14m、水切りは 0.1375m 出ているのに影を落としていなかった。
  // ダルマチアの立面で最も読みやすい影がまるごと無い状態。
  winFrames.castShadow = true; winFrames.receiveShadow = true;
  group.add(tagMesh(winFrames, 'window.frame', { solid: true, masonry: true }),
    tagMesh(winGlass, 'window.glass', { thin: true, reason: 'ガラス 1 枚', noCollide: true }));

  // ===== 夜に灯る窓(暮らしの窓の 1/3 ほど — 手前に薄板を重ねて夜だけ現す)
  {
    const litWins = windows.filter(w => w.seed > 0.58);
    const litGeo = new THREE.PlaneGeometry(OPEN_W - 0.06, OPEN_H - 0.06);
    const litMesh = new THREE.InstancedMesh(litGeo, litWindowsMat, litWins.length);
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    litWins.forEach((w, i) => {
      // 離散 4 段だと「同じ比率の窓が同一画面に 20 個」並ぶ。連続にし、
      // 縦横を独立に振って比率そのものを散らす(1:1.62 〜 1:2.05)。
      const sc = scOf(w), asp = aspOf(w);
      // 枠の見込み(0.22m)の奥に置くと、斜めから見たとき枠に隠れて街が真っ暗になる
      // 中桟(+0.062)の奥・ガラス(+0.02)の手前。手前に出すと夜だけ桟が消える。
      dummy.position.set(w.x + Math.sin(w.rotY) * 0.042, w.y, w.z + Math.cos(w.rotY) * 0.042);
      dummy.rotation.set(0, w.rotY, 0);
      dummy.scale.set(sc * asp, sc / asp, 1);
      dummy.updateMatrix();
      litMesh.setMatrixAt(i, dummy.matrix);
      // 窓ごとの灯の色(蝋色〜電球色)
      col.setHSL(0.062 + w.seed * 0.035, 0.86, 0.46 + w.seed * 0.14, THREE.SRGBColorSpace);
      litMesh.setColorAt(i, col);
    });
    group.add(tagMesh(litMesh, 'window.litPane', { thin: true, reason: '夜の灯りの面', noCollide: true }));
  }

  // ===== 鎧戸(緑の褪せ・角度の個体差 = 街の生活)
  const shutterGeo = (() => {
    // 葉の丈 = 開口 + 戸决り 0.02、幅 = 開口の半分。開口からはみ出す鎧戸は
    // 「窓に立てかけた板」に見える。
    const LW = OPEN_W / 2 - 0.005;
    const g = new THREE.BoxGeometry(LW, OPEN_H + 0.02, 0.042);
    g.translate(LW / 2, 0, 0);   // ヒンジを x=0 に
    return g;
  })();
  const shutterMat = new THREE.MeshStandardMaterial({
    map: tex.louver.map, normalMap: tex.louver.normalMap, roughness: 0.78,
  });
  const shutterList = [];
  windows.forEach(w => {
    if (!w.shutter) return;
    for (const side of [-1, 1]) {
      // 開き角: 全開/半開/閉じかけ — 家ごとの暮らしの気配
      const a = hash2((w.x * 23 + side * 7) | 0, (w.y * 17) | 0);
      // 昼の開き。夜は閉める(03:30 に全開の鎧戸は、街に時計が無い証拠だった)。
      const open = a < 0.16 ? 0.10 + a * 0.3 : a < 0.94 ? 2.90 + a * 0.22 : 1.35 + a * 0.5;
      shutterList.push({ w, side, open: open * side, seed: a, shut: 0.10 * side });
    }
  });
  const shutters = new THREE.InstancedMesh(shutterGeo, shutterMat, shutterList.length);
  let shutterOpenK = 1;
  const shutterDummy = new THREE.Object3D();
  function placeShutters(colorToo) {
    const dummy = shutterDummy;
    const col = new THREE.Color();
    shutterList.forEach((s, i) => {
      const w = s.w;
      const sc = scOf(w), asp = aspOf(w);
      const hx = (OPEN_W / 2 + 0.005) * sc * asp;
      const hingeX = w.x + Math.cos(w.rotY) * hx * s.side + Math.sin(w.rotY) * 0.105;
      const hingeZ = w.z - Math.sin(w.rotY) * hx * s.side + Math.cos(w.rotY) * 0.105;
      dummy.position.set(hingeX, w.y, hingeZ);
      dummy.rotation.set(0, w.rotY + (s.side > 0 ? Math.PI : 0) + lerp(s.shut, s.open, shutterOpenK), (s.seed - 0.5) * 0.02);
      dummy.scale.set(sc * asp, sc / asp, 1);
      dummy.updateMatrix();
      shutters.setMatrixAt(i, dummy.matrix);
      // ドゥブロヴニクの緑鎧戸: 褪せの個体差
      // 沈んだボトルグリーン。鮮やかな青緑は嘘(#2E4A3C 〜 #3D5A48)
      // setHSL の既定はリニア作業色域。sRGB で指定しないと 2 段階明るく出る。
      // 全市が同じボトルグリーンだと、鎧戸が「テクスチャの一部」に見える。
      // 実物は 緑・焦茶・褪せた灰青 の 3 系統が混ざる。
      const sk = hash2((w.x * 17) | 0, (w.z * 19 + w.y * 5) | 0);
      if (sk < 0.50) col.setHSL(0.352 + s.seed * 0.024, 0.20 + s.seed * 0.10, 0.155 + s.seed * 0.055, THREE.SRGBColorSpace);
      else if (sk < 0.82) col.setHSL(0.070 + s.seed * 0.018, 0.26 + s.seed * 0.10, 0.175 + s.seed * 0.06, THREE.SRGBColorSpace);
      else col.setHSL(0.575 + s.seed * 0.025, 0.09 + s.seed * 0.05, 0.245 + s.seed * 0.08, THREE.SRGBColorSpace);
      if (colorToo) shutters.setColorAt(i, col);
    });
    shutters.instanceMatrix.needsUpdate = true;
  }
  placeShutters(true);
  shutters.castShadow = true;
  group.add(tagMesh(shutters, 'window.shutter', { solid: true, joinery: true }));

  // ===== 扉(石の枠と木の扉は別の素材 — 枠まで緑に塗らない)
  const frameRectGeo = (() => {
    const parts = [];
    const mk = (w, hh, x, y, d = 0.16) => { const g = new THREE.BoxGeometry(w, hh, d); g.translate(x, y, 0); return g; };
    parts.push(mk(0.16, 2.25, -0.58, 1.12));
    parts.push(mk(0.16, 2.25, 0.58, 1.12));
    parts.push(mk(1.32, 0.18, 0, 2.3));
    parts.push(mk(1.4, 0.09, 0, 0.03));   // 敷居
    return mergeGeoSimple(parts);
  })();
  const frameArchGeo = (() => {
    const parts = [];
    const mk = (w, hh, x, y, d = 0.18) => { const g = new THREE.BoxGeometry(w, hh, d); g.translate(x, y, 0); return g; };
    parts.push(mk(0.17, 2.3, -0.62, 1.15));
    parts.push(mk(0.17, 2.3, 0.62, 1.15));
    // アーチ環は「半円柱」ではなく壁面に貼る半円環。半円柱だと正面から
    // 見たとき内輪だけが見え、垂れ幕のような弧になる。
    const sh = new THREE.Shape();
    sh.moveTo(-0.7, 0);
    sh.absarc(0, 0, 0.7, Math.PI, 0, true);
    sh.lineTo(0.87, 0);
    sh.absarc(0, 0, 0.87, 0, Math.PI, false);
    sh.lineTo(-0.7, 0);
    sh.closePath();
    const arch = new THREE.ExtrudeGeometry(sh, { depth: 0.18, bevelEnabled: false, curveSegments: 10 });
    arch.translate(0, 2.3, 0);
    parts.push(arch);
    // 迫の内輪(通路の天井)— 開口が「壁に描いた弧」に見えないように
    const soff = new THREE.CylinderGeometry(0.7, 0.7, 0.30, 12, 1, true, 0, Math.PI);
    soff.rotateX(Math.PI / 2);
    soff.rotateZ(Math.PI);
    soff.translate(0, 2.3, -0.10);
    parts.push(soff);
    parts.push(mk(1.5, 0.09, 0, 0.03));
    return mergeGeoSimple(parts);
  })();
  // 扉葉は開口(clear 1.00×2.21)より小さく。大きいと枠を突き抜ける。
  const leafGeo = (() => {
    // 一枚板の扉は幅 1.8m の教会正面で必ず嘘になる。中央に合わせ框を入れて両開きに。
    const l = new THREE.PlaneGeometry(0.455, 2.10); l.translate(-0.248, 1.06, 0.035);
    const r = new THREE.PlaneGeometry(0.455, 2.10); r.translate(0.248, 1.06, 0.035);
    const m = new THREE.BoxGeometry(0.045, 2.10, 0.028); m.translate(0, 1.06, 0.045);
    return mergeGeoSimple([l, r, m]);
  })();
  const doorFrameMat = new THREE.MeshStandardMaterial({
    map: tex.dressed.map, normalMap: tex.dressed.normalMap,   // 戸口枠も一枚石
    color: 0xb3aa98, roughness: 0.70, envMapIntensity: 0.55,
  });
  const doorLeafMat = new THREE.MeshStandardMaterial({
    map: tex.wood.map, normalMap: tex.wood.normalMap, roughness: 0.85, envMapIntensity: 0.30,
    // 色はインスタンス側だけで決める。ここに 0x8a6446 を置くと
    // 「材質色 × インスタンス色 × 木目マップ」の三重掛けで扉が真っ黒(実測 sRGB 8)になる。
    color: 0xffffff,
  });
  const rectDoors = doors.filter(d => !d.arch), archDoors = doors.filter(d => d.arch);
  const doorFramesRect = new THREE.InstancedMesh(frameRectGeo, doorFrameMat, rectDoors.length);
  const doorFramesArch = new THREE.InstancedMesh(frameArchGeo, doorFrameMat, archDoors.length);
  const doorLeaves = new THREE.InstancedMesh(leafGeo, doorLeafMat, doors.length);
  {
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const place = (mesh, d, i) => {
      dummy.position.set(d.x + Math.sin(d.rotY) * 0.02, d.y, d.z + Math.cos(d.rotY) * 0.02);
      dummy.rotation.set(0, d.rotY, 0);
      dummy.scale.setScalar(d.big ? 1.85 : 0.95 + d.seed * 0.15);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    };
    rectDoors.forEach((d, i) => place(doorFramesRect, d, i));
    archDoors.forEach((d, i) => place(doorFramesArch, d, i));
    doors.forEach((d, i) => {
      place(doorLeaves, d, i);
      // 扉の色: 木地の茶〜深緑〜灰青(色褪せ)
      // 記念建築の大扉は色くじを引かない。焦げ茶の重い木。
      if (d.big) col.setHSL(0.070, 0.26, 0.62, THREE.SRGBColorSpace);
      else if (d.seed < 0.5) col.setHSL(0.068, 0.20 + d.seed * 0.16, 0.74 + d.seed * 0.16, THREE.SRGBColorSpace);
      else if (d.seed < 0.8) col.setHSL(0.345, 0.26, 0.68 + d.seed * 0.12, THREE.SRGBColorSpace);
      else col.setHSL(0.565, 0.16, 0.76, THREE.SRGBColorSpace);
      doorLeaves.setColorAt(i, col);
    });
  }
  doorFramesRect.receiveShadow = doorFramesArch.receiveShadow = true;
  group.add(tagMesh(doorFramesRect, 'door.frameRect', { solid: true, masonry: true }),
    tagMesh(doorFramesArch, 'door.frameArch', { solid: true, masonry: true }),
    tagMesh(doorLeaves, 'door.leaf', { thin: true, reason: '扉の葉は板(要立体化)', joinery: true }));

  // 城壁の内面の足元。街の中でいちばん面積の大きい石の面なのに、接地の
  // 汚れが 1 枚も無かった(実測 半径 16m に 0 枚)。石の量で言えば街の
  // 半分以上が「新品の CG」のまま立っていたことになる。
  {
    const loop2 = plan.wallPts.map(p2 => [p2[0], p2[1]]);
    for (let i = 1; i < plan.wallPts.length; i++) {
      const A = plan.wallPts[i - 1], B = plan.wallPts[i];
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (L < 2) continue;
      const ux = (B[0] - A[0]) / L, uz = (B[1] - A[1]) / L;
      let nx = -uz, nz = ux;
      const half = (plan.wallNodeHalf && plan.wallNodeHalf[i - 1]) || 2.2;
      const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2;
      // 市内側を向く法線(汚れは歩く側にしか付かない)
      if (!pointInPoly(loop2, mx + nx * (half + 1.2), mz + nz * (half + 1.2))) { nx = -nx; nz = -nz; }
      const n = Math.max(1, Math.round(L / 7));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const bx0 = lerp(A[0], B[0], t), bz0 = lerp(A[1], B[1], t);
        // 内面(市内側)と、外面のうち **人が歩く帯があるところ**(埠頭・
        // 防波堤・橋)。旧港のアーセナルの脚はここで拾う — 城壁の外面だが
        // 人が立つ床がある。海に落ちる外面は潮線(walls.js)の担当なので触らない。
        // **内面だけ。** 外面は裾に勾配(scarp)があり、岸壁の高さでは面が
        // 中心線から half + 0.7m ほど外へ出る。half で貼ると帯が壁から
        // 0.4m 離れて通路に浮き、歩行網スキャンが「石の中に立っている」と
        // 鳴った(実測 IN_SOLID 5 件)。半厚はデッキの厚みであって、
        // 足元の面の位置ではない。外面(アーセナルの脚)は
        // surround.js 側で頂点色として持たせてある。
        for (const sgn of [1]) {
          const ox = nx * sgn, oz = nz * sgn;
          const cx = bx0 + ox * half, cz = bz0 + oz * half;
          const g7 = plan.groundAt(cx + ox * 0.5, cz + oz * 0.5, 200);
          if (!g7 || g7.y === undefined || g7.y > 24) continue;
          // 門のまわりは壁体ではなく門ブロックが立つので、半厚は面の位置に
          // ならない(プロチェ門で 2 件鳴った)。門から 12m は貼らない。
          if (plan.GATES.some(g8 => Math.hypot(cx - g8.x, cz - g8.z) < 12)) continue;
          // 壁の面が **実際に露出している** 所だけ。多くの節では家が壁に
          // 突き当たっていて、そこに貼ると帯が家の中か通路の中に出る
          // (実測 歩行網スキャンで IN_SOLID 5 件 — 胸の高さの八方 6/8)。
          let hidden = false;
          for (const h2 of plan.houses) {
            if (Math.abs(cx - h2.x) < h2.w / 2 + 1.4 && Math.abs(cz - h2.z) < h2.d / 2 + 1.4) { hidden = true; break; }
          }
          if (hidden) continue;
          grimes.push({ x: cx + ox * 0.03, z: cz + oz * 0.03, rotY: Math.atan2(ox, oz),
            w: (L / n) * 0.98, h: 1.2 + hash2((cx * 3) | 0, (cz * 3) | 0) * 0.8, y: g7.y });
        }
      }
    }
  }

  // ===== 汚れ帯(接地の黒ずみ — 幾何で貼るからタイル状に繰り返さない)
  const grimeGeo = new THREE.PlaneGeometry(1, 1);
  grimeGeo.translate(0, 0.5, 0);
  // アルファ合成を HDR バッファで行うと、日向(シーンリニア 1.5)に
  // リニア 0.04 を α 0.31 で乗せても AgX 通過後に差が消える(実測 ΔL* 0.2)。
  // 乗算合成なら「暗くする」という意図が必ず伝わる。
  const grimeMat = multiplyDecal(new THREE.MeshBasicMaterial({
    map: tex.grime, transparent: true, depthWrite: false, opacity: 0.85,
    polygonOffset: true, polygonOffsetFactor: -1,
  }));
  const grimeMesh = new THREE.InstancedMesh(grimeGeo, grimeMat, grimes.length);
  {
    const dummy = new THREE.Object3D();
    grimes.forEach((g, i) => {
      dummy.position.set(g.x, g.y, g.z);
      dummy.rotation.set(0, g.rotY, 0);
      dummy.scale.set(g.w, g.h, 1);
      dummy.updateMatrix();
      grimeMesh.setMatrixAt(i, dummy.matrix);
    });
  }
  group.add(tagMesh(grimeMesh, 'house.grimeBand', { thin: true, reason: '接地の汚れ(デカール)', noCollide: true, decal: true }));

  // ===== 雨だれ(窓台・水切りの下)— 壁の履歴のうち最も読み取りやすい印。
  // 上向きの面(窓台・蛇腹)がある所には必ず下に筋が落ちる。
  {
    const stGeo = new THREE.PlaneGeometry(1, 1);
    stGeo.translate(0, -0.5, 0);   // 上端を原点に(窓台の下から垂らす)
    const stMat = multiplyDecal(new THREE.MeshBasicMaterial({
      map: tex.streak, transparent: true, depthWrite: false, opacity: 0.62,
      polygonOffset: true, polygonOffsetFactor: -1.4,
    }));
    const list = windows.filter(w => hash2((w.x * 31) | 0, (w.y * 29) | 0) < 0.62);
    const mesh = new THREE.InstancedMesh(stGeo, stMat, list.length);
    const dummy = new THREE.Object3D();
    list.forEach((w, i) => {
      const sc = scOf(w), asp = aspOf(w);
      const hh = 0.9 + hash2((w.x * 7) | 0, (w.z * 7) | 0) * 2.4;
      dummy.position.set(
        w.x + Math.sin(w.rotY) * 0.045, w.y - (OPEN_H / 2 + 0.20) * sc / asp, w.z + Math.cos(w.rotY) * 0.045,
      );
      dummy.rotation.set(0, w.rotY, 0);
      dummy.scale.set((OPEN_W + 0.44) * sc * asp, hh, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    group.add(tagMesh(mesh, 'window.reveal', { thin: true, reason: '見込みの奥の暗がり', noCollide: true, opening: true }));
  }

  // ===== ストラドゥンの店舗アーチ(clear 1.85×2.95m、膝高 0.72m のカウンター)
  if (shops.length) {
    const CW = 0.925, SPR = 2.05, DP = 0.24;   // 半幅 / 迫元高さ / 見付
    const arGeo = (() => {
      const shape = new THREE.Shape();
      shape.moveTo(-CW - 0.19, 0);
      shape.lineTo(-CW, 0);
      shape.lineTo(-CW, SPR);
      shape.absarc(0, SPR, CW, Math.PI, 0, true);
      shape.lineTo(CW, 0);
      shape.lineTo(CW + 0.19, 0);
      shape.lineTo(CW + 0.19, SPR);
      shape.absarc(0, SPR, CW + 0.19, 0, Math.PI, false);
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: DP, bevelEnabled: false, curveSegments: 10 });
      g.translate(0, 0, 0.035);
      // na koljeno は開口の「半分」がカウンター、残り半分が人の出入りする扉。
      // 全幅をカウンターで塞ぐと、店ではなく窓口になる。
      const counter = new THREE.BoxGeometry(CW + 0.05, 0.11, 0.42);
      counter.translate(-CW / 2 + 0.02, 0.72, 0.19);
      const cFront = new THREE.BoxGeometry(CW, 0.62, 0.09);
      cFront.translate(-CW / 2 + 0.02, 0.36, 0.14);
      const leafH = 2.05;                       // 扉の葉(開口の右半分)
      const leaf = new THREE.BoxGeometry(CW - 0.06, leafH, 0.055);
      leaf.translate(CW / 2 + 0.01, leafH / 2, 0.055);
      const jamb = new THREE.BoxGeometry(0.075, leafH + 0.06, 0.16);
      jamb.translate(0.02, (leafH + 0.06) / 2, 0.10);
      // 石材テクスチャの目地は横に走る。UV を入れ替えて縦の板目に見せる。
      const plank = (gg) => {
        const uv = gg.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * 2.6, uv.getX(i) * 0.22);
        return gg;
      };
      plank(leaf); plank(jamb);
      const sill = new THREE.BoxGeometry(CW * 2 + 0.42, 0.10, 0.16);
      sill.translate(0, 0.05, 0.06);
      // 扉の葉だけ木の色にする。インスタンス色は面ごとに変えられないので、
      // ジオメトリに頂点色を焼いて掛け合わせる(draw call は増えない)。
      const tint = (gg, c) => {
        const n = gg.attributes.position.count, a = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
        gg.setAttribute('color', new THREE.BufferAttribute(a, 3)); return gg;
      };
      const W = [1, 1, 1];
      return mergeGeoSimple([tint(g, W), tint(counter, [0.72, 0.66, 0.58]), tint(cFront, [0.30, 0.22, 0.15]),
        tint(leaf, [0.235, 0.135, 0.085]), tint(jamb, [0.22, 0.13, 0.08]), tint(sill, W)]);
    })();
    const arMat = new THREE.MeshStandardMaterial({
      map: tex.dressed.map, normalMap: tex.dressed.normalMap,   // 迫石も一枚石
      color: 0xa9a08e, roughness: 0.66, envMapIntensity: 0.5, vertexColors: true,
    });
    const arMesh = new THREE.InstancedMesh(arGeo, arMat, shops.length);
    // 店の奥の暗がり(開口が「穴」に見えるための黒)
    const darkGeo = new THREE.PlaneGeometry(CW * 2, SPR + CW * 0.9);
    darkGeo.translate(0, (SPR + CW * 0.9) / 2, 0.016);
    // 壁に本物の穴を開けずに奥行きを出す = インテリアマッピング。
    // 視線をフラグメントで箱に当てて、棚と商品をその場で描く。draw call は増えない。
    const darkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, envMapIntensity: 0.22 });
    darkMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          varying vec3 vIntV; varying vec2 vIntP;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
          #ifdef USE_INSTANCING
            mat4 imx = modelMatrix * instanceMatrix;
          #else
            mat4 imx = modelMatrix;
          #endif
          vec3 wp = (imx * vec4(transformed, 1.0)).xyz;
          vec3 Tt = normalize((imx * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
          vec3 Bt = normalize((imx * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          vec3 Nt = normalize((imx * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
          vec3 Vw = wp - cameraPosition;
          vIntV = vec3(dot(Vw, Tt), dot(Vw, Bt), dot(Vw, Nt));
          vIntP = position.xy;`);
      sh.uniforms.uShopOpen = shopOpen;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vIntV; varying vec2 vIntP; uniform float uShopOpen;
          float h11(float n) { return fract(sin(n * 127.1) * 43758.5453); }`)
        .replace('#include <map_fragment>', `
          const float CWl = 0.925, HHl = 2.88, DPl = 1.45;
          vec3 rd = normalize(vIntV);
          vec3 ro = vec3(vIntP, 0.0);
          float tz = rd.z < -1e-4 ? (-DPl - ro.z) / rd.z : 1e9;
          float tx = abs(rd.x) > 1e-4 ? ((rd.x > 0.0 ? CWl : -CWl) - ro.x) / rd.x : 1e9;
          float ty = abs(rd.y) > 1e-4 ? ((rd.y > 0.0 ? HHl : 0.0) - ro.y) / rd.y : 1e9;
          float t = min(tz, min(tx, ty));
          vec3 hp = ro + rd * max(t, 0.0);
          float depth01 = clamp(-hp.z / DPl, 0.0, 1.0);
          vec3 icol;
          if (t == tz) {
            icol = vec3(0.52, 0.46, 0.375);                    // 奥の壁(漆喰)
            float sy = hp.y - 0.30;
            float shelf = floor(sy / 0.56);
            float inShelf = step(0.0, sy) * step(sy, 2.30);
            // 棚板
            if (inShelf > 0.5 && fract(sy / 0.56) < 0.055) icol = vec3(0.24, 0.165, 0.105);
            else if (inShelf > 0.5) {
              float cell = floor((hp.x + CWl) / 0.185);
              float id = shelf * 37.0 + cell;
              float has = step(0.30, h11(id));
              float gh = 0.16 + 0.20 * h11(id * 2.7);
              float fy = fract(sy / 0.56) * 0.56;
              float gx = fract((hp.x + CWl) / 0.185);
              if (has > 0.5 && fy < gh && gx > 0.10 && gx < 0.90) {
                icol = 0.24 + 0.62 * vec3(h11(id * 1.7), h11(id * 2.3), h11(id * 3.1));
                icol = mix(vec3(dot(icol, vec3(0.33))), icol, 0.72) * vec3(1.10, 1.0, 0.86);
              }
            }
          } else if (t == ty) {
            icol = rd.y > 0.0 ? vec3(0.22, 0.195, 0.17) : vec3(0.33, 0.26, 0.20);   // 天井 / 床
          } else {
            icol = vec3(0.40, 0.35, 0.29);                      // 側壁
          }
          // 明るさは開口からの距離で落ちる。奥の壁が明るいと「絵を貼った」に見える。
          icol *= mix(1.0, 0.30, depth01 * depth01);
          icol += vec3(0.055, 0.042, 0.028) * smoothstep(2.3, 2.88, hp.y) * (1.0 - depth01 * 0.7);
          diffuseColor.rgb *= icol;`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          reflectedLight.directDiffuse *= 0.05;
          reflectedLight.directSpecular *= 0.05;
          // 営業中だけ灯が点く。空の間接光だけだと青い物置に見えるので、
          // 閉店時は棚も暗く落とす(閉まった店は「暗い」のであって「青い」のではない)。
          reflectedLight.indirectDiffuse += icol * vec3(0.62, 0.42, 0.20) * uShopOpen
            * mix(1.0, 0.42, clamp(-hp.z / 1.45, 0.0, 1.0));
          reflectedLight.indirectDiffuse *= mix(0.45, 1.0, uShopOpen);`);
    };
    darkMat.customProgramCacheKey = () => 'shopinterior';
    const darkMesh = new THREE.InstancedMesh(darkGeo, darkMat, shops.length);
    const dm = new THREE.Object3D();
    const cc = new THREE.Color();
    shops.forEach((sp, i) => {
      dm.position.set(sp.x, sp.y, sp.z);
      dm.rotation.set(0, sp.rotY, 0);
      dm.scale.setScalar(1);
      dm.updateMatrix();
      arMesh.setMatrixAt(i, dm.matrix);
      darkMesh.setMatrixAt(i, dm.matrix);
      cc.setHSL(0.112, 0.09, 0.70 + (sp.seed - 0.5) * 0.07, THREE.SRGBColorSpace);
      arMesh.setColorAt(i, cc);
    });
    arMesh.castShadow = true; arMesh.receiveShadow = true;
    group.add(tagMesh(arMesh, 'arcade.arch', { solid: true, masonry: true, groundContact: true }),
      tagMesh(darkMesh, 'arcade.shadow', { thin: true, reason: 'アーケード奥の暗がり', noCollide: true, opening: true }));

    // ===== 看板と日よけ — 「石の街」に「商いの街」を重ねる。
    // 全店が同じ顔で、看板も日よけも無いと、パン屋も宝石屋も見分けがつかない。
    // 板の紋章は 4x2 のアトラスから、インスタンスごとに UV をずらして選ぶ。
    {
      const dm5 = new THREE.Object3D();
      const CELL_U = 0.25, CELL_V = 0.5;
      // --- 吊り看板(錬鉄のブラケット + 板)
      const signGeo = (() => {
        const parts = [];
        const vcol = [];
        const put = (g, c) => {
          const n = g.attributes.position.count, arr = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) { arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2]; }
          g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
          // 板以外は UV をセルの隅(地色)に潰す
          const uv = g.attributes.uv;
          if (c[0] < 0.5) for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.012 + uv.getX(i) * 0.010, 0.012 + uv.getY(i) * 0.010);
          parts.push(g); return g;
        };
        const IR = [0.16, 0.155, 0.15];
        const bx = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
        put(bx(0.034, 0.30, 0.034, 0, 2.62, 0.055), IR);          // 壁付けの立ち上がり
        put(bx(0.030, 0.030, 0.62, 0, 2.76, 0.34), IR);           // 腕
        put(bx(0.026, 0.026, 0.34, 0, 2.585, 0.20), IR);          // 方杖(斜材の代わり)
        put(bx(0.020, 0.30, 0.020, 0, 2.62, 0.16), IR);           // 吊り金具 手前
        put(bx(0.020, 0.30, 0.020, 0, 2.62, 0.56), IR);           // 吊り金具 奥
        // 板(±x の大面にアトラスのセル 0 を貼る)
        const board = new THREE.BoxGeometry(0.040, 0.30, 0.52);
        board.translate(0, 2.32, 0.36);
        {
          const uv = board.attributes.uv;
          // BoxGeometry の面順: +x -x +y -y +z -z(各 4 頂点)
          for (let fi = 0; fi < 6; fi++) for (let k = 0; k < 4; k++) {
            const i = fi * 4 + k;
            if (fi < 2) uv.setXY(i, 0.015 + uv.getX(i) * (CELL_U - 0.03), 0.02 + uv.getY(i) * (CELL_V - 0.04));
            else uv.setXY(i, 0.012 + uv.getX(i) * 0.010, 0.012 + uv.getY(i) * 0.010);
          }
        }
        put(board, [1, 1, 1]);
        return mergeGeoSimple(parts);
      })();
      const signMat = new THREE.MeshStandardMaterial({
        map: tex.signs.map, vertexColors: true, roughness: 0.58, metalness: 0.0,
        envMapIntensity: 0.5,
      });
      signMat.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec2 aUvOff;')
          .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvMapUv += aUvOff;');
      };
      signMat.customProgramCacheKey = () => 'signatlas';
      const signList = shops.filter(sp => hash2((sp.x * 31) | 0, (sp.z * 29) | 0) < 0.62);
      if (signList.length) {
        const signOff = new Float32Array(signList.length * 2);
        const signs = new THREE.InstancedMesh(signGeo, signMat, signList.length);
        signList.forEach((sp, i) => {
          dm5.position.set(sp.x, sp.y, sp.z);
          dm5.rotation.set(0, sp.rotY, 0);
          const sc5 = 0.88 + hash2((sp.z * 13) | 0, (sp.x * 7) | 0) * 0.24;
          dm5.scale.setScalar(sc5);
          dm5.updateMatrix();
          signs.setMatrixAt(i, dm5.matrix);
          const k = (hash2((sp.x * 53) | 0, (sp.z * 47) | 0) * 8) | 0;
          signOff[i * 2] = (k % 4) * CELL_U;
          signOff[i * 2 + 1] = ((k / 4) | 0) * CELL_V;
        });
        signGeo.setAttribute('aUvOff', new THREE.InstancedBufferAttribute(signOff, 2));
        signs.castShadow = true;
        group.add(tagMesh(signs, 'shop.sign', { thin: true, reason: '看板は板', noCollide: true }));
      }
      // --- 日よけ(片流れの縞帆布)
      const awnGeo = (() => {
        const W = 1.05, Z0 = 0.10, Z1 = 1.30, Y0 = 2.98, Y1 = 2.52, VAL = 0.14;
        const P = [], N = [], U = [], I = [];
        const quad = (a2, b2, c2, d2, uvs) => {
          const i0 = P.length / 3;
          const ux = b2[0] - a2[0], uy = b2[1] - a2[1], uz = b2[2] - a2[2];
          const vx = d2[0] - a2[0], vy = d2[1] - a2[1], vz = d2[2] - a2[2];
          let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          const nl = Math.hypot(nx, ny, nz) || 1;
          for (const v of [a2, b2, c2, d2]) P.push(v[0], v[1], v[2]);
          for (let k = 0; k < 4; k++) N.push(nx / nl, ny / nl, nz / nl);
          U.push(...uvs);
          I.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
        };
        // 縞は 1 行 = 1/8。0.004 の余白で隣の色を拾わない。
        const v0 = 0.004, v1 = 0.121;
        quad([-W, Y0, Z0], [W, Y0, Z0], [W, Y1, Z1], [-W, Y1, Z1],
          [0, v0, 1.8, v0, 1.8, v1, 0, v1]);
        quad([-W, Y1, Z1], [W, Y1, Z1], [W, Y1 - VAL, Z1], [-W, Y1 - VAL, Z1],
          [0, v0, 1.8, v0, 1.8, v1 * 0.35, 0, v1 * 0.35]);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
        g.setIndex(I);
        return g;
      })();
      const awnMat = new THREE.MeshStandardMaterial({
        map: tex.awning.map, roughness: 0.92, side: THREE.DoubleSide, envMapIntensity: 0.25,
      });
      awnMat.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec2 aUvOff;')
          .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvMapUv += aUvOff;');
      };
      awnMat.customProgramCacheKey = () => 'awning';
      const awnList = shops.filter(sp => hash2((sp.x * 17 + 3) | 0, (sp.z * 23 + 5) | 0) > 0.56);
      if (awnList.length) {
        const awnOff = new Float32Array(awnList.length * 2);
        const awns = new THREE.InstancedMesh(awnGeo, awnMat, awnList.length);
        awnList.forEach((sp, i) => {
          dm5.position.set(sp.x, sp.y, sp.z);
          dm5.rotation.set(0, sp.rotY, 0);
          dm5.scale.setScalar(0.92 + hash2((sp.x * 11) | 0, (sp.z * 19) | 0) * 0.20);
          dm5.updateMatrix();
          awns.setMatrixAt(i, dm5.matrix);
          awnOff[i * 2] = 0;
          awnOff[i * 2 + 1] = ((hash2((sp.z * 41) | 0, (sp.x * 37) | 0) * 8) | 0) * 0.125;
        });
        awnGeo.setAttribute('aUvOff', new THREE.InstancedBufferAttribute(awnOff, 2));
        awns.castShadow = true;
        group.add(tagMesh(awns, 'shop.awning', { thin: true, reason: '日除けの布', noCollide: true }));
      }
    }
  }

  // ===== 巾木(base course)と縦樋 — 接地の説得力はここで決まる
  {
    const plinthGeo = new THREE.BoxGeometry(1, 0.40, 0.13);
    plinthGeo.translate(0, 0.20, 0.065);
    // 巾木は高さ 0.40m の帯に 3.2m 分が縦 8 倍圧縮で入り、段高 0.26m の切石が
    // 33mm の現代の煉瓦になっていた。巾木も一枚石の見付として扱う。
    const plinthMat = new THREE.MeshStandardMaterial({
      map: tex.dressed.map, normalMap: tex.dressed.normalMap,
      color: 0xb3aa98, roughness: 0.80, envMapIntensity: 0.35,
    });
    const pm = new THREE.InstancedMesh(plinthGeo, plinthMat, plinths.length);
    const dummy = new THREE.Object3D();
    plinths.forEach((p2, i) => {
      dummy.position.set(p2.x, p2.y, p2.z);
      dummy.rotation.set(0, p2.rotY, 0);
      dummy.scale.set(p2.w, 1, 1);
      dummy.updateMatrix();
      pm.setMatrixAt(i, dummy.matrix);
    });
    pm.castShadow = true; pm.receiveShadow = true;
    group.add(tagMesh(pm, 'house.plinth', { solid: true, masonry: true, groundContact: true }));

    // ===== 目の高さ(1.6m 以下)の造作
    // AAA の基準は「近づくほど新しい情報が出る」。ところが実測では逆で、
    // 舗装から 2.2m の帯は巾木と扉 1 枚しか無く、見上げたほう(鎧戸・壁灯・
    // 縦樋)が密だった。手の届く高さこそがいちばん密度が高いはず —
    // 敷居の一段、車除けの丸石、壁に埋まった石の吐水口と受け。
    {
      const bits = [];
      const put = (g, x, y, z, rotY) => {
        if (rotY) g.rotateY(rotY);
        g.translate(x, y, z);
        bits.push(g);
      };
      // 沓摺 — 扉の下に一段。扉は「壁に開いた穴」ではなく、敷居を持つ。
      for (const d of doors) {
        const w2 = d.big ? 1.85 : 1.35;
        // 沓摺の底面を舗石と同じ高さに置くと Z ファイティングする(実測 197 組)。
        // 一段は「地面より上に出ている分」だけが見えればよい。底は舗石の下へ。
        put(new THREE.BoxGeometry(w2, 0.22, 0.40), d.x, d.y + 0.02, d.z, d.rotY);
      }
      // 車除け石(paracarro)— 路地の口に立つ六角の切頭錐。荷車が角の石を
      // 削らないための石で、実物の旧市街の角には必ずある。
      for (const a of plan.streets) {
        if (a.kind !== 'alley') continue;
        const zEnds = [a.pts[0][1], a.pts[a.pts.length - 1][1]];
        for (const ze of zEnds) {
          const sgn = ze > (a.pts[0][1] + a.pts[a.pts.length - 1][1]) / 2 ? -1 : 1;
          const zb = ze + sgn * 1.5;
          const ax = plan.alleyXAt(a, zb);
          for (const sx of [-1, 1]) {
            const bx = ax + sx * (a.w / 2 + 0.42);
            const g5 = plan.groundAt(bx, zb, 200);
            if (!g5 || g5.y === undefined) continue;
            const c2 = plan.collide(bx, zb, 0.24, g5.y + 1.0);
            if (Math.hypot(c2.x - bx, c2.z - zb) > 0.10) continue;   // 壁の中には立てない
            const cone = new THREE.CylinderGeometry(0.16, 0.22, 0.62, 6);
            cone.translate(0, 0.31, 0);
            put(cone, bx, g5.y, zb, hash2((bx * 13) | 0, (zb * 17) | 0) * 1.05);
          }
        }
      }
      // 石の吐水口と受け皿 — 中庭の雨水を通りへ落とす。壁に埋まった石の匙。
      {
        const srng2 = rngFor(0x3c71);
        let made = 0;
        for (const h of plan.houses) {
          if (made >= 40 || h.garden || h.monument) continue;
          if (srng2() > 0.06) continue;
          const sgn = srng2() < 0.5 ? -1 : 1;
          const sx2 = h.x + sgn * (h.w / 2 + 0.10), sz2 = h.z + (srng2() - 0.5) * h.d * 0.5;
          const g6 = plan.groundAt(sx2 + sgn * 0.4, sz2, 200);
          if (!g6 || g6.y === undefined || Math.abs(g6.y - h.yBase) > 2.2) continue;
          const sp = new THREE.BoxGeometry(0.46, 0.11, 0.19);
          sp.translate(sgn * 0.20, 0, 0);
          put(sp, sx2, g6.y + 1.02, sz2, 0);
          const bowl = new THREE.CylinderGeometry(0.24, 0.19, 0.13, 8);
          bowl.translate(0, 0.065, 0);
          put(bowl, sx2 + sgn * 0.30, g6.y, sz2, 0);
          made++;
        }
      }
      if (bits.length) {
        const sg = mergeGeoSimple(bits);
        sg.computeVertexNormals();
        const smat = new THREE.MeshStandardMaterial({
          map: tex.dressed.map, normalMap: tex.dressed.normalMap,   // 街路に面した框石
          color: 0xb0a795, roughness: 0.82, envMapIntensity: 0.35,
        });
        bakeSkyVis(sg, skyAt0, { offsetY: 0.3 });
        patchSkyVis(smat);
        const sm = new THREE.Mesh(sg, smat);
        sm.castShadow = true; sm.receiveShadow = true;
        group.add(tagMesh(sm, 'house.streetStone', { solid: true, masonry: true, groundContact: true }));
      }
    }

    const pipeGeo = new THREE.CylinderGeometry(0.055, 0.055, 1, 7);
    pipeGeo.translate(0, 0.5, 0);
    // metalness 0.30 は物理的に存在しない(半金属)。亜鉛は金属。
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.85, envMapIntensity: 0.85 });
    const pipeMesh = new THREE.InstancedMesh(pipeGeo, pipeMat, pipes.length);
    const col2 = new THREE.Color();
    pipes.forEach((p2, i) => {
      dummy.position.set(p2.x, p2.y, p2.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, p2.h, 1);
      dummy.updateMatrix();
      pipeMesh.setMatrixAt(i, dummy.matrix);
      col2.setHSL(0.09, 0.05, 0.27 + p2.seed * 0.10, THREE.SRGBColorSpace);   // 亜鉛のグレー
      pipeMesh.setColorAt(i, col2);
    });
    pipeMesh.castShadow = true;
  group.add(tagMesh(pipeMesh, 'house.downpipe', { solid: true, small: true }));
  }

  const counts = {
    houses: plan.houses.length, windows: windows.length,
    shutters: shutterList.length, doors: doors.length,
    chimneys: chimneyPos.length, grime: grimes.length,
  };
  // 街の時計。鎧戸は 22:00〜07:00 で閉まり、店の灯は営業時間だけ点く。
  let clockBucket = -1;
  function setClock(h) {
    const bk = Math.round(h * 12);
    if (bk === clockBucket) return;
    clockBucket = bk;
    const k = Math.min(smoothstep(6.2, 8.4, h), 1 - smoothstep(21.4, 23.2, h));
    if (Math.abs(k - shutterOpenK) > 0.02) { shutterOpenK = k; placeShutters(false); }
    shopOpen.value = Math.min(smoothstep(7.6, 9.4, h), 1 - smoothstep(21.0, 22.8, h));
  }
  return { group, counts, windows, setClock };
}

// 夜の窓明かり(light.js が opacity を書く)
export const glassNightUniform = { value: 0 };
// 店の営業(0=閉店 1=営業)。「店は必ず灯が点いている」は文字通りだった。
export const shopOpen = { value: 1 };
export const litWindowsMat = new THREE.MeshBasicMaterial({
  color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
});

// BufferGeometryUtils なしの簡易マージ(非インデックス化して結合)
// 乗算デカール。HDR バッファ上のアルファ合成は AgX 通過後に差が消える(実測 ΔL* 0.2)。
// 乗算にすれば必ず伝わるが、素の乗算だとアルファ 0 の所まで暗くなる。
// アルファを「乗算の強さ」として使う: 結果 = 下地 × mix(1, 汚れ色, α)
function multiplyDecal(mat) {
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.DstColorFactor;
  mat.blendDst = THREE.ZeroFactor;
  mat.toneMapped = false;   // 係数はトーンマップしてはいけない
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <opaque_fragment>',
      'gl_FragColor = vec4(mix(vec3(1.0), diffuseColor.rgb, diffuseColor.a), 1.0);',
    );
  };
  mat.customProgramCacheKey = () => 'multiplyDecal';
  return mat;
}

function mergeGeoSimple(geos) {
  const nonIndexed = geos.map(g => g.toNonIndexed ? g.toNonIndexed() : g);
  let total = 0;
  for (const g of nonIndexed) total += g.attributes.position.count;
  const P = new Float32Array(total * 3), N = new Float32Array(total * 3), U = new Float32Array(total * 2);
  // 色属性を落とすと vertexColors:true の材質が真っ黒になる。持っている物だけ拾い、
  // 持たない物は白(=無変調)で埋める。
  const hasC = nonIndexed.some(g => g.attributes.color);
  const C = hasC ? new Float32Array(total * 3).fill(1) : null;
  let o = 0;
  for (const g of nonIndexed) {
    P.set(g.attributes.position.array, o * 3);
    N.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) U.set(g.attributes.uv.array, o * 2);
    if (C && g.attributes.color) C.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  if (C) out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return out;
}
