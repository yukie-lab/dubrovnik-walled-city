// ============================================================================
// ground.js — 大地と舗装。
// ・市内の基盤地形(家々と舗装の下地)
// ・城壁外: 南の海食岩棚 / 北の乾壕と山裾 / 西の入江 / 東の港底
// ・街路の舗装ストリップ(ストラドゥンだけ鏡面に磨く)
// ・StepPool: 市中のあらゆる石段を 1 つの InstancedMesh に束ねる
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, hash2, clamp, lerp, smoothstep, nearestOnPolyline, samplePolyline, polylineLength, pointInPoly, vnoise, fbm2, tagMesh } from './util.js';
import { streetY, farHeight } from './plan.js';
import { specularEnvTargets, sharedSkyVis } from './buildings.js';
import { makeSkyVis, patchSkyVis, bakeSkyVis, patchSkyVisInstanced, bakeSkyVisInstanced } from './skyvis.js';
import { patchWet } from './wet.js';



// ---------------------------------------------------- 城壁外の地形高 ----
// (実体は plan.outsideHeight に一元化 — 地面解決と描画が同じ真実を見る)
export function makeOutsideHeight(plan) {
  return plan.outsideHeight;
}
function _unusedLegacyOutsideHeight(plan) {
  const loop = plan.wallPts.map(p => [p[0], p[1]]);
  return function outsideHeight(x, z) {
    if (pointInPoly(loop, x, z)) return plan.terrainHeight(x, z) - 0.28;
    // 門前は橋・道の高さへ均す(門の外に山を作らない)
    let gateCarve = 1e9;
    for (const g of plan.GATES) {
      const dg = Math.hypot(x - g.x, z - g.z);
      if (dg < 20) gateCarve = Math.min(gateCarve, g.y - 0.5 + Math.max(0, dg - 8) * 0.25);
    }
    const nw = nearestOnPolyline(plan.wallPts, x, z);
    const kind = plan.wallKinds[Math.max(0, nw.i - 1)];
    const wk = plan.WALL_KIND[kind] || plan.WALL_KIND.sea;
    const d = Math.max(0, nw.d - wk.thick / 2);
    const rock = fbm2(x * 0.13, z * 0.13);

    // 東の港の水域と岸壁まわり
    if (x > 150 && z > -52 && z < 70 && x < 226) {
      if (x < 182 && z > -48 && z < 60) return 1.45;               // 岸壁の張り出しの下地
      return -2.2 + rock * 0.6;                                     // 港の水底
    }
    // 南・西 = 海へ落ちる石灰岩の岩棚
    if (z > 40 || x < -150) {
      const base = 3.6 + rock * 2.6;
      let y = base * Math.exp(-d / 8.5) - 1.6 * smoothstep(4, 22, d) + rock * 1.4 * Math.exp(-d / 20);
      // ロヴリイェナツの岩山(西の入江の向こう)
      const dl = Math.hypot(x + 215, z - 55);
      const lov = 24 * smoothstep(30, 8, dl);
      y = Math.max(y, lov - 0.5, -2.6);
      return Math.min(y, gateCarve);
    }
    // 北 = 乾壕(glacis)から山裾へ
    const innerY = nw.y - wk.parapet - 8;    // 壁の内側地面のだいたいの高さ
    const moat = innerY - 4.5 + rock * 1.2;
    const rise = smoothstep(18, 130, d) * (24 + fbm2(x * 0.02, z * 0.02) * 10);
    return Math.min(Math.max(moat + rise + d * 0.05, 0.5), gateCarve);
  };
}

// 遠景の山は plan.js が持つ(近景の landHeight が末端でそこへ寄せるため、
// plan → ground の向きに依存を作れない)。ここは再輸出だけ。
export { farHeight };

