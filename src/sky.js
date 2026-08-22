// ============================================================================
// sky.js — 空は塗られた大気。グラデーション禁止:筆の揺らぎ・水平線の靄・
// 太陽の暈・薄暮の菫色まで、すべて時刻 t から一貫して導く。
// sunState(time) が「世界で唯一の太陽」。照明・海・霧はここから引く。
// ============================================================================
import * as THREE from 'three';
import { clamp, lerp, smoothstep, DEG, tagMesh } from './util.js';

// ドゥブロヴニク 42.64°N / 8月中旬(赤緯 +13.8°)の実値。
export const SUNRISE = 6.00, SUNSET = 19.74, NOON = 12.87;   // 経度補正 +47.6分・均時差 −4.5分
// 空の HDR 係数。1.35 では、シーンリニアで「日向の石灰岩 3.41 : 天頂 0.152」
// = 22:1 になり、地中海の晴天としてありえない(実際は 4:1 程度)。
// かつてブルームが乗ったのは閾値が低かった頃の話で、現在の閾値は正午 5.60。
export const SKY_GAIN = 2.6;

// 時刻 → 太陽の方位・高度・各色。方位: 北=0° 東=90°(+X)남 180°(+Z)。
export function sunState(time) {
  const t = clamp(time, 4.6, 23.7);   // 時計は 23 時台まで回る(畳んだ傘・閉じた鎧戸)
  const dayT = (t - SUNRISE) / (SUNSET - SUNRISE);
  // 実緯度の太陽位置。71°の正弦と方位の線形掃引では、影が 35〜45% 短く、
  // 方位が朝で 10〜19° 南寄り・午後で 17〜24° 北寄りにずれる。
  const PHI = 42.6407 * DEG, DEC = 13.8 * DEG;
  const H = (t - NOON) * 15 * DEG;
  const sinEl = Math.sin(PHI) * Math.sin(DEC) + Math.cos(PHI) * Math.cos(DEC) * Math.cos(H);
  const el = Math.asin(clamp(sinEl, -1, 1)) / DEG;
  const az = ((Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(PHI) - Math.tan(DEC) * Math.cos(PHI)) / DEG) + 180 + 360) % 360;
  const elR = el * DEG, azR = az * DEG;
  const dir = new THREE.Vector3(Math.sin(azR) * Math.cos(elR), Math.sin(elR), -Math.cos(azR) * Math.cos(elR));

  // 高度 24 度で切る smoothstep だけを駆動軸にすると、el が 27→61→24 と動く
  // 08:12〜17:32(昼の 68%)で空の色がビット同一になる。太陽高度そのものを軸に足す。
  const dusk = smoothstep(15, -1, el);         // 空の色専用(黄金の時間の窓)
  const hi = smoothstep(20, 62, el);           // Rayleigh の深さ = 天頂の濃さ
  const deep = smoothstep(-4, -17, el);        // 市民薄明 → 天文薄明
  // 大気路程(Kasten–Young)。太陽の色と強さは高度ではなく「光が通る大気の厚さ」
  // で決まる。高度 24° で切る smoothstep だと、朝も夕も真昼と同じ白い光になる。
  const am = 1 / (Math.sin(Math.max(el, 1.5) * DEG) + 0.15 * Math.pow(Math.max(el, -3.8) + 3.885, -1.253));
  const warm = clamp((am - 1.35) / 5.5, 0, 1);    // 分母 14 は暖色化が遅すぎ、代わりに最後の 20 分で一気に赤へ落ちていた
  // 夜 ↔ 昼の遷移幅。(1,-7) の 8° は 5 時台の 20 分ほどで走り切るので、
  // 露出(1.0→1.95)と太陽強度が同時に振れて「パッと明るくなる」。
  // 12° に広げると 30 分強かけて明けるので、瞬間的な段差にならない。
  const night = smoothstep(3, -9, el);         // 日没後 3
  const glow = smoothstep(-9, 3, el);          // 空がまだ光を覚えている量

  // 太陽光の色: 白昼の白 → 深い黄金 → 沈む寸前の橙紅。
  // 色相スカラーの補間は緑を通るので、必ず RGB で混ぜる。
  const sunDay = new THREE.Color().setHSL(0.115, 0.25, 0.96);
  const sunGold = new THREE.Color().setHSL(0.075, 0.55, 0.68);
  // 金 → 燠(おき)の二段。一段だけだと日没最後の 25 分が同じ色で凍る。
  // 0.025/0.90/0.42 は linear B/R 0.053 = 1500K 未満。実在の日没の太陽は
  // 最も赤くて 1800〜2000K(B/R 0.12〜0.18)。しかも日没時は直射:天空が 1:1 に
  // なるので、画面の光の半分がこの単色赤になり、逃げ場が無くなっていた。
  const sunEmber = new THREE.Color().setHSL(0.045, 0.62, 0.50);
  const sunCol = sunDay.lerp(sunGold, Math.max(warm, dusk * 0.85))
    .lerp(sunEmber, smoothstep(7, 0.2, el) * (1 - night))
    .multiplyScalar(1 - night * 0.95);
  // 直射:天空 ≒ 6:1。ここが 1:3 だと影が埋まり、面の向きが読めない
  // (曇天のライティングになる)。地中海の光は「硬い」。
  // 日向の石灰岩(アルベド 0.62)が ACES のショルダーに入る強さ。
  // 5.2 だとリニア 0.87 止まりで、画面に一度も白が生まれない。
  // Beer–Lambert(晴天タービディティ)。71°で 8.5 / 37°で 6.5 / 23°で 5.1。
  // 立ち上がりも同じ理由で広げる。-1.5〜1.0 の 2.5° は約 12 分。
  const sunIntensity = (1 - night) * 18.5 * Math.pow(0.885, am - 1) * smoothstep(-3.2, 2.6, el);

  // 空の色(RGB 補間)
  // setHSL はワーキング空間(リニア)に直接書く。0.71 は「sRGB 0.71」ではなく
  // 「リニア 0.71」= ほぼ白。空が街より明るい無彩色になっていた。
  const zenith = new THREE.Color().setHSL(0.632, lerp(0.74, 0.86, hi), lerp(0.222, 0.160, hi))
    .lerp(new THREE.Color().setHSL(0.68, 0.45, 0.16), dusk);
  const horizon = new THREE.Color().setHSL(0.600, lerp(0.62, 0.72, hi), lerp(0.420, 0.330, hi))
    .lerp(new THREE.Color().setHSL(0.072, 0.68, 0.55), dusk);
  if (night > 0) {
    // 0.94 / 0.85 で打ち止めると、夕焼けの橙が真夜中まで 15% 残り、
    // 夜の霧まで橙になって「遠いものほど暖かく明るい夜」になる。1.0 まで振り切る。
    zenith.lerp(new THREE.Color(0x060a18), night);
    horizon.lerp(new THREE.Color(0x1a1526), night);          // 薄暮の菫
    // 天文薄明。ここを作らないと、夜空が正午の 1/1.5 の明るさで止まる。
    zenith.multiplyScalar(lerp(1.0, 0.11, deep));
    horizon.multiplyScalar(lerp(1.0, 0.13, deep));
  }
  // 反太陽側の水平線(夕方の東の空は青灰に沈む)
  // setHSL はワーキング空間(リニア)に直接書く。0.66 は sRGB 0.84 相当で、
  // 反太陽側の水平線が太陽側の 1.7 倍明るいという逆転が起きていた
  // (空は常に太陽側が明るい)。混合比も下げて Rayleigh の青を残す。
  // 夕方は horizon 自体が強い橙(0.766,0.498,0.301)になるので、混合先が
  // 彩度 0.24・明度 0.26 では打ち消せず、実算 B/R 0.757 = **反太陽側の
  // 水平線まで暖色** になっていた。日没の主題は「太陽側の橙 対 反対側の青」
  // という、その瞬間だけの最大の色相対比。混合先を濃くし、重みも上げる。
  const horizonFar = horizon.clone().lerp(new THREE.Color().setHSL(0.615,
    lerp(0.24, 0.52, dusk),
    lerp(0.26, 0.105, dusk) * lerp(1.0, 0.16, deep)), lerp(0.62, 0.90, dusk));

  // 環境光(空からの半球)— 夕は空の琥珀が影にも染みる。青すぎる影は嘘。
  // 日陰は空の色で満たされる。灰へ寄せると影が無彩色になり石が発泡スチロールに見える。
  const hemiSky = zenith.clone().lerp(horizon, lerp(0.42, 0.14, dusk))
    .lerp(new THREE.Color(0xd9c49c), 0.03 + 0.03 * smoothstep(10, 55, el))
    // 重み 0.05 では実測 B/R が 3.53 にしかならず(目標は 1.8)、青すぎる天空光を
    // urbanTint と bounceRad の暖色で打ち消す構造になっていた。打ち消し量が
    // 空可視率で変わるので、影の色相が場所ごとに 150°(緑)〜237°(青)に暴れる。
    // 0.30 で B/R 1.88 = 正規化 (0.53, 0.75, 1.00)。実在の昼光 (0.62, 0.78, 1.00) に一致。
    // 中和 0.30 だと分光比 (1,1.39,1.86) までしか青くならず、実測の日陰は
    // 色相 61〜186°(緑〜無彩)。実在のアドリア海の日陰が青いのは、開けた
    // 天空の相関色温度が 12,000〜16,000K あるから。緑を落として青を通す。
    .lerp(new THREE.Color(0xc9c6c0), 0.22 * (1 - dusk * 0.70))
    // **天空光が太陽高度に追随していなかった。** 半球光の輝度は 07:24〜19:30 を
    // 通して 0.318〜0.359 でほぼ一定なのに、直射は 12.9 → 0.06 まで落ちる。
    // 結果、日向:日陰が 8.9:1 → 1.3:1 に潰れ、夕方の絵が全部「曇天」になる。
    // 比が 1.3:1 になった時点で、それは太陽のある晴天ではない。
    .multiplyScalar(Math.pow(clamp(Math.sin(el * DEG), 0.02, 1), 0.45))
    .multiplyScalar(lerp(1.0, 1.05, dusk) * (1 - night * 0.80) + night * 0.46);   // 日没時の空全体は暗くならない(水平線が燃えるぶん明るい)
  // 夜は天頂が真っ暗(sRGB 10,16,38)なので、掛け算だけでは環境光がゼロになる。
  // 街灯だけで照らされた街は、灯の届かない所が「穴」になって奥行きが消える。
  // 空の残光と街の照り返しを、はっきりした青の底として与える。
  if (night > 0) hemiSky.lerp(new THREE.Color(0x2c3c5e), night * 0.96);
  // 地面バウンスは半球光の「下半分」ではなく、別の照り返しライトが担う。
  // ここを暖褐色にすると、垂直面の日陰が全時刻で暖色に固定される。
  // 夜に地面色が空色の 3 倍あると上下が逆転する(無照明の石畳が空より明るい)
  const hemiGround = new THREE.Color().setHSL(0.075, 0.07, lerp(0.28, 0.030, Math.max(dusk * 0.7, night))); // 石とテラコッタの照り返し(夜は空より暗く)

  // 夜は霧を天頂側へ寄せる。水平線由来のままだと、遠い海が赤紫になる。
  // 霧の輝度は現状維持(SKY_GAIN をそのまま掛けると遠景が乳白になる)
  // 1.5km 先は霧率 98%。つまり稜線はほぼ純粋な霧色になるのだから、
  // 霧色は「水平線の空」でなければ溶けない。天頂(暗く濃青)を昼にも 22%
  // 混ぜ、さらに ×0.62 していたので、山が空より 2 倍暗く 3 倍青い
  // 「青い切り抜き」として立っていた(実測 霧 Y 0.524 / 空 Y 0.97〜1.46)。
  // 海面だけ sea.js が同じ理由で専用に逃がしていた処置を、霧本体へ戻す。
  // 天蓋は太陽から 90° の方向で horizonFar 77% : horizon 23% を混ぜるのに、
  // 霧は 5:5 で作っていた。同じ方向を見ているのに霧のほうが明るく暖かい側を
  // 2 倍多く含み、水平線が消える(実測 海 V78% / 空 V80%)。比を合わせる。
  const fogCol = horizon.clone().lerp(horizonFar, 0.68)
    .lerp(zenith, lerp(0.0, 0.72, night)).multiplyScalar(SKY_GAIN * 1.00);
  const warmK = warm;

  return {
    time: t, el, az, dir, dusk, night, glow,
    sunCol, sunIntensity, zenith, horizon, horizonFar, hemiSky, hemiGround, fogCol, warm: warmK, am,
    starAlpha: smoothstep(-2.5, -8, el),
  };
}

