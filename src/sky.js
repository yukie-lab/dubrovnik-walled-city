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
  // 太陽の色は「大気を通ってきた結果」であって、手で置いた三色の補間ではない。
  // 二段の HSL 補間では warm が am 6.85(el 7.5°)で頭打ちになり、そこから
  // 日没までの 40 分が同じ色で凍る。到達点の sunGold 自体が B/R 0.589 ≒ 3900K で、
  // それ以上暖かくなれなかった(実測 t3gold で B/R 0.496 = 約 3300K。
  // 実在の el 4.7°・am 10.9 の太陽は 2855K で B/R 0.119)。
  //
  // 波長別 Beer–Lambert に置き換える。Rayleigh(Bodhaine)+ 海洋性エアロゾル
  // (Ångström AOD550=0.10)+ オゾン(Chappuis 0.32cm)で 5772K の黒体を減衰させ、
  // CIE 1931 で積分して sRGB リニアへ落とした結果に、1% 以内で一致する二定数:
  //   τ_G − τ_R = 0.058 / τ_B − τ_R = 0.215(am 1 あたり)
  // 検算: am 2.82 → B/R 0.676(分光の真値 0.696) / am 10.93 → 0.118(真値 0.119)。
  //
  // **色度だけを持たせ、輝度は sunIntensity に任せる**(輝度 1 に正規化)。
  // 以前は色の暗さが二つ目の減衰として効き、黄金時間の直射を 0.62 倍していた。
  // am は Kasten–Young なので el < 0 で単調性を失う(el −14° で 0.30)。
  // dAM を max(0, …) で守らないと、夜に太陽が青くなる。
  const dAM = Math.max(0, am - 1);
  const sunCol = new THREE.Color(1, Math.exp(-0.058 * dAM), Math.exp(-0.215 * dAM));
  {
    const yq = 0.2126 * sunCol.r + 0.7152 * sunCol.g + 0.0722 * sunCol.b;
    sunCol.multiplyScalar((1 - night * 0.95) / Math.max(yq, 1e-4));
  }
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
  // **天空の明るさは太陽高度そのもの。** 晴天の全天拡散照度は sin(el) にほぼ比例する
  // (ASHRAE の晴天モデルで el 61°:20.6°:4.7° = 1 : 0.40 : 0.10)。
  // これまで高度追随は hemiSky にだけ pow(sin el, 0.45) で掛かっており、
  // IBL と天蓋は満額のままだった。黄金時間には IBL が半球光の 2.66 倍になり、
  // **影を落とさない第二の太陽**として立面の日向:日陰を 2.73:1 に潰していた
  // (実在は 11.7:1)。三経路が同じ空を別の明るさで数えないよう、
  // 高度追随は色そのものに一度だけ掛ける。
  // 床 0.085 は市民薄明の残光(日没時の天空はまだ正午の 1/12 ある)。
  const skyLevel = Math.max(0.085, Math.max(Math.sin(elR), 0));
  // 天頂の青は高度追随の対象。**水平線の焼けは対象外** — 日没の水平線は
  // その瞬間の空で最も明るい部分で、正午の天頂と同程度の輝度がある。
  // 焼けの重みは dusk(高度の窓)ではなく warm(大気路程)で駆動する。
  // dusk は「日没後に天頂が菫になる」ほうの仕事だけを残す(sky.js の下)。
  const violet = smoothstep(2, -8, el);        // 地球影とヴィーナスベルト — 日没後に始まる
  const zenith = new THREE.Color().setHSL(0.632, lerp(0.74, 0.86, hi), lerp(0.222, 0.160, hi))
    .multiplyScalar(skyLevel)
    .lerp(new THREE.Color().setHSL(0.68, 0.45, 0.16).multiplyScalar(Math.max(skyLevel, 0.12)), violet);
  const horizon = new THREE.Color().setHSL(0.600, lerp(0.62, 0.72, hi), lerp(0.420, 0.330, hi))
    .multiplyScalar(skyLevel)
    // 実在の日没の水平線は 2000〜2500K で、彩度 0.68 明度 0.55 では
    // AgX を通ると彩度 0.06 の淡いピンクに潰れる。色度をもっと深くする。
    // 焼けにも部分的な高度追随を掛ける。実在の日没の水平線は正午の水平線の
    // 0.6〜0.8 倍で、**上回ることはない**。skyLevel をそのまま掛けると 0.34 倍まで
    // 落ちて焼けが消えるので、床 0.42 を与える。
    .lerp(new THREE.Color().setHSL(0.062, 0.86, 0.42)
      .multiplyScalar(Math.max(skyLevel, 0.42)), warm);
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
  // 半球光は方位を持てない = 天球の**平均**でなければならない。太陽側の焼けた
  // 水平線(horizon)だけを混ぜると、日没に「日陰まで橙」になる(実測 影の B/R 0.35)。
  // 実在の夕方の日陰が青いのは、日陰の壁が見ているのが反太陽側の空だから。
  // 方位の差は IBL(light.js の env 球)が担い、半球光は環の平均を担う。
  const horizonRing = horizon.clone().lerp(horizonFar, 0.65);
  const hemiSky = zenith.clone().lerp(horizonRing, lerp(0.42, 0.14, dusk))
    .lerp(new THREE.Color(0xd9c49c), 0.03 + 0.03 * smoothstep(10, 55, el))
    // 重み 0.05 では実測 B/R が 3.53 にしかならず(目標は 1.8)、青すぎる天空光を
    // urbanTint と bounceRad の暖色で打ち消す構造になっていた。打ち消し量が
    // 空可視率で変わるので、影の色相が場所ごとに 150°(緑)〜237°(青)に暴れる。
    // 0.30 で B/R 1.88 = 正規化 (0.53, 0.75, 1.00)。実在の昼光 (0.62, 0.78, 1.00) に一致。
    // 中和 0.30 だと分光比 (1,1.39,1.86) までしか青くならず、実測の日陰は
    // 色相 61〜186°(緑〜無彩)。実在のアドリア海の日陰が青いのは、開けた
    // 天空の相関色温度が 12,000〜16,000K あるから。緑を落として青を通す。
    // 中和 0.22 は天空光の R を 2.19 倍にし、リニアで B/R 4.52 → 2.19 まで
    // 削っていた。AgX はさらに彩度の高い青を中和するので、画面に出る落ち影の
    // B/R は 0.835 = **昼の影が青くない**。光源側で振っておかないと出ない。
    .lerp(new THREE.Color(0xbfc6cc), 0.09 * (1 - dusk * 0.70))
    // 高度追随は zenith/horizon に掛かった(上)。ここで二度掛けない。
    .multiplyScalar(lerp(1.0, 1.05, dusk) * (1 - night * 0.80) + night * 0.46);   // 日没時の空全体は暗くならない(水平線が燃えるぶん明るい)
  // 夜は天頂が真っ暗(sRGB 10,16,38)なので、掛け算だけでは環境光がゼロになる。
  // 街灯だけで照らされた街は、灯の届かない所が「穴」になって奥行きが消える。
  // 空の残光と街の照り返しを、はっきりした青の底として与える。
  if (night > 0) hemiSky.lerp(new THREE.Color(0x2c3c5e), night * 0.96);
  // 地面バウンスは半球光の「下半分」ではなく、別の照り返しライトが担う。
  // ここを暖褐色にすると、垂直面の日陰が全時刻で暖色に固定される。
  // 夜に地面色が空色の 3 倍あると上下が逆転する(無照明の石畳が空より明るい)
  // 地面バウンス = 地面のアルベド × その時刻に地面が受けた放射照度 / π。
  // 以前は dusk/night のランプで駆動していたので、水平面の直射が正午の 1/55 に
  // 落ちる黄金時間でも 0.55 倍にしか落ちなかった。結果、**昼の全時刻で半球光の
  // 下半分が上半分より明るく**(1.12〜1.89 倍)、日陰の垂直面は輝度の 65% を
  // 暖色から受け、光と影の色相差が 2° に潰れていた。
  // 正午の実測値(0.281)を固定点にする — いま最も正しい t2noon の絵は動かさない。
  const GHI_NOON = 16.5;                          // 正午の水平面全天照度(直射 15.36 + 天空 1.11)
  const skyHorizE = (0.2126 * hemiSky.r + 0.7152 * hemiSky.g + 0.0722 * hemiSky.b) * 4.4;
  // 夜は太陽ではなく街灯が地面を照らす。ここを 0 にすると夜の軒下が穴になる。
  const ghi = sunIntensity * Math.max(Math.sin(elR), 0) + skyHorizE + night * 0.55;
  const dirF = clamp(sunIntensity * Math.max(Math.sin(elR), 0) / Math.max(ghi, 1e-4), 0, 1);
  // 地面を照らしている光の色度(直射と天空の混合)。日没には橙、正午には白に近い。
  const groundLit = sunCol.clone().multiplyScalar(dirF)
    .add(hemiSky.clone().multiplyScalar(1 - dirF));
  const glY = 0.2126 * groundLit.r + 0.7152 * groundLit.g + 0.0722 * groundLit.b;
  if (glY > 1e-5) groundLit.multiplyScalar(1 / glY);
  const hemiGround = groundLit
    .multiply(new THREE.Color(0.62, 0.545, 0.455))   // 石灰岩とテラコッタの平均アルベド
    .multiplyScalar(0.281 / 0.545 * clamp(ghi / GHI_NOON, 0, 1));

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
  // 霧色は二色になった(方位依存)。太陽側 = horizon、反対側 = horizonFar。
  // 天頂を昼にも 0.28 混ぜる — 遠景が実際に載る仰角(+6°、h=0.10)では
  // 天蓋の horizW = pow(1-0.10, 3.2) = 0.717 で、天頂が 28% を占める。
  // 昼の天頂重みが 0.0 だったので、1.5km 先の山が **その上の空より 38% 明るい**
  // という逆転が起きていた(散乱光が空の放射輝度を上回ることはない)。
  const fogMix = lerp(0.28, 0.72, night);
  const fogCol = horizon.clone().lerp(zenith, fogMix).multiplyScalar(SKY_GAIN);
  const fogFar = horizonFar.clone().lerp(zenith, fogMix).multiplyScalar(SKY_GAIN);
  const warmK = warm;

  return {
    time: t, el, az, dir, dusk, night, glow,
    sunCol, sunIntensity, zenith, horizon, horizonFar, hemiSky, hemiGround, fogCol, fogFar, warm: warmK, am,
    ghi,                       // 水平面の全天照度 — 露出の測光はこれで行う
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
  // 位相関数と水平線の無彩化は天蓋と同じにする。映り込みが元と違う形をしていたら、
  // それは水平線で必ず段になって出る(海/空 0.95 はキャンペーン中で最も薄い関係)。
  // 位相関数は「その方向の空の放射輝度」そのものの性質なので、映り込みにも要る。
  // 一方、水平線の無彩化と逆転層の蓋は **観測者から水平線までの長い水平経路**
  // の効果で、反射線にまで掛けると二重計上になる(実測: 掛けたところ海の
  // B/R が 2.073 → 1.936 に動き、保護対象の海を動かしてしまった)。天蓋だけに置く。
  float ph = mix(1.0, 0.75 * (1.0 + sunAmt * sunAmt), 0.40 * pow(1.0 - horizW, 3.0));
  vec3 col = mix(zen * ph, horiz, horizW);
  float disc = smoothstep(0.99996, 0.999985, sunAmt);
  // 暈の裾 pow(...,34) は半値角 10.6° の巨大な光の輪。逆光のストラドゥンで
  // 画面の 11.2% を「Y>0.75 かつ彩度<0.06」の無彩の白にしていた。
  // 実在の太陽の光冠は 2〜3°。円盤(disc)は残す — 太陽を直接見た画素が
  // 白いのは正しい。裾だけを締める。
  // 裾は天蓋と同じく「暖色への混色」。ここは唯一の呼び出し元 sea.js:292 が
  // sunK=0 を渡すので現状どの画素にも出ないが、写しが食い違ったままにはしない。
  float sA = clamp(sunAmt, 0.0, 1.0);
  col = mix(col, col * 0.55 + sunCol * 0.42, pow(sA, 34.0) * (0.35 + dusk * 0.55) * sunK);
  col += sunCol * (pow(sA, 140.0) * 5.0 * (0.5 + dusk * 1.2) + disc * mix(600.0, 46.0, dusk)) * sunK;
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
uniform float uDusk, uNight, uStarAlpha, uTime, uSunEl, uHour, uClear;

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
  // 単一散乱の位相関数。同じ仰角でも、太陽から 30° と 100° では実在の空の
  // 輝度が 3〜4 倍違う。それが「空が丸い」ことを見せている当のもの。
  // これが無いので、仰角 40〜84° の空は全方位で 0.3 L* しか変わらない
  // = 天頂から 40° までが物理的に一枚の色見本だった。
  // (1+cos^2) の球面平均は 4/3。0.75 を掛けて **総量は 1 のまま** 分配だけ変える。
  // 強さは上限ではなく安全弁 — 1.0 にすると太陽から 90° の空が 25% 暗くなり、
  // 山/空 0.96(v4_srd 正午)が 1.0 を跨いで第4パスの成果が折れる。
  // 仰角で立ち上げる。欠陥が実測されたのは天頂(仰角 40° と 84° で 0.3 L*、
  // 弁別閾の 1/3 = 空の上半分が物理的に一枚の色見本)であって低空ではない。
  // 物理でもある:大気路程が長い水平線方向では多重散乱が位相関数を等方に均すので、
  // 単一散乱の非対称は天頂ほど強く出る(効きは経路長に対して超線形)。
  // 一次で掛けると仰角 13〜21.5° の空が 3.6% 暗くなり、第4パスが 1.41 → 0.96 まで
  // 詰めた「山/空」(v4_srd 正午)が 1.00 を跨ぐ。三乗ならそこは 1% で済む。
  float ph = mix(1.0, 0.75 * (1.0 + sunAmt * sunAmt), 0.40 * pow(1.0 - horizW, 3.0));
  vec3 col = mix(uZenith * ph, horiz, horizW);

  // 塗られた大気: 低周波の筆むら(彩度と明度がわずかに揺れる)
  // atan(d.x, d.z) は方位 180°(±π)で値が 2π 飛ぶ。それを直接 noise に
  // 渡していたので、空にまっすぐな縦の継ぎ目が一本走っていた
  // (夜ほど目立つ — 露出が上がって ±3.7% の段差が読めるようになる)。
  // 方位を「円周上の点」として渡せば周期性が保たれ、切れ目そのものが消える。
  // 半径に高度を混ぜると、高さ方向にも模様が変わる。
  // 大気の不均一は「水平に広く、垂直に薄い」— 境界層のエアロゾルは水平 15〜20°・
  // 垂直 4〜6° の層をなす。等方 (d*4.4) では支配周期が 13° になり、視野が
  // 12〜18° しかない路地と広場の空の帯では **その成分がまるごと直流になって消える**。
  // 実測 resid: v8_luza_t2noon 0.774 / v1_stradun_t2noon 0.757(弁別閾 1 L* 未満)。
  // **時刻でも流す。** uTime(実時間の elapsed)だけで動かしていたので、
  // 時計を進めても絵具の配置が 1 画素も動かなかった(色だけが変わる)。
  // ユーザー報告「時間を変えても背景が変わらない」。大気の不均一は風で流れる
  // 物で、3m/s なら 1 時間に 11km 動く — 一時間ごとに別の空になるのが正しい。
  // 流すのは **水平**(x, z = 風向)。y は仰角の軸で、そこを流すと空が
  // 上下に滑る。斜めの風にして、模様が同じ形で往復しないようにする。
  vec3 brushP = d * vec3(3.4, 13.0, 3.4)
    + vec3(uHour * 0.55, uTime * 0.012, uHour * 0.21);
  float brushK = smoothstep(0.97, 0.70, d.y);
  float brush = fbm3(brushP);
  float fine  = fbm3(brushP * 3.1 + 7.7);
  // 加算のむらは「絶対量」だった。空のゲイン前輝度は天頂で 0.090(正午)→
  // 0.0007(夜)と 130 倍動くので、同じ 0.022 が ±12% → ±950% に化けていた。
  // 夜空一面の灰色の斑(レンズの汚れに見えるもの)はこれ。比例させれば時刻に
  // よらず同じ強さの筆になり、mix(1.0,0.32,uNight) の逃げも要らなくなる。
  float mK = ((brush - 0.5) * 0.62 + (fine - 0.5) * 0.38) * 0.115 * brushK;

  // 靄の層。振幅の小さい平滑な noise は、どれだけ足しても弁別閾に届かない。
  // 絵具になるには **縁** が要る。閾値で層を切り出し、明るい側と暗い側を
  // 同じ幅の smoothstep で対にする — fbm3 は 0.5 を中心にほぼ対称なので、
  // (up - dn) の平均は構造的にゼロ。空の平均輝度は動かない(山/空・海/空を守る)。
  float ci = brush * 0.62 + fine * 0.38;
  float gate = smoothstep(0.05, 0.30, d.y);          // 水平線帯には触れない
  float up = smoothstep(0.50, 0.70, ci);
  float dn = smoothstep(0.50, 0.30, ci);
  // 層は色度が抜ける(多重散乱で白む)。ただし白ませるだけだと空の平均彩度が
  // 下がり、山と空の色相差(v4_srd 正午で 0.72)が痩せる。層の切れ間では逆に
  // 混合係数を負にして色度を伸ばす — mix の外挿。輝度は t に依らず保存される
  // (自分の輝度への混合なので (1-t)Y + tY = Y)。彩度も平均でゼロ和になる。
  mK += (up - dn) * 0.34 * gate;
  // **晴天の窓。** ブラ(北東の風)が抜けたあとのアドリアは、雲も靄の層も
  // 残さず澄む。uClear は 0(いつもの空)→ 1(洗った空)で、筆むらも層も
  // まるごと引く。じわじわ効かせるのは JS 側(smoothstep で 1.5 時間かける)。
  mK *= 1.0 - uClear;
  col *= 1.0 + mK;
  // AgX は明るい画素ほど彩度を落とす。筆と靄の層で持ち上げた画素はそのぶん
  // 色度が抜け、空クラスの平均 B/R が下がって、水平線で海と空の色相差が痩せる
  // (実測 v3_roofs 正午で 1.794 → 1.704)。持ち上げた量に比例して色度を先に
  // 伸ばして相殺する。混合係数が負の外挿でも、自分の輝度まわりなので
  // 輝度は厳密に保存される((1-t)Y + tY = Y)。暗くした側は AgX が彩度を
  // 落とさないので触らない。
  col = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), -max(mK, 0.0) * 1.50);

  // 水平線の無彩化と、沈降逆転の蓋。
  // 実測 C*(0)/C*(30) = 0.63。八月のアドリア海(視程 20〜40km)は多重散乱で
  // 水平線がほぼ無彩に抜け、この比は 0.30〜0.40。いまは水平線が濃すぎる。
  // 無彩化は自分の輝度への混合なので、ここでも明度は動かない。
  float wash = smoothstep(0.105, 0.0, d.y);          // 仰角 6° → 0°
  col = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), wash * 0.32);
  // 海洋境界層の上端(1100m、17.5km 先 = 仰角 3.6°)。実在の水平線が持つ、
  // 0.8° でぼけた一段。単調な pow ではこの段は原理的に作れない。
  col *= mix(1.0, 1.045, smoothstep(0.077, 0.052, d.y));

  // 地球影とヴィーナスベルト。日没直後、**反太陽側の低空** に二段が立つ:
  // 下が地球の影(青灰の一段暗い帯)、その上が桃色の帯。天頂ではない。
  // sunState の violet(sky.js:93)は天頂に掛かっていて、しかも t3gold(el+4.7)
  // では smoothstep が 0、t4dusk(el-14.3)では night=1 の上書きで消えるので、
  // 定点のどこでも一度も効いていない。影の上端の仰角 ≒ 太陽の伏角。
  // 窓は el -2°〜-8°(19:55〜20:25)。四つの定点時刻ではすべて厳密に 0 なので、
  // 採点表のどの数字も動かさない — 歩いている人だけが見る。
  float win = smoothstep(2.0, -1.0, uSunEl) * (1.0 - smoothstep(-6.0, -11.0, uSunEl));
  if (win > 0.001) {
    float anti = clamp(-sunAmt, 0.0, 1.0);
    float elDeg = degrees(asin(clamp(d.y, -1.0, 1.0)));
    float top = -uSunEl;
    float sh = 1.0 - smoothstep(top - 1.5, top + 1.5, elDeg);
    float belt = smoothstep(top - 1.5, top + 1.5, elDeg) * (1.0 - smoothstep(top + 7.0, top + 16.0, elDeg));
    col = mix(col, col * 0.62, sh * anti * win);
    col += vec3(0.055, 0.017, 0.026) * belt * anti * win;
  }

  // 太陽の暈と光芒
  // 実視直径 0.53°。radiance 2.6 では日向の石より少し明るいだけで、
  // 画面に一度も白が生まれない。空はシーンで最も明るい面であるべき。
  float disc = smoothstep(0.99996, 0.999985, sunAmt);
  // pow(cosθ,34) の半値角は 11.5°。実在の太陽の光冠は 2〜3° なのに、
  // 直径 27° の白い輪が空に乗っていた。07:54 で画面の 29% を占める空が
  // 「石灰岩と同じ明るさで、しかも B/R 1.10 = ほぼ無彩」になっていた原因。
  // 裾は **加算の白をやめ、暖色への混色にする** — 空の色を消さずに焼ける。
  float sA = clamp(sunAmt, 0.0, 1.0);
  // 実在の太陽の光冠は半値角 2〜3°。pow(cosθ,140) は 5.7° を振幅 5.0 で加算し、
  // その外を pow(cosθ,34) = 半値角 11.5° が 0.55 で覆っていたので、暈は
  // **直径 27°** あった。07:54 の空(画面の 29%)が日向の石灰岩と同じ明るさで、
  // しかも B/R 1.10 = ほぼ無彩の白い穴になっていたのはこれ。
  float aur = pow(sA, 900.0) * 3.2;                  // 半値角 2.25°
  // ただし大気路程が伸びる薄暮には、実際に暈は大きく広がる。広い裾は uDusk の
  // 窓に閉じ込め、昼は狭い核だけ残す。加算の白ではなく暖色への混色にすることで、
  // 焼けても空の色度が消えない。
  float veil = pow(sA, 34.0) * uDusk * uDusk;
  col = mix(col, col * 0.55 + uSunCol * 0.42, clamp(veil * 0.85, 0.0, 1.0));
  // 地平の太陽は R だけが飽和して赤橙になる。600 のままだと 3ch とも振り切れ、
  // 沈む太陽が白い円盤になって色を失う。
  col += uSunCol * (aur * (0.5 + uDusk * 1.2) + disc * mix(600.0, 46.0, uDusk));

  // 沈んだ太陽の残照(地平線に琥珀の帯)
  float ember = pow(clamp(sunAmt * 0.5 + 0.5, 0.0, 1.0), 7.0) * horizW * uDusk;
  col += uSunCol * ember * 0.5;

  // 星(薄暮から)
  // d.xz/(d.y+0.35) は水平線に近づくほどセルを圧縮するので、立体角あたりの
  // セル数が増える。実測 1000deg² あたり 低空 18 個 / 天頂 3 個 — 実在とは
  // 上下が逆で、しかも天頂が 6 倍足りない(航海薄明の限界等級 4.5 等 = 約 19 個、
  // 大気減光で低空はその半分以下)。方向ベクトルの 3 次元格子なら立体角一様。
  if (uStarAlpha > 0.002 && d.y > 0.02) {
    vec3 ci = floor(d * 58.0);                        // セル ≒ 0.99°
    float sel = hash3(ci + 11.3);
    if (sel > 0.9835) {                               // 1.65% ≒ 17 個/1000deg²
      vec3 jit = vec3(hash3(ci + 3.1), hash3(ci + 5.9), hash3(ci + 7.7)) - 0.5;
      vec3 ctr = normalize((ci + 0.5 + jit * 0.75) / 58.0);
      // 等級分布 N(<m) ∝ 10^(0.44m)。べき 2.6 で「たまに明るいのが混じる」。
      float mag = pow(hash3(ci + 23.7), 2.6);
      // 大気減光 τ=0.28/気柱。低空の星は暗く、数も減って見える。
      float ext = exp(-0.28 * (1.0 / max(d.y, 0.09) - 1.0));
      float rad = mix(0.00055, 0.00170, mag);
      float star = smoothstep(rad, 0.0, length(d - ctr)) * mix(0.22, 1.0, mag) * ext;
      col += vec3(0.9, 0.94, 1.0) * star * uStarAlpha * (0.72 + 0.28 * sin(uTime * 2.0 + sel * 40.0));
    }
  }
  col *= uSkyGain;      // 空は HDR。ここを 1.0 のままにすると空が街より暗くなる
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------- 雲 ----
const CLOUD_VERT = /* glsl */`
attribute vec4 aRect;      // アトラスUV(x,y,w,h)。w<0 で左右反転
attribute float aShade;
attribute float aRot;      // 板の傾き(±8°)。同じ判子が水平のまま並ぶのを崩す
uniform vec3 uSunDir; uniform float uFogD;
varying vec2 vUv; varying float vShade; varying vec3 vWorld;
varying vec2 vSun, vLocal; varying float vFog;
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
  float cr = cos(aRot), sr = sin(aRot);
  vec2 pr = vec2(position.x * cr - position.y * sr, position.x * sr + position.y * cr);
  vLocal = pr;                                  // -0.5 … +0.5
  // 板の中での太陽の向き。ビルボードは Y 軸まわりにしか回らないので、
  // 板の右方向 right と world up の 2 成分だけで太陽を表せる。
  vSun = normalize(vec2(dot(uSunDir, right), uSunDir.y) + vec2(1e-6));
  vec3 wp = c.xyz + right * pr.x * sx + up * pr.y * sy;
  vWorld = wp;
  // 空気遠近。FogExp2 と同じ式・同じ密度を使う — 別の値を入れると、
  // 同じ距離で山と雲が食い違う(山/空 0.96 の余裕では即座に露見する)。
  float dz = length(cameraPosition - wp) * uFogD;
  vFog = 1.0 - exp(-dz * dz);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const CLOUD_FRAG = /* glsl */`