// ------------------------------------------------------------ StepPool ----
// 市中の全石段を 1 ドローコールへ。addRun(折れ線, 幅) で階段化。
export function makeStepPool(tex) {
  const items = []; // {x,y,z,rotY,w,d, tint, run, step}
  // 一続きの階段には通し番号を振る。「同じ run の中で蹴上が一段だけ違う」は
  // 置き間違いの決定的な兆候で、run を知らないと検出できない。
  let runId = 0;
  function addRun(pts3, w, { rise = 0.16 } = {}) {
    const run = runId++;
    // pts3: [[x,z,y],...] のランプ。全長と高低差から段を割る。
    for (let i = 1; i < pts3.length; i++) {
      const [x0, z0, y0] = pts3[i - 1], [x1, z1, y1] = pts3[i];
      const dh = y1 - y0;
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (Math.abs(dh) < rise * 1.2 || len < 0.01) continue;
      // 踏面に上限を掛けて段を増やすと、蹴上が勾配に比例して痩せる。
      // 南の路地(勾配 9.7%)では 5.8cm になり、階段ではなく躓きの元になる。
      // さらに致命的なのは、plan.js の quantizeRun が rise=0.16 で n を決める
      // ことで、視覚の段と足の段が別物になる(描かれていない段を体が登る)。
      // n は quantizeRun と同じ式でなければならない。
      const n = Math.max(1, Math.round(Math.abs(dh) / rise));
      const tread = len / n;
      const dirx = (x1 - x0) / len, dirz = (z1 - z0) / len;
      const rotY = Math.atan2(dirx, dirz);
      // quantizeRun と同じ格子: 段の面は t=k/n(k=0..n)。両端がランプの端に
      // ぴたり合い、途中の面はランプの ±半段に収まる。
      for (let s = 0; s <= n; s++) {
        // 折れ線の節では、前の区間の s=n と次の区間の s=0 が同じ場所に
        // 二重の段を出す。ただし **螺旋では重複ではない** — 2 枚は向きが
        // 違い、2 枚合わせて曲がりを埋めている。1 枚消したらミンチェタの
        // 井筒に 5.87m の穴が空いた。ほぼ真っ直ぐな節でだけ捨てる。
        if (s === 0 && i > 1) {
          const [px0, pz0] = pts3[i - 2], [px1, pz1] = pts3[i - 1];
          const pl = Math.hypot(px1 - px0, pz1 - pz0) || 1;
          const dot = ((px1 - px0) / pl) * dirx + ((pz1 - pz0) / pl) * dirz;
          if (dot > 0.94) continue;      // 向きの差が 20° 未満なら重複
        }
        const t = s / n;
        // **走りの両端の段は、着く床と同じ高さ**になる。石段の天板と床が
        // 同一平面で重なり、見る角度で交互に勝って **板がチラつく**
        // (見晴らしの砲座の天端 17.40 と最上段でユーザー報告)。
        // 段は「床へ上がるための石」であって床そのものではない。
        // 床がある側の端の段だけ 12mm 沈める — 影の線は残り、争いは消える。
        const endSink = (s === n && i === pts3.length - 1) || (s === 0 && i === 1) ? 0.012 : 0;
        items.push({
          x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t,
          y: y0 + dh * t - endSink,
          rotY, w, d: tread + 0.06,
          tint: 0.92 + hash2((x0 * 7 + s) | 0, (z0 * 7) | 0) * 0.16,
          run, seg: i, step: s, of: n,
        });
      }
    }
  }
  function finalize(skyAt) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, -0.5, 0); // 上面が y=0
    // テクスチャは共有せず複製(repeat を触ると舗装まで変わる)
    const stepMap = tex.paving.map.clone();
    stepMap.repeat.set(0.55, 0.16);   // 踏面は幅 2.9m × 奥行 0.5m。等方の repeat だと石目が 6:1 に伸びる
    const stepNrm = tex.paving.normalMap.clone();
    stepNrm.repeat.set(0.55, 0.16);
    const mat = new THREE.MeshStandardMaterial({
      map: stepMap, normalMap: stepNrm,
      roughness: 0.70, metalness: 0, envMapIntensity: 0.55,
    });
    // 路地の段は常に日陰側にある。天空可視率が無いと蹴上だけが青く浮く。
    if (skyAt) { bakeSkyVisInstanced(geo, items, skyAt, { offsetY: 0.25 }); patchSkyVisInstanced(mat); }
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    items.forEach((it, i) => {
      dummy.position.set(it.x, it.y, it.z);
      dummy.rotation.set(0, it.rotY, 0);
      dummy.scale.set(it.w, 0.55, it.d);   // 深めに沈めて隙間を見せない
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      col.setHSL(0.10, 0.15, 0.775 * it.tint, THREE.SRGBColorSpace);
      mesh.setColorAt(i, col);
    });
    mesh.castShadow = true; mesh.receiveShadow = true;
    // 石段は「置いた物」なので、1 段ごとに接地と蹴上を検証できるよう素データを渡す。
    // 段の箱は踏面が y=0、下へ 0.55m 伸びる — 舗装に沈めて隙間を見せないため。
    // つまり「箱の底」は接地面ではない。浮きだけを主張する物として宣言する。
    return tagMesh(mesh, 'steps', { solid: true, masonry: true, groundContact: true, buriedBase: true, steps: items });
  }
  return { addRun, finalize, items, get count() { return items.length; } };
}

