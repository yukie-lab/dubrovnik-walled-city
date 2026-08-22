// ============================================================================
// sea.js — アドリア海。青い板ではなく「水の体積」。
//
// この海の色はマテリアルの属性ではない。光が水の柱を通って戻ってきた結果として
// 毎ピクセル計算する。だから同じ水が、白い岩棚の上では淡いターコイズに、
// 中深度では翡翠に、ドロップオフの先では濃紺になる。
//
//  1. 吸収 — Beer–Lambert。水柱の長さは深度バッファから実測する(塗らない)。
//  2. 屈折 — 海底を法線でずらしてサンプルする。だから沈んだ岩が揺れる。
//  3. フレネル — IOR 1.333。真下を見れば透け、掠めれば鏡になる。
//  4. 反射 — 天蓋と同じ放射輝度関数 + 画面空間反射(城壁とロクルム)。
//  5. 波 — 方向スペクトル(ゲルストナー6波 + 細波3層)。反復は見えない。
//  6. きらめき — 波面勾配の統計から。点の集合が個々に瞬く「光の道」。
//  7. 逆光の穂 — 薄い波頭が光を透かして内側から翡翠に光る。
//  8. 砕波 — 浅場で立ち上がり、岩に当たって泡を生み、泡は流れて消える。
// ============================================================================
import * as THREE from 'three';
import { clamp, lerp, smoothstep, mulberry32, nearestOnPolyline, tagMesh } from './util.js';
import { LOKRUM } from './plan.js';
import { SKY_GAIN, SKY_RADIANCE_GLSL } from './sky.js';

// 水中から見える物(海底・岩棚・岸壁・島)を焼くレイヤー。
// 屈折と反射はこのレイヤーだけを描いた RT を読む — 街全体を二度描かない。
export const SEA_LAYER = 3;

const SEA_LEVEL = 0.0;

// ---- 海底図の範囲(この外は「沖の深場」として扱う)
const BX0 = -820, BX1 = 980, BZ0 = -700, BZ1 = 1100;
const BN = 768;                       // 2.34m / テクセル
const DEPTH_MAX = 40;                 // R チャンネルの最大水深
const SHORE_MAX = 200;                // G チャンネルの最大岸距離
const LAND_MAX = 12;                  // A チャンネルの最大陸高(水面からの高さ)

// うねりの来る向き(外洋 = 南東。波は北西へ進む)
const SWELL = [-0.62, -0.785];

// 方向スペクトル。波長は互いに素に近い値にして、反復が見えないようにする。
//            波長  振幅   角度(deg) 尖り
// 波長(m), 振幅(m), 主方向からのずれ(度), 尖り。
// 振幅の総和 ≒ 0.46m → 有義波高 ≒ 0.8m。晴れた日のアドリア海はこの程度で、
// 1.5m 級にすると外海が常に白波だらけの「時化の海」になる。
// 振幅の総和 ≒ 0.65m → 有義波高 ≒ 1.3m。長波に寄せると振幅は妥当でも
// 「勾配」が出ない(実測 Σ A·k = 5.6° で、Cox–Munk の rms 傾斜 9.7° にも
// 届かず、水面が平らな板になっていた)。短波側へ配分し直して 11° にする。
const WAVES = [
  [74.0, 0.210, 0, 0.30],
  [47.0, 0.140, -23, 0.33],
  [23.0, 0.110, 32, 0.36],
  [13.5, 0.080, -45, 0.38],
  [7.9, 0.052, 59, 0.40],
  [4.3, 0.034, -72, 0.42],
  [2.6, 0.021, 14, 0.44],
  [1.5, 0.013, -58, 0.46],
  [0.9, 0.008, 77, 0.48],
];

const COMMON = /* glsl */`
const float PI = 3.14159265;
#define PI2 6.283185307179586
uniform sampler2D tBathy;
uniform vec4 uBathyRect;      // x0, z0, 1/(x1-x0), 1/(z1-z0)
uniform float uTime;

vec4 bathy(vec2 p) {
  vec2 q = (p - uBathyRect.xy) * uBathyRect.zw;
  vec4 b = texture2D(tBathy, clamp(q, vec2(0.002), vec2(0.998)));
  // 範囲外は沖の深場・岸から遠い・遮蔽なし
  float inside = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
  return mix(vec4(1.0, 1.0, 0.0, 0.0), b, inside);
}

float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1,0)), f.x),
             mix(hash21(i + vec2(0,1)), hash21(i + vec2(1,1)), f.x), f.y);
}
`;

// ゲルストナー波。振幅は「遮蔽」と「水深」で変える —
// 港の中は凪ぎ、浅場では立ち上がって尖る。これが無いと海全体が一様に揺れる。
const GERSTNER = /* glsl */`
uniform vec4 uWaveA[9];   // dirx, dirz, k(=2pi/L), omega
uniform vec2 uWaveB[9];   // amp, steepness

// 戻り値: xyz = 変位, w = ヤコビアン(1 に近いほど平ら、小さいほど尖る)
vec4 gerstner(vec2 p, float shelter, float depth, out vec3 nrm, out float amp) {
  vec3 disp = vec3(0.0);
  amp = 0.0;
  float jxx = 1.0, jzz = 1.0, jxz = 0.0;
  vec3 n = vec3(0.0, 1.0, 0.0);
  float calm = 1.0 - 0.86 * shelter;
  for (int i = 0; i < 9; i++) {
    vec2 D = uWaveA[i].xy;
    float k = uWaveA[i].z, w = uWaveA[i].w;
    float L = 2.0 * PI / k;
    // 浅水変形: 水深が波長の半分を切ると振幅が増して波長が縮む
    float sh = clamp(depth / (0.5 * L), 0.04, 1.0);
    float shoal = 1.0 + 0.62 * (1.0 - sh);
    float A = uWaveB[i].x * calm * shoal * smoothstep(0.0, 1.1, depth);
    float Q = uWaveB[i].y;
    amp += A;
    float ph = k * dot(D, p) - w * uTime;
    float c = cos(ph), s = sin(ph);
    disp.xz += Q * A * D * c;
    disp.y += A * s;
    float QA = Q * A * k;
    jxx -= QA * D.x * D.x * s;
    jzz -= QA * D.y * D.y * s;
    jxz -= QA * D.x * D.y * s;
    n.x -= D.x * A * k * c;
    n.z -= D.y * A * k * c;
  }
  nrm = normalize(n);
  return vec4(disp, jxx * jzz - jxz * jxz);
}
`;