// 空の放射輝度(方向 → 色)。天蓋と海の反射で同じ式を使う。
// 別々に書くと、夕方に海だけが青いままになる。uSkyGain は呼ぶ側で掛ける。
export const SKY_RADIANCE_GLSL = /* glsl */`
// sunK: 太陽の円盤と暈をどれだけ入れるか。水面の反射では 0 にする —
// 粗い面が鋭い暈を鏡映しにすることはなく、太陽の照り返しは鏡面 BRDF が作る。
// (1 のままだと、遠方の大きな三角形が丸ごと暈を拾い、水平線に赤い玉が並ぶ)
vec3 skyRadiance(vec3 d, vec3 zen, vec3 hor, vec3 horFar, vec3 sunDir, vec3 sunCol, float dusk, float sunK) {
  float h = clamp(d.y, -0.06, 1.0);
  float sunAmt = clamp(dot(d, sunDir), -1.0, 1.0);
  float horizW = pow(1.0 - clamp(h, 0.0, 1.0), 3.2);
  vec3 horiz = mix(horFar, hor, smoothstep(-0.4, 0.9, sunAmt));
  vec3 col = mix(zen, horiz, horizW);
  float disc = smoothstep(0.99996, 0.999985, sunAmt);
  float halo = pow(clamp(sunAmt, 0.0, 1.0), 34.0) * 0.55 + pow(clamp(sunAmt, 0.0, 1.0), 140.0) * 5.0;
  col += sunCol * (halo * (0.5 + dusk * 1.2) + disc * mix(600.0, 46.0, dusk)) * sunK;
  float ember = pow(clamp(sunAmt * 0.5 + 0.5, 0.0, 1.0), 7.0) * horizW * dusk;
  col += sunCol * ember * 0.5;
  return col;
}
`;