// ------------------------------------------------------------- 舗装 ----
function stripGeometry(pts2, width, yAt, { step = 1.0, coverM = 5, edgeAO = 0.24, lift = 0.02 } = {}) {
  // 折れ線に沿う帯。頂点色で縁を沈める(建物際の翳り)。
  const L = polylineLength(pts2);
  const n = Math.max(2, Math.ceil(L / step));
  const positions = [], uvs = [], colors = [], indices = [];
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * L;
    const p = samplePolyline(pts2, Math.min(s, L - 0.001));
    const nx = -p.tz, nz = p.tx;
    // 4 列(±1 / ±0.42)。2 列だと |side| が常に 1 で edgeAO が定数になり、
    // 横断方向の階調がゼロ = 帯全体が一様に沈むだけになる。
    for (const side of [-1, -0.42, 0.42, 1]) {
      const px = p.x + nx * (width / 2) * side;
      const pz = p.z + nz * (width / 2) * side;
      // 高さは列ごとに測る。中心線の一点で決めて幅 6m の帯を張っていたので、
      // 傾いた通りでは描かれた石畳が当たり判定の面より最大 0.47m 高くなり、
      // そこに立つ人の足がその分だけ石に埋まっていた。
      positions.push(px, yAt(px, pz, s) + lift, pz);
      uvs.push((side * width / 2) / coverM, s / coverM);
      // 縁が沈み、中央がわずかに磨かれて明るい(轍)
      const a2 = Math.abs(side);
      const shade = 1 - edgeAO * (a2 ** 1.7) + 0.014 * (1 - a2);
      colors.push(shade, shade, shade);
    }
  }
  // 巻きは必ず上向き法線に。a=(i,左) b=(i,右) c=(i+1,左) d=(i+1,右) で
  // (a,b,c) の外積は w·ds·(nz·tx − nx·tz) = w·ds > 0 — 折れ線の向きに依らず上を向く。
  // (逆に巻くと帯は裏面になり、FrontSide カリングで上から消える = 石畳が無くなる)
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const a = i * 4 + k, b = i * 4 + k + 1, c = (i + 1) * 4 + k, d = (i + 1) * 4 + k + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