const SEA_VERT = /* glsl */`
${COMMON}
${GERSTNER}
#include <shadowmap_pars_vertex>
varying vec3 vWorld;
varying vec3 vNrm;
varying float vJac;
varying vec3 vBathy;     // depth, shoreDist(m), shelter
varying float vAmp;      // その場の波の振幅(m)。砕波判定に要る
void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  wp.y = ${SEA_LEVEL.toFixed(1)};
  vec4 b = bathy(wp.xz);
  float depth = b.r * ${DEPTH_MAX.toFixed(1)};
  float shore = b.g * ${SHORE_MAX.toFixed(1)};
  float shelter = b.b;
  vBathy = vec3(depth, shore, shelter);
  vec3 n;
  float amp;
  vec4 g = gerstner(wp.xz, shelter, depth, n, amp);
  vAmp = amp;
  wp += g.xyz;
  // 海面は陸より下でなければならない。これまでは深度バッファ任せだったので、
  // 沖の波頭(0.5m)と陸側の頂点を結ぶ三角形が地面を突き抜けた。ピレの空壕
  // (底 0.3m、海から 15m 離れた閉じた窪み)を横切る **水平の帯** がそれ。
  // 汀(0〜0.12m)は沈めない — そこは本当に波が上がる所で、沈めると水際に
  // 裂け目ができる。それより上は陸の高さぶん + 余裕 1.2m だけ下げる。
  float landH = b.a * ${LAND_MAX.toFixed(1)};
  wp.y -= smoothstep(0.12, 0.45, landH) * (landH + 1.2);
  vJac = g.w;
  vNrm = n;
  vWorld = wp;
  // 城壁の影を海に落とすため、太陽の影マップの座標をここで作る。
  // 影は「暗い帯」ではなく本物の遮蔽 — 時刻が変われば向きも長さも変わる。
#ifdef USE_SHADOWMAP
  #if NUM_DIR_LIGHT_SHADOWS > 0
  vDirectionalShadowCoord[0] = directionalShadowMatrix[0]
    * vec4(wp + n * directionalLightShadows[0].shadowNormalBias, 1.0);
  #endif
#endif
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const SEA_FRAG = /* glsl */`
${COMMON}
${SKY_RADIANCE_GLSL}
#include <packing>
uniform bool receiveShadow;   // lights_pars_begin を取り込まないので自前で宣言する
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
varying vec3 vWorld;
varying vec3 vNrm;
varying float vJac;
varying vec3 vBathy;
varying float vAmp;

uniform sampler2D tScene, tDepth;
uniform vec2 uRes;
uniform float uNear, uFar;
uniform vec3 uCamFwd;
uniform vec3 uZenith, uHorizon, uHorizonFar, uSunCol, uSunDir;
uniform float uSunLum, uDusk, uNight, uSkyGain;
uniform vec3 uFog;
uniform float uFogDensity;
uniform mat4 uViewProj;   // フラグメントでは projectionMatrix が来ない
uniform float uDebug;     // 0=通常 1=海底色 2=水柱長 3=フレネル 4=法線 5=泡 6=海底図
uniform vec3 uSigma;      // 吸収+散乱の減衰係数 (1/m)
uniform vec3 uInscat;     // 散乱で返ってくる色

float linearDepth(vec2 uv) {
  float z = texture2D(tDepth, uv).x;
  float ndc = z * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear));
}

