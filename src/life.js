// ============================================================================
// life.js — 無人でも生きている街。
// 洗濯物(ロープは壁の金具へ・布はロープ支点で個別に揺れる)、
// 鉢植えの緑、日なたの猫、カフェの積まれた椅子、夕暮れに屋根を旋回する
// アマツバメ、港のカモメ。すべてインスタンスか小さなマージ。
// ============================================================================
import * as THREE from 'three';
import { mulberry32, hash2, clamp, lerp, smoothstep, nearestOnPolyline, polylineLength, tagMesh } from './util.js';
import { rngFor } from './seed.js';
import { sharedSkyVis } from './buildings.js';
import { makeSkyVis, urbanTint, bounceRad, patchSkyVisInstanced } from './skyvis.js';

// 人・鉢・卓・日除けは「街の中」にいるのに、街の遮蔽も照り返しも受けていなかった。
// 実測: 白シャツ B/R 0.64 に対し 2m 隣の壁 0.31、輝度差 3.0 段。
// 頂点ではなくインスタンス単位で天空可視率を持たせる(動く物なので焼けない)。
// 影パス用。頂点変形を深度マテリアルにも掛けないと、歩いている人も座っている人も
// 「直立で腕を下ろした姿」の影を落とす。付属品も 3 種すべての影が同時に出る。
function depthFor(mat) {
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  d.onBeforeCompile = mat.onBeforeCompile;
  d.customProgramCacheKey = () => (mat.customProgramCacheKey ? mat.customProgramCacheKey() : '') + '|depth';
  return d;
}