// 舗装に周期 34m の大きな明度のうねりを足す。6m のタイルだけだと、
// カメラに近いほど情報が減る(近景が画面でいちばん空虚になる)。
function macroVariation(mat, macroTex, periodM, amount) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uMacro = { value: macroTex };
    sh.uniforms.uMacroP = { value: periodM };
    sh.uniforms.uMacroA = { value: amount };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMacroPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vMacroPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMacroPos;\nuniform sampler2D uMacro;\nuniform float uMacroP, uMacroA;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        // grimeTex はアルファで描く暗いオーバーレイ。.r は 0〜0.043 しか無く、
        // (mv-0.5) が一度も 0 を跨がない = 一律の減光になる。.a を読む。
        float mv = texture2D(uMacro, vMacroPos.xz / uMacroP).a;
        float mv2 = texture2D(uMacro, vMacroPos.xz / (uMacroP * 4.3) + 0.37).a;
        // 片側だけの式は「変調」ではなく一律の減光。中心 0 の両側変調にする。
        diffuseColor.rgb *= 1.0 + uMacroA * 2.0 * (0.6 * (mv - 0.5) + 0.4 * (mv2 - 0.5));`);
  };
}

// 海草(ポシドニア)の色。海底の白い岩盤に斑で乗る。
const SEAGRASS = new THREE.Color().setHSL(0.255, 0.32, 0.185, THREE.SRGBColorSpace);

export function makeGround(plan, tex, stepPool) {
  const group = new THREE.Group();
  const skyAt = sharedSkyVis || makeSkyVis(plan);
  const outsideHeight = makeOutsideHeight(plan);

  // ---- 基盤地形(市内 + 岸まわり)
  {
    // 格子は plan.NEAR が持つ。ここで別に定義すると、plan.surfaceAt(= 物を
    // 置くときに見る面)と描かれる面が静かにずれる。
    // 北の縁を -190 で切ると、そこから先は 42m 格子の遠景しか無くなる。
    // 城壁外の起伏を戻したので、-190 の縁で 20m 超の崖になる。-320 まで伸ばす。
    const { x0, x1, z0, z1, nx, nz } = plan.NEAR;
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    // 低木の被覆率。マキは「色」だけでは出ない — 数メートルの粒が要る。
    // 灌木の粒テクスチャを岩肌に混ぜないと、斜面が滑らかな砂丘に見える。
    const scrubA = new Float32Array(pos.count);
    // 「決して濡れない床」の印。空壕の底は海面から 0.3m しか無いが海ではない。
    const dryA = new Float32Array(pos.count);
    const c = new THREE.Color();

    // ---- 先に高さを出し、「海が届く所」を海から辿って決める。
    // 汀の濡れ帯・海底の色は、これまで **高さだけ** で決めていた。だから
    // 海と繋がっていない低い床が全部「渚」になった — ピレの空壕(底 0.3m)は
    // 濡れて泡の縁まで走り、乾いた壕が川に見えていた。glacis(0.5m)も同じ。
    // 高さは「海かどうか」を決めない。**海から低地を塗り広げて**決める。
    const VN = pos.count, RW = nx + 1;
    const ys = new Float32Array(VN);
    for (let i = 0; i < VN; i++) {
      const y = outsideHeight(pos.getX(i), pos.getZ(i));
      ys[i] = y; pos.setY(i, y);
    }
    const seaConn = new Uint8Array(VN);
    {
      const q = [];
      for (let i = 0; i < VN; i++) {
        const ix = i % RW, iy = (i - ix) / RW;
        // 種は格子の外周(そこは必ず外洋)。内陸の窪みからは始めない。
        if (ys[i] < 0.02 && (ix === 0 || ix === nx || iy === 0 || iy === nz)) { seaConn[i] = 1; q.push(i); }
      }
      for (let h = 0; h < q.length; h++) {
        const i = q[h], ix = i % RW;
        for (const j of [ix > 0 ? i - 1 : -1, ix < nx ? i + 1 : -1, i - RW, i + RW]) {
          if (j < 0 || j >= VN || seaConn[j] || ys[j] >= 0.02) continue;
          seaConn[j] = 1; q.push(j);
        }
      }
      // 汀は水面のすぐ上まで続く。海に接する陸を 2 セル(6.4m)ぶん濡らす。
      for (let pass = 0; pass < 2; pass++) {
        const add = [];
        for (let i = 0; i < VN; i++) {
          if (seaConn[i] || ys[i] > 3.0) continue;
          const ix = i % RW;
          for (const j of [ix > 0 ? i - 1 : -1, ix < nx ? i + 1 : -1, i - RW, i + RW]) {
            if (j >= 0 && j < VN && seaConn[j] === 1) { add.push(i); break; }
          }
        }
        for (const i of add) seaConn[i] = 2;
        for (let i = 0; i < VN; i++) if (seaConn[i] === 2) seaConn[i] = 1;
      }
    }

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = ys[i];
      // 城壁の外はカルストのむき出しの岩と、乾いたマキ低木のまだら。
      // 一様な砂色にすると、アドリア海の岩の岸が砂丘に見える。
      const n = fbm2(x * 0.06, z * 0.06);
      const n3 = fbm2(x * 0.017 + 31, z * 0.017 - 19);
      // 海底の色は「高さ 0.4m 未満」だけで決めていた。ピレの空壕の底は
      // 0.3〜0.4m なので、乾いた壕が丸ごと**海底**の色(白い石灰岩 + 海草)
      // で塗られ、影に入ると水を張ったように青く見えていた。実物は乾壕で、
      // いまは庭。海底かどうかは高さだけでは決まらない。
      const moat = plan.moatAt(x, z);
      dryA[i] = seaConn[i] ? 0 : 1;
      if (y < 0.4 && seaConn[i]) {
        // 海底は白い石灰岩。暗い青緑で塗ると、浅場が光らない —
        // アドリア海のいちばん分かりやすい性質が丸ごと消える。
        // 深くなるほど藻と泥で暗く、わずかに緑へ。
        const dep = clamp(-y / 12, 0, 1);
        // 明度 0.90 は「白紙」。実在の石灰岩礫の海底はアルベド 0.45〜0.6 で、
        // ドゥブロヴニクの浅場は #7ad4d8〜#a8e4e0(彩度 25〜45%)のターコイズ。
        // 明度を上げて彩度を落としていたので、浅場が彩度 2% の乳白になっていた。
        c.setHSL(0.112 - dep * 0.030, 0.13 + dep * 0.09, 0.74 - dep * 0.34 + n * 0.16, THREE.SRGBColorSpace);
        // ポシドニアの藻場。アドリア海の底は一面の白砂ではなく、白い岩盤に
        // 濃い緑褐色の海草が斑に生える。これが無いと浅場が一様な白になり、
        // 水面が「牛乳をこぼした」ように飛ぶ。二層重ねて、大きな藻場の中に
        // 岩の抜けを作る(実測の海底コントラストは 3.3% しかなかった)。
        const gr = clamp(smoothstep(0.42, 0.64, fbm2(x * 0.028 + 71, z * 0.028 - 53))
          + smoothstep(0.56, 0.74, fbm2(x * 0.11 + 13, z * 0.11 + 29)) * 0.45, 0, 1)
          * (1 - dep * 0.30) * (0.35 + 0.65 * smoothstep(0.25, 1.6, -y));
        c.lerp(SEAGRASS, gr * 0.95);
      } else if (pointInPoly(plan.wallPts, x, z)) {   // util の署名は (poly, x, z)
        c.setHSL(0.105 + n * 0.012, 0.09 + n * 0.05, 0.80 + n * 0.10, THREE.SRGBColorSpace);   // 市内(踏み固めた石灰岩の砂利)
      } else {
        const hx = outsideHeight(x + 4, z) - outsideHeight(x - 4, z);
        const hz = outsideHeight(x, z + 4) - outsideHeight(x, z - 4);
        const slope = Math.hypot(hx, hz) / 8;
        // 城壁の外は「剥き出しの白い石灰岩に低木がまだら」であって、その逆ではない。
        // 実測の平均 slope は 0.21 で、閾値 0.30 だと傾き項が平均でゼロ寄与だった
        // (rockF < 0.3 が 81.6%、> 0.9 は 2.4% = 暗いマキ一色)。
        // 壁際(踏み固められた glacis)は岩、斜面を登るほどマキが matrix になる。
        // 高さを見ないと、スルジの裾まで一様に白い岩の砂丘に見える。
        const rockF = clamp(smoothstep(0.10, 0.45, slope) * 0.85 + (n3 - 0.5) * 1.05 + 0.20
          - smoothstep(16, 52, y) * 0.44, 0, 1);
        const scrubC = new THREE.Color().setHSL(0.232 - n * 0.05, 0.26 + n3 * 0.12, 0.155 + n * 0.06, THREE.SRGBColorSpace);
        const rockC = new THREE.Color().setHSL(0.105 + n * 0.012, 0.10, 0.40 + n * 0.12, THREE.SRGBColorSpace);
        c.copy(scrubC).lerp(rockC, rockF);
        scrubA[i] = 1 - rockF;   // 低木の被覆率(テクスチャの混ぜ率に使う)
        // 空壕の底は平ら = 傾きが 0 なので rockF が沈み、斜面の暗いマキ
        // (明度 0.155)で塗られる。日陰に入ると暗い水面に見える。実物は
        // 手入れされた庭 — 砂利と芝の明るい床に寄せる。
        if (moat > 0.02) {
          c.lerp(new THREE.Color().setHSL(0.198 + n * 0.030, 0.20 + n3 * 0.10,
            0.44 + n * 0.10, THREE.SRGBColorSpace), moat * 0.92);
          // 低木の粒はむしろ残す。均された滑らかな面は、色を変えても水に見える。
          scrubA[i] = Math.max(scrubA[i], moat * 0.55);
        }
      }
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('aScrub', new THREE.BufferAttribute(scrubA, 1));
    g.setAttribute('aDry', new THREE.BufferAttribute(dryA, 1));
    g.computeVertexNormals();
    const nearMat = new THREE.MeshStandardMaterial({
      map: tex.rock.map, normalMap: tex.rock.normalMap, vertexColors: true,
      roughness: 0.9, metalness: 0,
      envMapIntensity: 0.30,   // 既定の 1.0 だと水面下の海底に太陽の鏡面が乗る
    });
    // 岩棚や壕の急斜面で平面投影が縦に伸びる。三平面で潰す。
    nearMat.onBeforeCompile = (sh) => {
      sh.uniforms.mapScrub = { value: tex.scrub.map };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\nattribute float aScrub;\nvarying float vScrub;')
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWNrm = normalize(mat3(modelMatrix) * objectNormal);
          vScrub = aScrub;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\nvarying float vScrub;\nuniform sampler2D mapScrub;')
        .replace('#include <map_fragment>', `
          vec3 tw = abs(vWNrm) / max(length(vWNrm), 1e-4);
          tw = max(tw, vec3(1e-3));
          tw = tw * tw * tw;
          tw /= max(tw.x + tw.y + tw.z, 1e-4);
          float cm = ${'${COVER}'};
          vec4 sampledDiffuseColor =
              texture2D(map, vWPos.xz / cm) * tw.y
            + texture2D(map, vWPos.zy / cm) * tw.x
            + texture2D(map, vWPos.xy / cm) * tw.z;
          // マキ(garrigue)の粒。二つの縮尺で重ねると、株の塊と株そのものが
          // 同時に出て、斜面が「滑らかな砂丘」から「風に刈られた低木の海」になる。
          float sc = clamp(vScrub, 0.0, 1.0);
          if (sc > 0.01) {
            vec4 sb = texture2D(mapScrub, vWPos.xz / ${'${SCOVER}'}) * 0.62
                    + texture2D(mapScrub, vWPos.xz / ${'${SCOVER2}'} + vec2(0.37, 0.11)) * 0.38;
            sampledDiffuseColor = mix(sampledDiffuseColor, sb, sc * 0.88);
          }
          diffuseColor *= sampledDiffuseColor;`
          .replace('${COVER}', tex.rock.coverM.toFixed(2))
          .replace('${SCOVER}', (tex.scrub.coverM * 0.45).toFixed(2))
          .replace('${SCOVER2}', (tex.scrub.coverM * 0.14).toFixed(2)));
    };
    bakeSkyVis(g, skyAt, { offsetY: 0.9 });
    patchSkyVis(nearMat);
    macroVariation(nearMat, tex.grime, 26.0, 0.20);   // 数mスケールの情報が無いと岩肌が砂に見える
    patchWet(nearMat, { wet: 0.34, top: 0.55, foam: 0.22, dry: true });   // 汀の濡れ帯
    const m = new THREE.Mesh(g, nearMat);
    m.receiveShadow = true;
    // UV 実寸
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / tex.rock.coverM, pos.getZ(i) / tex.rock.coverM);
    group.add(tagMesh(m, 'ground.near', { terrain: true, openSurface: true }));
  }

  // ---- 遠景の山と丘(スルジ・ラパド・東海岸)
  {
    const x0 = -2300, x1 = 2500, z0 = -2300, z1 = 700, step = 42;
    const nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step);
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      // 近景リングと重ならないよう内側は海面下へ
      const inNear = x > -290 && x < 300 && z > -310 && z < 320;
      // 遠景も海底図と同じ断面にする。近景(私の断面)と遠景(平坦 −2.5)が
      // 食い違うと、そこに一本の横線が出て「水の色が段で変わる」ように見える。
      let y = inNear ? -2.8 : farHeight(x, z);
      if (y < 0.05) {
        const sub = outsideHeight(x, z);      // 近景メッシュと完全に同じ海底断面
        if (sub < 0.05) {
          // 近景リングの内側では遠景を必ず下へ逃がす。逃がさないと、平坦な
          // −2.8 のスラブが本物の海底(−30m)より上に出て深度テストに勝ち、
          // 「近景の矩形だけ一定の浅瀬色」という四角い継ぎ目になる。
          // 逃がし量はリング境界で 0 に落として段差を作らない。
          const dE = Math.min(x + 290, 300 - x, z + 180, 320 - z);
          y = Math.min(y, sub - (inNear ? 4.5 * smoothstep(0, 70, dE) : 0));
        }
      }
      pos.setY(i, y);
      // スルジは砂丘ではない。石灰岩のカルストに、乾いたマキ低木(暗いオリーブ)が
      // まだらに乗る。急斜面ほど岩が出る。色は高さではなく「傾き」で決まる。
      const hx = farHeight(x + 24, z) - farHeight(x - 24, z);
      const hz = farHeight(x, z + 24) - farHeight(x, z - 24);
      const slope = Math.hypot(hx, hz) / 48;
      const n = fbm2(x * 0.008, z * 0.008);
      const n2 = fbm2(x * 0.031 + 11, z * 0.031 - 7);
      // 実測の遠景 slope は平均 0.23 / 最大 0.94。閾値 0.42 では岩が一度も出ず、
      // スルジが暗いマキ低木一色の板になっていた。
      const rockF = clamp(smoothstep(0.12, 0.55, slope) * 0.85
        + smoothstep(120, 260, y) * 0.65 + (n2 - 0.5) * 0.5, 0, 1);
      const scrubC = new THREE.Color().setHSL(0.235 - n * 0.045, 0.26 + n2 * 0.10, 0.155 + n * 0.055, THREE.SRGBColorSpace);
      const rockC = new THREE.Color().setHSL(0.105 + n2 * 0.012, 0.11, 0.50 + n * 0.10, THREE.SRGBColorSpace);
      c.copy(scrubC).lerp(rockC, rockF);
      if (y < 6) c.lerp(new THREE.Color().setHSL(0.10, 0.10, 0.46, THREE.SRGBColorSpace), smoothstep(6, -1, y));
      // 水面下は近景と同じ白い石灰岩に。ここだけ違う色で塗ると、近景格子の
      // 縁で水の色が四角く切り替わる(海面に矩形の継ぎ目が出る)。
      if (y < 0.4) {
        const dep = clamp(-y / 12, 0, 1);
        c.setHSL(0.112 - dep * 0.030, 0.06 + dep * 0.11, 0.80 - dep * 0.44 + n * 0.07, THREE.SRGBColorSpace);
        const gr = clamp(smoothstep(0.42, 0.64, fbm2(x * 0.028 + 71, z * 0.028 - 53))
          + smoothstep(0.56, 0.74, fbm2(x * 0.11 + 13, z * 0.11 + 29)) * 0.45, 0, 1)
          * (1 - dep * 0.30) * (0.35 + 0.65 * smoothstep(0.25, 1.6, -y));
        c.lerp(SEAGRASS, gr * 0.95);
      }
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 60, pos.getZ(i) / 60);
    const farMat = new THREE.MeshStandardMaterial({
      map: tex.scrub.map, vertexColors: true, roughness: 0.95, metalness: 0,
      envMapIntensity: 0.35,   // 草木に空の鏡面は出ない
    });
    // 平面投影のままだと急斜面でテクスチャが縦に伸び、山肌が「垂れた布」になる。
    // 三平面投影(法線で重み付け)に差し替える。
    farMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWNrm = normalize(mat3(modelMatrix) * objectNormal);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
        .replace('#include <map_fragment>', `
          vec3 tw = abs(vWNrm) / max(length(vWNrm), 1e-4);
          tw = max(tw, vec3(1e-3));
          tw = tw * tw * tw;
          tw /= max(tw.x + tw.y + tw.z, 1e-4);
          vec4 sampledDiffuseColor =
              texture2D(map, vWPos.xz / 60.0) * tw.y
            + texture2D(map, vWPos.zy / 60.0) * tw.x
            + texture2D(map, vWPos.xy / 60.0) * tw.z;
          diffuseColor *= sampledDiffuseColor;`);
    };
    patchWet(farMat, { foam: 0.35 });   // 遠景の岸も同じ汀を持つ
    const m = new THREE.Mesh(g, farMat);
    group.add(tagMesh(m, 'ground.far', { terrain: true, openSurface: true, backdrop: true }));
  }

  // ---- 街路の舗装
  const paveGeoms = [];
  const stradunGeoms = [];
  for (const s of plan.streets) {
    const yAt = (x, z) => streetY(s, x, z);
    const isStradun = s.kind === 'stradun';
    const g = stripGeometry(s.pts, s.w + 0.9, yAt, {
      coverM: isStradun ? tex.stradun.coverM : tex.paving.coverM,
      edgeAO: s.kind === 'alley' ? 0.34 : 0.20,
      // 帯どうしが同じ高さで重なると Z ファイトする。種別ごとに 6mm ずつずらす。
      // 帯どうしが同じ高さで重なると Z ファイトする。種別ごとにずらすが、
      // 0.014〜0.026m は「足が石に埋まる量」そのもの。
      // 間隔は coplanar 検査の閾値(4mm)より広く、かつ足が沈む量として
      // 気づかれない範囲で刻む(実測 中央 +0.026 → +0.007)。
      lift: isStradun ? 0.012 : s.kind === 'alley' ? 0.002 : 0.007,
    });
    (isStradun ? stradunGeoms : paveGeoms).push(g);

    // 勾配のきつい路地は階段化(足の量子化と同じ共有サンプル・同じ段フラグ)
    if (s.kind === 'alley') {
      for (const seg of plan.alleySamples(s).segs) {
        if (seg.stepped) stepPool.addRun([seg.a, seg.b], s.w + 0.95);
      }
    }
  }
  // 門の敷居。舗装の帯は街路の中心線から (w+0.9)/2 までしか無いので、門が
  // その帯の外に立つと、通路の床だけが素地形に落ちる(実測: ポンテ門で
  // 通路 1.53m / 湊の舗装 1.72m = 0.19m の段。跨いだ瞬間に床が上がる)。
  // 敷居は「歩ける面」そのものに敷く。描かれる床と足の高さが必ず一致する。
  for (const g of plan.GATES) {
    const ax = g.tz, az = -g.tx;                     // 通路の軸(壁の法線)
    // 敷居は門の通路を覆うためのもので、門の外の取り付きは橋や埠頭が
    // 自前の床を持っている。それでも ±6.5m の固定長・固定幅で張っていたので、
    // ピレ門では帯が橋の欄干より外へはみ出し、**壕の上に宙に浮いた板**が
    // 4m 突き出していた(下の実地面は 0.29m、帯は下限 2.0m で止まる)。
    // 下の「クランプ」は帯が壁体へせり上がるのを止めるためのもので、
    // 実地面がはるか下にあるときは逆に板を空中で支えてしまう。
    // 支えのある所までで切る — 帯の両縁が門の高さの床に載っている station だけ残す。
    const HW = (g.w + 3.0) / 2;
    const supported = (t) => {
      const cx2 = g.x + ax * t, cz2 = g.z + az * t;
      for (const sgn of [-1, 1]) {
        const q = plan.groundAt(cx2 - az * HW * sgn, cz2 + ax * HW * sgn, g.y);
        if (!q || q.y === undefined || Math.abs(q.y - g.y) > 0.45) return false;
      }
      return true;
    };
    const ts = [];
    for (let t = -6.5; t <= 6.5001; t += 2.6) ts.push(Number(t.toFixed(3)));
    const mid = ts.reduce((b, t) => (Math.abs(t) < Math.abs(b) ? t : b), ts[0]);
    let lo = ts.indexOf(mid), hi = lo;
    while (lo > 0 && supported(ts[lo - 1])) lo--;
    while (hi < ts.length - 1 && supported(ts[hi + 1])) hi++;
    if (hi - lo < 1) { lo = Math.max(0, lo - 1); hi = Math.min(ts.length - 1, lo + 1); }
    const pts2 = ts.slice(lo, hi + 1).map((t) => [g.x + ax * t, g.z + az * t]);
    // groundAt は curY を渡さないと層の解決が全て tier 0 に落ち、**最初の候補**
    // を返す。門の高さを渡さないと、歩廊デッキ(pri 6)や広場を拾って敷居が
    // 0.74m せり上がり、歩行網スキャンで「足の上に床がある」と鳴る。
    const geo = stripGeometry(pts2, g.w + 3.0, (x, z) => {
      const q = plan.groundAt(x, z, g.y);
      const yy = (q && q.y !== undefined) ? q.y : plan.surfaceAt(x, z);
      // 敷居は門の床。帯の外側の列は壁体や堀にかかるので、門の高さから
      // 大きく離れた値を拾わせない(離すと敷居が壁の中へせり上がる)。
      return Math.max(g.y - 0.8, Math.min(g.y + 0.35, yy));
    }, { coverM: tex.paving.coverM, edgeAO: 0.22, lift: 0.017 });
    paveGeoms.push(geo);
  }

  // 広場
  for (const p of plan.PLAZAS) {
    // 舗装を羽根ぶん広げると街路と重なり、床が 1m 浮く。広場は素の矩形のまま。
    const g = new THREE.PlaneGeometry(p.x1 - p.x0, p.z1 - p.z0, 2, 2);
    g.rotateX(-Math.PI / 2);
    g.translate((p.x0 + p.x1) / 2, p.y + 0.02, (p.z0 + p.z1) / 2);
    const uv = g.attributes.uv, pos = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / tex.stradun.coverM, pos.getZ(i) / tex.stradun.coverM);
    const colors = new Float32Array(pos.count * 3).fill(0.80);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // 広場はストラドゥンほど磨かれていない(摩耗した不規則な敷石)。
    // 磨いた材質に入れると、水平面が天頂の青を拾って「青い舗石」になる。
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / tex.paving.coverM, pos.getZ(i) / tex.paving.coverM);
    paveGeoms.push(g);
  }
  // イエズス会の大階段(幅広の儀典階段)
  {
    const js = plan.JESUIT_STAIR;
    // 教会正面(-z 向き)の真下へ、z 方向に昇る儀典階段。
    stepPool.addRun(
      [[(js.x0 + js.x1) / 2, js.z0, js.yLow], [(js.x0 + js.x1) / 2, js.z1, js.yHigh]],
      js.x1 - js.x0, { rise: 0.155 },
    );
  }

  // ---- マージして素材ファミリーごと 1 ドローコールに
  {
    const pave = mergeGeometries(paveGeoms);
    const paveMat = new THREE.MeshStandardMaterial({
      map: tex.paving.map, normalMap: tex.paving.normalMap,
      // roughnessMap はこれまでストラドゥンにしか無く、路地の舗石は一様マット。
      // 「濡れた所・磨かれた所・目地」の差が出せず、太陽の白が一様に張り付いていた。
      roughnessMap: tex.paving.roughnessMap,
      vertexColors: true, roughness: 0.86, metalness: 0, envMapIntensity: 0.58,
    });
    macroVariation(paveMat, tex.grime, 11.0, 0.18);
    bakeSkyVis(pave, skyAt, { offsetY: 0.9 });
    patchSkyVis(paveMat);
    // 埠頭の天端は y≈1.5〜1.7m。top 0.50 では above が常に 1.0 以上になり、
    // 濡れ帯が一度も発火しなかった(実測: 水際と内陸の輝度差 0.1% 未満)。
    patchWet(paveMat, { wet: 0.62, top: 1.60, foam: 0.45 });
    const paveMesh = new THREE.Mesh(pave, paveMat);
    paveMesh.receiveShadow = true;
    group.add(tagMesh(paveMesh, 'ground.paving', { openSurface: true, layer: 'paving' }));

    // ストラドゥン: 何世紀もの足に磨かれた石。空と立面の照りを引き受ける。
    const stradun = mergeGeometries(stradunGeoms);
    const stradunMat = new THREE.MeshStandardMaterial({
      map: tex.stradun.map, normalMap: tex.stradun.normalMap,
      roughnessMap: tex.stradun.roughnessMap,
      // 逆光の掠め角で D(0) ∝ 1/α⁴ が効き、路面のピーク鏡面が linear 11 に達して
      // 画面の 5.5% が sRGB 253〜255 に貼り付いていた(階調ゼロの「白い舌」)。
      // 0.62 → 0.74 でピークは 0.30 倍。磨かれた石という性格は残る。
      // 白飛びを材質で潰すと、逆光でも夜でも路面が一度も光らない(実測 局所SD
      // r=2 が 0.0033、夜の街灯 8 個の映り込みが 1 本も無い)。
      // 白飛びは材質ではなく **鏡面の上限** で切る(下の lights_fragment_end)。
      vertexColors: true, roughness: 0.60, metalness: 0.0,
      color: 0xf0e3c6,        // 頂点色×テクスチャに石灰岩の温みを重ねる
      envMapIntensity: 0.62,  // 700年の靴に磨かれた石。ここが画面で唯一の「真の白」を作る
    });
    {
      // 太陽の芯だけ切る。路面を走る照りの「形」は残す。
      const prevOBC = stradunMat.onBeforeCompile;
      stradunMat.onBeforeCompile = (sh, r) => {
        if (prevOBC) prevOBC.call(stradunMat, sh, r);
        sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>',
          '#include <lights_fragment_end>\n  reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(3.2));');
      };
    }
    // 700年の靴に磨かれた石。鏡面に太陽が映らなければ「照り」は出ない。
    specularEnvTargets.push(stradunMat);
    macroVariation(stradunMat, tex.grime, 9.0, 0.12);   // 磨いた石は変調が浅い
    bakeSkyVis(stradun, skyAt, { offsetY: 0.9 });
    patchSkyVis(stradunMat);
    const stradunMesh = new THREE.Mesh(stradun, stradunMat);
    stradunMesh.receiveShadow = true;
    group.add(tagMesh(stradunMesh, 'ground.stradun', { openSurface: true, layer: 'paving' }));
  }

  return { group, outsideHeight };
}