// 細波。三層を非整数倍・別方向で流し、周期が見えないようにする。
vec3 ripples(vec2 p, float amp, float lod) {
  float e = 0.35;
  float a1 = 1.0 - smoothstep(60.0, 260.0, lod);
  float a2 = 1.0 - smoothstep(24.0, 110.0, lod);
  float a3 = 1.0 - smoothstep(9.0, 42.0, lod);
  vec2 d1 = vec2(0.81, -0.59) * uTime * 0.44;
  vec2 d2 = vec2(-0.34, 0.94) * uTime * 0.63;
  vec2 d3 = vec2(0.62, 0.78) * uTime * 0.95;
  float s = 0.0, sx = 0.0, sz = 0.0;
  float h1 = vnoise(p * 0.145 + d1), h2 = vnoise(p * 0.41 + d2), h3 = vnoise(p * 1.07 + d3);
  sx += (h1 - vnoise((p + vec2(e, 0.0)) * 0.145 + d1)) * 0.145 * a1 * 1.00;
  sz += (h1 - vnoise((p + vec2(0.0, e)) * 0.145 + d1)) * 0.145 * a1 * 1.00;
  sx += (h2 - vnoise((p + vec2(e, 0.0)) * 0.41 + d2)) * 0.41 * a2 * 0.55;
  sz += (h2 - vnoise((p + vec2(0.0, e)) * 0.41 + d2)) * 0.41 * a2 * 0.55;
  sx += (h3 - vnoise((p + vec2(e, 0.0)) * 1.07 + d3)) * 1.07 * a3 * 0.26;
  sz += (h3 - vnoise((p + vec2(0.0, e)) * 1.07 + d3)) * 1.07 * a3 * 0.26;
  return vec3(sx, sz, (h1 - 0.5) * a1);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 V = normalize(cameraPosition - vWorld);
  float camD = length(vWorld - cameraPosition);
  float depth = vBathy.x, shore = vBathy.y, shelter = vBathy.z;

  // ---- 城壁の影。三つの影マップをそのまま読む(海だけ別の嘘をつかない)。
  // 夕方、水面はここだけ暗く、きらめかず、映り込みも落ちる。
  float sh = 1.0;
#ifdef USE_SHADOWMAP
  // 影マップはプレイヤ中心・半径 170m まで。遠方は常に日向を返すので読まない。
  if (camD < 360.0) sh = getShadowMask();
#endif
  float lit = 0.30 + 0.70 * sh;

  // ---- 法線: ゲルストナーの解析法線 + 細波
  // 風のむら。数十mのスケールで波の立ち方が変わらない海は「描かれた模様」。
  float wind = (0.42 + 0.78 * vnoise(vWorld.xz * 0.0052 + uTime * 0.011)
              + 0.34 * vnoise(vWorld.xz * 0.0195 - uTime * 0.026)) * (1.0 - 0.80 * shelter);
  vec3 rip = ripples(vWorld.xz, 1.0, camD);
  vec3 N = normalize(vec3(vNrm.x + rip.x * 3.6 * wind, 1.0, vNrm.z + rip.y * 3.6 * wind));

  // ---- 水柱の長さ(深度バッファから実測)
  float sceneZ = linearDepth(uv);
  vec3 rayW = -V;
  float cosA = max(dot(rayW, uCamFwd), 1e-3);
  float sceneDist = sceneZ / cosA;
  float botK = 1.0 - smoothstep(uFar * 0.70, uFar * 0.85, sceneZ);   // 深度に海底が無くなる境目を線にしない
  bool hasBottom = botK > 0.001;
  // 水柱長は「海底図から解析的に」を主、「深度バッファ」を上限として使う。
  // 深度バッファだけに頼ると、視線が浅くなって海底に届かなくなる高さで
  // 値が跳ね、画面を横切る一本の直線(色の段差)が出る。
  float colA = depth / max(-rayW.y, 0.02);
  float colB = hasBottom ? max(sceneDist - camD, 0.0) : 1.0e9;
  float column = min(min(colA, colB), 260.0);
  float bottomDepth = depth;

  // ---- 屈折: 法線で画面をずらして海底を読む。
  // ずれ量は距離に反比例させる(世界スケールで一定の揺れに見せるため)
  float refK = clamp(1.6 / max(camD, 2.0), 0.0, 0.06) * clamp(column * 0.5, 0.0, 1.0);
  vec2 ruv = clamp(uv + N.xz * refK, vec2(0.002), vec2(0.998));
  float rZ = linearDepth(ruv);
  // ずらした先が水面より手前なら、水の上の物を水中に映してしまう
  if (rZ / cosA < camD) ruv = uv;
  // 深度バッファに海底が無い画素では「見えない海底」の平均色で代用する。
  // ここを暗い散乱色にすると、海底に届く/届かないの境界が画面を横切る
  // 一本の直線になって、水の色が段で変わる。
  vec3 deepBottom = vec3(0.30, 0.30, 0.28) * (0.35 + 0.65 * max(uSunDir.y, 0.0));
  vec3 bottomCol = mix(deepBottom, texture2D(tScene, ruv).rgb, botK);

  // ---- Beer–Lambert。太陽が海底へ降りる経路も足す(往復)
  float down = bottomDepth / max(uSunDir.y, 0.22);
  vec3 T = exp(-uSigma * (column + min(down, 90.0)));
  vec3 Tv = exp(-uSigma * column);
  // 散乱で戻る光は深いほど飽和する
  vec3 scat = uInscat * (1.0 - Tv) * (0.38 + 0.62 * sh);
  vec3 water = bottomCol * T + scat;

  // ---- 逆光の穂(薄い波頭が内側から光る)
  float crest = clamp((vWorld.y - ${SEA_LEVEL.toFixed(1)}) * 2.6, 0.0, 1.0);
  float back = clamp(dot(-V, normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0, 1.0);   // 指数は sss 側で掛ける
  float lowSun = smoothstep(0.55, 0.06, uSunDir.y);
  // uInscat は青優勢なので、そのまま使うと逆光の穂が「青く」光る。
  // 薄い波頭を透かした光は緑が最も残る(赤は数cmで消え、青は散乱で逃げる)。
  vec3 sssCol = vec3(0.10, 0.62, 0.44) * (uInscat.r + uInscat.g + uInscat.b);
  vec3 sss = sssCol * uSunCol * (pow(back, 0.53) * crest * crest * lowSun * 4.0 * (1.0 - uNight)) * sh;
  water += sss;

  // ---- フレネル(IOR 1.333)
  float cosT = clamp(dot(V, N), 0.0, 1.0);
  float F = 0.0204 + 0.9796 * pow(1.0 - cosT, 5.0);

  // ---- 反射: 天蓋と同じ式。太陽円盤はきらめき側で作るので抜く。
  vec3 R = reflect(-V, N);
  R.y = max(R.y, 0.008);
  vec3 refl = skyRadiance(R, uZenith, uHorizon, uHorizonFar, uSunDir, uSunCol, uDusk, 0.0) * uSkyGain * (0.60 + 0.40 * sh);
  // 遠方では波が 1 画素より小さくなり、幾何法線からは何の模様も出ない。
  // そこで実際に見えているのは「風のむら」— 粗い面は空の平均を返し、
  // 凪いだ面は水平線を鏡で返す。これが無い海は、遠景がのっぺりした板になる。
  {
    float farK = smoothstep(70.0, 380.0, camD);
    vec3 skyAvg = mix(uHorizonFar, uZenith, 0.30) * uSkyGain * 0.88;
    refl = mix(refl, skyAvg, farK * clamp((wind - 0.62) * 0.85, 0.0, 0.60));
  }

  // 画面空間反射 — 城壁とロクルムが実際に映る(静的キューブマップではない)
  float ssrK = smoothstep(0.14, 0.42, F) * (1.0 - smoothstep(90.0, 420.0, camD));
  if (ssrK > 0.02) {
    // 画面空間反射はレイを 1 本しか撃てない。細波の法線をそのまま使うと、
    // 隣り合う画素が別々の物を拾って、反射像が「浮かんだ氷の板」に千切れる。
    // 反射のレイはうねりの大きな面だけで作り、細波は空の映り込み側に残す。
    vec3 Nssr = normalize(vec3(vNrm.x * 0.5, 1.0, vNrm.z * 0.5));
    vec3 Rs = reflect(-V, Nssr);
    Rs.y = max(Rs.y, 0.006);
    vec3 p = vWorld, pIn = vWorld;
    float st = 0.6;
    bool hit = false;
    for (int i = 0; i < 18; i++) {
      pIn = p; p += Rs * st; st *= 1.34;
      vec4 clip = uViewProj * vec4(p, 1.0);
      if (clip.w <= 0.0) break;
      vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
      if (suv.x < 0.004 || suv.x > 0.996 || suv.y < 0.004 || suv.y > 0.996) break;
      float pz = dot(p - cameraPosition, uCamFwd);
      float sz = linearDepth(suv);
      if (pz > sz && pz - sz < st * 3.0 && sz < uFar * 0.85) { hit = true; break; }
    }
    if (hit) {
      // 二分探索で交点を詰める。粗い前進のまま採ると、反射像が
      // 「油膜のような斑」になる(城壁の映り込みが階段状に割れていた)。
      for (int k = 0; k < 5; k++) {
        vec3 mid = (p + pIn) * 0.5;
        vec4 c2 = uViewProj * vec4(mid, 1.0);
        vec2 u2 = c2.xy / max(c2.w, 1e-4) * 0.5 + 0.5;
        float mz = dot(mid - cameraPosition, uCamFwd);
        if (mz > linearDepth(u2)) p = mid; else pIn = mid;
      }
      vec4 clip = uViewProj * vec4(p, 1.0);
      vec2 suv = clamp(clip.xy / max(clip.w, 1e-4) * 0.5 + 0.5, vec2(0.0), vec2(1.0));
      float edge = smoothstep(0.0, 0.12, min(min(suv.x, 1.0 - suv.x), min(suv.y, 1.0 - suv.y)));
      refl = mix(refl, texture2D(tScene, suv).rgb, edge * ssrK * 0.88);
    }
  }

  vec3 col = mix(water, refl, F);

  // ---- きらめき: 波面勾配の統計(GGX)。細波が細かいほど道が砕ける。
  vec3 H = normalize(uSunDir + V);
  float NoH = max(dot(N, H), 0.0);
  // 遠いほど 1 画素が受け持つ海面が広い = 勾配の分散が大きい。粗さを距離で開く。
  // 開かないと、遠方の三角形 1 枚が丸ごと鏡になって「水平線に並ぶ赤い玉」になる。
  // Cox–Munk: 海面の傾きの分散は σ² ≈ 0.003 + 0.0051·U。風速 5m/s で σ ≈ 0.17。
  // ここを 0.03 にすると鏡面ローブが 3 度しかなく、太陽の道が「線」にもならない。
  float rough = clamp(mix(0.115, 0.42, smoothstep(30.0, 2500.0, camD)) / max(wind, 0.55), 0.09, 0.62);
  float a2 = rough * rough;
  float dTerm = min(a2 / (PI * pow(NoH * NoH * (a2 - 1.0) + 1.0, 2.0)), 24.0);   // 遠方のスパイクはここで抑える(距離で殺さない)
  // 個々に瞬く粒。波面の微小勾配を確率的に間引くと「道」が点に割れる。
  // 粒の大きさは「画面上で一定」にする。世界スケールで固定すると、
  // 近くでは粗い斑、遠くでは 1 画素に何十粒も入って砂嵐になる
  // (実測: 胸壁から見下ろすと海面全体が白い砂嵐になった)。
  // fwidth で 1 画素が受け持つ海面の幅を測り、粒がその 2.4 倍を保つようにする。
  float px = max(length(fwidth(vWorld.xz)), 0.015);
  float spkS = 1.0 / max(px * 2.4, 0.10 + 0.25 / max(wind, 0.4));
  float spk = vnoise(vWorld.xz * spkS + uTime * vec2(0.9, -0.7) * max(spkS * 0.4, 0.6));
  float twinkle = 0.50 + 1.45 * smoothstep(0.58, 0.95, spk) * (1.0 - smoothstep(200.0, 900.0, camD));
  // 遠方は 1 画素が何十もの波を受け持つ。そこで鏡面ローブを立てると、
  // 三角形 1 枚ぶんの輝度スパイクが水平線に赤い玉となって並ぶ。
  vec3 glit = uSunCol * uSunLum * dTerm * F * twinkle * max(uSunDir.y, 0.0) * (1.0 - uNight)
    * (1.0 - smoothstep(2500.0, 4000.0, camD)) * sh * sh;
  col += glit;

  // ---- 泡
  // 三つの出どころを分けて扱う。混ぜて一つの係数にすると、海全体が
  // 一様に白く濁って「牛乳の海」になる(実測: 浅場一面が foam≈0.8 だった)。
  //  1. 波頭が尖りすぎて崩れる(ヤコビアン)— 沖でも起きる。風が要る。
  //  2. 浅場で波が立ち上がって砕ける — 岸に平行な「うねりの線」として来る。
  //  3. 岩・岸壁への衝突 — 汀にへばりつく。
  // vJac の落ち込み幅は Σ Q·A·k で決まる。旧振幅では最小 0.93 で、
  // 閾値 0.40 には「どの時刻・どの場所でも」到達しなかった(恒久的に 0)。
  // 風速 5m/s の白波被覆率は海面の 1% 未満。閾値をヤコビアンの分布の裾に置く。
  // 0.965 では海面の広い範囲が閾値を跨ぎ、水面全体が泡になった(実測)。
  float steepFoam = smoothstep(0.90, 0.84, vJac) * smoothstep(0.75, 1.35, wind);
  // 砕波の線。shore(岸までの距離)を位相に使うと、線が岸と平行に走る。
  float phase = shore * 0.34 - uTime * 1.25 + vnoise(vWorld.xz * 0.055) * 3.4;
  // 砕波の条件は「水深が浅いこと」ではなく「波高が水深に近いこと」(H/d ≳ 0.6)。
  // 水深だけで判定すると、凪いだ港の 2m の浅場が一面の白波になる(実測)。
  float Hw = vAmp * 2.0;   // 波高(m)。H はきらめきのハーフベクトルで使用済み
  // 分母を 0.12m でクランプすると、浅場では H/d が常に 1 を超えて砕波判定が
  // 貼り付き、泡が飽和する。砕波帯を実際の幅に戻す。
  float shallow = smoothstep(0.58, 0.95, Hw / max(depth, 0.45));
  float surf = smoothstep(0.62, 0.97, sin(phase)) * shallow;
  // 砕けた泡は消えずに、崩れた場所から沖へ流れて薄れる。
  // 位相を遅らせた複製を重ねて「置き去りにされた泡」を作る。
  float trail = 0.0;
  for (int i = 1; i <= 3; i++) {
    float lag = float(i) * 1.15;
    float sg = sin((shore + 3.2 * float(i)) * 0.34 - uTime * 1.25
      + vnoise(vWorld.xz * 0.055) * 3.4 + vnoise(vWorld.xz * 0.42 + uTime * 0.06) * 0.9);
    trail += smoothstep(0.74, 1.0, sg) * exp(-lag * 0.72);
  }
  trail *= shallow * (0.55 + 0.45 * wind);
  // 岸・岩に張りつく泡。うねりの上下でにじり寄る。
  float lap = 0.5 + 0.5 * sin(shore * 0.30 - uTime * 1.05);
  // 岸には常に多少の波打ちがあるが、うねりが無ければ静かに舐めるだけ。
  // 岸に張りつく泡の帯は実際には 0.5〜2m。7m にすると、掠める視角では
  // 画面の半分が白くなる(埠頭に立つと海が一面の泡になった)。
  float rockFoam = smoothstep(2.6, 0.0, shore) * (0.15 + 0.85 * lap)
                 * smoothstep(0.10, 0.38, Hw) * 0.62;
  float foam = clamp(steepFoam * 0.85 + surf * 0.95 + trail * 0.42 + rockFoam * 0.9, 0.0, 1.0);
  // 泡の粒。一様な白い塗りは、遠目には「印刷された模様」に見える。
  float grain = 0.55 + 0.45 * vnoise(vWorld.xz * 2.3 - uTime * vec2(0.35, 0.22));
  foam *= mix(1.0, grain, 0.55);
  foam *= smoothstep(0.02, 0.20, depth) * (1.0 - smoothstep(220.0, 620.0, camD) * 0.65);
  // 泡は白い拡散面。日向では石灰岩の白と同じくらい明るい。ここを暗くすると
  // 水の色と見分けがつかず、「泡が無い海」になる(係数 0.30 では見えなかった)。
  vec3 foamCol = (uSunCol * uSunLum * max(uSunDir.y, 0.0) * 2.6 * sh
                + uZenith * uSkyGain * 0.42 + vec3(0.05)) * (1.0 - uNight * 0.72);
  col = mix(col, foamCol, foam * 0.82);

  // 水面は画面の大半を占める。ここに一画素でも巨大値が出ると、ブルームが
  // それを広げて「水平線の赤い玉」になる。物理的にありえない輝度は切る。
  col = min(col, vec3(9.0));
  vec3 preFog = col;
  // ---- 水平線は空そのものへ溶ける。
  // シーン共通の霧色 uFog は天頂寄り・SKY_GAIN×0.62 で作られていて、
  // 水平線の空より明確に暗い。そこへ溶かすと海の遠端が空より暗くなり、
  // 水平線に一本の線が出る(実測 昼 1.41倍・夜 6.48倍の輝度段差)。
  // 海だけは「同じ方位の水平線の空」へ溶かす。式を天蓋と一致させてあるので、
  // 継ぎ目は原理的に生まれない(太陽の暈も含める。円盤だけは入れない)。
  vec3 hDir = normalize(vec3(rayW.x, 0.0, rayW.z));
  float hSun = clamp(dot(hDir, uSunDir), -1.0, 1.0);
  float hHalo = pow(max(hSun, 0.0), 34.0) * 0.55 + pow(max(hSun, 0.0), 140.0) * 5.0;
  float hEmber = pow(clamp(hSun * 0.5 + 0.5, 0.0, 1.0), 7.0) * uDusk;
  vec3 horizonSky = (mix(uHorizonFar, uHorizon, smoothstep(-0.4, 0.9, hSun))
    + uSunCol * (hHalo * (0.5 + uDusk * 1.2) + hEmber * 0.5)) * uSkyGain;
  float fd = uFogDensity * camD;
  col = mix(col, horizonSky, 1.0 - exp(-fd * fd));

  bool ok = all(greaterThanEqual(col, vec3(-1.0))) && all(lessThanEqual(col, vec3(1.0e5)));
  if (!ok) col = uFog;
  // ---- 診断(?seadbg=N)。海は要素が多いので、切り分けられないと直せない。
  if (uDebug > 0.5) {
    if (uDebug < 1.5) col = bottomCol;
    else if (uDebug < 2.5) col = vec3(column / 40.0);
    else if (uDebug < 3.5) col = vec3(F);
    else if (uDebug < 4.5) col = N * 0.5 + 0.5;
    else if (uDebug < 5.5) col = vec3(steepFoam, surf + trail, rockFoam);   // R=波頭 G=砕波 B=汀
    else if (uDebug < 5.7) col = vec3(shallow, Hw / 4.0, depth / 40.0);       // R=砕波条件 G=波高 B=水深
    else if (uDebug < 5.9) col = vec3(sh);                                     // 影マスク(1=日向)
    else if (uDebug < 6.5) col = vec3(depth / 40.0, shore / 200.0, shelter);
    else if (uDebug < 7.5) col = vec3(hasBottom ? 1.0 : 0.0, min(camD / 300.0, 1.0), 0.0);
    else if (uDebug < 8.5) col = glit / (glit + 1.0);
    else if (uDebug < 9.5) col = refl / (refl + 1.0);
    else if (uDebug < 10.5) col = water / (water + 1.0);
    else if (uDebug < 11.5) col = preFog / (preFog + 1.0);
    else if (uDebug < 12.5) col = vec3(foam);
    else if (uDebug < 13.5) col = vec3(0.25);
    else if (uDebug < 14.5) col = texture2D(tScene, uv).rgb;
    else col = vec3(texture2D(tDepth, uv).x);
    gl_FragColor = vec4(col, 1.0); return;
  }
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

// ---------------------------------------------------------------- 海底図 ----
// 水深・岸までの距離・遮蔽(fetch)を 1 枚のテクスチャに焼く。
// 波の高さも泡も、この 3 つが決める。塗るのではなく地形から導く。
function bakeBathy(plan) {
  // 人が造った水際(埠頭・防波堤・橋)。海底図はこれを陸として知らないと、
  // 岸から 17m 沖に「本当の水際」があることになってしまう。
  const quay = plan.streets.find(s => s.id === 'quay');
  const builtAt = (x, z) => {
    for (const w of plan.OUTSIDE_WALKS) {
      if (w.has) { if (w.has(x, z)) return true; }
      else if (x > w.x0 - 0.6 && x < w.x1 + 0.6 && z > w.z0 - 0.6 && z < w.z1 + 0.6) return true;
    }
    if (quay) {
      const n = nearestOnPolyline(quay.pts, x, z);
      if (Math.hypot(x - n.x, z - n.z) < quay.w / 2 + 0.5) return true;
    }
    // カセ突堤(walls.js が描く沖の防波堤)
    if (x > 201.4 && x < 210.6 && z > -20.6 && z < 16.6) return true;
    return false;
  };
  const N = BN;
  const dx = (BX1 - BX0) / (N - 1), dz = (BZ1 - BZ0) / (N - 1);
  const h = new Float32Array(N * N);
  const land = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) {
    const z = BZ0 + j * dz;
    for (let i = 0; i < N; i++) {
      const x = BX0 + i * dx;
      const y = plan.outsideHeight(x, z);
      h[j * N + i] = y;
      // 素地形だけを陸とみなすと、埠頭・防波堤・稜堡の足元が「海の真ん中」に
      // なる。実測: 聖ヨハネ埠頭の縁で岸までの距離が 16.9m と出ていた。
      // その結果 rockFoam も砕波も shelter も全部ゼロ = 泡の無い海・凪がない港。
      land[j * N + i] = (y > 0.06 || builtAt(x, z)) ? 1 : 0;
    }
  }
  // 岸までの距離 — 陸マスクのチャンファ距離変換(2パス)
  const INF = 1e9;
  const d = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) d[k] = land[k] ? 0 : INF;
  const cd = Math.hypot(dx, dz);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i; let v = d[k];
    if (i > 0) v = Math.min(v, d[k - 1] + dx);
    if (j > 0) v = Math.min(v, d[k - N] + dz);
    if (i > 0 && j > 0) v = Math.min(v, d[k - N - 1] + cd);
    if (i < N - 1 && j > 0) v = Math.min(v, d[k - N + 1] + cd);
    d[k] = v;
  }
  for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) {
    const k = j * N + i; let v = d[k];
    if (i < N - 1) v = Math.min(v, d[k + 1] + dx);
    if (j < N - 1) v = Math.min(v, d[k + N] + dz);
    if (i < N - 1 && j < N - 1) v = Math.min(v, d[k + N + 1] + cd);
    if (i > 0 && j < N - 1) v = Math.min(v, d[k + N - 1] + cd);
    d[k] = v;
  }
  // 遮蔽 — 「囲まれ具合」。一方向の fetch だけだと、旧港のように斜めに
  // 口が開いた水面が「外洋と同じ」になる。全方位に光線を撃って、
  // 近くで陸に当たる方向の割合を採る。港の中は凪ぎ、沖は素通し。
  const FN = 128, FR = 280, NRAY = 16;
  const shelt = new Float32Array(FN * FN);
  const rays = [];
  for (let r = 0; r < NRAY; r++) {
    const a = (r / NRAY) * Math.PI * 2;
    rays.push([Math.cos(a), Math.sin(a)]);
  }
  const landAt = (x, z) => {
    const i = Math.round((x - BX0) / dx), j = Math.round((z - BZ0) / dz);
    if (i < 0 || i >= N || j < 0 || j >= N) return 0;
    return land[j * N + i];
  };
  for (let fj = 0; fj < FN; fj++) {
    const z = BZ0 + (fj / (FN - 1)) * (BZ1 - BZ0);
    for (let fi = 0; fi < FN; fi++) {
      const x = BX0 + (fi / (FN - 1)) * (BX1 - BX0);
      let acc = 0;
      for (const r of rays) {
        for (let t = 6; t < FR; t += 6) {
          if (landAt(x + r[0] * t, z + r[1] * t)) { acc += 1 - t / FR; break; }
        }
      }
      shelt[fj * FN + fi] = clamp(acc / (NRAY * 0.55), 0, 1);
    }
  }
  const sheltAt = (i, j) => {
    const u = (i / (N - 1)) * (FN - 1), v = (j / (FN - 1)) * (FN - 1);
    const i0 = Math.min(FN - 2, Math.floor(u)), j0 = Math.min(FN - 2, Math.floor(v));
    const fu = u - i0, fv = v - j0;
    const a = shelt[j0 * FN + i0], b = shelt[j0 * FN + i0 + 1];
    const c = shelt[(j0 + 1) * FN + i0], e = shelt[(j0 + 1) * FN + i0 + 1];
    return lerp(lerp(a, b, fu), lerp(c, e, fu), fv);
  };
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    data[k * 4] = clamp((SEA_LEVEL - h[k]) / DEPTH_MAX, 0, 1) * 255;
    data[k * 4 + 1] = clamp(d[k] / SHORE_MAX, 0, 1) * 255;
    data[k * 4 + 2] = clamp(sheltAt(i, j), 0, 1) * 255;
    // A は「陸か否か」の旗だったが、シェーダはこれを一度も読んでいなかった。
    // 海面を陸より下へ沈めるのに要るのは旗ではなく **陸の高さ** なので、
    // 水面からの高さ(0〜12m)を入れる。
    data[k * 4 + 3] = clamp(h[k] / LAND_MAX, 0, 1) * 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return { tex, dist: d, N, dx, dz };
}