// ---------------------------------------------------------------- 天蓋 ----
const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // 常に最遠
}
`;
const SKY_FRAG = /* glsl */`
varying vec3 vDir;
uniform vec3 uZenith, uHorizon, uHorizonFar, uSunDir, uSunCol;
uniform float uSkyGain;
uniform float uDusk, uNight, uStarAlpha, uTime;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){ return noise(p) * 0.55 + noise(p * 2.7) * 0.28 + noise(p * 6.1) * 0.17; }

// 空を「方位角 × 高度」で貼ると、方位 180° に縦の継ぎ目が出る(atan の切れ目)。
// 方位を円周に写すと継ぎ目は消えるが、今度は天頂から放射状の縞が出る
// (半径方向に模様がほとんど変わらないため)。方向ベクトルそのものを
// 3 次元の noise に渡せば、継ぎ目も特異点も原理的に存在しない。
float hash3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash3(i), n100 = hash3(i + vec3(1,0,0));
  float n010 = hash3(i + vec3(0,1,0)), n110 = hash3(i + vec3(1,1,0));
  float n001 = hash3(i + vec3(0,0,1)), n101 = hash3(i + vec3(1,0,1));
  float n011 = hash3(i + vec3(0,1,1)), n111 = hash3(i + vec3(1,1,1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float fbm3(vec3 p){ return noise3(p) * 0.55 + noise3(p * 2.7) * 0.28 + noise3(p * 6.1) * 0.17; }

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.06, 1.0);
  float sunAmt = clamp(dot(d, uSunDir), -1.0, 1.0);

  // 水平線の靄は太陽側で厚く暖かい
  float horizW = pow(1.0 - clamp(h, 0.0, 1.0), 3.2);
  vec3 horiz = mix(uHorizonFar, uHorizon, smoothstep(-0.4, 0.9, sunAmt));
  vec3 col = mix(uZenith, horiz, horizW);

  // 塗られた大気: 低周波の筆むら(彩度と明度がわずかに揺れる)
  // atan(d.x, d.z) は方位 180°(±π)で値が 2π 飛ぶ。それを直接 noise に
  // 渡していたので、空にまっすぐな縦の継ぎ目が一本走っていた
  // (夜ほど目立つ — 露出が上がって ±3.7% の段差が読めるようになる)。
  // 方位を「円周上の点」として渡せば周期性が保たれ、切れ目そのものが消える。
  // 半径に高度を混ぜると、高さ方向にも模様が変わる。
  vec3 brushP = d * 4.4 + vec3(0.0, uTime * 0.004, 0.0);
  float brushK = smoothstep(0.97, 0.70, d.y);
  float brush = fbm3(brushP);
  col *= 1.0 + (brush - 0.5) * 0.075 * brushK;
  // 加算のむらは夜に効きすぎる(空が暗いので相対的に強く出て、星が霞に沈む)。
  col += (fbm3(brushP * 3.1 + 7.7) - 0.5) * 0.022 * brushK * mix(1.0, 0.32, uNight);

  // 太陽の暈と光芒
  // 実視直径 0.53°。radiance 2.6 では日向の石より少し明るいだけで、
  // 画面に一度も白が生まれない。空はシーンで最も明るい面であるべき。
  float disc = smoothstep(0.99996, 0.999985, sunAmt);
  float halo = pow(clamp(sunAmt, 0.0, 1.0), 34.0) * 0.55 + pow(clamp(sunAmt, 0.0, 1.0), 140.0) * 5.0;
  // 地平の太陽は R だけが飽和して赤橙になる。600 のままだと 3ch とも振り切れ、
  // 沈む太陽が白い円盤になって色を失う。
  col += uSunCol * (halo * (0.5 + uDusk * 1.2) + disc * mix(600.0, 46.0, uDusk));

  // 沈んだ太陽の残照(地平線に琥珀の帯)
  float ember = pow(clamp(sunAmt * 0.5 + 0.5, 0.0, 1.0), 7.0) * horizW * uDusk;
  col += uSunCol * ember * 0.5;

  // 星(薄暮から)
  if (uStarAlpha > 0.002 && d.y > 0.02) {
    vec2 sp = d.xz / (d.y + 0.35) * 34.0;
    vec2 cellId = floor(sp);
    float s = hash(cellId);
    if (s > 0.986) {
      vec2 pos = fract(sp) - 0.5;
      float star = smoothstep(0.09, 0.0, length(pos)) * smoothstep(0.986, 0.999, s);
      col += vec3(0.9, 0.94, 1.0) * star * uStarAlpha * (0.6 + 0.4 * sin(uTime * 2.0 + s * 40.0));
    }
  }
  col *= uSkyGain;      // 空は HDR。ここを 1.0 のままにすると空が街より暗くなる
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------- 雲 ----
const CLOUD_VERT = /* glsl */`
attribute vec4 aRect;      // アトラスUV(x,y,w,h)
attribute float aShade;
varying vec2 vUv; varying float vShade; varying vec3 vWorld;
void main() {
  vUv = vec2(aRect.x + uv.x * aRect.z, aRect.y + uv.y * aRect.w);
  vShade = aShade;
  // Y軸ビルボード
  vec4 c = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec3 look = normalize(cameraPosition - c.xyz);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), look));
  vec3 up = vec3(0.0, 1.0, 0.0);
  float sx = length(vec3(instanceMatrix[0]));
  float sy = length(vec3(instanceMatrix[1]));
  vec3 wp = c.xyz + right * position.x * sx + up * position.y * sy;
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const CLOUD_FRAG = /* glsl */`
varying vec2 vUv; varying float vShade; varying vec3 vWorld;
uniform sampler2D uTex;
uniform vec3 uLit, uShadow;
uniform float uOpacity;
void main() {
  vec4 t = texture2D(uTex, vUv);
  if (t.a < 0.01) discard;
  // 焼き込みの上面光(t.rgbの明度)を時刻の色に写像
  // 下限を 0 にすると、アトラスの暗いセルがまるごと uShadow の一色ベタになり、
  // 空に「縁の立った灰色の楕円」が浮く。必ず床を敷く。
  // 床を足すだけではアトラスの階調の 7 割が単色に潰れる。全域を伸ばす。
  // 雲体は t.r 0.80〜1.00 にしか存在しない。smoothstep(0.10,0.92) だと
  // そこは全域 0.95〜1.0 に飽和し、uLit と uShadow の 5.2:1 が一度も使われず、
  // 雲が「白い平たいレンズ」になる(実測 雲の頂:底 = 1.08:1)。
  float litF = smoothstep(0.76, 1.0, t.r);
  vec3 col = mix(uShadow, uLit, litF) * (0.92 + vShade * 0.16);
  gl_FragColor = vec4(col, t.a * uOpacity);
}
`;

export function makeSky(tex) {
  const group = new THREE.Group();

  const skyUniforms = {
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
    uHorizonFar: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() },
    uSkyGain: { value: SKY_GAIN },
    uSunCol: { value: new THREE.Color() },
    uDusk: { value: 0 }, uNight: { value: 0 }, uStarAlpha: { value: 0 }, uTime: { value: 0 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(3600, 40, 24),
    new THREE.ShaderMaterial({ uniforms: skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false }),
  );
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  group.add(tagMesh(dome, 'sky.dome', { thin: true, reason: '天蓋は内側から見る 1 枚', noCollide: true, backdrop: true }));

  // 積雲(遠景ビルボード・ゆっくり流れる)
  const cloudUniforms = {
    uTex: { value: tex.clouds }, uLit: { value: new THREE.Color(1, 1, 1) },
    uShadow: { value: new THREE.Color(0.6, 0.62, 0.7) }, uOpacity: { value: 1 },
  };
  const N = 14;
  const cGeo = new THREE.PlaneGeometry(1, 1);
  const cMat = new THREE.ShaderMaterial({
    uniforms: cloudUniforms, vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG,
    transparent: true, depthWrite: false,
  });
  const clouds = new THREE.InstancedMesh(cGeo, cMat, N);
  clouds.frustumCulled = false;
  clouds.renderOrder = -9;
  const rects = new Float32Array(N * 4);
  const shades = new Float32Array(N);
  const cloudState = [];
  const dummy = new THREE.Object3D();
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + (i % 3) * 0.35;
    const r = 900 + (i % 5) * 380;
    const y = 260 + (i % 4) * 90 + (i % 3) * 40;
    const w = 420 + (i % 4) * 210, h = w * (0.42 + (i % 3) * 0.06);
    cloudState.push({ a, r, y, w, h, speed: 0.0016 + (i % 3) * 0.0009 });
    rects[i * 4] = (i % 2) * 0.5; rects[i * 4 + 1] = ((i >> 1) % 2) * 0.5;
    rects[i * 4 + 2] = 0.5; rects[i * 4 + 3] = 0.5;
    shades[i] = (i % 5) / 5;
  }
  cGeo.setAttribute('aRect', new THREE.InstancedBufferAttribute(rects, 4));
  cGeo.setAttribute('aShade', new THREE.InstancedBufferAttribute(shades, 1));
  group.add(tagMesh(clouds, 'sky.clouds', { thin: true, reason: '雲は板', noCollide: true, backdrop: true }));

  function update(sun, elapsed, camPos) {
    skyUniforms.uZenith.value.copy(sun.zenith);
    skyUniforms.uHorizon.value.copy(sun.horizon);
    skyUniforms.uHorizonFar.value.copy(sun.horizonFar);
    skyUniforms.uSunDir.value.copy(sun.dir);
    skyUniforms.uSunCol.value.copy(sun.sunCol);
    skyUniforms.uDusk.value = sun.dusk;
    skyUniforms.uNight.value = sun.night;
    skyUniforms.uStarAlpha.value = sun.starAlpha;
    skyUniforms.uTime.value = elapsed;

    // 雲の色: 昼は白/灰青、夕は上面が琥珀・底が灰紫、夜は沈黙
    // 空は uSkyGain 倍で描かれるのに、雲はその係数を掛けずに 0.84 で頭打ちだった。
    // 逆光では「空より暗い雲」= 太陽の暈の上に灰色の楕円が数珠つなぎに浮く。
    // 日向の雲の頂は、日向の石灰岩(シーンリニア 3.4)と同じ明るさまで上げる。
    const lit = new THREE.Color().copy(sun.sunCol).lerp(new THREE.Color(1, 1, 1), 1 - sun.dusk * 0.75);
    lit.multiplyScalar((1 - sun.night * 0.85) * SKY_GAIN * 1.55);
    const shadow = new THREE.Color().copy(sun.zenith).lerp(new THREE.Color(0.42, 0.45, 0.55), 0.35);
    shadow.multiplyScalar((1 - sun.night * 0.8) * SKY_GAIN * 1.15);
    cloudUniforms.uLit.value.copy(lit);
    cloudUniforms.uShadow.value.copy(shadow);
    cloudUniforms.uOpacity.value = 0.88 - sun.night * 0.45;

    for (let i = 0; i < N; i++) {
      const s = cloudState[i];
      const a = s.a + elapsed * s.speed;
      dummy.position.set(Math.cos(a) * s.r + camPos.x * 0.7, s.y, Math.sin(a) * s.r + camPos.z * 0.7);
      dummy.scale.set(s.w, s.h, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      clouds.setMatrixAt(i, dummy.matrix);
    }
    clouds.instanceMatrix.needsUpdate = true;
    dome.position.copy(camPos);
  }

  return { group, update };
}