varying vec2 vUv; varying float vShade; varying vec3 vWorld;
varying vec2 vSun, vLocal; varying float vFog;
uniform sampler2D uTex;
uniform vec3 uLit, uShadow, uSunDir, uSunCol, uHaze, uHazeFar;
uniform float uOpacity, uDusk;
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
  // アトラスの t.r は「上から照らされた雲」を焼き込んだ上下ランプ。太陽高度
  // 4.7° の黄金時間にそれを使うと、頂が輝き腹が陰る = 実在と 12 倍逆さになる
  // (水平な雲頂が受ける放射照度は、太陽に正対する鉛直面の tan(4.7°)=0.082 倍)。
  // 板の中の太陽方向にそって陰影を付け直す。正午は太陽がほぼ真上なので lam は
  // 上下ランプとほぼ一致し、いまの絵(雲ΔL* 25.7)が保たれる。
  float dens = smoothstep(0.76, 1.0, t.r);      // アトラスは「厚み」として使う
  float lam  = dot(vSun, vLocal) * 2.0;
  // 足し算にすると、薄い縁(dens≈0)まで太陽側というだけで完全に照らされ、
  // 雲がまるごと白く飛ぶ(実測 正午の空クラスの Y が 5.0% 上がり、B/R が
  // 1.794 → 1.671 に落ちて水平線で海と空の色相差が痩せた)。掛け算にすれば、
  // 「太陽を向いていて、かつ光学的に厚い」ところだけが白くなる。
  float litF = smoothstep(-0.30, 0.35, lam) * (0.32 + 0.68 * dens);
  vec3 col = mix(uShadow, uLit, litF) * (0.92 + vShade * 0.16);
  // 逆光の銀の縁。薄い縁ほど光が抜ける。いま完全に無い。
  vec3 vd = normalize(vWorld - cameraPosition);
  float rim = smoothstep(0.55, 0.08, t.a) * pow(clamp(dot(vd, uSunDir), 0.0, 1.0), 6.0);
  col += uSunCol * rim * 1.6 * (0.25 + uDusk * 0.75);
  // 空気遠近。900m で 30%・2400m で 93% 霞むはずの雲だけが霧の外にいたので、
  // 遠近の違う板が同じ白で並び、雲の帯が「天井」に見えていた。
  // 色だけを沈める — アルファを霞ませると輪郭が痩せてシルエットが溶ける。
  // 係数 0.40。シーンの ρ は「1km で残存 54%」の様式化された近景の霞で、実在の
  // 八月のアドリア(視程 20〜40km)より一桁濃い。雲のいる 0.9〜3.4km では既に
  // 飽和しているので、全量掛けると遠い雲が消えて構図の奥行きがむしろ減る
  // (実測 t3gold 雲被覆 17.8% → 1.4%)。ρ は山と揃えたまま、量だけを絞る。
  col = mix(col, mix(uHazeFar, uHaze, smoothstep(-0.4, 0.9, dot(vd, uSunDir))), vFog * 0.40);
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
    uHour: { value: 12 }, uClear: { value: 0 },
    uSunEl: { value: 0 },
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
    uSunDir: skyUniforms.uSunDir,        // 天蓋と同じ参照 — 太陽は世界に一つ
    uSunCol: skyUniforms.uSunCol,
    uHaze: { value: new THREE.Color() }, uHazeFar: { value: new THREE.Color() },
    uDusk: { value: 0 }, uFogD: { value: 0.00072 },
  };
  // N は描画呼び出しに影響しない(InstancedMesh 1 個)。14 では、時刻で数を
  // 変えたときに海側・陸側・頭上のどれかが必ず空になる。仰角 7〜45°・全方位に
  // 散らすと一視点(画角 50〜54°)に入る枚数が減るので、実在の被覆率に届かせるには
  // 総数が要る。板 30 枚 = 120 頂点。
  const N = 30;
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
  const rots = new Float32Array(N);
  const cloudState = [];
  const dummy = new THREE.Object3D();
  for (let i = 0; i < N; i++) {
    // 方位。等間隔リング + (i%3)*0.35 では、旗竿(v8 ルジャ)や鐘楼(v1)の
    // 真後ろ・画面の中央縦線の上に毎回同じ雲が来る。黄金比の低食い違い列で散らし、
    // 陸側(北 = スルジの稜線)へ寄せる:八月の海面 25℃ の上の気層は安定で
    // 外海に積雲は立たず、海風が入ってから 412m の稜線の上に収束して並ぶ。
    // いまは逆で、v4_srd(北)が四時刻とも雲ゼロ、外海の v5_sea に 5〜6% ある。
    const u = (i * 0.6180339887 + 0.31) % 1;
    const wsym = Math.sign(u - 0.5) * Math.pow(Math.abs(u - 0.5) * 2, 1.15) * 0.5;
    const a = -Math.PI / 2 + wsym * Math.PI * 2;              // 北 = -π/2
    // r と y がどちらも i%4 / i%5 で回っていたので、14 枚すべてが仰角
    // 4.1〜39.5° の一本の環に収まり、路地から見上げるリボン(40〜60°)は
    // 四時刻とも完全に雲ゼロ、v5_sea では逆に全部が画面上端で切れていた。
    // 大きさ・距離・高度の相関を互いに素な周期で切る。
    const r0 = 900 + ((i * 3) % 5) * 620;
    const w0 = 380 + ((i * 7) % 4) * 190;
    // 縦横比 0.42〜0.54 は積雲を煎餅にする(塊ひとつが 2.3:1〜3.0:1)。puff は 1:1。
    const h0 = w0 * (0.62 + (i % 3) * 0.09);
    // **雲は地形より遠くになければならない。** 900m の雲は 412m のスルジより
    // 手前に立ち、板が稜線を貫いて「半透明の灰色の楔」を出していた
    // (ユーザー報告。実測 砲座から北で 9.46% の画素、最大の濃さ 171/255)。
    // ground.far は半径 2500m まであるので、その外へ出す。
    // **角度は変えない** — 距離・高度・大きさを同じ倍率で伸ばすので、
    // 空に見える位置も大きさも元のまま(第5パスの採点を動かさない)。
    const k0 = Math.max(1, 2600 / r0);
    const r = r0 * k0, w = w0 * k0, h = h0 * k0;
    // **高さは「雲底」で置く。中心で置いてはいけない。**
    // 中心 300m・縦 589m の雲は下端が y = −4 になり、板が地面まで伸びる。
    // 水平 900m の雲は 418m のスルジの稜線より **手前** に立つので、
    // 深度で切られた断面が「半透明の灰色の楔」として山と海の上に出る
    // (ユーザー報告。実測 砲座から北で画面の 9.46%、最大の濃さ 171/255)。
    // 地形の最高点は 418m(スルジの十字架)。真夏のダルマチア海岸の積雲の
    // 雲底は 900〜1500m で、そもそもこの高さが物理的に正しい。
    // 雲底が地形の最高点(418m = スルジの十字架)より上に来るまで持ち上げる。
    // 高い雲はそのまま = 空の配置(第5パスの採点)をできるだけ動かさない。
    // 高度も同じ倍率。仰角 atan(y/r) が元と一致する。
    // そのうえで海面に刺さらないよう、雲底だけ 40m を下限にする。
    const y = Math.max((300 + ((i * 5) % 7) * 155) * k0, h / 2 + 40);
    cloudState.push({ a, r, y, w, h, speed: 0.0016 + (i % 3) * 0.0009 });
    // アトラス 4 セルを周期 4 で回していたので、同じ輪郭が画面に 3〜4 回出る。
    // 幅に負号を許して左右反転させれば、テクスチャ 1024² のまま 8 通りになる。
    const mir = (i % 3 === 0) ? -1 : 1;
    const cell = (i * 3) % 4;
    rects[i * 4] = (cell % 2) * 0.5 + (mir < 0 ? 0.5 : 0);
    rects[i * 4 + 1] = ((cell >> 1) % 2) * 0.5;
    rects[i * 4 + 2] = 0.5 * mir; rects[i * 4 + 3] = 0.5;
    shades[i] = (i % 5) / 5;
    rots[i] = (((i * 13) % 7) - 3) * 0.045;                   // ±7.7°
  }
  cGeo.setAttribute('aRect', new THREE.InstancedBufferAttribute(rects, 4));
  cGeo.setAttribute('aShade', new THREE.InstancedBufferAttribute(shades, 1));
  cGeo.setAttribute('aRot', new THREE.InstancedBufferAttribute(rots, 1));
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
    skyUniforms.uSunEl.value = sun.el;
    skyUniforms.uTime.value = elapsed;
    const hourNow = sun.time ?? 12;
    skyUniforms.uHour.value = hourNow;
    // 晴天の窓。**キャンペーンの四定点(7.90 / 12.87 / 19.30 / 21.20)を跨がない。**
    // 13:06 から 1.5 時間かけて澄み、14:36〜17:36 は雲ひとつ絵具ひとつ無く、
    // 17:36 から 1.4 時間かけて戻る(19:00 には元通り = t3gold に掛からない)。
    const clearNow = smoothstep(13.1, 14.6, hourNow) * (1 - smoothstep(17.6, 19.0, hourNow));
    skyUniforms.uClear.value = clearNow;

    // 雲の色: 昼は白/灰青、夕は上面が琥珀・底が灰紫、夜は沈黙
    // 空は uSkyGain 倍で描かれるのに、雲はその係数を掛けずに 0.84 で頭打ちだった。
    // 逆光では「空より暗い雲」= 太陽の暈の上に灰色の楕円が数珠つなぎに浮く。
    // 日向の雲の頂は、日向の石灰岩(シーンリニア 3.4)と同じ明るさまで上げる。
    // sunCol は輝度 1 に正規化済みで、白との lerp も輝度 1 同士。だから lit の
    // 輝度は昼のあいだ **常に 4.03 で凍っていた** — 法線日射が正午の 0.30 倍
    // しかない 19:18 の雲(L*97.4)が、正午の雲(L*92.0)より明るくなる。
    // 実際に届いている直射に繋ぐ。指数 0.45 と定数は「正午で現行と一致する」
    // よう解いた(sunIntensity 18.19 で係数 1.000)。
    const litK = 0.03 + 0.97 * Math.pow(clamp(sun.sunIntensity / 18.19, 0, 1), 0.45);
    const lit = new THREE.Color().copy(sun.sunCol).lerp(new THREE.Color(1, 1, 1), 1 - sun.dusk * 0.75);
    lit.multiplyScalar(SKY_GAIN * 1.55 * litK);
    // 雲の底は下半球しか見ていない面。照らしているのは天空光と地面の照り返しで、
    // 太陽ではない。定数の明るい灰 (0.42,0.45,0.55) を 0.35 で混ぜ、さらに
    // (1-night*0.8) の床 0.20 を残していたので、天頂がどれだけ暗くなっても
    // 雲底は中明度から下がらず、航海薄明に雲が空の 4.6 倍・街灯に照らされた
    // 石灰岩の 5.6 倍明るい白い板になっていた。正午でも雲の最暗部(p5 63.6)が
    // 同じ帯の空(p50 62.4)を上回り、**雲のどこにも空より暗い場所が無い**。
    // 0.20 は「正午の雲底 2500cd/m² 対 仰角 20° の空 7000cd/m² = 0.36」から。
    const shadow = sun.hemiSky.clone().multiplyScalar(0.55)
      .add(sun.hemiGround.clone().multiplyScalar(0.45))
      .multiplyScalar(SKY_GAIN * 0.20 * (1 - sun.night * 0.55));
    cloudUniforms.uLit.value.copy(lit);
    cloudUniforms.uShadow.value.copy(shadow);
    // 光学的に厚いものが空を隠す。薄めても、空より明るいうちは空に近づくだけだった。
    cloudUniforms.uOpacity.value = 0.94;
    cloudUniforms.uHaze.value.copy(sun.fogCol);
    cloudUniforms.uHazeFar.value.copy(sun.fogFar);
    cloudUniforms.uDusk.value = sun.dusk;
    // light.js:282 と同一の式・同一の定数。別の値を入れると同じ距離で山と雲が食い違う。
    cloudUniforms.uFogD.value = lerp(0.00062, 0.00072, sun.dusk * (1 - sun.night)) * lerp(1, 0.72, sun.night);

    // 積雲は海陸風の熱対流。日射の **積算** に遅れて立ち上がり、日没前に崩れる。
    // 太陽高度で駆動すると朝夕が対称になり、いま正しい t3gold の逆光が崩れるので、
    // 必ず時刻で駆動する。08:36 に立ち上がり 13:30 前後で最大、20:48 に消える。
    // これが無いので、四時刻の雲は画素単位で同じ配置・同じ被覆率だった
    // (SHOT では elapsed が 40 に固定されるので位相も完全に一致する)。
    const conv = 0.10 + 0.90 * Math.pow(Math.max(0, Math.sin(Math.PI * clamp((sun.time - 8.0) / 14.0, 0, 1))), 1.0);
    // 活性の数は **丸めない**。整数で切ると 1 枚が丸ごと消える瞬間があり、
    // 30 枚を数分で引くあいだ「ぽん、ぽん」と抜けて見える。境目の 1 枚だけを
    // 連続に痩せさせれば、積雲が順に蒸発していくように消える。
    // 晴天の窓(clearNow)もここに掛ける — 数だけを引き、残る雲の大きさは
    // そのまま(全部が一斉に縮むと「引いた」ではなく「遠のいた」に見える)。
    const thr = lerp(3, N, conv) * (1 - clearNow);   // 実数のまま
    const grow = lerp(0.66, 1.0, conv);              // Cu humilis → mediocris
    for (let i = 0; i < N; i++) {
      const s = cloudState[i];
      const a = s.a + elapsed * s.speed;
      dummy.position.set(Math.cos(a) * s.r + camPos.x * 0.7, s.y, Math.sin(a) * s.r + camPos.z * 0.7);
      // 非活性は面積ゼロ。InstancedMesh なので描画呼び出しは 1 のまま動かない。
      // 境目の 1 枚は thr の小数部だけ痩せる = 連続に消える。
      const k = grow * clamp(thr - i, 0, 1);
      dummy.scale.set(s.w * k, s.h * k, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      clouds.setMatrixAt(i, dummy.matrix);
    }
    clouds.instanceMatrix.needsUpdate = true;
    dome.position.copy(camPos);
  }

  return { group, update };
}