// ---- カメラ追従の放射グリッド。近くは細かく、水平線まで一枚で届く。
// 固定グリッドだと「近景は粗く遠景は無限に細かい」という透視法の逆転が起きる。
function radialGrid(rings, segs) {
  const pos = new Float32Array((1 + rings * segs) * 3);
  const idx = [];
  const A = 0.50, B = (4000 - A * rings) / (rings * rings * rings);
  for (let i = 1; i <= rings; i++) {
    const r = A * i + B * i * i * i;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const k = (1 + (i - 1) * segs + s) * 3;
      pos[k] = Math.cos(a) * r; pos[k + 1] = 0; pos[k + 2] = Math.sin(a) * r;
    }
  }
  // 巻き方: 上から見て +Y が表。逆にすると海が丸ごと裏面カリングで消える。
  for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
  for (let i = 1; i < rings; i++) {
    const a0 = 1 + (i - 1) * segs, a1 = 1 + i * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      idx.push(a0 + s, a1 + s1, a1 + s, a0 + s, a0 + s1, a1 + s1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4200);
  return g;
}

export function makeSea(plan) {
  const bath = bakeBathy(plan);

  const waveA = [], waveB = [];
  const base = Math.atan2(SWELL[1], SWELL[0]);
  for (const [L, A, degOff, Q] of WAVES) {
    const a = base + degOff * Math.PI / 180;
    const k = 2 * Math.PI / L;
    waveA.push(new THREE.Vector4(Math.cos(a), Math.sin(a), k, Math.sqrt(9.81 * k)));
    waveB.push(new THREE.Vector2(A, Q));
  }

  const uniforms = {
    uTime: { value: 0 },
    tBathy: { value: bath.tex },
    uBathyRect: { value: new THREE.Vector4(BX0, BZ0, 1 / (BX1 - BX0), 1 / (BZ1 - BZ0)) },
    uWaveA: { value: waveA },
    uWaveB: { value: waveB },
    tScene: { value: null },
    tDepth: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uNear: { value: 0.1 }, uFar: { value: 6000 },
    uCamFwd: { value: new THREE.Vector3(0, 0, -1) },
    uViewProj: { value: new THREE.Matrix4() },
    uZenith: { value: new THREE.Color(0x4d80b8) },
    uHorizon: { value: new THREE.Color(0xbcd8e8) },
    uHorizonFar: { value: new THREE.Color(0xbcd8e8) },
    uSunCol: { value: new THREE.Color(1, 1, 0.9) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunLum: { value: 1 },
    uDusk: { value: 0 }, uNight: { value: 0 },
    uSkyGain: { value: SKY_GAIN },
    uFog: { value: new THREE.Color(0xdde8f0) },
    uFogDensity: { value: 0.00135 },
    // 清澄なアドリア海の減衰係数(1/m)。赤は数mで消え、緑は数十m、青が最も遠い。
    // **散乱源は固定、消散だけを動かす。** 深い水の色は Beer–Lambert の
    // 漸近値 σ_s/σ_t で決まるので、σ_t(消散)を上げれば遠くの水は青へ寄り、
    // 短い水柱(浅場)では scat ≈ (σ_s/σ_t)·σ_t·column = σ_s·column となって
    // **σ に依らない** — 浅場は 1 ミリも変わらない。色を足すのとは別物。
    uSigma: { value: new THREE.Vector3(0.42, 0.075, 0.030) },
    // 水柱 0.5m での散乱寄与が海底色の 0.7% しか無く、浅場の色が事実上
    // 「白い海底 × わずかな赤の吸収」だけになっていた(実測 彩度 2〜4%)。
    // 沿岸のアドリア海は外洋よりはるかに散乱が強く、0.5m でも色が付く。
    // 実効値は update() が毎フレーム SCAT/σ から入れ直す。ここは器。
    uInscat: { value: new THREE.Vector3(0.055, 0.20, 0.42) },
    uDebug: { value: 0 },
  };

  // lights:true にしないと three は NUM_DIR_LIGHT_SHADOWS を定義せず、
  // 影チャンクが丸ごと消える(= 壁の影が海に落ちない)。ライト側の
  // uniform も material.uniforms に実体が要る。
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.lights), uniforms),
    vertexShader: SEA_VERT, fragmentShader: SEA_FRAG, lights: true,
  });
  // ---- 消散係数の生調整。σ_s(散乱源)は動かさない。
  // SCAT = INS0 × SIG0。これを保ったまま σ を上げると、
  //   浅場: scat ≈ SCAT·column        (σ に依らない = 変わらない)
  //   深場: scat → SCAT/σ             (σ が大きいほど暗く・青く)
  //   海底: T = exp(−σ·(column+down)) (水柱長に比例して赤緑が落ちる)
  // **update() が毎フレーム uInscat を上書きしている。** だから作成時の値も、
  // ここで書いた値も、1 フレームで消える(実測: σ を 2.4 倍にしても
  // 画素の 0.47% しか変わらなかった)。基準色はそこに置いてある
  // (0.055, 0.20, 0.42)。散乱源はそれと σ から作る。
  // SIG0 / INS0 は **散乱源を決めるための基準の組**。触らない。
  // これらの積 SCAT = σ_s·L が保存量で、σ を動かしても不変。
  const SIG0 = new THREE.Vector3(0.42, 0.075, 0.030);
  const INS0 = new THREE.Vector3(0.055, 0.20, 0.42);   // 基準 σ における update() の実効値
  const SCAT = new THREE.Vector3(INS0.x * SIG0.x, INS0.y * SIG0.y, INS0.z * SIG0.z);
  // 出荷する消散係数。赤と緑だけ上げ、青は基準のまま(0.030)。
  // 深い水の漸近色は SCAT/σ なので (0.023, 0.094, 0.420) — 正規化 (0.05, 0.22, 1.00)。
  // 基準の (0.13, 0.48, 1.00) より深く飽和したアドリア海の青になる。
  // 浅場は scat ≈ SCAT·column で σ に依らないが、**海底の透過** は
  // exp(−σ·path) なので水深 1〜4m のターコイズの帯は青へ寄る。
  // その代償は承知のうえで選んだ値(実測 沖 |Δ|5.7 / 浅場 |Δ|22.2)。
  const SIG_DEFAULT = new THREE.Vector3(1.00, 0.16, 0.030);
  const baseInscat = INS0.clone();                      // = SCAT / σ
  const applySigma = (r, g, b) => {
    uniforms.uSigma.value.set(r, g, b);
    baseInscat.set(SCAT.x / r, SCAT.y / g, SCAT.z / b);
    uniforms.uInscat.value.copy(baseInscat);
  };
  // ヘッドレスの計器には window はあっても location が無い(domshim)。
  // window だけで判定して落としていた。使う物そのものを確かめる。
  applySigma(SIG_DEFAULT.x, SIG_DEFAULT.y, SIG_DEFAULT.z);   // 計器も同じ海を見る
  if (typeof location !== 'undefined' && typeof window !== 'undefined') {
    const Q2 = new URLSearchParams(location.search);
    const qn = (k, d) => (Q2.has(k) ? Number(Q2.get(k)) : d);
    applySigma(qn('sigR', SIG_DEFAULT.x), qn('sigG', SIG_DEFAULT.y), qn('sigB', SIG_DEFAULT.z));
    window.__sea = {
      get sigma() { const v = uniforms.uSigma.value; return { r: v.x, g: v.y, b: v.z }; },
      get inscat() { const v = uniforms.uInscat.value; return { r: v.x, g: v.y, b: v.z }; },
      /** 例: __sea.set({ r: 0.84, g: 0.15 }) — 青は既定のまま */
      set(o = {}) {
        const v = uniforms.uSigma.value;
        applySigma(o.r ?? v.x, o.g ?? v.y, o.b ?? v.z);
        return this.sigma;
      },
      /** 出荷値へ戻す(基準の組 SIG0 ではない) */
      reset() { applySigma(SIG_DEFAULT.x, SIG_DEFAULT.y, SIG_DEFAULT.z); return this.sigma; },
      /** 変更前の海に戻して見比べる */
      before() { applySigma(SIG0.x, SIG0.y, SIG0.z); return this.sigma; },
      /** 海底のドロップオフは地形なので、その値で読み直す */
      dropoff(v) { const u = new URL(location.href); u.searchParams.set('dropoff', v); location.href = u.href; },
    };
  }

  const mesh = new THREE.Mesh(radialGrid(150, 176), mat);
  mesh.receiveShadow = true;     // これが false だと getShadowMask() が常に 1.0
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;          // 街の後ろに描く(深度で大半が捨てられる)
  const group = new THREE.Group();
  group.add(tagMesh(mesh, 'sea.surface', { thin: true, reason: '水面は面。体積は吸収で表す', noCollide: true }));

  const fwd = new THREE.Vector3();
  function update(sun, elapsed, camera, fogDensity) {
    uniforms.uTime.value = elapsed;
    if (camera) {
      // 頂点の泳ぎを止めるため 1m 格子にスナップする(波は世界座標の関数)
      mesh.position.set(Math.round(camera.position.x), 0, Math.round(camera.position.z));
      camera.getWorldDirection(fwd);
      uniforms.uViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      uniforms.uCamFwd.value.copy(fwd);
      uniforms.uNear.value = camera.near;
      uniforms.uFar.value = camera.far;
    }
    uniforms.uZenith.value.copy(sun.zenith);
    uniforms.uHorizon.value.copy(sun.horizon);
    uniforms.uHorizonFar.value.copy(sun.horizonFar);
    uniforms.uSunCol.value.copy(sun.sunCol);
    uniforms.uSunDir.value.copy(sun.dir);
    uniforms.uSunLum.value = sun.sunIntensity * 0.10;
    uniforms.uDusk.value = sun.dusk;
    uniforms.uNight.value = sun.night;
    uniforms.uFog.value.copy(sun.fogCol);
    if (fogDensity != null) uniforms.uFogDensity.value = fogDensity;
    // 散乱で戻る光は入射光に比例する。夕方は琥珀へ、夜は沈む。
    const L = (sun.sunIntensity * 0.045 + 0.10) * (1 - sun.night * 0.88);
    const c = uniforms.uInscat.value;
    // 色度は **σ から** 来る(SCAT / σ)。ここに数字を直接書くと、
    // 消散係数をいくら動かしても深い水の色は変わらない。
    c.copy(baseInscat).multiplyScalar(L);
    c.x = lerp(c.x, c.x * 2.4, sun.dusk);
  }

  // 音の定位などが使う「岸までの距離」。焼いた距離場を読む。
  function shoreDist(x, z) {
    const i = clamp(Math.round((x - BX0) / bath.dx), 0, bath.N - 1);
    const j = clamp(Math.round((z - BZ0) / bath.dz), 0, bath.N - 1);
    return bath.dist[j * bath.N + i];
  }

  function setTargets(sceneTex, depthTex, w, h) {
    uniforms.tScene.value = sceneTex;
    uniforms.tDepth.value = depthTex;
    uniforms.uRes.value.set(w, h);
  }

  return { group, mesh, update, shoreDist, setTargets, uniforms };
}