export function makeLife(plan, tex, stepPool) {
  // 時刻で変わるもの。update() が行列を書き換えるだけの設計だったので、
  // 深夜 2 時のカフェも 23 時の市場も 03:30 の全開の鎧戸も、そのまま出ていた。
  // 洗濯物のメッシュは関数の頭で作られるので、宣言はここに置く。
  const clock = { bucket: -1, market: null, parasols: null, cloths: null };
  // パラソルの開閉は時刻の関数(店ごとにずれる)。毎フレーム時刻だけ渡す。
  const parasolHour = { value: 12 };
  // 街の遮蔽(天空可視率)。buildings が先に作った物を使い回す。
  const skyAt = sharedSkyVis || makeSkyVis(plan);
  const skyOf = (x, z, y) => 0.5 * (skyAt(x, z, y, 0, 1, 0) + skyAt(x, z, y, 0, 0.2, 1));
  const group = new THREE.Group();
  let lampNight = null;
  const rng = rngFor(0x11fe);

  // ------------------------------------------------------------ 洗濯物 ----
  // 路地ごとに 2〜3 本。両側の家の壁面(2〜3階の高さ)に金具で張る。
  const ropes = [];   // {x0,y0,z0, x1,y1,z1}
  const cloths = [];  // {x,y,z, w,h, phase, colorSeed, rotY}
  const alleys = plan.streets.filter(s => s.kind === 'alley');
  // 東西の通り(プリイェコ・ペリーネ・オドプチャ…)は「住んでいる部分」その
  // もので、実物ではここがいちばん洗濯物の多い通り。なのに生活が路地にしか
  // 付いていなかった(kind === 'alley' でしか回していなかった)ので、
  // s04_prijeko は手前 30m が完全な無人・無生活だった。
  //
  // 張り方は路地も通りも同じ — 「通りを跨いで両側の家の壁に張る」。
  // 違うのは軸だけ。式を書き写すと、いつか片方だけ直す。
  const ewStreets = plan.streets.filter(s => s.kind === 'street');
  const hangLaundry = (s, alongZ) => {
    const P0 = s.pts[0], P1 = s.pts[s.pts.length - 1];
    // 路地は 2 点の直線とは限らない(南の街区は曲がる)。z ごとに中心を引く。
    const avAt = (u2) => (alongZ ? plan.alleyXAt(s, u2) : P0[1]);
    const uA = alongZ ? P0[1] : P0[0], uB = alongZ ? P1[1] : P1[0];
    const uMin = Math.min(uA, uB), uMax = Math.max(uA, uB);
    const uOf = (h) => (alongZ ? h.z : h.x);              // 家の「通りに沿う」座標
    const vOf = (h) => (alongZ ? h.x : h.z);              // 家の「通りを跨ぐ」座標
    const halfAlong = (h) => (alongZ ? h.d : h.w) / 2;
    const halfCross = (h) => (alongZ ? h.w : h.d) / 2;
    const n = alongZ ? 7 + (rng() * 5 | 0) : Math.max(6, Math.round((uMax - uMin) / 14));
    for (let i = 0; i < n; i++) {
      // 一様乱数で位置を振ると、拒否条件(頭上 2.9m・隣と 2.4m・両側の家の有無)を
      // 通った紐が偏って残る。実測 alleyN2 の 72.5m に **2 本だけ**、しかも
      // z=-50.8 と -55.3 の 4.4m 間隔で奥に密集し、手前 45m はゼロだった。
      // 層化抽出にすれば、同じ本数でも路地の全長に散る。
      const u = lerp(uMin + 6, uMax - 6, (i + 0.35 + rng() * 0.30) / n);
      const av = avAt(u);
      const near = plan.houses.filter(h => Math.abs(uOf(h) - u) < halfAlong(h) + 1);
      const lo = near.filter(h => vOf(h) < av && av - vOf(h) < 9);
      const hi = near.filter(h => vOf(h) > av && vOf(h) - av < 9);
      if (!lo.length || !hi.length) continue;
      const hl = lo.reduce((p, c) => (vOf(c) > vOf(p) ? c : p));
      const hr = hi.reduce((p, c) => (vOf(c) < vOf(p) ? c : p));
      const v0 = vOf(hl) + halfCross(hl) + 0.05, v1 = vOf(hr) - halfCross(hr) - 0.05;
      if (v1 - v0 < 1.5 || v1 - v0 > 9.0) continue;
      const yTop = Math.min(hl.eaves, hr.eaves);
      const gy = plan.streetY(s, alongZ ? av : u, alongZ ? u : av);
      const y = Math.min(yTop - 1.2, gy + 4.4 + rng() * 4.0);
      if (y < gy + 3.0) continue;
      // 高さを通りの中心 1 点だけで見ていたので、階段や段のある所で
      // ロープの端が地面に近づき、**頭の高さに垂れる布** が 8 枚あった。
      // 全長で床を見て、いちばん高い所からでも 2.9m 空けさせる。
      let clear = 1e9;
      for (let q = 0; q <= 4; q++) {
        const cv = lerp(v0, v1, q / 4);
        const g2 = plan.groundAt(alongZ ? cv : u, alongZ ? u : cv, gy + 0.5);
        if (g2 && g2.y !== undefined) clear = Math.min(clear, y - g2.y);
      }
      if (clear < 2.9) continue;
      // 通りに面していない家が張り出していると、ロープがその家の躯体を
      // 貫き、布が壁の中に垂れる(実測 8 枚が壁の面と同じ高さで止まっていた)。
      // 端の 2 軒以外の家の中を通る紐は張らない。
      let blocked = false;
      for (let q = 1; q < 4 && !blocked; q++) {
        const cv = lerp(v0, v1, q / 4);
        const px2 = alongZ ? cv : u, pz2 = alongZ ? u : cv;
        for (const h2 of plan.houses) {
          if (h2 === hl || h2 === hr) continue;
          if (Math.abs(px2 - h2.x) < h2.w / 2 && Math.abs(pz2 - h2.z) < h2.d / 2 && y < h2.eaves + 0.4) {
            blocked = true; break;
          }
        }
      }
      if (blocked) continue;
      // 同じ高さに重ならない(数を増やすと二重に張られて見える)
      if (ropes.some(r2 => Math.abs((alongZ ? r2.z0 : r2.x0) - u) < 2.4 && Math.abs(r2.y0 - y) < 1.2)) continue;
      ropes.push(alongZ
        ? { x0: v0, y0: y, z0: u, x1: v1, y1: y, z1: u }
        : { x0: u, y0: y, z0: v0, x1: u, y1: y, z1: v1 });
      // 布(ロープに 2〜5 枚)
      // 1m あたり 2 枚強。シーツ・シャツ・靴下が混ざるので寸法は 3 クラス。
      const nc = Math.max(2, Math.round((v1 - v0) * 2.2));
      // 干す時刻・取り込む時刻はロープ単位。街じゅうの布が同じ分に消えると
      // 「全戸が同時に取り込む町」になる(実測 19:30 に一斉に消えていた)。
      const q = rng();
      const h0 = 6.0 + q * 3.2, h1 = 16.4 + ((q * 7) % 1) * 5.0, night = ((q * 13) % 1) < 0.14;
      let lastCol = -1;
      for (let c = 0; c < nc; c++) {
        const t = (c + 0.5 + (rng() - 0.5) * 0.55) / nc;
        const sag = Math.sin(Math.PI * t) * 0.2;
        const k = rng();
        const [cw, ch] = k < 0.22 ? [0.20 + rng() * 0.12, 0.24 + rng() * 0.16]      // 靴下・布巾
          : k < 0.72 ? [0.34 + rng() * 0.22, 0.52 + rng() * 0.30]                    // シャツ
            : [0.62 + rng() * 0.40, 0.80 + rng() * 0.55];                            // シーツ
        let cs = rng();
        if ((cs < 0.45) === (lastCol < 0.45) && rng() < 0.6) cs = 1 - cs;            // 白ばかり並ばせない
        lastCol = cs;
        const cu = lerp(v0, v1, t);
        cloths.push({
          x: alongZ ? cu : u, y: y - sag, z: alongZ ? u : cu,
          w: cw, h: ch, tilt: (rng() - 0.5) * 0.24,
          phase: rng() * Math.PI * 2, colorSeed: cs,
          rotY: (alongZ ? 0 : Math.PI / 2) + (rng() - 0.5) * 0.5,
          h0, h1, night,
        });
      }
    }
  };
  // 旗。石だけの街で **風向きを見せる唯一の物**。竿は 2 本立っているのに
  // 布が 1 枚も付いておらず、しかもオルランドの柱は「自由都市の宣言柱」で、
  // リベルタス旗が上がっていることがその柱の存在理由そのもの。
  // 布は既に揺れるシェーダ付きの InstancedMesh があるので、そこへ 2 枚足す。
  const flags = [
    { x: 144 + 0.80, y: 10.9, z: 5, w: 1.45, h: 0.98, rotY: 0 },        // オルランドの柱(竿 7.84〜12.44)
    { x: -248 + 1.15, y: 59.4, z: 82, w: 2.20, h: 1.48, rotY: 0.35 },   // ロヴリイェナツ(竿 49.9〜60.9)
  ];
  for (const f of flags) {
    cloths.push({ x: f.x, y: f.y, z: f.z, w: f.w, h: f.h, tilt: 0,
      phase: f.x * 0.7, colorSeed: 0.20, rotY: f.rotY, h0: 0, h1: 24, night: true });
  }
  for (const a of alleys) hangLaundry(a, true);
  for (const s2 of ewStreets) hangLaundry(s2, false);
  // ロープ(1 ドローコールの線)
  {
    const pos = [];
    for (const r of ropes) {
      const segs = 8;
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs, t1 = (i + 1) / segs;
        const sag0 = Math.sin(Math.PI * t0) * 0.2, sag1 = Math.sin(Math.PI * t1) * 0.2;
        // z を補間せず r.z0 / r.z1 をそのまま使っていた。路地(z 一定)では
        // 偶然正しかったが、通りを跨ぐ向きが z のロープは 1 点に潰れる。
        pos.push(
          lerp(r.x0, r.x1, t0), r.y0 - sag0, lerp(r.z0, r.z1, t0),
          lerp(r.x0, r.x1, t1), r.y1 - sag1, lerp(r.z0, r.z1, t1),
        );
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const ropeMesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x5a5348 }));
    group.add(tagMesh(ropeMesh, 'life.laundryRope', { thin: true, reason: '洗濯紐', noCollide: true }));
  }
  // 布(ロープ支点で個別スイング — シェーダで裾ほど大きく)
  const clothTime = { value: 0 };
  let folkMeshes = null;
  {
    const g = new THREE.PlaneGeometry(1, 1, 1, 3);
    g.translate(0, -0.5, 0);   // 上端がロープ
    const phases = new Float32Array(cloths.length);
    const mat = new THREE.MeshStandardMaterial({
      map: tex.cloth.map, side: THREE.DoubleSide, roughness: 0.9,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uT = clothTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aPhase; uniform float uT;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float sway = sin(uT * (1.1 + fract(aPhase) * 0.8) + aPhase * 7.0);
          float hang = -transformed.y;   // 0(ロープ)→1(裾)
          transformed.z += sway * hang * 0.16;
          transformed.x += sway * hang * 0.05;`);
    };
    const mesh = new THREE.InstancedMesh(g, mat, cloths.length);
    clock.cloths = { mesh, list: cloths, dummy: null, key: '' };
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    cloths.forEach((c, i) => {
      dummy.position.set(c.x, c.y, c.z);
      dummy.scale.set(c.w, c.h, 1);
      dummy.rotation.set(0, c.rotY, c.tilt || 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      // 白・生成り・空色・薄い臙脂 — 洗いざらしの彩度
      const s = c.colorSeed;
      if (s < 0.45) col.setHSL(0.1, 0.15, 0.90, THREE.SRGBColorSpace);
      else if (s < 0.65) col.setHSL(0.55, 0.28, 0.78, THREE.SRGBColorSpace);
      else if (s < 0.82) col.setHSL(0.02, 0.34, 0.70, THREE.SRGBColorSpace);
      else col.setHSL(0.13, 0.38, 0.82, THREE.SRGBColorSpace);
      mesh.setColorAt(i, col);
      phases[i] = c.phase;
      c._m = dummy.matrix.clone();      // 干してある時の行列(取り込みで 0 に潰す)
    });
    clock.cloths.dummy = dummy;
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    mesh.castShadow = true;
    group.add(tagMesh(mesh, 'life.laundryCloth', { thin: true, reason: '布', noCollide: true }));
  }

  // 描かれている床に物を置く。plan.pavedY は ground.js が石を張るのと **同じ式**で
  // 帯と踏面の高さを返す。streetY(滑らかなランプ)や広場の素の y のままだと、
  // 段のある路地や重ね張りの帯で石に潜る(実測 鉢 3 個・露店 1 台・井戸蓋 1 枚)。
  // 目安から 0.9m 以上離れた値は別の層(歩廊・段の上の踊り場)なので採らない。
  // 近ければ **その高さに合わせる**(高い方を採るのではない)。人が帯の縁で
  // 0.13m 浮いていたのは、足の高さが groundAt の通行帯(w/2+0.40)から来ていて、
  // 描かれた帯がそこまで無かったため。離れた値は別の層なので採らない。
  const onFloor = (x, z, fallback) => {
    const pv = plan.pavedY(x, z);
    return (pv !== null && Math.abs(pv - fallback) < 0.35) ? pv : fallback;
  };

  // ------------------------------------------------------- 鉢植えと緑 ----
  const pots = [];    // 階段脇・扉脇
  // 鉢を増やしたら鉢どうしが重なった(実測 19 組)。鉢の外径は 0.335m。
  const putPot = (o) => {
    for (const q of pots) if (Math.hypot(q.x - o.x, q.z - o.z) < 0.78) return;
    // 広場の擁壁の中に置かない。壁は第7パスで足した物で、置く側が知らないと
    // 鉢が石の中に立つ(ユーザー報告。実測 jesuitFoot の南で 2 個)。
    const pw = plan.plazaWall(o.x, o.z, 0.50);
    if (pw && o.y < pw.yTop - 0.05) return;
    pots.push(o);
  };
  for (const a of alleys) {
    const zMin = Math.min(a.pts[0][1], a.pts[a.pts.length - 1][1]);
    const zMax = Math.max(a.pts[0][1], a.pts[a.pts.length - 1][1]);
    const n = 6 + (rng() * 5 | 0);
    for (let i = 0; i < n; i++) {
      const z = lerp(zMin + 3, zMax - 3, rng());
      const ax = plan.alleyXAt(a, z);
      const side = rng() < 0.5 ? -1 : 1;
      const x = ax + side * (a.w / 2 - 0.35);
      putPot({ x, z, y: onFloor(x, z, plan.streetY(a, ax, z)), s: 0.7 + rng() * 0.7, seed: rng(), boug: rng() < 0.16 });
    }
  }
  // 東西の通りの壁際にも。プリイェコは実物では鉢と卓でいちばん賑わう通り。
  for (const s2 of ewStreets) {
    const sz = s2.pts[0][1];
    const x0e = Math.min(s2.pts[0][0], s2.pts[1][0]), x1e = Math.max(s2.pts[0][0], s2.pts[1][0]);
    const n = Math.max(8, Math.round((x1e - x0e) / 14));
    for (let i = 0; i < n; i++) {
      const x = lerp(x0e + 3, x1e - 3, rng());
      const side = rng() < 0.5 ? -1 : 1;
      const z = sz + side * (s2.w / 2 - 0.35);
      putPot({ x, z, y: onFloor(x, z, plan.streetY(s2, x, z)), s: 0.7 + rng() * 0.7, seed: rng(), boug: rng() < 0.16 });
    }
  }
  // 広場・ストラドゥンの縁にも
  for (let i = 0; i < 42; i++) {
    const x = -140 + rng() * 270;
    const pz5 = (rng() < 0.5 ? -1 : 1) * (3.5 - 0.2);
    putPot({ x, z: pz5, y: onFloor(x, pz5, 2.6), s: 0.9 + rng() * 0.5, seed: rng(), boug: false });
  }
  {
    // 上面を塞いだ円柱だと、天面が空を向いて明るいピンクの円盤に見える。
    // 縁を筒にして、その中に暗い土を落とす(頂点色で焼く)。
    const potGeo = (() => {
      const side = new THREE.CylinderGeometry(0.32, 0.24, 0.42, 8, 1, true);
      side.translate(0, 0.21, 0);
      // 縁を「詰まった円柱」にすると天面が塞がり、土が見えず明るい円盤になる
      const lip = new THREE.CylinderGeometry(0.335, 0.32, 0.06, 8, 1, true);
      lip.translate(0, 0.40, 0);
      const lipTop = new THREE.RingGeometry(0.29, 0.335, 8);
      lipTop.rotateX(-Math.PI / 2);
      lipTop.translate(0, 0.43, 0);
      // 内張り。半径 0.29 の「まっすぐな円筒」を高さ 0.05〜0.39 に置いていた。
      // 鉢の胴は上 0.32 → 下 0.24 に絞れているので、胴の半径が 0.29 を下回る
      // y=0.26 より下では、内張りが胴を突き抜けて外に出る。八角形の角が
      // 左右で一番遠くまで出るので、「鉢の下の方が左右で尖って」見えていた。
      // 内張りは土(y=0.33)から縁までしか要らない。胴の絞りの内側に収める。
      const inner = new THREE.CylinderGeometry(0.300, 0.288, 0.115, 8, 1, true);
      inner.scale(-1, 1, 1);            // 内側を向ける
      inner.translate(0, 0.3725, 0);
      const soil = new THREE.CylinderGeometry(0.29, 0.29, 0.02, 8);
      soil.translate(0, 0.33, 0);
      const tintG = (g, c) => {
        const n = g.attributes.position.count, a = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
        g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
      };
      return mergeSimpleC([tintG(side, [1, 1, 1]), tintG(lip, [0.88, 0.86, 0.84]), tintG(lipTop, [0.60, 0.58, 0.56]),
        tintG(inner, [0.55, 0.50, 0.46]), tintG(soil, [0.20, 0.155, 0.115])]);
    })();
    const potMat = new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true });
    const potMesh = new THREE.InstancedMesh(potGeo, potMat, pots.length);
    // 葉群(交差クアッド × 3)
    const leafGeo = (() => {
      const quads = [];
      for (let k = 0; k < 3; k++) {
        const q = new THREE.PlaneGeometry(1, 1);
        q.rotateY((k / 3) * Math.PI);
        q.translate(0, 0.5, 0);
        quads.push(q);
      }
      const merged = mergeSimple(quads);
      return merged;
    })();
    const leafMat = new THREE.MeshStandardMaterial({
      map: tex.foliage, transparent: true, alphaTest: 0.45, side: THREE.DoubleSide,
      roughness: 0.9, emissive: 0x0c1406, emissiveIntensity: 0.22,   // 日陰の黒死防止
    });
    const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, pots.length);
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    pots.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.setScalar(p.s);
      dummy.rotation.set(0, p.seed * 7, 0);
      dummy.updateMatrix();
      potMesh.setMatrixAt(i, dummy.matrix);
      col.setHSL(0.043, 0.31 + p.seed * 0.13, 0.375 + p.seed * 0.10, THREE.SRGBColorSpace);
      potMesh.setColorAt(i, col);
      dummy.position.set(p.x, p.y + 0.36 * p.s, p.z);
      dummy.scale.set(p.s * (0.66 + p.seed * 0.34), p.s * (0.62 + p.seed * 0.46), p.s * (0.66 + p.seed * 0.34));
      dummy.updateMatrix();
      leafMesh.setMatrixAt(i, dummy.matrix);
      if (p.boug) col.setHSL(0.915, 0.52, 0.435, THREE.SRGBColorSpace);          // ブーゲンビリア
      else col.setHSL(0.255 + p.seed * 0.075, 0.30 + p.seed * 0.12, 0.275 + p.seed * 0.125, THREE.SRGBColorSpace);
      leafMesh.setColorAt(i, col);
    });
    potMesh.castShadow = true; leafMesh.castShadow = true;
    group.add(tagMesh(potMesh, 'life.flowerPot', { solid: true, groundContact: true }),
      tagMesh(leafMesh, 'life.foliage', { thin: true, reason: '葉は交差板', noCollide: true }));
  }

  // ------------------------------------------------------------ 猫 ----
  // 一匹は南の路地の日なたの段で丸くなり、一匹はストラドゥンの戸口に座る。
  function curledCat(color) {
    const body = new THREE.TorusGeometry(0.16, 0.085, 7, 12, Math.PI * 1.8);
    body.rotateX(-Math.PI / 2);
    body.translate(0, 0.085, 0);
    const head = new THREE.SphereGeometry(0.085, 8, 6);
    head.translate(0.14, 0.11, 0.06);
    const earL = new THREE.ConeGeometry(0.028, 0.05, 4);
    earL.translate(0.11, 0.175, 0.03);
    const earR = new THREE.ConeGeometry(0.028, 0.05, 4);
    earR.translate(0.17, 0.175, 0.08);
    const g = mergeSimple([body, head, earL, earR]);
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
  }
  function sittingCat(color) {
    const body = new THREE.ConeGeometry(0.13, 0.34, 8);
    body.translate(0, 0.17, 0);
    const head = new THREE.SphereGeometry(0.08, 8, 6);
    head.translate(0, 0.38, 0.02);
    const earL = new THREE.ConeGeometry(0.026, 0.05, 4);
    earL.translate(-0.045, 0.45, 0.01);
    const earR = new THREE.ConeGeometry(0.026, 0.05, 4);
    earR.translate(0.045, 0.45, 0.01);
    const tail = new THREE.CylinderGeometry(0.02, 0.03, 0.3, 5);
    tail.rotateX(Math.PI / 2.4);
    tail.translate(0.1, 0.06, -0.16);
    const g = mergeSimple([body, head, earL, earR, tail]);
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
  }
  {
    const sAlleys = alleys.filter(s => s.id.startsWith('alleyS'));
    const a = sAlleys[(sAlleys.length / 2) | 0];
    const ax = a.pts[0][0], az = 14;
    const cat1 = curledCat(0xc7833c);   // 茶トラ(日なた色)
    cat1.position.set(ax + a.w / 2 - 0.5, plan.streetY(a, ax, az) + 0.16, az);
    cat1.rotation.y = 1.2;
    cat1.castShadow = true;
    group.add(tagMesh(cat1, 'life.cat', { solid: true, creature: true }));
    window.__catPos = [cat1.position.x, cat1.position.z];
    const cat2 = sittingCat(0x3a3a40);  // 黒っぽい仔
    cat2.position.set(-38, 2.62, 3.1);
    cat2.rotation.y = -0.6;
    cat2.castShadow = true;
    group.add(tagMesh(cat2, 'life.cat2', { solid: true, creature: true }));
  }

  // ------------------------------------------------- 壁付ランタンと電線 ----
  // 夜の旧市街は「石壁に溜まる暖色の光」が主役。灯が無いと、ただ暗くした昼になる。
  const lamps = [];
  {
    // 街灯は壁付け。壁の無い所(広場に開いた街路の端・門前)に置くと、
    // 台座ごと空中に浮く(実測: ストラドゥン中央 z=-1 の上空 6.2m)。
    // 家の輪郭が 1.1m 以内にあるときだけ立てる。
    const hasWall = (x, z) => plan.houses.some(h => !h.garden
      && x > h.x - h.w / 2 - 1.1 && x < h.x + h.w / 2 + 1.1
      && z > h.z - h.d / 2 - 1.1 && z < h.z + h.d / 2 + 1.1);
    for (const s2 of plan.streets) {
      if (s2.kind === 'port') continue;
      // 折れ線の路地で pts[1] を終点にすると、南の 4 点折れ線では第一区間しか
      // 見ないので、灯が手前 34% にしか立たない。
      const [x0, z0] = s2.pts[0], [x1, z1] = s2.pts[s2.pts.length - 1];
      const L = Math.hypot(x1 - x0, z1 - z0);
      const dx = (x1 - x0) / L, dz = (z1 - z0) / L;
      const nx = -dz, nz = dx;
      // 実在の階段路地の吊り灯は 8〜12m に 1 基。15 だと実測 18m に 1 基になり、
      // 光源の間に「何も無い」区間ができる(夜の路地の 40.8% が L*<5 だった)。
      const gap = s2.kind === 'alley' ? 11 : 17;
      let side = 1;
      for (let d = 7; d < L - 4; d += gap * (0.82 + rng() * 0.4)) {
        const t = d / L;
        // 折れ線に沿って中心を取り直す。直線の弦で置くと、振れた路地では
        // 壁座が石の中か路地の真ん中に来る。
        const bz = lerp(z0, z1, t);
        const bx = (s2.kind === 'alley' && plan.alleyXAt) ? plan.alleyXAt(s2, bz) : lerp(x0, x1, t);
        // 壁面は設計中心 ±(w/2 + 0.16)。設計幅そのままだと壁座の裏が壁から
        // 0.19m 手前に浮く(実測 46 基すべてで 0.19m、分散ゼロ)。
        const cx = bx + nx * (s2.w / 2 + 0.10) * side;
        const cz = bz + nz * (s2.w / 2 + 0.10) * side;
        const gy = plan.groundAt(cx, cz, 200).y;
        // 46 基すべてが床上ぴったり 3.20m だった。取り付く石の段は家ごとに
        // 違うので、実在の吊り灯は 2.9〜4.2m に散る。
        if (hasWall(cx, cz)) lamps.push({ x: cx, z: cz, y: gy + 3.05 + rng() * 0.95, rotY: Math.atan2(-nx * side, -nz * side), seed: rng() });
        side = -side;
      }
    }
    for (const p2 of plan.PLAZAS) {
      for (const [cx, cz] of [[p2.x0 + 1, p2.z0 + 1], [p2.x1 - 1, p2.z1 - 1], [p2.x0 + 1, p2.z1 - 1]]) {
        if (hasWall(cx, cz)) lamps.push({ x: cx, z: cz, y: p2.y + 3.4, rotY: rng() * 6.28, seed: rng() });
      }
    }
  }
  {
    // 壁座 → S 字の腕 → 六角のガラス箱 → 円錐の笠 → つまみ。
    // L 字の棒に黒い箱では、街灯ではなく防犯カメラに見える。
    const armGeo = (() => {
      const parts = [];
      const plate = new THREE.BoxGeometry(0.16, 0.30, 0.06); plate.translate(0, 0, 0.03); parts.push(plate);
      for (let k = 0; k < 5; k++) {                      // 腕(ゆるい S 字)
        const t = k / 4;
        const seg = new THREE.BoxGeometry(0.045, 0.045, 0.115);
        seg.translate(0, Math.sin(t * Math.PI) * 0.06, 0.06 + t * 0.42);
        parts.push(seg);
      }
      const hang = new THREE.CylinderGeometry(0.018, 0.018, 0.14, 5); hang.translate(0, -0.07, 0.50); parts.push(hang);
      const cap = new THREE.ConeGeometry(0.17, 0.11, 6); cap.rotateY(Math.PI / 6); cap.translate(0, -0.20, 0.50); parts.push(cap);
      const knob = new THREE.SphereGeometry(0.032, 6, 4); knob.translate(0, -0.53, 0.50); parts.push(knob);
      return mergeSimple(parts);
    })();
    const armMat = new THREE.MeshStandardMaterial({ color: 0x2a2723, roughness: 0.55, metalness: 0.5 });
    const armMesh = new THREE.InstancedMesh(armGeo, armMat, lamps.length);
    const glGeo = new THREE.CylinderGeometry(0.135, 0.115, 0.30, 6);
    glGeo.rotateY(Math.PI / 6); glGeo.translate(0, -0.38, 0.50);
    const glMat = new THREE.MeshStandardMaterial({
      color: 0x1a1610, emissive: 0xffbe7d, emissiveIntensity: 0.0, roughness: 0.4,
    });
    const glMesh = new THREE.InstancedMesh(glGeo, glMat, lamps.length);
    // 地面の光溜まり(加算・夜だけ)
    const poolTex = (() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const g2 = cv.getContext('2d');
      const rg = g2.createRadialGradient(64, 64, 2, 64, 64, 62);
      rg.addColorStop(0, 'rgba(255,206,152,0.90)');
      rg.addColorStop(0.4, 'rgba(255,190,134,0.30)');
      rg.addColorStop(1, 'rgba(255,170,100,0)');
      g2.fillStyle = rg; g2.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const poolMat = new THREE.MeshBasicMaterial({
      map: poolTex, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, opacity: 0,
    });
    const poolGeo = new THREE.PlaneGeometry(1, 1); poolGeo.rotateX(-Math.PI / 2);
    const poolMesh = new THREE.InstancedMesh(poolGeo, poolMat, lamps.length);
    poolMesh.renderOrder = 3;
    const dummy = new THREE.Object3D();
    lamps.forEach((l, i) => {
      dummy.position.set(l.x, l.y, l.z);
      dummy.rotation.set(0, l.rotY, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      armMesh.setMatrixAt(i, dummy.matrix);
      glMesh.setMatrixAt(i, dummy.matrix);
      const gy = plan.groundAt(l.x, l.z, 200).y;
      dummy.position.set(l.x - Math.sin(l.rotY) * 0.44, gy + 0.06, l.z - Math.cos(l.rotY) * 0.44);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(3.4 + l.seed * 1.2);
      dummy.updateMatrix();
      poolMesh.setMatrixAt(i, dummy.matrix);
    });
    armMesh.castShadow = true;
    group.add(tagMesh(armMesh, 'life.lampArm', { solid: true, small: true }),
      tagMesh(glMesh, 'life.lampGlass', { thin: true, reason: 'ガラス', noCollide: true }),
      tagMesh(poolMesh, 'life.lampPool', { thin: true, reason: '灯の落ちる床の光', noCollide: true, decal: true }));
    // 実光源のプール。加算デカールは床しか照らさないので、夜は人も壁も
    // 真っ暗のまま「床に貼った黄色い円」だけが見える状態になっていた。
    // 8 灯を毎フレーム最寄りのランタンに付け替える(draw call は増えない)。
    const lampPool = [];
    for (let i = 0; i < 8; i++) {
      const pl = new THREE.PointLight(0xffc79a, 0, 15, 2.0);   // 0xffb877 は B/R 0.195 ≒ 1900K。実在の街灯は 2700〜3000K
      pl.visible = false;
    group.add(tagMesh(pl, 'life.lampLight', { thin: true, reason: '点光源の担体', noCollide: true }));
      lampPool.push(pl);
    }
    lampNight = { glMat, poolMat, lampPool };
  }

  // 電線(旧市街の空を横切る線 — 「その場にいる感じ」の即効薬)
  {
    const pos = [];
    for (const a of alleys) {
      const zMin = Math.min(a.pts[0][1], a.pts[a.pts.length - 1][1]);
      const zMax = Math.max(a.pts[0][1], a.pts[a.pts.length - 1][1]);
      for (let z = zMin + 10; z < zMax - 6; z += 19 + rng() * 14) {
        const ax = plan.alleyXAt(a, z);
        const left = plan.houses.filter(h => Math.abs(h.z - z) < h.d / 2 + 1 && h.x < ax && ax - h.x < 9);
        const right = plan.houses.filter(h => Math.abs(h.z - z) < h.d / 2 + 1 && h.x > ax && h.x - ax < 9);
        if (!left.length || !right.length) continue;
        const hl = left.reduce((p2, c) => (c.x > p2.x ? c : p2));
        const hr = right.reduce((p2, c) => (c.x < p2.x ? c : p2));
        const y = Math.min(hl.eaves, hr.eaves) - 0.6 - rng() * 1.4;
        const segs = 6;
        for (let i = 0; i < segs; i++) {
          const t0 = i / segs, t1 = (i + 1) / segs;
          const s0 = Math.sin(Math.PI * t0) * 0.16, s1 = Math.sin(Math.PI * t1) * 0.16;
          pos.push(lerp(hl.x + hl.w / 2, hr.x - hr.w / 2, t0), y - s0, z,
            lerp(hl.x + hl.w / 2, hr.x - hr.w / 2, t1), y - s1, z);
        }
      }
    }
    if (pos.length) {
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    group.add(tagMesh(new THREE.LineSegments(g2, new THREE.LineBasicMaterial({ color: 0x2b2822, transparent: true, opacity: 0.85 })), 'life.wire', { thin: true, reason: '線', noCollide: true }));
    }
  }

  // カフェ・テラス(卓・椅子・パラソル)。椅子は既存の InstancedMesh に相乗り。
  // 帯の定義は plan.TERRACES 一本(店の日除けも同じ表を見て避ける)。
  const terraces = plan.TERRACES.map(t => ({ ...t }));
  // プリイェコは実物では通り幅の 2/3 をレストランの卓が占め、1m の通路しか
  // 残らない。カフェ卓はストラドゥンの z=±2.92 にしか無かった。
  // y を省くとストラドゥンの 2.6m が既定になる。プリイェコは 8〜10m の
  // 棚の上なので、椅子と客が 2.6m の高さに浮いた(実測 22 体)。
  // 通りは長さ方向に高さが変わるので、卓の列ごとに実際の床を引く。
  for (const [tx, tl] of [[-20, 26], [40, 22], [-96, 18]]) {
    const g4 = plan.groundAt(tx + tl / 2, -34.9, 200);
    // プリイェコは幅 3.4m。両側に椅子を出すと壁際の椅子が巾木(0.13m 出る)に
    // 乗って埋まる。実物どおり **卓は壁に付け、椅子は通り側だけ**。
    if (g4 && g4.y !== undefined) terraces.push({ x0: tx, len: tl, z: -34.75, y: g4.y, side: -1 });
  }
  {
    const lu0 = plan.PLAZAS.find(p2 => p2.id === 'luza');
    if (lu0) terraces.push({ x0: 145, len: 8.0, z: -12.5, y: lu0.y });
  }
  const cafeTables = [], cafeParasols = [];
  const chairPos = [];
  for (const t of terraces) {
    const nT = Math.max(3, Math.round(t.len / 2.2));
    for (let i = 0; i < nT; i++) {
      const x = t.x0 + (i + 0.5) * (t.len / nT);
      const z = t.z + (rng() - 0.5) * 0.35;
      // 高さはテラス 1 列で 1 個にせず、卓ごとに実際の床を引く。通りは
      // 長さ方向に高さが変わるので、1 点で決めると端の椅子が石に埋まる
      // (実測 プリイェコで 0.34m)。
      const yr = t.y ?? 2.6;
      const gT = plan.groundAt(x, z, yr + 0.6);
      const y = (gT && gT.y !== undefined && Math.abs(gT.y - yr) < 2.2) ? gT.y : yr;
      cafeTables.push({ x, z, y, rot: rng() * 6.28 });
      for (const sgn of (t.side ? [t.side] : [-1, 1])) {
        // 椅子(背もたれ local z = -0.19)も人も +z を向く。卓は椅子から見て前。
        const cz2 = z + sgn * 0.58;
        const gC = plan.groundAt(x + sgn * 0.30, cz2, y + 0.6);
        const cy = (gC && gC.y !== undefined && Math.abs(gC.y - y) < 1.2) ? gC.y : y;
        chairPos.push({ x: x + sgn * 0.30, z: cz2, y: cy, rot: sgn > 0 ? Math.PI + 0.2 : -0.2, seed: rng() });
      }
    }
    const nP = Math.max(2, Math.round(t.len / 3.4));
    for (let i = 0; i < nP; i++) {
      const px3 = t.x0 + (i + 0.5) * (t.len / nP);
      const gP = plan.groundAt(px3, t.z, (t.y ?? 2.6) + 0.6);
      cafeParasols.push({ x: px3, z: t.z,
        y: (gP && gP.y !== undefined && Math.abs(gP.y - (t.y ?? 2.6)) < 2.2) ? gP.y : (t.y ?? 2.6), seed: rng() });
    }
  }
  // ------------------------------------------------------------ 人 ----
  // 街の寸法はすべて「人の背丈」で読まれる。1人もいない街では、
  // 石が大きいのか壁が高いのか、見る人には永久に判定できない。
  const folk = [];
  // 歩行振幅(aWalk)は毎フレーム書き換える。宣言はメッシュ生成より前に置く。
  let walkAmt = null, walkAttr = null, accWalkAmt = null, accWalkAttr = null;
  let lastElapsed = null;
  // 屋台の配置は人体メッシュより先に決める(売り子を folk に相乗りさせるため)。
  // 専用の乱数系列を使い、以降の rng の並びを崩さない。
  const stalls = [];
  {
    const srng = rngFor(0x5741);
    const gu = plan.PLAZAS.find(p2 => p2.id === 'gundulic');
    if (gu) {
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) {
          // 完全な格子は市場に見えない。列ごとにずらし、個体差を大きくする。
          const x = lerp(gu.x0 + 3.2, gu.x1 - 3.2, c / 3) + (srng() - 0.5) * 1.8 + (r % 2 ? 1.1 : -0.6);
          const z = lerp(gu.z0 + 4.0, gu.z1 - 4.0, r / 2) + (srng() - 0.5) * 1.5;
          stalls.push({ x, z, y: onFloor(x, z, gu.y), rot: (srng() - 0.5) * 0.7 + (r % 2 ? 0.06 : -0.04), seed: srng() });
        }
      }
    }
    // 旧港。ポンタ門を出た所が実物では **ペスカリヤ(魚市場)** で、朝は氷の台と
    // 発泡箱とカモメ、昼は食堂。旧港は街で唯一「物を運ぶ場所」なのに、露店が
    // 一台も無く、岸壁に人が 4〜5 人しかいなかった。
    for (let i = 0; i < 5; i++) {
      stalls.push({ x: 170.5 + i * 0.38, z: -13.5 + i * 5.5, y: 1.7,
        rot: Math.PI / 2 + (srng() - 0.5) * 0.4, seed: srng(), fish: true });
    }
  }
  {
    // y は呼び出し側の推定値。実際の床に必ずスナップする(浮き/めり込み対策)。
    const place = (x, z, y, seed, face) => {
      const c = plan.collide(x, z, 0.4, y + 1.0);
      if (Math.hypot(c.x - x, c.z - z) > 0.15) return null;
      const g = plan.groundAt(x, z, y + 1.0);
      // 足裏はインスタンス原点(= ここで決める gy)に合わせてある。
      // 舗石は Z ファイト避けの lift ぶん(0.014〜0.026m)だけ当たり判定の面より
      // 高く描かれるので、その分はまだ埋まる。人を持ち上げて誤魔化さない —
      // 「描かれた床と当たり判定の床が食い違う」ほうが直すべき欠陥で、
      // それは walkability が既に 43 点で鳴らしている。
      let gy = (g && Math.abs(g.y - y) < 1.6) ? g.y : y;
      gy = onFloor(x, z, gy);          // 描かれている床に合わせる
      // 広場の擁壁の中に立たせない(実測 2 人が壁の中に居た)
      const pw = plan.plazaWall(x, z, 0.55);
      if (pw && gy < pw.yTop - 0.05) return null;
      // 石段の天板は踏面より 0.06m 先まで出る(段鼻)。当たり判定は
      // quantizeRun の格子で切り替わるので、段鼻の 3cm の帯では
      // **描かれた段が一段上** になり、そこに立つ人は蹴上ぶん(0.16m)
      // 石に埋まる。描かれている踏面が上にあるなら、そちらに立たせる。
      // 足は原点の 1 点ではない。足裏は左右 ±0.096・前 0.042 にある。
      // 原点だけ見ると段鼻をまたいだ人を取りこぼし(実測 0.169m の埋没)、
      // 逆に半径 0.14 の円盤で見ると **隣の段に人を持ち上げる**(0.12m の浮き)。
      // 足裏そのものを測る。だから向きをここで決めてしまう。
      const rotY0 = face !== undefined ? face : seed * 11.3;
      if (stepPool && stepPool.items) {
        const cR = Math.cos(rotY0), sR = Math.sin(rotY0);
        let hi = null;
        for (const [lx, lz] of [[-0.096, 0.042], [0.096, 0.042]].map(
          ([a, b]) => [a * cR + b * sR, -a * sR + b * cR])) {
          const [ox, oz] = [lx, lz];
          const sx = x + ox, sz = z + oz;
          for (const q of stepPool.items) {
            if (Math.abs(sx - q.x) > 3.0 || Math.abs(sz - q.z) > 3.0) continue;
            const c2 = Math.cos(q.rotY), s2 = Math.sin(q.rotY);
            const along = (sx - q.x) * s2 + (sz - q.z) * c2;
            const across = (sx - q.x) * c2 - (sz - q.z) * s2;
            if (Math.abs(along) > q.d / 2 || Math.abs(across) > q.w / 2) continue;
            if (q.y > gy && q.y - gy < 0.35 && (hi === null || q.y > hi)) hi = q.y;
          }
        }
        if (hi !== null) gy = hi;
      }
      for (const f of folk) if (Math.hypot(f.x - x, f.z - z) < 0.62) return null;  // 重なり排除
      // 露店と植木鉢は当たり判定を持たないので、plan.collide をすり抜ける。
      // 実測で露店の脚の中に立つ人が 1 人、鉢の中に足を入れた人が 1 人いた。
      for (const s2 of stalls) if (Math.hypot(s2.x - x, s2.z - z) < 1.5) return null;
      for (const p2 of pots) if (Math.hypot(p2.x - x, p2.z - z) < 0.55) return null;
      // 卓と椅子も当たり判定を持たない。実測で卓の天板に胸まで埋まった人が 1 人。
      for (const t2 of cafeTables) if (Math.hypot(t2.x - x, t2.z - z) < 0.85) return null;
      // 体型: 標準 62% / がっしり 26% / 子供 12%。等方スケールだけでは
      // 「1.5m の人は 2.0m の人の縮小コピー」になり、子供に見えない。
      const bq = (seed * 733) % 1;
      const kid = bq > 0.88;
      const stout = !kid && bq > 0.62;
      const o = {
        x, z, y: gy, seed,
        h: kid ? 0.56 + seed * 0.14 : 0.80 + seed * 0.26,
        wx: kid ? 1.06 : stout ? 1.10 : 0.96 + seed * 0.08,
        wz: kid ? 1.04 : stout ? 1.14 : 0.94 + seed * 0.10,
        headK: kid ? 1.34 : stout ? 1.02 : 0.98 + seed * 0.05,
        rotY: rotY0,
      };
      folk.push(o);
      return o;
    };
    // 会話の輪。人は等間隔には立たない — 2〜3人が向き合う塊を作る。
    const cluster = (x, z, y, seed) => {
      const n = seed > 0.62 ? 2 : 1;
      const base = seed * 6.28318;
      // **乱数は「置けたか」より先に引く。** 置けなかったときだけ rng を飛ばすと、
      // そこから先の街全体で位相がずれる — 通りの人の間隔まで
      // `d += step * (0.6 + rng() * 0.8)` で決まっているので、**一人置けなかった
      // だけで街じゅうの人数が変わる**。実測: 北の帯を 1 層上げただけで
      // folk 481 → 440 になり、増えた棄却は 9 なのに place の成功は 37 減っていた
      // (= 残りは全部この位相ずれ)。引く回数を置けたかどうかから切り離す。
      const draws = [];
      for (let k = 0; k < n; k++) draws.push([rng(), rng(), rng()]);
      const a = place(x, z, y, seed);
      if (!a) return;
      for (let k = 0; k < n; k++) {
        const [d0, d1, d2] = draws[k];
        const th = base + (k + 1) * (2.0 + d0 * 0.9);
        const r = 0.72 + d1 * 0.34;
        const bx = x + Math.cos(th) * r, bz = z + Math.sin(th) * r;
        place(bx, bz, y, d2, Math.atan2(x - bx, z - bz));
      }
      a.rotY = base + 3.14159;
    };
    // ストラドゥン(1人/9m)と東西の街路
    for (const s2 of plan.streets) {
      if (s2.kind === 'alley') continue;
      // 折れ線の路地で pts[1] を終点にすると、南の 4 点折れ線では第一区間しか
      // 見ないので、灯が手前 34% にしか立たない。
      const [x0, z0] = s2.pts[0], [x1, z1] = s2.pts[s2.pts.length - 1];
      const L = Math.hypot(x1 - x0, z1 - z0);
      // プリイェコは実物では旧市街でいちばん人と卓の出る通り。22m に 1 人では
      // 「住んでいる部分」が無人に見える。岸壁も同じ(100m に 4 人だった)。
      const step = s2.kind === 'stradun' ? 7 : s2.id === 'prijeko' ? 9
        : s2.kind === 'port' ? 10 : 22;
      const ux = (x1 - x0) / L, uz = (z1 - z0) / L;
      for (let d = step * 0.5; d < L; d += step * (0.6 + rng() * 0.8)) {
        const t = d / L;
        // ストラドゥンは両端 3.3m がテラス。中央だけを歩かせないと卓と椅子を素通りする。
        const spr = (s2.w - 1.4) * (s2.kind === 'stradun' ? 0.60 : 1.0);
        // 横位置を「中心 ± 一様乱数」で振ると中心の密度が最大になり、人が
        // 道の真ん中を一列縦隊で歩く。地中海の街の人は日陰側の壁沿いを歩く。
        // 両側に寄せた二山にすると、同じ人数のまま店先を流れる二本の筋になる。
        const off = (rng() < 0.5 ? -1 : 1) * (0.34 + rng() * 0.66) * spr * 0.5;
        const jit = (rng() - 0.5) * 1.6;
        const cx = lerp(x0, x1, t) + ux * jit - uz * off;
        const cz = lerp(z0, z1, t) + uz * jit + ux * off;
        const sd = rng();
        if (sd > 0.66) cluster(cx, cz, plan.streetY(s2, cx, cz), sd);
        else place(cx, cz, plan.streetY(s2, cx, cz), sd);
      }
    }
    // 路地(1人/35m)
    for (const a of alleys) {
      const zMin = Math.min(a.pts[0][1], a.pts[a.pts.length - 1][1]);
      const zMax = Math.max(a.pts[0][1], a.pts[a.pts.length - 1][1]);
      for (let z = zMin + 8; z < zMax - 4; z += 28 + rng() * 20) {
        const ax = plan.alleyXAt(a, z);
        place(ax + (rng() - 0.5) * (a.w - 1.2), z, plan.groundAt(ax, z, 200).y, rng());
      }
    }
    // 広場
    for (const p2 of plan.PLAZAS) {
      // 1人/68㎡ は共和国の集会広場の密度ではない(ルジャ 1024㎡ に 15 人)。
      const n2 = Math.max(2, Math.round((p2.x1 - p2.x0) * (p2.z1 - p2.z0) / 34));
      // 完全な一様分布だと、柱廊の下にも噴水の前にも扉の前にも誰も居らず、
      // 広場の真ん中に均等に撒かれる。人は縁と記念物のまわりに溜まる。
      const mons = plan.MONUMENTS ? Object.values(plan.MONUMENTS) : [];
      const nearEdgeOrMon = (px, pz) => {
        if (px - p2.x0 < 3.5 || p2.x1 - px < 3.5 || pz - p2.z0 < 3.5 || p2.z1 - pz < 3.5) return true;
        return mons.some(m2 => m2 && m2.x !== undefined
          && Math.hypot(px - m2.x, pz - m2.z) < (m2.r || 3) + 4.5);
      };
      for (let i = 0; i < n2; i++) {
        const sd = rng();
        let px = 0, pz = 0;
        for (let k = 0; k < 6; k++) {
          px = lerp(p2.x0 + 1.5, p2.x1 - 1.5, rng()); pz = lerp(p2.z0 + 1.5, p2.z1 - 1.5, rng());
          if (nearEdgeOrMon(px, pz)) break;
        }
        if (sd > 0.5) cluster(px, pz, p2.y, sd); else place(px, pz, p2.y, sd);
      }
    }
    // オノフリオの大噴水は今も飲用で、常に誰かがボトルを満たしている。
    // それが「16 本の吐水口がある建造物」を給水塔に見せる唯一の証拠だった。
    // 広場の一様分布は噴水を参照しないので、6 人が噴水に背を向けて棒立ちしていた。
    {
      const of2 = plan.MONUMENTS.onofrio;
      if (of2) {
        for (const th of [0.35, 1.75, 3.60, 5.10]) {
          const fx = of2.x + Math.cos(th) * ((of2.r || 3) + 0.35);
          const fz = of2.z + Math.sin(th) * ((of2.r || 3) + 0.35);
          const g3 = plan.groundAt(fx, fz, 3.6);
          const a3 = place(fx, fz, g3 ? g3.y : 2.8, rng(), Math.atan2(of2.x - fx, of2.z - fz));
          if (a3) a3.pose = 1;                    // 片手を伸ばした読み
        }
      }
    }
    // 城壁歩廊(1人/25m)
    for (let i = 1; i < plan.wallPts.length; i++) {
      const A = plan.wallPts[i - 1], B = plan.wallPts[i];
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      // 城壁歩廊は旧市街で最も人が歩く一本道。平均 36m に 1 人では、
      // 200m 先まで見通せる歩廊に人影が 2 つしか無い。
      for (let d = 6; d < L - 4; d += 13 + rng() * 11) {
        const t = d / L;
        const nx = -(B[1] - A[1]) / L, nz = (B[0] - A[0]) / L;
        const off = (rng() - 0.5) * 1.2;
        place(lerp(A[0], B[0], t) + nx * off, lerp(A[1], B[1], t) + nz * off, lerp(A[2], B[2], t), rng());
      }
    }
    // 防波堤と岸壁
    for (const w of plan.OUTSIDE_WALKS) {
      const n2 = Math.max(1, Math.round((w.x1 - w.x0) / 22));
      for (let i = 0; i < n2; i++) {
        place(lerp(w.x0 + 1, w.x1 - 1, rng()), lerp(w.z0 + 1, w.z1 - 1, rng()), w.y, rng());
      }
    }
  }
  // ---- カフェの椅子に座る人(歩行フラグは立てない)
  for (const c of chairPos) {
    if (rng() > 0.45) continue;
    // 座る人の足は椅子の 1.35m 前に着く。その先に植木鉢があると足が鉢に入る
    // (実測 2 人)。鉢の側に人を置かない — 鉢は当たり判定を持たない。
    {
      const fx = c.x - Math.sin(c.rotY ?? 0) * 1.35, fz = c.z - Math.cos(c.rotY ?? 0) * 1.35;
      let blocked = false;
      for (const p2 of pots) {
        if (Math.hypot(p2.x - fx, p2.z - fz) < 0.55 || Math.hypot(p2.x - c.x, p2.z - c.z) < 0.55) { blocked = true; break; }
      }
      if (blocked) continue;
    }
    const sd = rng();
    const bq = (sd * 733) % 1;
    const kid = bq > 0.88;
    folk.push({
      x: c.x, z: c.z, y: c.y, seed: sd, sit: 1,
      h: 0.86 + sd * 0.12,       // 座面 0.45m は固定。身長を振ると腰が椅子に沈む/浮く
      wx: kid ? 1.06 : 0.96 + sd * 0.10, wz: kid ? 1.04 : 0.94 + sd * 0.12,
      headK: kid ? 1.20 : 0.98 + sd * 0.05,
      rotY: c.rot + (rng() - 0.5) * 0.3,   // 椅子と同じ向き(+π を足すと背もたれに正対する)   // 椅子と同じ向き(+π を足すと背もたれに正対する)
    });
  }

  // ---- 歩く人に経路を与える。四肢だけがその場で振れる群衆は、
  // 群衆がいないより強く「模型だ」と告げる。
  {
    const allStreets = plan.streets;
    for (const f of folk) {
      if (f.sit) { f.walk = null; continue; }
      if (f.seed <= 0.26) { f.walk = null; continue; }     // 永久固定は 26%(残りは歩いて止まる)
      // **乱数はここで全部引く。** 経路が取れたかどうかで引く回数が変わると、
      // そこから先の街全体の位相がずれる(前の commit と同じ故障)。
      // 引く数は「歩く体になり得る人」1 人につき常に 5。
      const dSpan = rng(), dT0 = rng(), dSp = rng(), dPa = rng(), dPb = rng();
      let best = null;
      for (const st of allStreets) {
        const q = nearestOnPolyline(st.pts, f.x, f.z);
        if (q.d > st.w / 2 + 0.9) continue;
        if (!best || q.d < best.q.d) best = { st, q };
      }
      // 経路の候補を作る。街路の人は 1 本(通りに沿う)、広場の人は向きを
      // 変えて 4 本試す — 広場の弦は記念物・階段・柱廊に当たりやすく、
      // 一方向だけ試すとルジャで 25 人中 3 人しか歩けない。
      const cands = [];
      if (best) {
        cands.push({ tx: best.q.tx, tz: best.q.tz,
          span: Math.min(16 + dSpan * 14, polylineLength(best.st.pts) - 6) });
      } else {
        // **広場の人は街路の折れ線に乗らない。** ここで一律 walk = null にしていたので、
        // ルジャ広場もオノフリオの前も、広場に立つ人は一人も歩いていなかった
        // (実測: 広場の folk の歩く体 0 / 全員)。広場は街でいちばん人が動く場所で、
        // そこが全員棒立ちだと「模型だ」と最も強く告げる。
        const pl = (plan.PLAZAS || []).find(q2 =>
          f.x > q2.x0 && f.x < q2.x1 && f.z > q2.z0 && f.z < q2.z1);
        if (!pl) {
          // **城壁の歩廊も街路の折れ線に乗らない。** 実測 46 人中 45 人が
          // 「永久に立っている人」だった(ユーザー報告「人が全然動いていない」)。
          // 歩廊は曲がるので長い弦は通らない。短い区間を八方位で試し、
          // 下の 9 点検証(collide と groundAt)に通ったものを採る。
          for (let k = 0; k < 8; k++) {
            const th = f.seed * 6.28318 + (k * Math.PI) / 4;
            const ux = Math.sin(th), uz = Math.cos(th);
            for (const sp of [11 + dSpan * 6, 6.5]) cands.push({ tx: ux, tz: uz, span: sp });
          }
          if (!cands.length) { f.walk = null; continue; }
        } else {
        const M = 1.2;   // 縁の 1.2m は柱廊・階段・記念物の取り付き
        for (let k = 0; k < 4; k++) {
          const th = f.seed * 6.28318 + k * (Math.PI / 4);
          const ux = Math.sin(th), uz = Math.cos(th);
          const tMax = (dx, dz) => {
            let t = Infinity;
            if (dx > 1e-6) t = Math.min(t, (pl.x1 - M - f.x) / dx);
            else if (dx < -1e-6) t = Math.min(t, (pl.x0 + M - f.x) / dx);
            if (dz > 1e-6) t = Math.min(t, (pl.z1 - M - f.z) / dz);
            else if (dz < -1e-6) t = Math.min(t, (pl.z0 + M - f.z) / dz);
            return Math.max(0, t);
          };
          cands.push({ tx: ux, tz: uz,
            span: Math.min(tMax(ux, uz), tMax(-ux, -uz), (16 + dSpan * 14) / 2) * 2 });
        }
        }
      }
      let tx = 0, tz = 0, span = 0, ys = null;
      for (const c of cands) {
        if (c.span < 5) continue;
        // 経路上の高さを 9 点サンプルして持っておく(毎フレームの groundAt を避ける)
        const yy = [];
        let ok = true;
        for (let k = 0; k <= 8; k++) {
          const u = k / 8 - 0.5;
          const px2 = f.x + c.tx * c.span * u, pz2 = f.z + c.tz * c.span * u;
          const cc = plan.collide(px2, pz2, 0.4, f.y + 1.0);
          if (Math.hypot(cc.x - px2, cc.z - pz2) > 0.2) { ok = false; break; }
          const g = plan.groundAt(px2, pz2, f.y + 1.2);
          if (!g || Math.abs(g.y - f.y) > 3.5) { ok = false; break; }
          yy.push(g.y);
        }
        if (ok) { tx = c.tx; tz = c.tz; span = c.span; ys = yy; break; }
      }
      const okPath = ys !== null;
      if (!okPath) { f.walk = null; continue; }
      // 端で止まって振り向く時間。三角波で往復するだけだと、1 フレームで
      // yaw が π 飛び、同じ人が目の前で瞬間反転する。
      f.walk = { tx, tz, span, ys, t0: dT0, sp: 1.05 + dSp * 0.55,
        pa: 1.8 + dPa * 4.5, pb: 1.8 + dPb * 4.5 };
    }
  }

  {
    // 手足のあるローポリ人体。カプセルに球を載せたものは「人がいない」より悪い。
    // 歩行は頂点シェーダで四肢を振る(aLimb: ±1=脚 ±2=腕、符号=左右)。
    const limbOf = (g, v) => {
      const n = g.attributes.position.count;
      g.setAttribute('aLimb', new THREE.BufferAttribute(new Float32Array(n).fill(v), 1));
      return g;
    };
    const box = (w, h, d, x, y, z = 0) => {
      const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y + h / 2, z); return g;
    };
    const taper = (wt, wb, h, d, x, y) => {
      const g = new THREE.CylinderGeometry(wt, wb, h, 10);
      g.scale(1, 1, d); g.translate(x, y + h / 2, 0); return g;
    };
    // 胴(シャツ)
    // 実測の人体は肩幅 0.42m・胸厚 0.24m(幅:厚 = 1.75:1)。
    // 前後に長い円柱にすると、背面から見たとき一枚の板になる。
    const torsoGeo = mergeGeo([
      limbOf(taper(0.21, 0.185, 0.52, 0.58, 0, 1.16), 0),         // 胴(横に広く前後に薄い)
      (() => { const g = new THREE.SphereGeometry(0.092, 8, 6); g.scale(1, 0.80, 0.60); g.translate(-0.190, 1.60, 0); return limbOf(g, 0); })(),
      (() => { const g = new THREE.SphereGeometry(0.092, 8, 6); g.scale(1, 0.80, 0.60); g.translate(0.190, 1.60, 0); return limbOf(g, 0); })(),
    ]);
    // 腕は上腕・前腕・肩を分けず 1 本の連続体に(境目の段差が「部品の寄せ集め」に見える)
    const armGeo = mergeGeo([
      (() => { const g = new THREE.CylinderGeometry(0.050, 0.042, 0.60, 6); g.scale(1, 1, 1.12); g.translate(-0.205, 1.32, 0); return limbOf(g, -2); })(),
      (() => { const g = new THREE.CylinderGeometry(0.050, 0.042, 0.60, 6); g.scale(1, 1, 1.12); g.translate(0.205, 1.32, 0); return limbOf(g, 2); })(),   // 腕は脚と対側に振る
      limbOf(box(0.072, 0.105, 0.048, -0.205, 0.925), -2),
      limbOf(box(0.072, 0.105, 0.048, 0.205, 0.925), 2),
    ]);
    // 脚(ズボン)。腰と腿を 0.03m 重ねる — 隙間があると製図用コンパスに見える。
    const legGeo = mergeGeo([
      limbOf(box(0.300, 0.30, 0.225, 0, 0.88), 0),                // 腰
      limbOf(box(0.145, 0.47, 0.165, -0.086, 0.44), 1),           // 腿 左
      limbOf(box(0.145, 0.47, 0.165, 0.086, 0.44), -1),           // 腿 右
      limbOf(box(0.115, 0.42, 0.140, -0.094, 0.03), 1),           // 脛 左
      limbOf(box(0.115, 0.42, 0.140, 0.094, 0.03), -1),           // 脛 右
      // box(w,h,d,x,y,z) の y は **底**(中心ではない)。足裏は元から原点にある。
      // 「中心 y=0 だから足裏が 0.028m 下」と読み違えて持ち上げ、逆に 2.75cm
      // 浮かせたことがある。箱の定義を読んでから直すこと。
      limbOf(box(0.118, 0.055, 0.245, -0.096, 0.0, 0.042), 1),    // 足 左
      limbOf(box(0.118, 0.055, 0.245, 0.096, 0.0, 0.042), -1),    // 足 右
    ]);
    // 頭・首(肌)
    const headGeo = (() => {
      const h = new THREE.SphereGeometry(0.108, 8, 6);
      h.scale(0.78, 1.12, 0.88); h.translate(0, 1.80, 0);   // 頭幅は 0.17m。0.20 だと顔が大きい
      const nose = new THREE.BoxGeometry(0.028, 0.042, 0.034); nose.translate(0, 1.782, 0.094);
      const neck = new THREE.CylinderGeometry(0.055, 0.062, 0.12, 6); neck.translate(0, 1.68, 0);
      return mergeGeo([limbOf(h, 0), limbOf(nose, 0), limbOf(neck, 0)]);
    })();

    const walkShader = (mat) => {
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uT = clothTime;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>
            uniform float uT; attribute float aLimb; attribute float aPh; attribute float aWalk;
            attribute float aCad; attribute float aSit; attribute float aPose;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            float ph = aPh + uT * aCad;
            float sw = sin(ph) * aWalk;
            // 立ち止まっている人の姿勢(0=直立 1=片手を腰 2=腕組み 3=片脚に体重)
            float stand = 1.0 - aWalk;
            float pz = floor(aPose + 0.5);
            float breathe = sin(uT * 0.55 + aPh) * 0.012 * stand;   // 呼吸と重心の揺れ
            if (abs(aLimb) > 0.5) {
              float side = sign(aLimb);
              float isArm = step(1.5, abs(aLimb));
              float amp = mix(0.40, 0.30, isArm);   // 散歩の股関節は片側 12〜14°
              float piv = mix(0.90, 1.62, isArm);
              float a = sw * side * amp;
              // 立位の腕は左右で別の角度をとる。同じ角度だと必ずブリキの兵隊になる。
              // 肩から丸ごと回すと腕が水平に突き出るので、肘から先にだけ効かせる。
              float tArm = clamp((piv - transformed.y) / 0.62, 0.0, 1.0);
              float elbow = smoothstep(0.44, 1.0, tArm);
              if (isArm > 0.5) {
                a += sin(uT * 0.42 + aPh + side) * 0.04 * stand;
              } else if (pz == 3.0) {
                a += side * 0.10 * stand;                               // 片脚に体重
              }
              // 膝。脛(y<0.45)を後ろへ折る。これが無いと 200 人全員が黒い筒になる。
              if (isArm < 0.5) {
                float knee = max(0.0, -sin(ph) * side) * 0.62 * aWalk;
                float dyK = transformed.y - 0.45;
                if (dyK < 0.0) {
                  transformed.z += sin(knee) * dyK;
                  transformed.y = 0.45 + cos(knee) * dyK;
                }
              }
              float dy = transformed.y - piv;
              float ca = cos(a), sa = sin(a);
              transformed.z += sa * dy;
              transformed.y = piv + ca * dy;
              // 腕組みは前腕を体の前で内側へ寄せる
              // 剛体の円柱は「肩から回す」と必ずスキーのストックになる。
              // 手先の位置だけを動かして、肘の曲がりを暗示する。
              if (isArm > 0.5 && stand > 0.5) {
                if (pz == 1.0 && side > 0.0) {          // 片手を腰へ
                  transformed.x -= 0.098 * elbow;
                  transformed.y += 0.075 * elbow;
                  transformed.z -= 0.030 * elbow;
                } else if (pz == 2.0 && side < 0.0) {
                  // 片手で反対の肘を持つ。左右対称に寄せると前腕が融合して
                  // 「胸の白い塊」になる(実測 シャツとの段差 L* 16.6)。片腕だけ動かす。
                  transformed.x += 0.115 * elbow;
                  transformed.y += 0.185 * elbow;
                  transformed.z += 0.085 * elbow;
                }
              }
            }
            // 剛体回転で足裏が 0.90·(1−cos a) 浮く。骨盤を同じだけ下げて接地を保つ。
            // ただし体ごと下げると **接地している側の足も** 一緒に沈む。
            // 歩いている人は最大 0.071m 舗石に埋まっていた(実測 404 体中 149 体)。
            // 沈み込みは足首より上だけに効かせる — 脛が少し伸びるが、足は残る。
            transformed.y -= 0.90 * (1.0 - cos(sw * 0.40)) * aWalk
              * smoothstep(0.02, 0.30, transformed.y);
            // 片脚に体重を乗せると腰が数センチ傾く
            transformed.x += (pz == 3.0 ? 0.024 : 0.0) * stand * smoothstep(0.55, 1.20, transformed.y);
            transformed.y -= breathe * smoothstep(0.9, 1.7, transformed.y);
            transformed.x += sin(uT * 0.8 + aPh) * 0.006 * stand;
            // 座位: 腰は座面 0.50m、腿は水平、脛は垂直、上体は 0.40m 下がる。
            if (aSit > 1.5) {
              // 石段に座る。踏面 0.50m・蹴上げ 0.155m の階段では、足は 3 段下
              // (前方 1.35m・下方 0.45m)に着く。椅子と同じ式だと脛が石に埋まる。
              if (abs(aLimb) > 1.5) transformed.z += 0.20 * smoothstep(1.62, 1.00, transformed.y);
              // 足は座面より 0.55m 下に着く姿勢だった。実測ではその位置の床は
              // 0.30m 下しかなく、40 人全員の脛が舗装に 0.15〜0.26m 埋まって
              // 「足の無い人」になっていた。膝を高く、足は座面 −0.30m へ。
              if (transformed.y >= 0.91) {
                transformed.y -= 0.40;
              } else if (transformed.y >= 0.45) {
                float t3 = 0.91 - transformed.y;
                transformed.z += t3 * 1.90;
                transformed.y = 0.50 - t3 * 0.10;
              } else {
                transformed.z += 1.35;
                transformed.y = 0.454 - (0.45 - transformed.y) * 0.66;
              }
            } else if (aSit > 0.5) {
              // 腕は前へ。卓は椅子から z ±0.58 にあるので、0.26m 出すと手が天板に届く。
              if (abs(aLimb) > 1.5) transformed.z += 0.26 * smoothstep(1.62, 1.00, transformed.y);
              if (transformed.y >= 0.91) {
                transformed.y -= 0.40;
              } else if (transformed.y >= 0.45) {
                float t2 = 0.91 - transformed.y;
                transformed.z += t2 * 0.98;
                transformed.y = 0.50 + t2 * 0.12;
              } else {
                transformed.z += 0.45;
                transformed.y *= 1.11;
              }
            }`);
      };
    };
    const skinMat = new THREE.MeshStandardMaterial({ roughness: 0.82 , envMapIntensity: 0.32 });
    const shirtMat = new THREE.MeshStandardMaterial({ roughness: 0.88 , envMapIntensity: 0.32 });
    const legMat = new THREE.MeshStandardMaterial({ roughness: 0.90 , envMapIntensity: 0.32 });
    walkShader(skinMat); walkShader(shirtMat); walkShader(legMat);
    patchSkyVisInstanced(skinMat); patchSkyVisInstanced(shirtMat); patchSkyVisInstanced(legMat);
    const hairGeo = (() => {
      // 髪が頭より大きいとヘルメットに見える。ただし余裕が 2mm だと、
      // 6 段の低ポリ面が頭の面と交差して「白い横縞」になる。頭と同じ段数にし、
      // 8mm の余裕を取る。
      const h = new THREE.SphereGeometry(0.122, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.47);
      h.scale(0.80, 1.10, 0.90); h.translate(0, 1.799, -0.009);
      return mergeGeo([h].map(g => {
        const n = g.attributes.position.count;
        g.setAttribute('aLimb', new THREE.BufferAttribute(new Float32Array(n), 1));
        return g;
      }));
    })();
    const hairMat = new THREE.MeshStandardMaterial({ roughness: 0.94 , envMapIntensity: 0.32 });
    const armMat2 = new THREE.MeshStandardMaterial({ roughness: 0.84 , envMapIntensity: 0.32 });
    walkShader(hairMat); walkShader(armMat2);
    patchSkyVisInstanced(hairMat); patchSkyVisInstanced(armMat2);
    // 売り子。台の後ろ 0.95m に立たせる(既存の 5 本のメッシュに相乗り = draw call 増ゼロ)
    for (const st of stalls) {
      const nx = -Math.sin(st.rot), nz = -Math.cos(st.rot);
      const sd2 = 0.30 + st.seed * 0.11;
      // 売り子は台から 0.95m 後ろ。台の高さをそのまま使うと、台が帯の上・
      // 売り子が広場の板の上、という食い違いで 0.13m 浮く(実測 1 人)。
      // 立つ場所の床を引き直す。
      const vx = st.x - nx * 0.95, vz = st.z - nz * 0.95;
      folk.push({
        x: vx, z: vz, y: onFloor(vx, vz, st.y), seed: sd2, sit: 0, job: 'stall',
        h: 0.90 + st.seed * 0.16, wx: 1.0, wz: 1.0, headK: 1.0,
        // 12 人が同じ向きで棒立ちだと、市場ではなく人形の陳列になる
        rotY: st.rot + Math.PI + (sd2 - 0.5) * 0.9, walk: null,
      });
    }
    // 階段に座る人。ドゥブロヴニクで最も人が座るのはイエズス会の大階段と路地の段。
    // 誰も座っていない階段は「行く場所」ではなく「置いてある飾り」に見える。
    if (stepPool && stepPool.items && stepPool.items.length) {
      const its = stepPool.items;
      const srng2 = rngFor(0x9c31);
      let placed = 0;
      // 一様抽選だと、幅 14m のイエズス会大階段(2600 段中 25 段)の期待値が 0.3 人になる。
      // 広い段ほど人が座るので、幅で重み付けする。
      const wide = its.filter(q => q.w >= 6.5);         // 儀典階段
      const norm = its.filter(q => q.w >= 2.6 && q.w < 6.5);
      const pool = [];
      for (let r = 0; r < 3; r++) for (const q of wide) pool.push(q);   // 大階段を 3 倍重く
      for (const q of norm) pool.push(q);
      for (let k = 0; k < pool.length && placed < 40; k++) {
        const it = pool[(k * 37 + 11) % pool.length];
        if (srng2() > (it.w >= 6.5 ? 0.42 : 0.13)) continue;
        // 段の中心から幅方向にずらす(縁に寄って座る)
        const off = (srng2() - 0.5) * (it.w - 1.2);
        const px2 = it.x + Math.cos(it.rotY) * off;
        const pz2 = it.z - Math.sin(it.rotY) * off;
        const sd3 = srng2();
        // 段を降りる向き(踏面の法線の下り側)を向く
        const rot3 = it.rotY + Math.PI + (srng2() - 0.5) * 0.6;
        let seatBase3 = it.y - 0.45;
        // 座位の脚が石に埋まっていないか、足だけでなく膝と腿でも確かめる。
        // 足だけを見ていたときは 40 人中 7 人の膝や腿が段に入っていた
        // (最悪 1.17m — 段の上り側を向いて座らせていた)。
        // 局所 +Z のワールド向きは (sin rotY, cos rotY)。シェーダの姿勢:
        //   足 z+1.35 / y+0.157、膝 z+0.874 / y+0.454、腿中 z+0.44 / y+0.478
        {
          const dirX = Math.sin(rot3), dirZ = Math.cos(rot3);
          // 床は plan.groundAt ではなく **実際に置かれた段** の天端で測る。
          // 段の量子化は歩く線の上でしか一致しないので、腰から 0.9m 前の膝は
          // plan では 0.38m 低く出て、めり込みを見落とす(実測でそうなった)。
          // 近い段の中で **一番高い天端** を採る。中心が一番近い段を採ると、
          // 踏面 0.5m の階段では膝(腰から 0.87m 前 = 2 段上)の下に
          // 一段低い段を拾ってしまい、めり込みを見落とす。
          // 段の「箱の中」に入っているかで拾う。中心からの距離で拾うと、
          // 踏面 0.5m の階段では一段下の段を掴んで、めり込みを見落とす。
          // 石段の踏面「だけ」を返す(無ければ null)。地形も舗装も見ない。
          const stepTread = (x, z) => {
            let hi = null;
            for (const q of its) {
              const ddx = x - q.x, ddz = z - q.z;
              if (Math.abs(ddx) > 3.5 || Math.abs(ddz) > 3.5) continue;
              const c2 = Math.cos(q.rotY), s2 = Math.sin(q.rotY);
              const along = ddx * s2 + ddz * c2, across = ddx * c2 - ddz * s2;
              if (Math.abs(along) <= q.d / 2 + 0.22 && Math.abs(across) <= q.w / 2 + 0.10) {
                if (hi === null || q.y > hi) hi = q.y;
              }
            }
            return hi;
          };
          const treadY = (x, z) => {
            let hi = null, near = null, bd = 0.9;
            for (const q of its) {
              const ddx = x - q.x, ddz = z - q.z;
              if (Math.abs(ddx) > 3.5 || Math.abs(ddz) > 3.5) continue;
              const c2 = Math.cos(q.rotY), s2 = Math.sin(q.rotY);
              const along = ddx * s2 + ddz * c2;
              const across = ddx * c2 - ddz * s2;
              // 段は踏面の先に小口(段鼻)が出る。箱をきっちり測ると、
              // その出のぶんだけ一段上の段を見落とす。
              if (Math.abs(along) <= q.d / 2 + 0.22 && Math.abs(across) <= q.w / 2 + 0.10) {
                if (hi === null || q.y > hi) hi = q.y;
              }
              const dd = Math.hypot(ddx, ddz);
              if (dd < bd) { bd = dd; near = q.y; }
            }
            // 段だけでなく、その場の舗装・地面も床の候補。一番高いものを採る。
            const g = plan.groundAt(x, z);
            const cand = [hi, near !== null && hi === null ? near : null,
              (g && g.y !== undefined) ? g.y : null, plan.surfaceAt(x, z)]
              .filter((v) => v !== null && v !== undefined);
            return cand.length ? Math.max(...cand) : null;
          };
          const base3 = it.y - 0.45;
          // 判定はインスタンスの拡大縮小まで含めた **実際の脚の位置** で。
          // 素の姿勢(拡大なし)で測っていたので、足が 5cm 手前にずれ、
          // 踏面 0.8m の階段では一段違う段を見ていた。
          const hs = 0.88 + sd3 * 0.10, wzs = 0.96, wxs = 0.98;
          let ok3 = true;
          // 検査点も **シェーダの姿勢そのもの** から取る。別の姿勢で測ると、
          // 石に埋まった人を一体も鳴らせない(実測でそうなっていた)。
          //   足 (z 0.492, y 0.30) / 膝 (z 0.45, y 0.55) / 腰 (z 0, y 0.50)
          for (const [fz0, fy0, lat] of [
            [0.492, 0.30, -0.10], [0.492, 0.30, 0], [0.492, 0.30, 0.10],
            [0.45, 0.55, -0.10], [0.45, 0.55, 0.10],
            [0.0, 0.50, 0]]) {
            // 実際のインスタンスの拡大は (h·wx, h, h·wz)。z を wz だけで
            // 掛けていたので、足が 9cm 奥にずれて別の段を見ていた。
            const fz = fz0 * hs * wzs, fy = fy0 * hs, lx = lat * hs * wxs;
            const qx = px2 + dirX * fz - dirZ * lx, qz = pz2 + dirZ * fz + dirX * lx;
            const wy = base3 + fy;
            const fy2 = treadY(qx, qz);
            if (fy2 === null) { ok3 = false; break; }
            if (fy2 > wy + 0.04) { ok3 = false; break; }            // 石にめり込む
            // 足の 3 点は **石段の実体** でしか測らない。踏面が深い階段
            // (イエズス会の大階段)や踊り場では、足が同じ段の上に残るので
            // 膝を上げた姿勢でも 0.18〜0.67m 埋まる。地形や舗装への
            // 取りこぼしを許すと、その場所に座らせてしまう。
            if (fz0 > 0.3 && stepTread(qx, qz) === null) { ok3 = false; break; }
            if (fz0 > 1.0 && fy2 < wy - 0.55) { ok3 = false; break; }  // 足が宙に浮く
            // 家の際に脚が入っていないか。実測でめり込んでいたのは躯体ではなく
            // **巾木**(壁面から 0.13m 出る base course)だった。plan.houses の
            // 矩形は躯体そのものなので、巾木のぶん 0.28m 外まで見る。
            for (const h of plan.houses) {
              if (qx < h.x - h.w / 2 - 0.28 || qx > h.x + h.w / 2 + 0.28) continue;
              if (qz < h.z - h.d / 2 - 0.28 || qz > h.z + h.d / 2 + 0.28) continue;
              if (wy > h.yBase - 0.2 && wy < h.eaves) { ok3 = false; break; }
            }
            if (!ok3) break;
          }
          if (!ok3) continue;
          seatBase3 = base3;
        }
        folk.push({
          x: px2, z: pz2, y: seatBase3, seed: sd3, sit: 2,
          h: 0.88 + sd3 * 0.10, wx: 0.98, wz: 0.96, headK: 1.0,
          rotY: rot3,
        });
        placed++;
      }
    }
    // ここまでで folk が確定する。InstancedMesh の確保はこの後でなければ、
    // 後から push した人が範囲外になって腕も髪も付かない。
    const arms = new THREE.InstancedMesh(armGeo, armMat2, folk.length);
    const hair = new THREE.InstancedMesh(hairGeo, hairMat, folk.length);
    const torso = new THREE.InstancedMesh(torsoGeo, shirtMat, folk.length);
    const legs = new THREE.InstancedMesh(legGeo, legMat, folk.length);
    const heads = new THREE.InstancedMesh(headGeo, skinMat, folk.length);
    const ph = new Float32Array(folk.length);
    const wk = new Float32Array(folk.length);
    const cd = new Float32Array(folk.length);
    const st = new Float32Array(folk.length);
    const po = new Float32Array(folk.length);
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    // シャツ8色 / ボトム5色 / 肌4色。40% は背景より暗い服にする(白ばかりにしない)
    // 実際の通りの服は白・生成り・淡色が大半で、高彩度は 2 割に満たない。
    // 原色を等確率で配ると、群衆が紙吹雪に見える。
    const SHIRT = [0xe6e2d8, 0xd8d2c2, 0xc9cdd4, 0x9fb0c0, 0x33415a, 0x8d8f86,
      0xb5a68e, 0x6d7a6a, 0xa8574a, 0x3c4a56, 0x5c6b7a, 0x7a6a58];
    const TROUS = [0x33333a, 0x4a4436, 0x1e2a36, 0x59554a, 0x282420, 0x3d3630, 0x2c3340];
    const SKIN = [0xc79a72, 0xd6b189, 0xa87a56, 0xe0c4a2];
    const HAIR = [0x1e1712, 0x2e2119, 0x4a3524, 0x6b5236, 0x8a7a68, 0xb9b2a6];
    folk.forEach((f, i) => {
      dummy.position.set(f.x, f.y, f.z);
      dummy.rotation.set(0, f.rotY, 0);
      dummy.scale.set(f.h * f.wx, f.h, f.h * f.wz);
      dummy.updateMatrix();
      torso.setMatrixAt(i, dummy.matrix);
      legs.setMatrixAt(i, dummy.matrix);
      heads.setMatrixAt(i, dummy.matrix);
      hair.setMatrixAt(i, dummy.matrix);
      arms.setMatrixAt(i, dummy.matrix);
      const k = (f.seed * 977) | 0;
      torso.setColorAt(i, col.setHex(SHIRT[k % 12]));
      legs.setColorAt(i, col.setHex(TROUS[((k * 3 + 5) >> 1) % 7]));
      heads.setColorAt(i, col.setHex(SKIN[((k * 5 + 3) >> 1) % 4]));
      hair.setColorAt(i, col.setHex(HAIR[((k * 7 + 13) >> 2) % 6]));
      // 55% は半袖(前腕が肌)。残りは袖のあるシャツ色。
      arms.setColorAt(i, col.setHex(f.seed < 0.55 ? SKIN[((k * 5 + 3) >> 1) % 4] : SHIRT[k % 12]));
      ph[i] = hash2((f.x * 31) | 0, (f.z * 17) | 0) * 6.28318;   // 位相は seed と独立に
      f._ph = ph[i];
      wk[i] = f.walk ? 1 : 0;
      // 歩調は速度から逆算する。歩幅 = 2·sin(amp)·股関節高 = 2·sin(0.40)·0.90 = 0.70m。
      // 定数にすると足がアニメの 5.7 倍の速さで滑る。
      cd[i] = f.walk ? (f.walk.sp / (0.70 * f.h)) * Math.PI : 1.3;
      f._cad = cd[i];
      st[i] = f.sit || 0;        // 0=立/歩 1=椅子 2=石段
      po[i] = f.sit ? 0 : ((hash2((f.z * 23) | 0, (f.x * 29) | 0) * 4) | 0);
    });
    // 座っている人の脚は宙に浮く(それが「座る」ということ)。接地を問える
    // のは立っている人だけなので、どちらかを検査に伝える。
    const folkStanding = folk.map((f) => !f.sit);
    const skI = new Float32Array(folk.length);
    folk.forEach((f, i) => { skI[i] = skyOf(f.x, f.z, (f.y ?? 0) + 1.1); });
    // aWalk は毎フレーム書き換える(歩く→止まるのランプ)。5 本に複製すると
    // 5 回アップロードすることになるので、同じ属性オブジェクトを共有する。
    walkAmt = wk;
    walkAttr = new THREE.InstancedBufferAttribute(wk, 1);
    walkAttr.setUsage(THREE.DynamicDrawUsage);
    for (const g of [torsoGeo, legGeo, headGeo, hairGeo, armGeo]) {
      g.setAttribute('aSkyI', new THREE.InstancedBufferAttribute(skI.slice(), 1));
      g.setAttribute('aPose', new THREE.InstancedBufferAttribute(po.slice(), 1));
      g.setAttribute('aPh', new THREE.InstancedBufferAttribute(ph.slice(), 1));
      g.setAttribute('aWalk', walkAttr);
      g.setAttribute('aCad', new THREE.InstancedBufferAttribute(cd.slice(), 1));
      g.setAttribute('aSit', new THREE.InstancedBufferAttribute(st.slice(), 1));
    }
    for (const m of [torso, legs, heads, hair, arms]) {
      m.castShadow = true; m.receiveShadow = true;
      // 影も同じ姿勢で落とす(これが無いと全員が直立の影を落とす)
      m.customDepthMaterial = depthFor(m.material);
    }
    arms.castShadow = true;
    group.add(tagMesh(torso, 'life.folkTorso', { solid: true, creature: true, composite: 'folk' }),
      tagMesh(legs, 'life.folkLegs', { solid: true, creature: true, composite: 'folk', groundContact: true, standing: folkStanding }),
      tagMesh(heads, 'life.folkHead', { solid: true, creature: true, composite: 'folk' }),
      tagMesh(hair, 'life.folkHair', { solid: true, creature: true, composite: 'folk' }),
      tagMesh(arms, 'life.folkArms', { solid: true, creature: true, composite: 'folk' }));
    folkMeshes = { torso, legs, heads, hair, arms, acc: null };

    // 持ち物 — 4割の人が何かを持っている。観光の街で手ぶらの群衆は嘘。
    {
      const bagGeo = mergeGeo([
        (() => { const g = new THREE.BoxGeometry(0.145, 0.19, 0.075); g.translate(0.127, 1.055, -0.135); return limbOf(g, 0); })(),
        (() => { const g = new THREE.BoxGeometry(0.030, 0.36, 0.02); g.rotateZ(-0.26); g.translate(0.112, 1.43, -0.10); return limbOf(g, 0); })(),
      ]);
      const hatGeo = mergeGeo([
        (() => { const g = new THREE.CylinderGeometry(0.098, 0.104, 0.085, 10); g.scale(0.86, 1, 0.92); g.translate(0, 1.876, 0); return limbOf(g, 0); })(),
        (() => { const g = new THREE.CylinderGeometry(0.168, 0.168, 0.012, 12); g.scale(0.86, 1, 0.92); g.translate(0, 1.836, 0.006); return limbOf(g, 0); })(),
      ]);
      const packGeo = mergeGeo([
        (() => { const g = new THREE.BoxGeometry(0.245, 0.32, 0.155); g.translate(0, 1.335, -0.148); return limbOf(g, 0); })(),
      ]);
      // 3 種を 1 メッシュに束ね、持っていない部位は頂点シェーダで潰す。
      // 別メッシュにすると深度プリパスと合わせて 6 ドローコールになる。
      const kindOf = (g, v) => {
        const n = g.attributes.position.count;
        g.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(n).fill(v), 1));
        return g;
      };
      const accGeo = mergeGeoK([kindOf(bagGeo, 1), kindOf(hatGeo, 2), kindOf(packGeo, 3)]);
      const accMat = new THREE.MeshStandardMaterial({ roughness: 0.86, envMapIntensity: 0.32 });
      accMat.onBeforeCompile = (sh) => {
        sh.uniforms.uT = clothTime;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>
            uniform float uT; attribute float aLimb; attribute float aKind;
            attribute float aPh; attribute float aWalk; attribute float aHas; attribute float aCad;
            attribute float aSit;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            if (abs(aKind - aHas) > 0.5) { transformed = vec3(0.0); }
            float ph = aPh + uT * aCad;
            float sw = sin(ph) * aWalk;
            if (abs(aLimb) > 0.5) {
              float side = sign(aLimb);
              float isArm = step(1.5, abs(aLimb));
              float amp = mix(0.40, 0.30, isArm);
              float piv = mix(0.90, 1.62, isArm);
              float a = sw * side * amp;
              float dy = transformed.y - piv;
              transformed.z += sin(a) * dy;
              transformed.y = piv + cos(a) * dy;
            }
            // 剛体回転で足裏が 0.90·(1−cos a) 浮く。骨盤を同じだけ下げて接地を保つ。
            transformed.y -= 0.90 * (1.0 - cos(sw * 0.40)) * aWalk;
            // 座った人の帽子と鞄は、胴と同じだけ下がらないと 40cm 宙に浮く
            if (aSit > 0.5) {
              if (transformed.y >= 0.91) transformed.y -= 0.40;
              else if (transformed.y >= 0.45) { float t2 = 0.91 - transformed.y; transformed.z += t2 * 0.98; transformed.y = 0.50 + t2 * 0.12; }
              else {
                // 脛と足。z を 0.45 前へ出すだけで高さを 1.11 倍していたので、
                // 足裏は座面の 0.44m **下** に置かれた。ところが前へ出るのは
                // 0.42m しかない。踏面 0.5m・蹴上 0.155m の階段が 0.42m で
                // 落ちる高さは 0.155m — **その姿勢は階段の上に存在できない**。
                // 実測 48 体すべてが腰まで石に埋まっていた。
                // 浅い段に座る人は膝が上がる。足裏を座面の 0.19m 下に置く。
                transformed.z += 0.45; transformed.y = transformed.y * 0.55 + 0.30;
              }
            }`);
      };
      const PAL = [[0x6b5a44, 0x2e3238, 0x8a4a3a, 0x4a5a52],
        [0xd8cfb4, 0xb8ac90, 0x2e2e30, 0xc0b8a4],
        [0x2f3a4a, 0x4a4436, 0x6b3a34, 0x3c4a3a]];
      const accList = [];
      for (const f of folk) {
        const q = (f.seed * 997) % 1;
        const kind = q > 0.86 && q <= 0.98 ? 2 : q > 0.62 ? 1 : q > 0.44 ? 3 : 0;
        if (kind) accList.push({ f, kind });
      }
      if (accList.length) {
        patchSkyVisInstanced(accMat);   // walkShader の後に掛ける(先に掛けると上書きで消える)
        const im = new THREE.InstancedMesh(accGeo, accMat, accList.length);
        im.customDepthMaterial = depthFor(accMat);
        const ph2 = new Float32Array(accList.length), wk2 = new Float32Array(accList.length);
        const hs = new Float32Array(accList.length), cd2 = new Float32Array(accList.length);
        const st2 = new Float32Array(accList.length);
        accList.forEach((a, i) => {
          dummy.position.set(a.f.x, a.f.y, a.f.z);
          dummy.rotation.set(0, a.f.rotY, 0);
          dummy.scale.setScalar(a.f.h);
          dummy.updateMatrix();
          im.setMatrixAt(i, dummy.matrix);
          const pal = PAL[a.kind - 1];
          im.setColorAt(i, col.setHex(pal[((a.f.seed * 613) | 0) % pal.length]));
          ph2[i] = hash2((a.f.x * 31) | 0, (a.f.z * 17) | 0) * 6.28318;
          wk2[i] = a.f.walk ? 1 : 0;
          hs[i] = a.kind;
          cd2[i] = a.f.walk ? (a.f.walk.sp / (0.70 * a.f.h)) * Math.PI : 1.3;
          st2[i] = a.f.sit || 0;
        });
        accGeo.setAttribute('aPh', new THREE.InstancedBufferAttribute(ph2, 1));
        accWalkAmt = wk2;
        accWalkAttr = new THREE.InstancedBufferAttribute(wk2, 1);
        accWalkAttr.setUsage(THREE.DynamicDrawUsage);
        accGeo.setAttribute('aWalk', accWalkAttr);
        accGeo.setAttribute('aHas', new THREE.InstancedBufferAttribute(hs, 1));
        accGeo.setAttribute('aCad', new THREE.InstancedBufferAttribute(cd2, 1));
        accGeo.setAttribute('aSit', new THREE.InstancedBufferAttribute(st2, 1));
        {
          const sk3 = new Float32Array(accList.length);
          accList.forEach((a, i) => { sk3[i] = skyOf(a.f.x, a.f.z, (a.f.y ?? 0) + 1.3); });
          accGeo.setAttribute('aSkyI', new THREE.InstancedBufferAttribute(sk3, 1));
        }
        im.castShadow = true;
    group.add(tagMesh(im, 'life.folkAccessory', { solid: true, creature: true, composite: 'folk' }));
        folkMeshes.acc = { mesh: im, list: accList };
      }
    }

    // 接地影のデカールは廃止。影の normalBias を是正して本物の影が出るようになった。
    // 太陽方向を無視する真下の楕円は、正しい影と二重になって足元を汚す。
  }

  // ------------------------------------------------- カフェの気配 ----
  // 朝の掃除前 — 日陰の隅に椅子が積まれ、日除けは開いている。


  const cafeSpots = [[118, -4.2, 0.4], [60, 4.0, 2.6], [-52, -4.2, 1.2], [134, 8, 1.9]];
  for (const [cx, cz, rot0] of cafeSpots) {
    const n = 4 + (rng() * 4 | 0);
    let i = 0;
    while (i < n) {
      // 候補は **常に 3 つ引く**。当たったかどうかで引く回数を変えると、
      // そこから先の位相がずれる(この場面で三度目)。
      const cand = [];
      for (let t = 0; t < 3; t++) cand.push([cx + (rng() - 0.5) * 3.4, cz + (rng() - 0.5) * 1.6]);
      const srot = rot0 + rng() * 1.2;
      let sx = null, sz = null, gy = 2.6;
      for (const [qx, qz] of cand) {
        // **床は実際に引く。** 以前は 2.6 の決め打ちで、そこに床が無い所では
        // 椅子がその高さに浮いていた。
        const g4 = plan.groundAt(qx, qz, 4.0);
        const y4 = (g4 && g4.y !== undefined) ? g4.y : 2.6;
        // 家の躯体の中に置かない。実測で (133.9, 8.3) の椅子の真上は
        // house.body@2.85 だった = 壁の中に椅子が立っていた。
        const c4 = plan.collide(qx, qz, 0.35, y4 + 1.0);
        if (Math.hypot(c4.x - qx, c4.z - qz) > 0.15) continue;
        sx = qx; sz = qz; gy = y4; break;
      }
      if (sx === null) { i += 1; continue; }   // 三つとも駄目なら 1 脚ぶん諦める
      // 積み重ねは **一箇所に下から順に** 積む。以前は段を i % 3 で決めていたので
      // 段の順が 0 → 2 → 1 → 0 になり、**下に何も無い 0.84m の段に椅子が乗って**
      // いた(実測 (118.6, -4.3) で 0.83m の浮き)。
      const k = rng() < 0.45 ? Math.min(n - i, 2 + (rng() < 0.5 ? 1 : 0)) : 1;
      for (let s = 0; s < k; s++) {
        const jit = rng();                      // 段ごとに必ず 1 回引く
        chairPos.push({
          // 積んだ椅子は座面が入れ子になるので 1 脚 0.13m しか上がらない。
          // 0.42m(座面の高さそのもの)で積むと、椅子ではなく棚に見える。
          x: sx, z: sz, y: gy + 0.13 * s,
          // 積んだ椅子は同じ向きに少しずつずれて重なる。1 脚だけなら自由に振る。
          rot: srot + (k > 1 ? s * 0.06 : (jit - 0.5) * 1.2), seed: rng(),
        });
      }
      i += k;
    }
  }
  {
    const chairGeo = (() => {
      const seat = new THREE.BoxGeometry(0.4, 0.04, 0.4);
      seat.translate(0, 0.45, 0);
      const back = new THREE.BoxGeometry(0.4, 0.42, 0.035);
      back.translate(0, 0.68, -0.19);
      const legs = [];
      for (const [lx, lz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) {
        const leg = new THREE.CylinderGeometry(0.02, 0.02, 0.45, 5);
        leg.translate(lx, 0.225, lz);
        legs.push(leg);
      }
      return mergeSimple([seat, back, ...legs]);
    })();
    const chairMat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
    const chairs = new THREE.InstancedMesh(chairGeo, chairMat, chairPos.length);
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    chairPos.forEach((c, i) => {
      dummy.position.set(c.x, c.y, c.z);
      dummy.rotation.set(0, c.rot, 0);
      dummy.updateMatrix();
      chairs.setMatrixAt(i, dummy.matrix);
      col.setHSL(0.08, 0.32, 0.38 + c.seed * 0.24, THREE.SRGBColorSpace);
      chairs.setColorAt(i, col);
    });
    chairs.castShadow = true;
    group.add(tagMesh(chairs, 'life.chair', { solid: true, furniture: true, groundContact: true }));
    // 日除けはパラソル(カフェ・テラス)に置き換えた。壁から離れて宙に浮く
    // 帆布は、屋根から生えた板にしか見えない。
  }

  // ------------------------------------------------ 市場とテーブル ----
  // 0.3〜2m のスケールの物が街に無いと、テクスチャがどれだけ細かくても模型に見える。
  {
    if (stalls.length) {
      const legG = [];
      for (const [lx, lz] of [[-1.05, -0.62], [1.05, -0.62], [-1.05, 0.62], [1.05, 0.62]]) {
        const g = new THREE.BoxGeometry(0.06, 0.78, 0.06); g.translate(lx, 0.39, lz); legG.push(g);
      }
      const top = new THREE.BoxGeometry(2.3, 0.06, 1.4); top.translate(0, 0.80, 0); legG.push(top);
      const skirt = new THREE.BoxGeometry(2.3, 0.55, 0.03); skirt.translate(0, 0.50, 0.70); legG.push(skirt);
      // 木箱と籠(空の台は市場に見えない)
      for (const [bx, bz, bw, bh, bd] of [[-0.72, -0.18, 0.46, 0.26, 0.34], [-0.12, 0.10, 0.38, 0.20, 0.30],
        [0.52, -0.12, 0.52, 0.30, 0.36], [0.86, 0.22, 0.30, 0.18, 0.26], [0.05, -0.30, 0.34, 0.16, 0.24]]) {
        const g = new THREE.BoxGeometry(bw, bh, bd); g.translate(bx, 0.83 + bh / 2, bz); legG.push(g);
      }
      for (const px2 of [-1.05, 1.05]) {
        const p3 = new THREE.BoxGeometry(0.05, 1.40, 0.05); p3.translate(px2, 1.45, -0.62); legG.push(p3);
        const p4 = new THREE.BoxGeometry(0.05, 1.40, 0.05); p4.translate(px2, 1.45, 0.62); legG.push(p4);
      }
      const stallMesh = new THREE.Mesh(mergeSimple(legG), new THREE.MeshStandardMaterial({
        map: tex.wood.map, normalMap: tex.wood.normalMap, roughness: 0.85, color: 0xd8c2a2, envMapIntensity: 0.4,
      }));
      const canG = [];
      const can = new THREE.PlaneGeometry(2.5, 1.55, 5, 1);
      const cp = can.attributes.position;
      for (let i = 0; i < cp.count; i++) cp.setZ(i, Math.sin((cp.getX(i) / 2.5 + 0.5) * Math.PI) * 0.10);
      can.rotateX(-Math.PI / 2); can.translate(0, 2.11, 0);
      canG.push(can);
      const canMesh = new THREE.Mesh(mergeSimple(canG), new THREE.MeshStandardMaterial({
        map: tex.cloth.map, color: 0xc8b48c, side: THREE.DoubleSide, roughness: 0.92,
      }));
      // 商品の山(木箱の中身)。ラベンダーの紫・柑橘の橙・干し無花果の茶・オリーブの緑。
      // 頂点色に焼くので、1 インスタンスの中で色が変わる(+1 draw call)。
      const goodsGeo = (() => {
        const parts = [];
        const PAL2 = [[0.34, 0.24, 0.42], [0.72, 0.36, 0.10], [0.30, 0.20, 0.13],
          [0.24, 0.28, 0.13], [0.62, 0.16, 0.13], [0.70, 0.58, 0.16]];
        const spots = [[-0.72, -0.18, 0.42, 0.30], [-0.12, 0.10, 0.34, 0.26],
          [0.52, -0.12, 0.48, 0.32], [0.86, 0.22, 0.27, 0.22], [0.05, -0.30, 0.31, 0.21]];
        spots.forEach(([bx, bz, bw, bd], k) => {
          const g = new THREE.SphereGeometry(0.5, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.5);
          g.scale(bw * 0.98, 0.19, bd * 0.98);
          g.translate(bx, 0.83 + [0.26, 0.20, 0.30, 0.18, 0.16][k], bz);
          const c = PAL2[k % PAL2.length];
          const n = g.attributes.position.count, a = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
          g.setAttribute('color', new THREE.BufferAttribute(a, 3));
          parts.push(g);
        });
        return mergeSimpleC(parts);
      })();
      const goodsMesh = new THREE.InstancedMesh(goodsGeo,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 }), stalls.length);
      const sm = new THREE.InstancedMesh(stallMesh.geometry, stallMesh.material, stalls.length);
      const cm = new THREE.InstancedMesh(canMesh.geometry, canMesh.material, stalls.length);
      const dm3 = new THREE.Object3D();
      const cc3 = new THREE.Color();
      stalls.forEach((st, i) => {
        dm3.position.set(st.x, st.y, st.z);
        dm3.rotation.set(0, st.rot, 0);
        dm3.updateMatrix();
        sm.setMatrixAt(i, dm3.matrix);
        cm.setMatrixAt(i, dm3.matrix);
        goodsMesh.setMatrixAt(i, dm3.matrix);
        cc3.setHSL(0.09 + st.seed * 0.03, 0.16 + st.seed * 0.12, 0.60 + st.seed * 0.16, THREE.SRGBColorSpace);
        cm.setColorAt(i, cc3);
      });
      sm.castShadow = true; cm.castShadow = true; goodsMesh.castShadow = true;
      group.add(tagMesh(sm, 'life.stallLeg', { solid: true, furniture: true, groundContact: true }),
        tagMesh(cm, 'life.stallCanopy', { thin: true, reason: '日除けの布', noCollide: true }),
        tagMesh(goodsMesh, 'life.stallGoods', { solid: true, furniture: true }));
      clock.market = [sm, cm, goodsMesh];

    }
  }

  // ---------------------------------------- 街路のカフェ・テラス ----
  {
    const tables = cafeTables, parasols = cafeParasols;
    if (tables.length) {
      const tGeo = (() => {
        const top = new THREE.CylinderGeometry(0.31, 0.31, 0.04, 12); top.translate(0, 0.73, 0);
        const col = new THREE.CylinderGeometry(0.035, 0.045, 0.71, 8); col.translate(0, 0.355, 0);
        const foot = new THREE.CylinderGeometry(0.22, 0.24, 0.03, 10); foot.translate(0, 0.015, 0);
        return mergeSimple([top, col, foot]);
      })();
      const tm = new THREE.InstancedMesh(tGeo, new THREE.MeshStandardMaterial({
        color: 0x8f8a7e, roughness: 0.62, metalness: 0.0, envMapIntensity: 0.28,
      }), tables.length);
      const dm4 = new THREE.Object3D();
      tables.forEach((t, i) => {
        dm4.position.set(t.x, t.y, t.z);
        dm4.rotation.set(0, t.rot, 0);
        dm4.updateMatrix();
        tm.setMatrixAt(i, dm4.matrix);
      });
      tm.castShadow = true; tm.receiveShadow = true;
    group.add(tagMesh(tm, 'life.table', { solid: true, furniture: true, groundContact: true }));

      // 卓上の物。41 卓が全部空だと、テラスは「家具の展示場」になる。
      // 4 種を 1 ジオメトリにまとめ、aTk で持っていない物を潰す(+1 draw call)。
      {
        const tk = (g, v) => {
          const n = g.attributes.position.count;
          g.setAttribute('aTk', new THREE.BufferAttribute(new Float32Array(n).fill(v), 1));
          return g;
        };
        const glass = (() => {
          const a = new THREE.CylinderGeometry(0.031, 0.026, 0.115, 7, 1, true);
          a.translate(0.13, 0.812, 0.05);
          const b = new THREE.CylinderGeometry(0.028, 0.028, 0.006, 7);
          b.translate(0.13, 0.757, 0.05);
          return tk(mergeSimple([a, b]), 1);
        })();
        const cup = (() => {
          const c = new THREE.CylinderGeometry(0.036, 0.028, 0.062, 8);
          c.translate(-0.09, 0.783, -0.07);
          const sa = new THREE.CylinderGeometry(0.072, 0.072, 0.008, 10);
          sa.translate(-0.09, 0.754, -0.07);
          return tk(mergeSimple([c, sa]), 2);
        })();
        const ash = (() => {
          const g = new THREE.CylinderGeometry(0.058, 0.050, 0.028, 9);
          g.translate(0.02, 0.764, 0.13);
          return tk(g, 3);
        })();
        const menu = (() => {
          const g = new THREE.BoxGeometry(0.105, 0.155, 0.012);
          g.rotateX(-0.30); g.rotateY(0.5);
          g.translate(-0.14, 0.828, 0.09);
          const b = new THREE.BoxGeometry(0.115, 0.010, 0.075);
          b.translate(-0.14, 0.754, 0.09);
          return tk(mergeSimple([g, b]), 4);
        })();
        const topGeo = mergeGeoT([glass, cup, ash, menu]);
        const topMat = new THREE.MeshStandardMaterial({ roughness: 0.42, envMapIntensity: 0.5 });
        topMat.onBeforeCompile = (sh) => {
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\n attribute float aTk; attribute float aHasT;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
              // 卓ごとに持ち物が違う。aHasT のビットに無い物は潰す。
              float bit = floor(mod(aHasT / pow(2.0, aTk - 1.0), 2.0) + 0.5);
              if (bit < 0.5) transformed = vec3(0.0);`);
        };
        topMat.customProgramCacheKey = () => 'tabletop';
        const has = new Float32Array(tables.length);
        const tops = new THREE.InstancedMesh(topGeo, topMat, tables.length);
        const cT = new THREE.Color();
        tables.forEach((t, i) => {
          dm4.position.set(t.x, t.y, t.z);
          dm4.rotation.set(0, t.rot, 0);
          dm4.updateMatrix();
          tops.setMatrixAt(i, dm4.matrix);
          const q = hash2((t.x * 31) | 0, (t.z * 37) | 0);
          // メニュー立ては必ず。あとは 0〜3 種。
          has[i] = 8 | (q > 0.34 ? 1 : 0) | (q > 0.58 ? 2 : 0) | (q > 0.76 ? 4 : 0);
          cT.setHSL(0.09, 0.05 + q * 0.10, 0.74 + q * 0.14, THREE.SRGBColorSpace);
          tops.setColorAt(i, cT);
        });
        topGeo.setAttribute('aHasT', new THREE.InstancedBufferAttribute(has, 1));
        tops.castShadow = true;
    group.add(tagMesh(tops, 'life.stallTop', { solid: true, furniture: true }));
      }

      // パラソル(八角・骨の折れ目つき)
      const pGeo = (() => {
        const parts = [];
        // 布は八角の円錐。CylinderGeometry の第1引数が「上」の半径なので、
        // (1.30, 0.07) と書くと上が広く下が尖った漏斗になる。傘は逆で、
        // 頂点が上・縁が下。骨の折れ目を出すため、縁から短い垂れをつける。
        const RIM_Y = 2.24, APEX_Y = 2.58, RIM_R = 1.30;
        const cloth = new THREE.CylinderGeometry(0.07, RIM_R, APEX_Y - RIM_Y, 8, 1, true);
        cloth.translate(0, (APEX_Y + RIM_Y) / 2, 0);
        parts.push(cloth);
        // 縁から垂れる短い幕(バランス)
        const skirt = new THREE.CylinderGeometry(RIM_R, RIM_R - 0.06, 0.13, 8, 1, true);
        skirt.translate(0, RIM_Y - 0.065, 0);
        parts.push(skirt);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const rib = new THREE.BoxGeometry(0.035, 0.035, RIM_R);
          // 外側の端が下がる向き(頂点から縁へ降りる)
          rib.rotateX(0.256); rib.rotateY(Math.PI / 2 - a);
          rib.translate(Math.cos(a) * 0.66, (APEX_Y + RIM_Y) / 2, Math.sin(a) * 0.66);
          parts.push(rib);
        }
        const pole = new THREE.CylinderGeometry(0.026, 0.030, APEX_Y, 6);
        pole.translate(0, APEX_Y / 2, 0);
        parts.push(pole);
        const knob = new THREE.SphereGeometry(0.05, 6, 4); knob.translate(0, APEX_Y + 0.05, 0);
        parts.push(knob);
        return mergeSimple(parts);
      })();
      // 畳み。**インスタンス行列を非一様に潰してはいけない** — three は
      // 法線に mat3(instanceMatrix) をそのまま掛ける(逆転置ではない)ので、
      // xz を 0.16 に潰すと法線が壊れ、閉じた傘が光の変化のたびに明滅する
      // (ユーザー報告「ゆらゆら揺れている」。実測 実機 1 秒で画素の 52%)。
      // 畳みは頂点シェーダでやる。行列は常に等倍のまま。
      const paraMat = new THREE.MeshStandardMaterial({
        map: tex.cloth.map, roughness: 0.94, side: THREE.DoubleSide, envMapIntensity: 0.25,
      });
      paraMat.onBeforeCompile = (sh) => {
        sh.uniforms.uHour = parasolHour;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uHour;\nattribute vec2 aPara;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            // aPara = (開く時刻, 畳む時刻)。店ごとに違う = 一斉に開かない。
            // 0.25 時 = 15 分かけて開く。人の手で開く速さ。
            float k = smoothstep(aPara.x, aPara.x + 0.25, uHour)
                    * (1.0 - smoothstep(aPara.y, aPara.y + 0.25, uHour));
            float r = length(transformed.xz);
            // **支柱は畳まない。** 軸ごと縮めると支柱(半径 0.03)が 3mm になり
            // 消える。軸からの距離で重みを付け、布と骨だけを寄せる。
            float w = smoothstep(0.06, 0.30, r);
            float rr = mix(mix(r, 0.10, w), r, k);       // 閉じた束の半径 0.10m
            transformed.xz *= (r > 1e-4) ? rr / r : 1.0;
            // 畳んだ布は頂点から **垂れ下がる**(持ち上がるのではない)。
            transformed.y -= (1.0 - k) * w * r * 0.47;`);
      };
      paraMat.customProgramCacheKey = () => 'parasol';
      const pm = new THREE.InstancedMesh(pGeo, paraMat, parasols.length);
      const cc4 = new THREE.Color();
      const paraA = new Float32Array(parasols.length * 2);
      parasols.forEach((p2, i) => {
        dm4.position.set(p2.x, p2.y, p2.z);
        dm4.rotation.set(0, p2.seed * 6.28, 0);
        dm4.updateMatrix();
        pm.setMatrixAt(i, dm4.matrix);
        cc4.setHSL(0.09 + p2.seed * 0.03, 0.14 + p2.seed * 0.10, 0.44 + p2.seed * 0.14, THREE.SRGBColorSpace);
        pm.setColorAt(i, cc4);
        // 開く 8.0〜9.1 時 / 畳む 19.9〜21.0 時。店ごとにばらす。
        paraA[i * 2] = 8.0 + p2.seed * 1.1;
        paraA[i * 2 + 1] = 19.9 + ((p2.seed * 7.3) % 1) * 1.1;
      });
      pGeo.setAttribute('aPara', new THREE.InstancedBufferAttribute(paraA, 2));
      // 影も畳む。深度パスに同じ頂点変形を渡さないと、閉じた傘が
      // **開いた傘の影**を落とす。
      pm.customDepthMaterial = depthFor(paraMat);
      pm.castShadow = true;
    group.add(tagMesh(pm, 'life.parasol', { solid: true, cloth: true }));
      clock.parasols = { mesh: pm, list: parasols, dummy: dm4, open: true };
    }
  }

  // ------------------------------------------ 通りの井戸の蓋 ----
  {
    const lids = [];
    for (let x = -132; x < 132; x += 21) {
      const lz = (rng() - 0.5) * 1.6;
      lids.push({ x, z: lz, y: onFloor(x, lz, 2.6) });
    }
    const lg = new THREE.CylinderGeometry(0.31, 0.31, 0.035, 16);
    const lm = new THREE.InstancedMesh(lg, new THREE.MeshStandardMaterial({
      map: tex.stradun.map, normalMap: tex.stradun.normalMap,
      color: 0xa9a08e, roughness: 0.52, envMapIntensity: 0.5,
    }), lids.length);
    const dm5 = new THREE.Object3D();
    lids.forEach((l, i) => {
      dm5.position.set(l.x, l.y + 0.032, l.z);
      dm5.rotation.set(0, i * 0.7, 0);
      dm5.updateMatrix();
      lm.setMatrixAt(i, dm5.matrix);
    });
    lm.receiveShadow = true;
    group.add(tagMesh(lm, 'life.wellLid', { solid: true, small: true, groundContact: true }));
  }

  // -------------------------------------------- アマツバメとカモメ ----
  // アマツバメ: 夕暮れ、屋根の海の上を鎌の翼が旋回する。
  const swiftGeo = (() => {
    const g = new THREE.BufferGeometry();
    // 体 + 鎌形の翼 2 枚(頂点の x 符号でシェーダが羽ばたきを振る)
    const v = [
      // 体(細い菱形)
      0, 0, 0.14, 0.03, 0, -0.06, -0.03, 0, -0.06,
      0, 0.02, 0.14, -0.03, 0, -0.06, 0.03, 0, -0.06,
      // 右翼
      0.02, 0, 0.02, 0.34, 0.02, -0.05, 0.14, 0, -0.12,
      // 左翼
      -0.02, 0, 0.02, -0.14, 0, -0.12, -0.34, 0.02, -0.05,
    ];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  })();
  const swiftTime = { value: 0 };
  const swiftMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.9, side: THREE.DoubleSide });
  swiftMat.onBeforeCompile = (shader) => {
    shader.uniforms.uT = swiftTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPhase; uniform float uT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float flap = sin(uT * 9.0 + aPhase * 20.0) * (0.6 + 0.4 * sin(aPhase * 3.0 + uT * 0.7));
        transformed.y += abs(transformed.x) * flap * 0.9;`);
  };
  // ---- 鳩。広場に地上の鳥が一羽もいないことが、この街を模型に見せていた。
  // ルジャとオノフリオは、現実のドゥブロヴニクで「鳩がいることそのものが風景」。
  const PIGEONS = [];
  const pigeonMesh = (() => {
    const head = (g, v) => {
      const n = g.attributes.position.count;
      g.setAttribute('aHead', new THREE.BufferAttribute(new Float32Array(n).fill(v), 1));
      return g;
    };
    const body = new THREE.ConeGeometry(0.052, 0.16, 7);
    body.rotateX(-Math.PI / 2); body.translate(0, 0.072, -0.018);
    const neck = new THREE.SphereGeometry(0.038, 6, 5);
    neck.scale(1, 1.15, 1); neck.translate(0, 0.098, 0.045);
    const hd = new THREE.SphereGeometry(0.029, 6, 5);
    hd.translate(0, 0.126, 0.062);
    const beak = new THREE.ConeGeometry(0.008, 0.026, 4);
    beak.rotateX(Math.PI / 2); beak.translate(0, 0.124, 0.086);
    const tail = new THREE.BoxGeometry(0.052, 0.007, 0.072);
    tail.rotateX(-0.22); tail.translate(0, 0.078, -0.108);
    const wing = (sg) => {
      const g = new THREE.BoxGeometry(0.016, 0.052, 0.115);
      g.rotateZ(sg * 0.16); g.translate(sg * 0.045, 0.078, -0.012);
      return g;
    };
    const legs = new THREE.BoxGeometry(0.020, 0.032, 0.018);
    legs.translate(0, 0.016, 0.004);
    const g = mergeSimple([head(body, 0), head(neck, 0.45), head(hd, 1), head(beak, 1),
      head(tail, 0), head(wing(-1), 0), head(wing(1), 0), head(legs, 0)]);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, envMapIntensity: 0.35 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uT = clothTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uT; attribute float aHead; attribute float aPh2;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // ついばみ: 首と頭だけが前下に落ちる
          float pk = smoothstep(0.55, 1.0, sin(uT * 2.35 + aPh2 * 6.28));
          transformed.y -= aHead * pk * 0.062;
          transformed.z += aHead * pk * 0.034;
          // ゆっくり向きを変える(位相は個体ごと)
          float yy = sin(uT * 0.29 + aPh2 * 11.0) * 0.62;
          float cy = cos(yy), sy = sin(yy);
          transformed.xz = mat2(cy, -sy, sy, cy) * transformed.xz;`);
    };
    mat.customProgramCacheKey = () => 'pigeon';
    patchSkyVisInstanced(mat);
    // 配置: 広場ごとの群れ。等分布ではなく中心寄りのガウス。
    const spots = [];
    const add = (id, n, r) => {
      const pz = plan.PLAZAS.find(q => q.id === id);
      if (!pz) return;
      const cx = (pz.x0 + pz.x1) / 2, cz = (pz.z0 + pz.z1) / 2;
      const prng = rngFor(0x9160 + n);
      for (let i = 0; i < n; i++) {
        const a2 = prng() * 6.28318;
        const rr = r * Math.sqrt(-2 * Math.log(1 - prng() * 0.9)) * 0.42;
        const x = clamp(cx + Math.cos(a2) * rr, pz.x0 + 1.2, pz.x1 - 1.2);
        const z = clamp(cz + Math.sin(a2) * rr, pz.z0 + 1.2, pz.z1 - 1.2);
        const gy = plan.groundAt(x, z, (pz.y ?? 2.6) + 1.4);
        if (!gy || Math.abs(gy.y - (pz.y ?? 2.6)) > 2.2) continue;
        spots.push({ x, z, y: gy.y, ph: prng(), fly: 0, hx: 0, hz: 0 });
      }
    };
    add('luza', 22, 5.6); add('onofrio', 16, 4.4); add('gundulic', 14, 5.0); add('pile', 10, 3.6);
    // 城壁から見た屋根の海に、鳥が一羽もいなかった。実物の屋根は鳩と
    // カモメが棟に並んで止まっている面で、そこが唯一「動くもの」になる。
    // 胸壁の天端も同じ。既存の啄みシェーダがそのまま「止まって首を動かす」に読める。
    {
      const prng = rngFor(0x71a3);
      for (let i = 0; i < plan.houses.length; i += 11) {
        const h2 = plan.houses[i];
        if (h2.garden || !(h2.roofH > 0.4)) continue;
        spots.push({ x: h2.x + (prng() - 0.5) * h2.w * 0.5, z: h2.z + (prng() - 0.5) * h2.d * 0.5,
          y: h2.eaves + h2.roofH + 0.06, ph: prng(), fly: 0, hx: 0, hz: 0 });
      }
      // 胸壁の天端(歩廊の縁)にも 40m 刻みで
      for (let i = 1; i < plan.wallPts.length; i++) {
        const A = plan.wallPts[i - 1], B = plan.wallPts[i];
        const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
        for (let d = 20; d < L - 8; d += 40) {
          const t = d / L;
          const e = plan.deckEdgeAt(lerp(A[0], B[0], t), lerp(A[1], B[1], t));
          const wy = plan.wallWalkYAt(e.nw);
          const nx2 = -(B[1] - A[1]) / L, nz2 = (B[0] - A[0]) / L;
          spots.push({ x: e.nw.x + nx2 * 1.35, z: e.nw.z + nz2 * 1.35, y: wy + 1.35,
            ph: prng(), fly: 0, hx: 0, hz: 0 });
        }
      }
    }
    if (!spots.length) return null;
    PIGEONS.push(...spots);
    const mesh = new THREE.InstancedMesh(g, mat, spots.length);
    const ph3 = new Float32Array(spots.length);
    const sk3 = new Float32Array(spots.length);
    const dm6 = new THREE.Object3D(); const cc6 = new THREE.Color();
    spots.forEach((p2, i) => {
      dm6.position.set(p2.x, p2.y, p2.z);
      dm6.rotation.set(0, p2.ph * 6.28318, 0);
      dm6.scale.setScalar(0.94 + p2.ph * 0.16);
      dm6.updateMatrix();
      mesh.setMatrixAt(i, dm6.matrix);
      ph3[i] = p2.ph;
      sk3[i] = skyOf(p2.x, p2.z, p2.y + 0.2);
      // 灰・青灰・白・こげ茶が混ざる(全部同じ灰色は一目で複製)
      const q = (p2.ph * 977) % 1;
      if (q < 0.52) cc6.setHSL(0.60, 0.05, 0.30 + q * 0.10, THREE.SRGBColorSpace);
      else if (q < 0.76) cc6.setHSL(0.09, 0.16, 0.24 + q * 0.08, THREE.SRGBColorSpace);
      else if (q < 0.90) cc6.setHSL(0.10, 0.04, 0.62 + q * 0.10, THREE.SRGBColorSpace);
      else cc6.setHSL(0.42, 0.10, 0.34, THREE.SRGBColorSpace);
      mesh.setColorAt(i, cc6);
    });
    g.setAttribute('aPh2', new THREE.InstancedBufferAttribute(ph3, 1));
    g.setAttribute('aSkyI', new THREE.InstancedBufferAttribute(sk3, 1));
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    group.add(tagMesh(mesh, 'life.bird', { thin: true, reason: '飛ぶ鳥は板', noCollide: true }));
    return mesh;
  })();
  const pigeonDummy = new THREE.Object3D();

  const NSWIFT = 46;
  const swifts = new THREE.InstancedMesh(swiftGeo, swiftMat, NSWIFT);
  const swiftPhases = new Float32Array(NSWIFT);
  const swiftState = [];
  for (let i = 0; i < NSWIFT; i++) {
    swiftPhases[i] = rng() * Math.PI * 2;
    swiftState.push({
      cx: -80 + rng() * 200, cz: -60 + rng() * 100,
      r: 12 + rng() * 30, h: 18 + rng() * 22,
      speed: (0.5 + rng() * 0.5) * (rng() < 0.5 ? 1 : -1),
      ph: rng() * Math.PI * 2, wob: rng() * Math.PI * 2,
    });
  }
  swiftGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(swiftPhases, 1));
  swifts.frustumCulled = false;
    group.add(tagMesh(swifts, 'life.swift', { thin: true, reason: '飛ぶ鳥は板', noCollide: true }));

  // カモメ: 港の上をゆっくり滑空(昼)
  const NGULL = 9;
  const gulls = new THREE.InstancedMesh(swiftGeo.clone(), new THREE.MeshStandardMaterial({ color: 0xcfcbc2, roughness: 0.85, side: THREE.DoubleSide }), NGULL);
  const gullState = [];
  for (let i = 0; i < NGULL; i++) {
    gullState.push({
      cx: 175 + rng() * 40, cz: 0 + rng() * 50,
      r: 15 + rng() * 25, h: 8 + rng() * 18,
      speed: (0.25 + rng() * 0.2) * (rng() < 0.5 ? 1 : -1),
      ph: rng() * Math.PI * 2,
    });
  }
  gulls.frustumCulled = false;
    group.add(tagMesh(gulls, 'life.gull', { thin: true, reason: '飛ぶ鳥は板', noCollide: true }));

  const dummy = new THREE.Object3D();
  const fkDummy = new THREE.Object3D();
  const near = { folk: 0, sitting: 0, list: [], steps: [] };   // 音の密度と定位に使う
  // 視錐台の判定に使う作業用。毎フレーム new すると GC が走る。
  const _frustum = new THREE.Frustum();
  const _projScreen = new THREE.Matrix4();
  const _sph = new THREE.Sphere(new THREE.Vector3(), 1.0);
  let folkStateInit = false;

  // ---- 街の時計。人出・市場・パラソル・洗濯物が時刻で変わる。
  // 行列と visible の書き換えだけなのでドローコールは増えない。
  const folkRank = new Float32Array(folk.length);
  folk.forEach((f, i) => { folkRank[i] = hash2((f.x * 13 + 7) | 0, (f.z * 11 + 3) | 0); });
  function dayCurve(h) {
    const wake = smoothstep(6.0, 9.0, h);
    const sleep = 1 - smoothstep(21.8, 23.6, h);
    // 昼下がりは人が引く(地中海の店じまい)
    const siesta = 1 - 0.30 * Math.exp(-((h - 14.7) ** 2) / 2.4);
    return clamp(wake * sleep * siesta, 0, 1);
  }
  function applyClock(sun) {
    const h = sun.time ?? 12;
    const bk = Math.round(h * 20);            // 3 分刻みでだけ作り直す
    if (bk === clock.bucket) return;
    clock.bucket = bk;
    const crowd = 0.10 + 0.90 * dayCurve(h);
    const marketOn = h >= 6.6 && h < 13.4;
    const cafeOn = h >= 8.0 && h < 23.2;   // 24.0 は永久に来ない値だった
    for (let i = 0; i < folk.length; i++) {
      const f = folk[i];
      // **ここでは「そうあるべき姿」だけを書く。** 実際に消し出しするのは
      // 画面に入っていないと分かった時だけ(下)。flow 36 では 3 ゲーム分 =
      // 実 5 秒ごとにこの関数が走り、crowd は 7:06 の 0.374 から 9:00 の 1.0 まで
      // 上がる = **人が目の前で 10 人ずつ湧く**。それが「突然パッと出る」の正体。
      if (f.job === 'stall') { f._want = !marketOn; continue; }
      if (f.sit === 1) { f._want = !cafeOn || folkRank[i] > crowd * 1.15; continue; }
      f._want = folkRank[i] > crowd;
    }
    if (clock.market) for (const m of clock.market) m.visible = marketOn;
    // 洗濯物は家ごとに干す時刻も取り込む時刻も違う。InstancedMesh 全体に
    // 真偽値 1 個を掛けていたので、19:30 ちょうどに街じゅうの布が同時に
    // 1 フレームで消えていた。全戸が同じ分に取り込む町は無い。
    // ロープ単位の h0/h1 と、翌朝まで出しっぱなしの 14% を持たせる。
    if (clock.cloths) {
      const C2 = clock.cloths;
      const key = (h * 4 | 0);            // 15 分刻みでだけ書き直す
      if (C2.key !== key) {
        C2.key = key;
        const zero = new THREE.Matrix4().makeScale(0, 0, 0);
        for (let i = 0; i < C2.list.length; i++) {
          const c = C2.list[i];
          const up = c.night ? (h >= c.h0 || h < 4.5) : (h >= c.h0 && h < c.h1);
          C2.mesh.setMatrixAt(i, up ? c._m : zero);
        }
        C2.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    // 日没(夏至で 20:20 前後)にカフェは傘を畳む。畳んだ細い柱の列が
    // 並ぶほうが夜らしく、壁のランタンの光がテーブルに届く。
    // 23.0 にしていたが時計は 22.1 で朝へ飛ぶので、畳んだ姿は一度も
    // 描かれない死んだ分岐だった。
    // パラソルはここで一斉に切り替えない。**店ごとの時刻**で、頂点シェーダが
    // 15 分かけて開く(aPara)。以前は 8.4 時ちょうどに全 53 本が 1 フレームで
    // 開いていた(ユーザー報告「いきなり開く」)。
  }

  function update(elapsed, sun, camPos, camera) {
    parasolHour.value = sun.time ?? 12;
    clothTime.value = elapsed;
    swiftTime.value = elapsed;
    // ---- 人を歩かせる。行列の書き換えだけなのでドローコールは増えない。
    if (folkMeshes) {
      const M = folkMeshes;
      near.folk = 0; near.sitting = 0; near.list.length = 0; near.steps.length = 0;
      const dt = Math.min(0.12, Math.max(0, elapsed - (lastElapsed ?? elapsed)));
      lastElapsed = elapsed;
      const TAU = Math.PI * 2;
      applyClock(sun);
      // 見えている人は消さないし、出さない。人は湧いて出ない — 出入りは
      // **こちらが見ていない間に**起きる。camera が渡されていれば視錐台で判定し、
      // 渡されていなければ(旧い呼び出し)従来どおり即時に反映する。
      let frustum = null;
      if (camera) {
        camera.updateMatrixWorld();
        _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum = _frustum.setFromProjectionMatrix(_projScreen);
      }
      const firstApply = !folkStateInit;
      folkStateInit = true;
      for (let i = 0; i < folk.length; i++) {
        const f = folk[i];
        if (f._off !== f._want) {
          // 初回(街を組み立てた直後)は誰も見ていないので、そのまま入れる。
          if (firstApply || !frustum) f._off = f._want;
          else {
            _sph.center.set(f.x, f.y + 0.9, f.z);
            // 点で見ると画面の縁に半分だけ入っている人を「見えていない」と
            // 判定して、縁で湧く。体の太さぶんの球で見る。
            // **距離で逃がさない。** 一度 90m の逃げ道を置いたら、ピレ門から
            // 見通す 300m のストラドゥンは大半が 90m の外なので、そこで
            // 246 回中 211 回が画面の中で湧いた(実測)。視錐台の外だけが条件。
            if (!frustum.intersectsSphere(_sph)) f._off = f._want;
          }
        }
        let x = f.x, y = f.y, z = f.z, rot = f.rotY, wAmt = 0;
        if (f.walk) {
          const w = f.walk;
          // 歩く → 端で止まる → 振り向く → 戻る。三角波だけだと 1 フレームで
          // yaw が π 飛び、同じ人が目の前で瞬間反転する(10〜28 秒ごとに)。
          const Tw = w.span / w.sp;
          const T = Tw * 2 + w.pa + w.pb;
          const sT = (w.t0 * T + elapsed) % T;
          let u, dirT, moving = false, edge = 0;
          if (sT < Tw) { u = sT / Tw; dirT = 1; moving = true; edge = Math.min(sT, Tw - sT); }
          else if (sT < Tw + w.pa) { u = 1; dirT = -1; }
          else if (sT < Tw * 2 + w.pa) {
            const q = sT - Tw - w.pa; u = 1 - q / Tw; dirT = -1; moving = true;
            edge = Math.min(q, Tw - q);
          } else { u = 0; dirT = 1; }
          const off = (u - 0.5) * w.span;
          x = f.x + w.tx * off; z = f.z + w.tz * off;
          const fi = clamp(u * 8, 0, 8);
          const k0 = Math.floor(fi), k1 = Math.min(8, k0 + 1);
          y = lerp(w.ys[k0], w.ys[k1], fi - k0);
          // 四肢の振れは 0.45 秒でランプする(止まった瞬間に足が止まる)
          wAmt = moving ? clamp(edge / 0.45, 0, 1) : 0;
          // モデルの前方は +Z(鼻 z+0.094 / 爪先 z+0.042)。rotation.y は +Z を
          // (sinθ, cosθ) に写すので atan2(tx, tz) だけでよい。
          const tgt = Math.atan2(dirT * w.tx, dirT * w.tz);
          let cur = f._rot;
          if (cur == null) cur = tgt;
          let dA = ((tgt - cur + Math.PI) % TAU + TAU) % TAU - Math.PI;
          cur += clamp(dA, -3.1 * dt, 3.1 * dt);       // 180 度に約 1 秒
          f._rot = cur; rot = cur;
        }
        // カメラの中に立たせない(0.9m 以内は畳む)
        let sc = f._off ? 0 : f.h;
        if (camPos) {
          const dc = Math.hypot(camPos.x - x, camPos.z - z);
          // スケールで絞ると「縮んだ人形」になる(足元 y は変わらないので沈まない)。
          // 消すか出すかの二値にする。
          // 消すと「人ではない」と一発で分かる。よけさせる(行列の書き換えだけ)。
          if (dc < 1.35) { const px3 = -(camPos.z - z), pz3 = (camPos.x - x); const pl = Math.hypot(px3, pz3) || 1; const push = (1.35 - dc) * 0.9; x += (px3 / pl) * push; z += (pz3 / pl) * push; }
          if (dc < 0.30) sc = 0;
        }
        fkDummy.position.set(x, y, z);
        fkDummy.rotation.set(0, rot, 0);
        fkDummy.scale.set(sc * f.wx, sc, sc * f.wz);
        fkDummy.updateMatrix();
        if (camPos) {
          const d2 = (x - camPos.x) ** 2 + (z - camPos.z) ** 2;
          if (d2 < 400) {
            near.folk++;
            if (f.sit) near.sitting++;
            near.list.push({ x, z, d2, sit: f.sit ? 1 : 0 });
          }
          // 他人の足音: 歩行位相が π を跨いだフレームで鳴らす(14m 以内)
          if (f.walk && d2 < 196) {
            const ph2 = ((f._ph ?? 0) + elapsed * (f._cad ?? 1.3)) % (Math.PI * 2);
            const prev = f._ph2 ?? ph2;
            if ((prev < Math.PI) !== (ph2 < Math.PI)) near.steps.push({ x, z, d2 });
            f._ph2 = ph2;
          }
        }
        M.torso.setMatrixAt(i, fkDummy.matrix);
        M.legs.setMatrixAt(i, fkDummy.matrix);
        M.arms.setMatrixAt(i, fkDummy.matrix);
        // 頭は別倍率(子供は頭身 5.5、大人は 7.5)
        fkDummy.scale.set(sc * f.headK, sc * f.headK, sc * f.headK);
        fkDummy.position.set(x, y + (sc - sc * f.headK) * 1.80, z);
        fkDummy.updateMatrix();
        M.heads.setMatrixAt(i, fkDummy.matrix);
        M.hair.setMatrixAt(i, fkDummy.matrix);
        f.curX = x; f.curY = y; f.curZ = z; f.curR = rot; f.curS = sc; f.curW = wAmt;
        if (walkAmt) walkAmt[i] = wAmt;
      }
      // 音の定位は「最寄り」でなければ意味がない。インデックス順ではなく距離順。
      if (near.list.length > 6) { near.list.sort((a, b) => a.d2 - b.d2); near.list.length = 6; }
      if (near.steps.length > 3) { near.steps.sort((a, b) => a.d2 - b.d2); near.steps.length = 3; }
      for (const m of [M.torso, M.legs, M.heads, M.hair, M.arms]) m.instanceMatrix.needsUpdate = true;
      if (walkAttr) walkAttr.needsUpdate = true;
      if (M.acc) {
        M.acc.list.forEach((a, i) => {
          fkDummy.position.set(a.f.curX, a.f.curY, a.f.curZ);
          fkDummy.rotation.set(0, a.f.curR, 0);
          fkDummy.scale.setScalar(a.f.curS);
          fkDummy.updateMatrix();
          M.acc.mesh.setMatrixAt(i, fkDummy.matrix);
          if (accWalkAmt) accWalkAmt[i] = a.f.curW ?? 0;
        });
        M.acc.mesh.instanceMatrix.needsUpdate = true;
        if (accWalkAttr) accWalkAttr.needsUpdate = true;
      }
    }
    // 灯は日没から。石に溜まる暖色の光が夜の主役。
    if (lampNight) {
      const on = smoothstep(2, -5, sun.el);
      lampNight.glMat.emissiveIntensity = on * 2.6;
      // 加算デカールが街路全面を覆うと、灯りの届く所と届かない所で色が変わらなくなる。
      // 実光源が入った以上、デカールは灯の真下の芯だけを担う。
      lampNight.poolMat.opacity = on * 0.10;
      const pool = lampNight.lampPool;
      if (on < 0.02 || !camPos) {
        for (const pl of pool) pl.visible = false;
      } else {
        // 近い順に 8 灯。距離で並べ替えるのは 100 個程度なので毎フレームでよい。
        for (const l of lamps) l._d = (l.x - camPos.x) ** 2 + (l.z - camPos.z) ** 2;
        const near = lamps.filter(l => l._d < 900).sort((a, b) => a._d - b._d).slice(0, 8);
        for (let i = 0; i < 8; i++) {
          const pl = pool[i], l = near[i];
          if (!l) { pl.visible = false; continue; }
          pl.visible = true;
          // 灯体そのものではなく、ガラス箱の位置(腕の先・下がり)に置く
          pl.position.set(l.x - Math.sin(l.rotY) * 0.50, l.y - 0.38, l.z - Math.cos(l.rotY) * 0.50);
          // 遠い灯は光量を落としてポップを消す
          pl.intensity = on * 12.5 * smoothstep(900, 400, l._d);
        }
      }
    }
    // ---- 鳩: 4m 以内に人が入ると、その一羽だけが飛び立って 8m 先へ降りる。
    // これが一度起きれば、この街が模型でないことは二度と疑われない。
    if (pigeonMesh && camPos) {
      const roost = sun.night > 0.5;
      pigeonMesh.visible = !roost;
      if (!roost) {
        let dirty = false;
        for (let i = 0; i < PIGEONS.length; i++) {
          const p2 = PIGEONS[i];
          const dx2 = p2.x - camPos.x, dz2 = p2.z - camPos.z;
          const d2p = dx2 * dx2 + dz2 * dz2;
          if (!p2.fly && d2p < 16 && d2p > 1e-4) {
            const dl = Math.sqrt(d2p);
            p2.fly = elapsed; p2.dur = 1.9 + (p2.ph % 1) * 0.9;
            p2.sx = p2.x; p2.sz = p2.z; p2.sy = p2.y;
            const jit = (p2.ph - 0.5) * 1.1;
            const ux = dx2 / dl, uz = dz2 / dl;
            p2.hx = p2.x + (ux * Math.cos(jit) - uz * Math.sin(jit)) * 7.5;
            p2.hz = p2.z + (ux * Math.sin(jit) + uz * Math.cos(jit)) * 7.5;
            const g2 = plan.groundAt(p2.hx, p2.hz, p2.y + 1.4);
            if (!g2 || Math.abs(g2.y - p2.y) > 1.6) { p2.hx = p2.x - ux * 6.0; p2.hz = p2.z - uz * 6.0; }
            else p2.hy = g2.y;
          }
          if (p2.fly) {
            const t4 = (elapsed - p2.fly) / p2.dur;
            if (t4 >= 1) {
              p2.fly = 0; p2.x = p2.hx; p2.z = p2.hz; p2.y = p2.hy ?? p2.y;
              pigeonDummy.position.set(p2.x, p2.y, p2.z);
              pigeonDummy.rotation.set(0, p2.ph * 6.28318, 0);
            } else {
              const bx = lerp(p2.sx, p2.hx, t4), bz = lerp(p2.sz, p2.hz, t4);
              const by = lerp(p2.sy, p2.hy ?? p2.sy, t4) + Math.sin(t4 * Math.PI) * 2.6;
              pigeonDummy.position.set(bx, by, bz);
              pigeonDummy.rotation.set(Math.sin(t4 * Math.PI) * -0.25,
                Math.atan2(p2.hx - p2.sx, p2.hz - p2.sz), 0);
            }
            pigeonDummy.scale.setScalar(0.94 + p2.ph * 0.16);
            pigeonDummy.updateMatrix();
            pigeonMesh.setMatrixAt(i, pigeonDummy.matrix);
            dirty = true;
          }
        }
        if (dirty) pigeonMesh.instanceMatrix.needsUpdate = true;
      }
    }
    // アマツバメは朝夕に出る(真昼と夜は消える)
    const swiftAct = smoothstep(32, 14, Math.abs(sun.el - 8)) * (1 - sun.night);
    swifts.visible = swiftAct > 0.04;
    if (swifts.visible) {
      for (let i = 0; i < NSWIFT; i++) {
        const s = swiftState[i];
        const a = s.ph + elapsed * s.speed;
        const wob = Math.sin(elapsed * 0.9 + s.wob) * 4;
        dummy.position.set(
          s.cx + Math.cos(a) * s.r,
          s.h + wob + Math.sin(elapsed * 1.7 + s.wob) * 2,
          s.cz + Math.sin(a) * s.r * 0.8,
        );
        const scale = 1.6 * swiftAct;
        dummy.scale.setScalar(Math.max(scale, 0.001));
        dummy.rotation.set(0, -a - Math.PI / 2 * Math.sign(s.speed), Math.sign(s.speed) * 0.5);
        dummy.updateMatrix();
        swifts.setMatrixAt(i, dummy.matrix);
      }
      swifts.instanceMatrix.needsUpdate = true;
    }
    gulls.visible = sun.night < 0.5;
    if (gulls.visible) {
      for (let i = 0; i < NGULL; i++) {
        const s = gullState[i];
        const a = s.ph + elapsed * s.speed;
        dummy.position.set(s.cx + Math.cos(a) * s.r, s.h + Math.sin(elapsed * 0.5 + i) * 2.5, s.cz + Math.sin(a) * s.r);
        dummy.scale.setScalar(3.2);
        dummy.rotation.set(0, -a - Math.PI / 2 * Math.sign(s.speed), Math.sign(s.speed) * 0.25);
        dummy.updateMatrix();
        gulls.setMatrixAt(i, dummy.matrix);
      }
      gulls.instanceMatrix.needsUpdate = true;
    }
  }

  return {
    group, update, near, folk,
    counts: { ropes: ropes.length, cloths: cloths.length, pots: pots.length, chairs: chairPos.length, swifts: NSWIFT, gulls: NGULL },
  };
}

// aTk を引き継ぐマージ
function mergeGeoT(geos) {
  const ns = geos.map(g => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of ns) total += g.attributes.position.count;
  const P = new Float32Array(total * 3), N = new Float32Array(total * 3);
  const U = new Float32Array(total * 2), K = new Float32Array(total);
  let o = 0;
  for (const g of ns) {
    P.set(g.attributes.position.array, o * 3);
    N.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) U.set(g.attributes.uv.array, o * 2);
    if (g.attributes.aTk) K.set(g.attributes.aTk.array, o);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  out.setAttribute('aTk', new THREE.BufferAttribute(K, 1));
  return out;
}

// 頂点色も引き継ぐマージ(mergeSimple は pos/nrm/uv のみ)
function mergeSimpleC(geos) {
  const ns = geos.map(g => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of ns) total += g.attributes.position.count;
  const P = new Float32Array(total * 3), N = new Float32Array(total * 3);
  const U = new Float32Array(total * 2), C = new Float32Array(total * 3).fill(1);
  let o = 0;
  for (const g of ns) {
    P.set(g.attributes.position.array, o * 3);
    N.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) U.set(g.attributes.uv.array, o * 2);
    if (g.attributes.color) C.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return out;
}

// aLimb などの追加属性も引き継ぐマージ(mergeSimple は pos/nrm/uv のみ)
// aLimb と aKind の両方を引き継ぐマージ
function mergeGeoK(geos) {
  const out = mergeGeo(geos);
  const list = geos.map(g => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const K = new Float32Array(total);
  let o = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    if (g.attributes.aKind) K.set(g.attributes.aKind.array, o);
    o += c;
  }
  out.setAttribute('aKind', new THREE.BufferAttribute(K, 1));
  return out;
}

function mergeGeo(geos) {
  const list = geos.map(g => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const P = new Float32Array(total * 3), N = new Float32Array(total * 3);
  const U = new Float32Array(total * 2), L = new Float32Array(total);
  let o = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    P.set(g.attributes.position.array, o * 3);
    N.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) U.set(g.attributes.uv.array, o * 2);
    if (g.attributes.aLimb) L.set(g.attributes.aLimb.array, o);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  out.setAttribute('aLimb', new THREE.BufferAttribute(L, 1));
  return out;
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
