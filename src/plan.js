// ============================================================================
// plan.js — ドゥブロヴニク旧市街の都市計画(すべての幾何・衝突・ゾーンの真実源)
//
// 座標系: メートル。+X=東, +Z=南(海側), -Z=北(スルジ山側)。海面 y=0。
// ストラドゥンは z=0 を東西に走る(実物どおり水平・一直線)。
// 北側は急斜面の櫛状路地(プリイェコ通り・ペリネ通りが東西に横切る)、
// 南側は緩やかに海側城壁へ上る。城壁は全周を一筆で歩ける実ループ。
// ============================================================================
import { mulberry32, hash2, clamp, lerp, smoothstep, nearestOnPolyline, samplePolyline, polylineLength, pointInPoly, fbm2 } from './util.js';
import { rngFor } from './seed.js';

export { DEFAULT_SEED as SEED } from './seed.js';   // 種の唯一の源は seed.js

// 家体の基礎面は、立面の地面より意図的に 0.5m 下から始まる。地面がうねっても
// 壁の下に隙間を出さないため。検査もこの値を見る(検査が独自に推測すると、
// 「設計どおりの埋め込み」を欠陥として 581 棟ぶん報告する)。
export const HOUSE_BASE_BURY = 0.5;

// ロクルム島(南東の沖 — 松の緑が読める距離、けれど海峡は海)
export const LOKRUM = { x: 385, z: 465, rx: 150, rz: 95, rot: -0.32, h: 30 };
// 聖イヴァン要塞の上に載る一段高い砲座(カヴァリエ)。
// 稜堡の上に砲座を載せるのは実在の作りで、要塞にも上段のテラスがある。
// ここは「海を眺める場所」— 実測で、天端 17.4m に立つと目の前を塞ぐ石が
// 0% になる(歩廊の上では胸壁が必ず 22m 以内にあり、最小でも 17% 残る)。
// 要塞の天端は歩廊そのもの。中心に載せたら城壁の周回が切れた
// (route:walls 15 点で食い込み・歩廊 9 点で塞がり)。海側へ外して小さく置く。
export const CAVALIER = { x: 176.4, z: 57.8, r: 2.6, rMass: 2.8, y: 17.4, base: 14.6 };
// ロヴリイェナツの岩。実物はピレ門から約 120m 沖。位置は plan と surround で共有する。
// 実物は海から垂直に立つ岩。r 16 → cliff 30 では 14m の水平距離で 26m 落ちる =
// 勾配 62% の「丘」であって崖ではなく、要塞が丸いドームの上に載って見えた。
// 9m で 26m 落とす(71°)。取り付きの東面だけは 43% の斜面のまま残す。
export const LOVRIJENAC = { x: -248, z: 82, r: 16, cliff: 25, top: 26 };
// 要塞の岩へ続く海岸線。ピレの浜からぐるりと西へ回り込む。
const LOV_COAST = [[-192, 10], [-203, 27], [-213, 45], [-224, 61], [-236, 72]];
const LOV_RAMP_A = Math.atan2(58 - 82, -222 + 248);   // 岩の取り付きが向く方位(南東)   // 崖の遷移 7m は 3.2m 格子で 2 セル = 階段状になる

// ---------------------------------------------------------------- 地形 ----
// 北プロファイル(z<=0): ストラドゥンの谷から北壁へ急登。プリイェコに棚。
const NORTH_PROFILE = [
  [0, 2.6], [-8, 3.4], [-18, 5.4], [-30, 8.0], [-34, 8.9], [-38, 9.1], // プリイェコ棚
  [-48, 11.6], [-60, 14.6], [-70, 17.2], [-74, 18.2], [-82, 19.6], [-90, 20.6], [-110, 21.4],
];
// 南プロファイル(z>=0): 緩やかに上って海側城壁の台地へ。
const SOUTH_PROFILE = [
  [0, 2.6], [10, 3.3], [26, 4.5], [32, 4.9], [36, 5.1], [48, 6.8],
  [58, 8.2], [62, 8.5], [74, 10.0], [84, 11.1], [96, 11.9], [110, 12.2],
];

function sampleProfile(profile, z) {
  const zz = Math.abs(z) * (profile === NORTH_PROFILE ? 1 : 1);
  const arr = profile;
  const q = profile === NORTH_PROFILE ? -Math.abs(z) : Math.abs(z);
  for (let i = 1; i < arr.length; i++) {
    const a = arr[i - 1], b = arr[i];
    const inSeg = profile === NORTH_PROFILE ? (q <= a[0] && q >= b[0]) : (q >= a[0] && q <= b[0]);
    if (inSeg) {
      const t = (q - a[0]) / (b[0] - a[0]);
      return lerp(a[1], b[1], t);
    }
  }
  return arr[arr.length - 1][1];
}

// 市内の素の地形高。x で東西修正: 東(旧港側)は低く沈み、北西(ミンチェタ側)はさらに高い。
// スルジ山(遠景の主)と西のラパド丘陵
export function farHeight(x, z) {
  let h = -2.5;
  // スルジ: z<-160 から立ち上がる乾いた大斜面(頂 ~400m を絵画的に圧縮)
  if (z < -120) {
    const t = smoothstep(-150, -1050, z);
    const ridge = 1 - Math.abs(Math.sin(x * 0.0016 + Math.sin(x * 0.0007) * 1.7)) * 0.22;
    // 谷筋(ガリー)。単一のうねりだけだと、4.8km の視野に山の膨らみが
    // 1 個しか無く、平板な青いシルエットになる。42m 格子で解像できる
    // 波長 220〜420m の折れ谷を引く。
    const gully = Math.abs(fbm2(x * 0.0055, z * 0.0038) - 0.5) * 76 * t;
    h = Math.max(h, Math.pow(t, 1.35) * 345 * ridge + fbm2(x * 0.01, z * 0.01) * 26 * t
      - gully + smoothstep(-105, -300, z) * 46);
  }
  // 西の半島(ラパド)の低い丘
  if (x < -240) {
    const t = smoothstep(-260, -900, x);
    h = Math.max(h, t * 68 + fbm2(x * 0.02, z * 0.02) * 22 * t - smoothstep(-100, 260, z) * 30);
  }
  // 東の海岸山地。旧港の正面(x 300〜400)に低い陸を出すと、水平線の手前に
  // 黒い帯が立って海が塞がれる。立ち上がりは十分に遠くから。
  if (x > 360 && z < -40) {
    const t = smoothstep(400, 1100, x) * smoothstep(-20, -320, z);
    h = Math.max(h, t * 150 + fbm2(x * 0.015, z * 0.015) * 30 * t);
  }
  return h;
}

export function terrainHeight(x, z) {
  let h = z <= 0 ? sampleProfile(NORTH_PROFILE, z) : sampleProfile(SOUTH_PROFILE, z);
  if (z <= 0) {
    const westGain = 1 + 0.16 * smoothstep(30, -110, x);   // 北西へ盛り上がる
    const eastDrop = smoothstep(96, 148, x);                // 北東(プロチェ)へ下がる
    h = 2.6 + (h - 2.6) * westGain * (1 - 0.42 * eastDrop);
  } else {
    const eastDrop = smoothstep(100, 142, x);               // 南東(大聖堂・港)は低地
    h = 2.6 + (h - 2.6) * (1 - 0.72 * eastDrop);
    const westGain = 1 + 0.10 * smoothstep(-40, -130, x);
    h = 2.6 + (h - 2.6) * westGain;
  }
  return h;
}

// ---------------------------------------------------------------- 街路 ----
// kind: stradun | street | alley | port
// 東西の街路は棚に載って水平に近い。路地は斜面を階段で直登する。
function makeStreets() {
  const streets = [];
  const add = (id, kind, w, pts) => { streets.push({ id, kind, w, pts }); };

  add('stradun', 'stradun', 8.6, [[-152, 0], [140, 0]]);
  add('prijeko', 'street', 3.4, [[-136, -36], [120, -36]]);
  add('peline', 'street', 3.0, [[-122, -74], [116, -74]]);
  // x=118 で止める。ここから東は広場 'dome'(大聖堂前庭)が受け持つ。
  add('odpuca', 'street', 3.6, [[-140, 32], [118, 32]]);
  add('stross', 'street', 3.0, [[-116, 60], [98, 60]]);
  add('margarita', 'street', 2.8, [[-96, 84], [86, 84]]);
  // 旧港の岸壁(市壁の外側・港の内側)
  add('quay', 'port', 11.0, [[169, -46], [172, -12], [174, 16], [174, 50]]);

  // 北の路地の櫛(実物は Zlatarska, Žudioska … の平行な階段路地)
  const rng = rngFor(0x51de);
  const northXs = [];
  for (let x = -130; x <= 108; x += 14.2 + rng() * 3.4) northXs.push(Math.round(x * 10) / 10);
  northXs.forEach((x, i) => {
    const short = i % 5 === 3 || i === 0; // 数本はプリイェコ止まり。西端は城壁の懐なので短く。
    const w = 2.0 + rng() * 0.7;
    add(`alleyN${i}`, 'alley', w, [[x, -1.5], [x, short ? -36 : -74]]);
  });
  // 南の路地。1667 年の震災で全焼した **北側** は直交する階段路地の櫛
  // (定規で引いた街区)。焼け残った **南側**(プスティイェルナ、カシュテオ)は
  // 中世のままの不整形 — 曲がる、狭まる、行き止まる。この「北は規則・南は迷路」
  // の対比が、歩いていて自分がどこにいるか分かる仕組みそのもの。
  // 南も北と同じ等間隔の平行直線にしていたので、s04 と s16 が見分けられなかった。
  const southXs = [];
  for (let x = -123; x <= 100; x += 11.8 + rng() * 9.0) southXs.push(Math.round(x * 10) / 10);
  // 水平に敷かれた面(広場・大階段)を路地が横切ると、路地の段がその舗装の
  // 上に浮く。手前で止める。
  const clipAtFlat = (x, w, zEnd) => {
    let z = zEnd;
    for (const r of [JESUIT_STAIR, ...PLAZAS]) {
      if (r.z0 < 20) continue;                       // 南側の面だけ
      if (x < r.x0 - w / 2 - 0.6 || x > r.x1 + w / 2 + 0.6) continue;
      if (r.z0 - 1.5 < z) z = r.z0 - 1.5;
    }
    // 城壁の手前でも止める。突き当たると路地の舗装が壁体に潜り、足の解決が
    // 歩廊(14.6m)へ跳んで「床が 5m 食い違う」と鳴る(実測 48 点)。
    // makeStreets は壁が組まれる前に走るので、生の折れ線を使う。
    // 行き止まりの長さを乱数で振ったので、初めて壁に届く路地が出た。
    const raw = WALL_PATH_RAW.map(p2 => [p2[0], p2[1]]);
    for (let zz = z; zz > 20; zz -= 1.5) {
      if (nearestOnPolyline(raw, x, zz).d > 6.5) { z = Math.min(z, zz); break; }
    }
    return z;
  };
  southXs.forEach((x, i) => {
    // 行き止まりを増やし、止まる位置も揃えない
    const q = rng();
    const short = q < 0.34;
    const w = 1.62 + rng() * 0.72;                       // 北(2.0〜2.7)より狭い
    const zEnd = short ? 26 + rng() * 22 : (q < 0.67 ? 60 : 84);
    const zE = clipAtFlat(x, w, zEnd);
    // 途中で振れる(4 点の折れ線)。振れ幅は路地幅と同程度 — これ以上振ると
    // 家の帯を食い破る。groundAt / alleySamples / 庭塀は折れ線対応済み。
    const j1 = (rng() - 0.5) * 1.3, j2 = (rng() - 0.5) * 1.3;   // ±0.65m — これ以上振ると路地が家の帯を食う(piercetest で実測)
    const zA = lerp(1.5, zE, 0.34), zB = lerp(1.5, zE, 0.68);
    add(`alleyS${i}`, 'alley', w, zE - 1.5 < 18
      ? [[x, 1.5], [x, zE]]
      : [[x, 1.5], [x + j1, zA], [x + j1 + j2, zB], [x + j1 + j2, zE]]);
  });
  return { streets, northXs, southXs };
}

// 折れ線の路地の「ある z における中心 x」。streetY はモジュール直下なので、
// buildPlan の中の alleyXAt とは別にここにも要る(式は 1 つ — こちらが本体)。
function alleyXAt2(s, z) {
  const p3 = s.pts;
  for (let i = 1; i < p3.length; i++) {
    const z0 = p3[i - 1][1], z1 = p3[i][1];
    if (z0 !== z1 && (z - z0) * (z - z1) <= 0) return lerp(p3[i - 1][0], p3[i][0], (z - z0) / (z1 - z0));
  }
  return Math.abs(z - p3[0][1]) < Math.abs(z - p3[p3.length - 1][1]) ? p3[0][0] : p3[p3.length - 1][0];
}

// 街路の中心線上の高さ(街路はこの高さに舗装され、プレイヤーもこれに立つ)
export function streetY(street, x, z) {
  if (street.kind === 'stradun') return 2.6;
  if (street.kind === 'port') return 1.7;
  // 「両端の x が同じか」で路地を判定していた。南の路地を折れ線にした
  // 途端、曲がった路地が **東西街路と誤判定** され、床が z=1.5 の高さ
  // (ストラドゥンの 2.6m)に張り付いた。地形は 7.1m なので、家の帯の
  // 隙間に 4.5m の落とし穴ができる(trapstest が 3 箇所で鳴った)。
  // 種類は kind が持っている。座標から推測しない。
  if (street.kind === 'alley') {
    // 南北路地: 地形に従う(勾配→階段)。ただしストラドゥンの舗装帯(±4.3)に
    // かかる区間は大通りの高さに合わせる — でないと路地の段が大通りの上に浮く。
    // 路地の床は幅方向に **水平** でなければならない。横断勾配のある地面で
    // terrainHeight(x, z) を使うと床が横に傾き、両側の巾木が舗装に対して
    // 上下にずれる(grounding が +72 件)。中心線の高さを使う。
    const ay = terrainHeight(alleyXAt2(street, z), z);
    const m = smoothstep(4.3, 7.2, Math.abs(z));
    return lerp(2.6, ay, m);
  }
  // 東西街路: 棚の高さでほぼ水平(地形の棚に一致)
  return terrainHeight(x, street.pts[0][1]);
}

// -------------------------------------------------------------- 広場等 ----
const PLAZAS = [
  // polished: ストラドゥンと同じ磨き上げた石灰岩の続き。ルジャ・ピレ・オノフリオは
  // 実物でも通りの床がそのまま広がった一枚の面で、七百年ぶんの靴で照る。
  // 残り(グンドリッチ・大聖堂まわり・イエズス会)は摩耗した不規則な敷石で正しい。
  // ルジャだけを磨いた床にする。ピレ門内とオノフリオも実物は通りの床の続きだが、
  // **カメラのすぐ足元が一枚の鏡になる**ので、逆光の朝に「無彩の白」が
  // 7.4% → 11.0% へ増え、第1パス(光)の保護値を割った。石の側の手
  // (アルベドを下げる・磨きの帯を弱める・鏡面の丈を比を保って切る)を
  // 三つ試したが 11.0% は動かなかった(拡散ではなく掠め角のフレネル)。
  // 磨きを弱めて全部を敷くより、いちばん効いた一枚を残すほうを採る。
  { id: 'luza', x0: 124, x1: 156, z0: -16, z1: 16, y: 2.6, polished: true },    // ルジャ広場(鐘楼前)
  { id: 'pile', x0: -160, x1: -144, z0: -10, z1: 12, y: 2.8 },                  // ピレ門内
  { id: 'onofrio', x0: -148, x1: -128, z0: -2, z1: 18, y: 2.8 },                // 大噴水の小広場
  { id: 'gundulic', x0: 96, x1: 118, z0: 30, z1: 52, y: 4.7 },   // 大聖堂(x≥121)に掛けない        // グンドリッチ広場
  { id: 'jesuitTerrace', x0: 58, x1: 84, z0: 54, z1: 72, y: 8.4 },    // イエズス会教会前
  { id: 'jesuitFoot', x0: 62, x1: 78, z0: 33.5, z1: 42.5, y: 5.9 },   // 大階段の足元
  { id: 'dome', x0: 118, x1: 152, z0: 18, z1: 58, y: 3.1 },           // 大聖堂まわり
];

// イエズス会の大階段(グンドリッチ広場 4.7 → テラス 8.4)
// カフェ・テラス(卓・椅子・パラソルが並ぶ帯)。**life と buildings の両方が読む。**
// life だけが持っていたとき、店の日除け(z ±4.4)とパラソルの笠(半径 1.30m、
// 中心 z ±2.92)が 1.48m しか離れず、10 組が食い込んでいた(ユーザー報告)。
// 「テラスの前の店には日除けを付けない」を言うには、両方が同じ表を見る要がある。
const TERRACES = [];
for (let k = 0; k < 8; k++) TERRACES.push({ x0: -118 + k * 30, len: 9.0, z: 2.92 });
for (let k = 0; k < 4; k++) TERRACES.push({ x0: -104 + k * 34, len: 8.0, z: -2.92 });

const JESUIT_STAIR = { x0: 63, x1: 77, z0: 42, z1: 54, yLow: 5.95, yHigh: 8.4, axis: 'z' };

// ---------------------------------------------------- 記念建築の敷地 ----
// 敷地内には民家を生成しない。建物本体は monuments.js が建てる。
const MONUMENTS = {
  bellTower: { x: 147, z: -3.2, w: 6.0, d: 6.0, h: 24.5 },   // 全高 31m(胴 24.5 + 鐘室 3.4 + 灯篭 2.4 + 玉 0.7)                // 鐘楼(時計塔・ストラドゥンの北側)
  sponza: { x: 133, z: -13, w: 17, d: 13 },                            // スポンザ館
  stBlaise: { x: 133, z: 15, w: 14, d: 17 },                           // 聖ヴラホ教会(広場の南側・大通りに掛けない)
  rector: { x: 146, z: 27, w: 13, d: 20 },                             // 総督邸
  cathedral: { x: 130, z: 48, w: 18, d: 25 },                          // 大聖堂(前庭 12m)
  jesuit: { x: 70, z: 66, w: 15, d: 18 },                              // イエズス会教会(前庭を確保)
  franciscan: { x0: -142, x1: -114, z0: -32, z1: -4, tower: { x: -118, z: -28, h: 26 } }, // フランシスコ会
  // 北東の斜めの城壁に対して、x1=142/z0=-68 の角は壁の中心線から 1.5m しかなく、
  // 修道院の北翼が歩廊を跨いで完全な行き止まりを作っていた。歩廊帯 4.2m を空ける。
  dominican: { x0: 112, x1: 137, z0: -64, z1: -40, tower: { x: 120, z: -56, h: 25 } },    // ドミニコ会
  onofrio: { x: -136, z: 11, r: 3.0 },                                 // オノフリオの大噴水
  orlando: { x: 144, z: 5 },                                            // オルランドの柱(広場の中)
};

// 広場と大階段は outsideHeight で ±4m のフェザーをつけて地形を掘り下げる。
// 建てない領域が ±1m しかないと、その差の帯に立った家と庭塀の足元だけ地面が
// 最大 2.9m 落ち、壁が宙に浮く(実測: 塀の下端 9.74 に対し地面 6.09)。
// カーブの羽根と同じ幅を空ける。
const NO_BUILD = [
  ...PLAZAS.map(p => [p.x0 - 4.6, p.z0 - 4.6, p.x1 + 4.6, p.z1 + 4.6]),
  // プロチェ門の切通し。素地形 8.1m から敷居 2.4m まで掘り下げる帯で、
  // ここに塀や家を建てると足元が抜けて宙に浮く。
  [140, -66, 160, -44],
  [JESUIT_STAIR.x0 - 4.6, JESUIT_STAIR.z0 - 4.6, JESUIT_STAIR.x1 + 4.6, JESUIT_STAIR.z1 + 4.6],
  [MONUMENTS.sponza.x - 10, MONUMENTS.sponza.z - 8.5, MONUMENTS.sponza.x + 10, MONUMENTS.sponza.z + 8.5],
  [MONUMENTS.stBlaise.x - 9, MONUMENTS.stBlaise.z - 10.5, MONUMENTS.stBlaise.x + 9, MONUMENTS.stBlaise.z + 10.5],
  [MONUMENTS.rector.x - 8.5, MONUMENTS.rector.z - 12, MONUMENTS.rector.x + 8.5, MONUMENTS.rector.z + 12],
  [MONUMENTS.cathedral.x - 11, MONUMENTS.cathedral.z - 15.5, MONUMENTS.cathedral.x + 11, MONUMENTS.cathedral.z + 15.5],
  [MONUMENTS.jesuit.x - 9.5, MONUMENTS.jesuit.z - 12, MONUMENTS.jesuit.x + 9.5, MONUMENTS.jesuit.z + 12],
  [MONUMENTS.franciscan.x0, MONUMENTS.franciscan.z0, MONUMENTS.franciscan.x1, MONUMENTS.franciscan.z1],
  [MONUMENTS.dominican.x0, MONUMENTS.dominican.z0, MONUMENTS.dominican.x1, MONUMENTS.dominican.z1],
  [140, -46, 168, 20],   // 鐘楼裏〜ポンテ門〜東壁の帯
  [-168, -12, -152, 14], // ピレ門の壁帯
];

function inNoBuild(x, z, m = 0) {
  for (const r of NO_BUILD) if (x > r[0] - m && x < r[2] + m && z > r[1] - m && z < r[3] + m) return true;
  return false;
}

// ---------------------------------------------------------------- 城壁 ----
// 一筆書きの実ループ。[x, z, 歩廊y, 種別] 種別: land(陸側=高く狭間胸壁) / sea / port / gate
// 歩廊幅・壁厚は種別から決まる。塔はノード名で指定。
const WALL_PATH_RAW = [
  [-158, 2, 13.2, 'gatePile'],
  [-161, -20, 16.0, 'land'],
  [-156, -46, 20.0, 'land'],
  [-142, -68, 24.5, 'land'],
  [-122, -82, 29.5, 'minceta'],   // ミンチェタ塔(最高所 — 足元の屋根海より高く)
  [-96, -89, 28.2, 'land'],
  [-62, -92, 27.2, 'land'],
  [-24, -92, 26.2, 'land'],
  [16, -90, 25.2, 'land'],
  [58, -88, 24.0, 'land'],
  [96, -84, 22.4, 'land'],
  [128, -76, 20.4, 'land'],
  [148, -62, 18.6, 'tower'],      // 北東の角塔
  [156, -50, 16.0, 'gatePloce'],
  [162, -30, 14.2, 'port'],
  [166, -6, 13.2, 'gatePonte'],   // ポンテ門はこの下の壁を潜る
  [168, 16, 13.0, 'port'],
  [170, 38, 13.6, 'port'],
  [172, 54, 14.6, 'stjohn'],      // 聖イヴァン要塞
  [156, 72, 15.2, 'sea'],
  [128, 84, 15.8, 'sea'],
  [96, 94, 16.6, 'sea'],
  [58, 101, 16.2, 'sea'],
  [18, 104, 15.8, 'sea'],
  [-22, 102, 16.2, 'sea'],
  [-62, 97, 15.6, 'sea'],
  [-96, 90, 15.0, 'sea'],
  [-122, 80, 14.6, 'bokar'],      // ボカール要塞
  [-142, 58, 13.8, 'sea'],
  [-152, 34, 13.5, 'sea'],
  [-158, 12, 13.2, 'sea'],
  [-158, 2, 13.2, 'gatePile'],    // ループを閉じる
];

// walkHalf = 実際に歩ける帯の半幅。実物の歩廊は陸側 1.5〜2.5m、海側 1.2〜2.0m
// で、すれ違うのに体を寄せる。4.6m は道路であって城壁ではない。
// pT/rT = 胸壁と内縁の厚み。かつて walkHalf から「余った石」として逆算していた
// ので、厚い壁ほど胸壁が厚くなり、陸側で 1.15m の卓になっていた。視点 1.62m から
// 敷居 1.32m 越しに 1.15m の奥行を見下ろすと、壁の足元は永久に見えない
// (画面の下 35% が真っ白な平板になる)。実物の胸壁は 0.6〜0.9m。
// 厚みを先に決め、歩ける帯はその残りとする。
const WK = (thick, pT, rT, parapet, merlon) =>
  ({ thick, pT, rT, parapet, merlon, walkHalf: thick / 2 - (pT + rT) / 2 });
const WALL_KIND = {
  //                厚 胸壁 内縁 敷居 メルロン
  land:      WK(5.0, 0.70, 0.55, 1.10, true),
  sea:       WK(3.6, 0.70, 0.50, 1.25, false),
  port:      WK(4.0, 0.70, 0.50, 1.25, false),
  gatePile:  WK(6.0, 0.75, 0.60, 1.10, true),
  gatePloce: WK(6.0, 0.75, 0.60, 1.10, true),
  gatePonte: WK(4.0, 0.70, 0.50, 1.25, false),
  minceta:   WK(5.5, 0.75, 0.60, 1.12, true),
  tower:     WK(5.2, 0.75, 0.58, 1.12, true),
  stjohn:    WK(5.0, 0.72, 0.55, 1.32, false),
  bokar:     WK(4.6, 0.72, 0.55, 1.30, false),
};

// 塔(円筒)— 歩廊はその脇を通り、ミンチェタは螺旋で頂上テラスへ
const TOWERS = {
  // well: 塔頂テラスに開ける階段室の切り欠き(方位 a0..a1 の外周は張らない)。
  // 螺旋はこの切り欠きから上がってくる — 塞ぐと階段が床の下をくぐり、頭が埋まる。
  minceta: {
    x: -122, z: -82, r: 8.6, topY: 34.7, crownR: 10.0, crownY0: 29.9,
    baseY: 19.5, galleryY: 29.5, collideTop: 27.2,
    well: { a0: -1.90, a1: -0.30, r: 6.4 },
  },
  bokar: { x: -122, z: 80, r: 7.0, topY: 14.6, crownR: 8.0, crownY0: 12.2, baseY: 2.0, galleryY: 14.6 },
  stjohn: { x: 172, z: 54, r: 7.0, topY: 14.6, crownR: 8.2, crownY0: 12.0, baseY: 0.5, galleryY: 14.6 },
  // galleryY は「歩廊がこの塔を横切る高さ」。壁ノード 12 の 18.6 と 1.4m ずれて
  // いたため、塔を貫く通路のアーチが迫元 19.2・天板 18.55 で上下逆転し、
  // 歩廊の真ん中に丸い殻が生えていた。ノードの高さに合わせる。
  // galleryY は「歩廊がこの塔を横切る高さ」。壁ノード 12 の 18.6 と 1.4m ずれて
  // いたため、塔を貫く通路のアーチが迫元 19.2・天板 18.55 で上下逆転し、
  // 歩廊の真ん中に丸い殻が生えていた。ノードに合わせ、胴を迫の頂(22.35)より
  // 高くして、アーチの上に本当の石を載せる。
  neCorner: { x: 148, z: -62, r: 6.0, topY: 25.0, crownR: 7.0, crownY0: 23.2, baseY: 4.0, galleryY: 18.6 },
};

// 門(壁衝突を無効にする通行帯 + アーチ形状は walls.js)
const GATES = [
  { id: 'pile', x: -158, z: 2, dir: 'x', w: 3.4, h: 4.6, y: 2.8 },     // 西へ(橋の袂まで)
  // 敷居 2.4 は市内の素地形 7.9 と 5.5m 違い、切通しが 34 度の崖になるか、
  // 緩くすると 14m 先のプロチェ階段の足元まで掘れて段が宙に浮いた。
  // 5.6 なら切通しは 14 度で歩け、階段にも届かない。
  { id: 'ploce', x: 156, z: -50, dir: 'xz', w: 3.2, h: 4.4, y: 5.6 },  // 北東へ(石橋の袂まで)
  { id: 'ponte', x: 166, z: -6, dir: 'x', w: 5.2, h: 5.8, y: 1.7 },    // ルジャ→旧港
];

// 城壁への階段。pts: [x, z, y] のランプ折れ線。enclosed=壁体内の暗い階段室。
const WALL_STAIRS = [
  { // ピレの大階段(広場から西壁の内面に沿って登り、面際で歩廊高さへ)
    id: 'pileStair', w: 2.3, enclosed: false,
    pts: [[-146, 10, 2.8], [-150.5, 14.5, 6.2], [-152.66, 19.90, 9.8], [-151.67, 24.46, 13.4]],
  },
  { // ミンチェタの階段室(ペリネ通り→暗い折返し→壁の内面に沿って登り歩廊脇へ「炸裂」)
    // 最後の3点は歩廊デッキの内縁(中心線から 2.75m)より外を通す。
    // デッキの下をくぐると頭が石に埋まる — 壁の中は登れない、沿って登る。
    id: 'mincetaShaft', w: 1.7, enclosed: true,
    // 最後の一歩だけ歩廊の内縁へ振る(デッキの上で終わる = 段と歩廊が地続き)
    pts: [[-102.5, -74.6, 20.7], [-106, -75.4, 21.6], [-110.5, -76.6, 22.8], [-113, -79, 24.4],
      [-111.27, -80.95, 25.32], [-106.77, -82.16, 26.96], [-102.37, -83.35, 28.35],
      [-102.71, -84.61, 28.57]],
  },
  { // 聖イヴァンの階段(大聖堂裏の帯→港壁歩廊)
    id: 'stjohnStair', w: 2.0, enclosed: false,
    pts: [[162, 44, 3.6], [165, 40, 6.5], [166.7, 35.01, 9.6], [165.97, 29.41, 13.2]],
  },
  { // プロチェの階段(ドミニコ会の裏→北東壁の内面に沿って長く登る)
    id: 'ploceStair', w: 2.0, enclosed: false,
    // 一段目は足元の地面から 0.3m 以内に置く(0.55 を超えると足が乗り移らない)。
    // 上半分は折り返して、歩廊デッキの内縁より外(中心線から 3.9m)を登る —
    // デッキの下をくぐると、登る者の頭がその石に入る。
    pts: [[143, -45, 7.5], [146.5, -48.5, 10.8], [149.5, -52, 13.6],
      [151.07, -50.18, 14.93], [152.36, -48.44, 16.13]],
  },
  { // 聖イヴァンの砲座への回り階段(要塞の輪に沿って上がり、最後に内へ振る)
    // 幅 1.4m は **実効 1.30m**(tools/_stairwidth.mjs)。体の半径 0.32 を引くと
    // 左右の余裕が ±0.25m しかなく、回りながら登るこの段では足が外れる
    // (ユーザー報告「狭くて上がりにくい」)。他の城壁階段は実効 1.6〜2.2m。
    id: 'stjohnTop', w: 2.0, enclosed: false, spiral: true,
    pts: [[170.6, 59.5, 14.6], [172.2, 61.5, 15.5], [174.6, 61.2, 16.5], [176.0, 59.6, 17.4]],
  },
  { // ミンチェタ塔頂への階段(王冠の内壁に沿って回り上がる)
    id: 'mincetaTop', w: 1.4, enclosed: false, spiral: true,
    // 最後の一段はテラスの床(半径 terraceR)に載せる — 井筒に取り残さない
    // 上半分は塔の内壁(半径 9.2)から 1.3m 離れて宙に架かっていた。
    // 壁から離れた斜めの梁は、どれだけ厚くしても「架けた板」に見える。
    // 桁の外側が内壁に触れる半径(8.2)まで寄せる。井筒の切り欠き
    // (a −1.9〜−0.3 rad, r 6.4〜9.2)の中は外さない。
    pts: [[-129.5, -84.8, 29.5], [-127.5, -88.3, 30.8], [-123.4, -89.9, 32.1], [-118.6, -88.9, 33.4], [-115.8, -85.3, 34.7]],
  },
];

// 城壁外の通行帯(橋の袂・防波堤)
// ピレ門の空壕の断面。地形の式と、地面の「色」を決める側の両方がこれを見る。
// 書き写すと、いつか片方だけ直す(歩廊の高さで実際にそうなった)。
// across = 壕を横断する向きの掘れ具合、along = 壕の長さ方向の減衰。
function moatSection(x, z) {
  const across = smoothstep(-178.4, -177.0, x) * smoothstep(-159.4, -160.8, x);
  const along = 1 - smoothstep(11, 22, Math.abs(z - 2));
  return { across, along, dig: across * along };
}
// 「ここは空壕か」(0〜1)。乾いた壕を海底の色で塗らないために ground.js が使う。
function moatAt(x, z) {
  if (!(x < -158 && x > -206 && Math.abs(z - 2) < 30)) return 0;
  return moatSection(x, z).dig;
}

const OUTSIDE_WALKS = [
  // 橋のデッキは -178.6 まで伸ばしてある(西の橋台の上を渡す)。帯が -176 で
  // 始まっていたので、デッキの西端 2.6m は「描かれているが乗れない」床だった。
  // 帯の西端は描かれたデッキより 0.15m だけ **外側** に置く。境界を
  // デッキの端とぴったり揃えると、その一点を踏んだ瞬間だけ帯から外れて
  // 壕(0.5m)へ落ち、しかも groundAt は層を今の高さで解くので、以降ずっと
  // 壕の層を拾って二度と橋に戻れない。落ちる縁では当たり判定を描画より
  // 広く取る — 逆向きの誤差は必ず穴になる。
  { id: 'pileBridge', x0: -178.75, x1: -160, z0: 0, z1: 4.4, y: 2.8 },
  // 要塞 stjohn は (172,54) 半径 7 の実体。x0 168 だと防波堤の付け根 10m が
  // 石の中を通り、歩くと壁を突き抜ける。要塞の外側から始める。
  { id: 'porporela', x0: 179.6, x1: 214, z0: 56.5, z1: 64.5, y: 1.5 },  // ポルポレラ防波堤(要塞の南東から東へ)
  { id: 'stjohnApron', x0: 179.6, x1: 182.0, z0: 42, z1: 58.5, y: 1.55 }, // 要塞東面のエプロン(岸壁と防波堤をつなぐ)
  // プロチェ橋。石橋は walls.js が描いていたのに歩ける帯に無く、門の床
  // (半径 6.5m の判定)が水面 −2.0 の上に 4.4m 浮いていた。
  {
    id: 'ploceBridge', x0: 150, x1: 177, z0: -63, z1: -45, y: 5.6,
    ax: [153.9, -48.6], bx: [172.0, -59.0], halfW: 2.5,
    has(px, pz) {
      // t をクランプすると、橋の端の「先」や「手前」まで帯が伸びて、
      // 桁の無い所に歩ける床ができる(海の上に 2m 浮く)。区間の中だけ。
      const dx = this.bx[0] - this.ax[0], dz = this.bx[1] - this.ax[1];
      const L2 = dx * dx + dz * dz;
      const t = ((px - this.ax[0]) * dx + (pz - this.ax[1]) * dz) / L2;
      if (t < 0 || t > 1) return false;
      const cx = this.ax[0] + dx * t, cz = this.ax[1] + dz * t;
      return Math.hypot(px - cx, pz - cz) < this.halfW;
    },
    yAt(px, pz) {
      const dx = this.bx[0] - this.ax[0], dz = this.bx[1] - this.ax[1];
      const L2 = dx * dx + dz * dz;
      const t = clamp(((px - this.ax[0]) * dx + (pz - this.ax[1]) * dz) / L2, 0, 1);
      // 門の床(半径 3.6m の平場)と段差を作らないよう、最初の 3 割は水平。
      return lerp(5.58, 3.85, clamp((t - 0.30) / 0.70, 0, 1));
    },
  },
];

// ------------------------------------------------------------- 家並み ----
// 帯(ストラドゥン→プリイェコ→ペリネ / 南は3段)× 路地の櫛 = 街区。
// 街区は東西棟の連なり(棟軸は東西 = 実物の屋根海の流れ)。
function buildHouses(northXs, southXs, streets) {
  const rng = rngFor(0xbead);
  const houses = [];
  const alleyW = id => streets.find(s => s.id === id)?.w ?? 2.2;

  // 帯の定義: [z手前, z奥, 最大階数, 屋根列の目安深さ]
  const northBands = [
    { z0: -4.4, z1: -34.2, fl: [3, 4], stradunRow: true },
    // プリイェコ〜ペリネ。ここが 2〜3 階だと、北の路地の壁が 8.7〜10.5m しか
    // 立たず、空のリボンが 18〜32° 開く(実在の Žudioska / Zlatarska は 7〜11°)。
    // 3〜4 階にすると帯の軒高は中央値 7.14 → 9.46m、リボンの中央値 18.1 → 15.8°。
    // **ミンチェタからの海は 2.9% のまま一画素も減らない**(第7パスの実測)。
    // 増える屋根 3.0pt は空でも海でもなく、屋根の間に覗いていた地面と躯体から
    // 来る = 屋根の海が連続する。街全体の軒高 p90 13.55m / 最大 14.82m は不変。
    { z0: -37.8, z1: -72.4, fl: [3, 4] },
    { z0: -75.6, z1: -84.5, fl: [1, 2], thin: true },   // ペリネと北壁の間の低い列
  ];
  const southBands = [
    { z0: 4.4, z1: 30.2, fl: [3, 4], stradunRow: true },
    { z0: 33.9, z1: 58.4, fl: [2, 3] },
    { z0: 61.6, z1: 82.5, fl: [2, 3] },
    { z0: 85.5, z1: 94.5, fl: [1, 2], thin: true },
  ];

  const genSide = (xs, bands, sideSign, alleys) => {
    const edges = [-146, ...xs, 150]; // 両端は壁・広場際まで
    for (let gi = 0; gi < edges.length - 1; gi++) {
      const aw0 = gi === 0 ? 0 : alleys[gi - 1].w;
      const aw1 = gi === edges.length - 2 ? 0 : alleys[gi]?.w ?? 2.2;
      const x0 = edges[gi] + aw0 / 2 + 0.1;
      const x1 = edges[gi + 1] - aw1 / 2 - 0.1;
      if (x1 - x0 < 3.5) continue;
      for (const band of bands) {
        const zA = sideSign * Math.min(Math.abs(band.z0), Math.abs(band.z1));
        const zB = sideSign * Math.max(Math.abs(band.z0), Math.abs(band.z1));
        const depth = Math.abs(zB - zA);
        const nRows = Math.max(1, Math.round(depth / 8.2));
        const rowD = depth / nRows;
        for (let r = 0; r < nRows; r++) {
          const zc = zA + sideSign * rowD * (r + 0.5);
          // 一列を家々に分割
          // 南の路地は 4 点の折れ線で ±0.65m 振れる(plan.js:169)。列の右端 x1 は
          // 路地の **始点** の x から決まっているので、余りを最後の家に吸わせると、
          // 路地が家の側へ振れている z では壁が路地の中へ入る(実測 alleyS1 で
          // 足元の通行幅が 0.06m まで潰れた)。この列の z 範囲で路地の中心線が
          // 最も家に寄る位置を取り直す。
          let x1r = x1;
          const aRight = gi === edges.length - 2 ? null : alleys[gi];
          if (aRight && aRight.pts.length > 2) {
            for (let k = 0; k <= 6; k++) {
              const zz = zA + sideSign * rowD * (r + k / 6);
              x1r = Math.min(x1r, alleyXAt2(aRight, zz) - aw1 / 2 - 0.1);
            }
          }
          let x = x0;
          const isStradunFace = band.stradunRow && r === 0;
          while (x < x1r - 3.0) {
            const w = isStradunFace ? 5.4 + rng() * 2.2 : 4.2 + rng() * 3.2;
            let wReal = Math.min(w, x1r - x);
            // 左詰めで割ると、余り(0〜3.2m)は街区の構造上 **必ず列の +x 端**、
            // つまり次の路地の西側に落ちる。そこが未建築のまま残り、plan.js の
            // 庭塀補完が厚 0.5m・高さ最大 10.83m の「目の無い板」でそれを塞ぐ。
            // garden は buildings.js:916 の `if (h.garden) continue;` で
            // 窓・扉・縦樋・巾木・軒・屋根をすべて失うので、路地の立面 278m が
            // 板になっていた。北の路地の西壁が東壁より系統的に貧しい(扉 4 対 8、
            // 縦樋 0 対 7、街灯が全部東側)のは、この一箇所の詰め方が原因。
            // 残りが 1 軒に足りないなら、この家を端まで伸ばす。
            if (x1r - (x + wReal) < 3.2) wReal = x1r - x;
            if (wReal < 3.0) break;
            const cx = x + wReal / 2;
            // 城壁の外に家を建てない。北西の帯は wall のポリラインが内側へ
            // 食い込むので、帯の矩形だけで割ると壁を越えた家が出る。
            const nwH = nearestOnPolyline(WALL_PATH_RAW.map(p3 => [p3[0], p3[1], p3[2]]), cx, zc);
            const insideWall = pointInPoly(WALL_PATH_RAW.map(p3 => [p3[0], p3[1]]), cx, zc)
              && nwH.d > (WALL_KIND[WALL_PATH_RAW[Math.max(0, nwH.i - 1)][3]] || WALL_KIND.sea).thick / 2 + 1.2;
            if (insideWall && !inNoBuild(cx, zc, 0.5)) {
              // 4 隅だけを見ると、擁壁の際で地面が急に落ちる場所で家が宙に浮く
              // (実測 壁の下端 9.74 に対し地面 6.53 = 3.2m の空隙)。
              // 足元を 0.6m 外まで 3×3 で見て、最も低い所まで躯体を降ろす。
              let yLo = Infinity, yTop = -Infinity;
              for (let gi = 0; gi < 3; gi++) {
                for (let gj = 0; gj < 3; gj++) {
                  const gx = cx + (gi - 1) * (wReal / 2 + 0.6);
                  const gz = zc + (gj - 1) * (rowD / 2 + 0.6);
                  const gy = terrainHeight(gx, gz);
                  if (gy < yLo) yLo = gy;
                  if (gy > yTop) yTop = gy;
                }
              }
              const yBase = yLo - 0.4;
              let floors = band.fl[0] + ((rng() * (band.fl[1] - band.fl[0] + 1)) | 0);
              if (isStradunFace) floors = 4; // ストラドゥンの正面は震災後の統一様式
              const seed = hash2((cx * 10) | 0, (zc * 10) | 0);
              // 斜面の家は「下の街路」から階を数える(上の面は1〜2階だけ出る)。
              // これが城壁から屋根海ごしに海が見える理由そのもの。
              // ストラドゥン正面は 1 階が高い(中2階を抱く 4.35m)。
              // 2.9m だと膝立ちアーチの冠が 2 階の窓台に触れ、通りが峡谷に見える。
              const g0 = isStradunFace ? 4.35 : 3.05;
              let eaves = isStradunFace
                ? 2.6 + 14.6                                  // 舗装から一定。揺らぎは瓦の色と煙突へ回す
                : yBase + 0.4 + g0 + (floors - 1) * 3.05 + 0.5 + seed * 0.5;
              eaves = Math.max(eaves, yTop + 2.5);   // 上の面にも最低限の壁
              // 視線の法則: 陸側城壁の近くでは、屋根は歩廊の目線より下。
              // (ミンチェタから屋根海ごしに海を見るための高さキャップ)
              const wallPts3 = WALL_PATH_RAW.map(p => [p[0], p[1], p[2]]);
              const nw = nearestOnPolyline(wallPts3, cx, zc);
              const nearKind = WALL_PATH_RAW[Math.max(0, nw.i - 1)][3];
              const landSide = ['land', 'minceta', 'tower', 'gatePile', 'gatePloce'].includes(nearKind);
              // kupa kanalica(丸瓦+平瓦)の実勾配は 17〜24°。0.55(28.8°)はアルプス。
              const roofH = (rowD / 2) * (0.30 + seed * 0.14);   // 棟高を家ごとに ±0.3m 散らす
              let garden = false;
              if (landSide && nw.d < 44) {
                const cap = nw.y - 2.2 - Math.max(0, 44 - nw.d) * 0.11;
                if (cap < yTop + 2.6) garden = true;   // 建てられない狭間は壁囲いの庭
                else {
                  eaves = Math.min(eaves, cap);
                  floors = Math.max(1, Math.min(floors, Math.floor((eaves - yTop - 0.6) / 3.05)));
                }
              }
              // 歩廊の帯に掛かる家は「棟まで」歩廊面より下。中心からの距離ではなく
              // 屋根の張り出しを含めた実際の外周で測る — 描かれる石が歩廊に上がって
              // こないことが条件(海側歩廊で屋根を突き抜けていた原因はここ)。
              const WALK_CLEAR = 3.8;   // 城壁中心線からこの内側は歩廊のもの
              let dWall = nw.d, wallY = nw.y;
              const ovX = wReal / 2 + 0.30, ovZ = rowD / 2 + 0.25;   // 軒の張り出し込み
              for (const [ex, ez] of [[-ovX, -ovZ], [ovX, -ovZ], [-ovX, ovZ], [ovX, ovZ]]) {
                const q = nearestOnPolyline(wallPts3, cx + ex, zc + ez);
                if (q.d < dWall) { dWall = q.d; wallY = q.y; }
              }
              const nearWalk = dWall < WALK_CLEAR;
              if (nearWalk) {
                const cap = wallY - 0.6 - roofH;      // 棟(+煙突は建てない)が歩廊より下
                if (cap < yTop + 2.3) garden = true;
                else {
                  eaves = Math.min(eaves, cap);
                  floors = Math.max(1, Math.min(floors, Math.floor((eaves - yTop - 0.6) / 3.05)));
                }
              }
              if (!garden && seed > 0.965) garden = true;   // 1667年の震災以来の空き地
              const gardenTop = nearWalk ? Math.min(yTop + 2.15, wallY - 0.6) : yTop + 2.15;
              houses.push({
                x: cx, z: zc, w: wReal - 0.12, d: rowD - 0.10,
                yBase, eaves: garden ? gardenTop : eaves,
                floors: garden ? 1 : floors, seed,
                // 実測 屋根 556 枚のうち棟が z 方向は 86 枚(15.5%)。残り 84.5% が
                // 全部東西の棟で、ミンチェタから見た屋根の海が「同じ切妻が
                // 並んだ縞」になっていた。1667 年後に定規で引かれた **北の櫛** は
                // 揃っていてよいが、焼け残った **南の不整形街区** は揃っていない。
                ridgeAxis: (seed > (zc > 0 ? 0.42 : 0.80)
                  && wReal / rowD > 0.62 && wReal / rowD < 1.7) ? 'z' : 'x',
                roofH: garden ? 0.001 : roofH,
                stradunFront: isStradunFace && !garden,
                band: band.thin ? 'thin' : 'main',
                side: sideSign, garden,
                noChimney: nearWalk,     // 歩廊際の屋根に煙突を立てない(体を突き抜ける)
              });
            }
            x += wReal;
          }
        }
      }
    }
  };

  const alleysN = streets.filter(s => s.id.startsWith('alleyN'));
  const alleysS = streets.filter(s => s.id.startsWith('alleyS'));
  genSide(northXs, northBands, -1, alleysN);
  genSide(southXs, southBands, +1, alleysS);
  return houses;
}

// 段の格子: 視覚の石段(stepPool)と足の高さを同じ式で刻む
const STEP_RISE = 0.16;
export function quantizeRun(y0, y1, t, rise = STEP_RISE) {
  const dh = y1 - y0;
  if (Math.abs(dh) < rise * 1.2) return y0 + dh * clamp(t, 0, 1);
  const n = Math.max(1, Math.round(Math.abs(dh) / rise));
  // 段の面はランプの ±半段、かつ両端は y0 / y1 にぴたり合う。
  // 切り上げにすると一段分まるごと持ち上がり、交差する街路や広場の舗装の
  // 上に石段が浮く。逆に端がずれると歩廊や踊り場との継ぎ目に段差が出る。
  return y0 + Math.round(clamp(t, 0, 1) * n) * (dh / n);
}

// ----------------------------------------------------------- 全体組立 ----
export function buildPlan() {
  const alleyXAt = alleyXAt2;   // 折れ線の路地の中心 x(式はモジュール直下に 1 つ)
  const { streets, northXs, southXs } = makeStreets();
  const houses = buildHouses(northXs, southXs, streets);

  // 路地の縁の空き区画に「庭の塀」を補完する。
  // 路地は必ず石の壁に挟まれている — それがこの街の連続性。
  for (const s of streets) {
    if (s.kind !== 'alley') continue;
    const zA = s.pts[0][1], zB = s.pts[s.pts.length - 1][1];
    const z0 = Math.min(zA, zB), z1 = Math.max(zA, zB);
    for (const side of [-1, 1]) {
      let runStart = null;
      for (let z = z0 + 1; z <= z1 - 1 + 0.001; z += 2.6) {
        const wx = alleyXAt(s, z) + side * (s.w / 2 + 0.45);
        // 近くに家があるか
        let covered = false;
        for (const h of houses) {
          if (Math.abs(h.z - z) < h.d / 2 + 0.6 && Math.abs(h.x - wx) < h.w / 2 + 1.1) { covered = true; break; }
        }
        if (inNoBuild(wx, z, 1.5)) covered = true;
        // 交差する街路の通り抜けを絶対に塞がない
        if (!covered) {
          for (const s2 of streets) {
            if (s2 === s) continue;
            const near2 = nearestOnPolyline(s2.pts, wx, z);
            if (near2.d < s2.w / 2 + 1.7) { covered = true; break; }
          }
        }
        if (!covered && runStart === null) runStart = z;
        if ((covered || z + 2.6 > z1 - 1) && runStart !== null) {
          const zEnd = covered ? z - 1.3 : z + 1.3;
          if (zEnd - runStart > 2) {
            const zc = (runStart + zEnd) / 2;
            // 両端 2 点だけを見ると、途中で地面が落ちる区間で塀が宙に浮く。
            // 走り全体を 1.5m 刻みで見て、最も低い所まで足元を伸ばす。
            const gwx = alleyXAt(s, zc) + side * (s.w / 2 + 0.55);
            let yTop = -Infinity, yLo = Infinity;
            const nSmp = Math.max(2, Math.ceil((zEnd - runStart) / 1.5));
            for (let q = 0; q <= nSmp; q++) {
              const gz = runStart + (zEnd - runStart) * (q / nSmp);
              for (const ox of [-0.6, 0, 0.6]) {
                const gy = terrainHeight(gwx + ox, gz);
                if (gy > yTop) yTop = gy;
                if (gy < yLo) yLo = gy;
              }
            }
            houses.push({
              x: gwx, z: zc, w: 0.5, d: zEnd - runStart,
              yBase: yLo - 0.4,
              eaves: yTop + 2.3, floors: 1, seed: hash2((gwx * 7) | 0, (zc * 7) | 0),
              ridgeAxis: 'x', roofH: 0.001, stradunFront: false,
              band: 'main', side, garden: true,
            });
          }
          runStart = null;
        }
      }
    }
  }

  // 路地の縦断サンプル(視覚の石段と足の量子化が同じ格子を使うための共有ソース)
  const alleySampleCache = new Map();
  // 路地は 2 点の直線とは限らない(南の街区は曲がる)。ある z における
  // 路地の中心 x。消費側(洗濯物・鉢・アーチ・人)はここを見る。
  // pts[0][0] を路地の x として使うと、曲がった路地で最大 1.5m ずれる。

  function alleySamples(s) {
    if (alleySampleCache.has(s.id)) return alleySampleCache.get(s.id);
    // 2 点しか見ていなかったので、折れ線の路地では中間の節が無視され、
    // 段が家の中を通った。全長に沿って刻む。
    const L = polylineLength(s.pts);
    const nSeg = Math.max(1, Math.ceil(L / 3));
    const pts3 = [];
    for (let i = 0; i <= nSeg; i++) {
      const q = samplePolyline(s.pts, Math.min((i / nSeg) * L, L - 0.001));
      pts3.push([q.x, q.z, streetY(s, q.x, q.z)]);
    }
    // セグメント化 + 段フラグ。交差する街路のコリドー内には段を刻まない
    // (道の真ん中に石段の平台がせり出すのを防ぐ — 視覚と足は同じ判定を共有)。
    const segs = [];
    for (let i = 1; i < pts3.length; i++) {
      const a = pts3[i - 1], b = pts3[i];
      const dl = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dh = Math.abs(b[2] - a[2]);
      // 9% で階段化を始めると、蹴上 0.16 では踏面が 1.78m になり
      // 「ときどき縁のある舗装」にしかならない。実物も 9〜16% は平らな石畳。
      let stepped = dl > 0.01 && dh / dl > 0.155;
      if (stepped) {
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        for (const s2 of streets) {
          if (s2 === s || s2.kind === 'alley') continue;
          if (nearestOnPolyline(s2.pts, mx, mz).d < s2.w / 2 + 0.3) { stepped = false; break; }
        }
      }
      segs.push({ a, b, stepped });
    }
    const out = { pts: pts3, segs };
    alleySampleCache.set(s.id, out);
    return out;
  }

  // 城壁パスの弧長テーブル
  const wallPts = WALL_PATH_RAW.map(p => [p[0], p[1], p[2]]);
  const wallKinds = WALL_PATH_RAW.map(p => p[3]);
  const wallLen = polylineLength(wallPts);
  // 歩廊デッキの実半幅(ノード共有・マイター前)。walls.js はこの寸法で石を張り、
  // 地面解決もこれに従う — 「石の無いところに足を置かない」ための唯一の寸法。
  const NWALL = wallPts.length - 1;
  const wallNodeHalf = wallPts.map((_, k) => {
    const kk = k % NWALL;
    const wkA = WALL_KIND[wallKinds[kk]] || WALL_KIND.sea;
    const wkB = WALL_KIND[wallKinds[(kk - 1 + NWALL) % NWALL]] || WALL_KIND.sea;
    return Math.max(wkA.thick, wkB.thick) / 2;
  });

  // 城壁歩廊の縦断は段。1:5 の連続斜路は磨いた石灰岩では歩けないし、
  // 「近代の遊歩道」に見える。実物は蹴上 0.16〜0.19 の浅い段が延々と続く。
  const WALK_RISE = 0.175;
  const wallSegN = wallPts.map((p, i) => {
    if (i === 0) return 1;
    const A = wallPts[i - 1], B = p;
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const dh = Math.abs(B[2] - A[2]);
    // 勾配 13% 未満は段ではなく斜路。0.045 で切ると 5〜10cm の蹴上を刻み、
    // 歩廊が「波板」になる(実物の段は 15% を超えてから)。
    if (L < 0.6 || dh / L < 0.13) return 1;
    let n = Math.max(1, Math.round(dh / WALK_RISE));
    while (L / n > 1.15) n++;            // 踏面が広すぎると段に見えない
    while (n > 1 && L / n < 0.34) n--;   // 狭すぎると歩けない
    return n;
  });
  // 区間内の位置 t(0..1)。nearestOnPolyline は t を返さないので復元する。
  function wallSegT(nw) {
    // 閉じた輪なので、区間 0 は「最後の節 → 最初の節」。添字は必ず巻き戻す。
    const nP = wallPts.length;
    const A = wallPts[(nw.i - 1 + nP) % nP], B = wallPts[nw.i % nP];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    return L > 1e-6 ? clamp(Math.hypot(nw.x - A[0], nw.z - A[1]) / L, 0, 1) : 0;
  }
  // 描画(walls.js)と足の高さ(groundAt)が必ず同じ格子を使うための唯一の関数。
  function wallWalkYAt(nw) {
    const n = wallSegN[nw.i];
    let y = nw.y;
    if (n > 1) {
      const nP = wallPts.length;
      const A = wallPts[(nw.i - 1 + nP) % nP], B = wallPts[nw.i % nP];
      y = A[2] + (B[2] - A[2]) * (Math.round(wallSegT(nw) * n) / n);
    }
    // 塔の天端は水平な砲床。歩廊が斜路のままそこを横切ると、天板(厚み 0.6m)の
    // 縁が歩廊から斜めに突き出して「浮いた板」に見える
    // (聖イヴァンの門口で実測 0.75m の食い違い)。
    // 天端が歩廊を兼ねる塔の中では、歩廊を天端の高さへ寄せる。斜路は塔の外で。
    for (const t of Object.values(TOWERS)) {
      const gy = t.galleryY ?? t.topY;
      if (!(gy > t.topY - 0.6)) continue;      // 天端が歩廊でない塔(ミンチェタ)は対象外
      const rT = t.terraceR ?? (t.crownR - 0.8);
      const d = Math.hypot(nw.x - t.x, nw.z - t.z);
      if (d > rT + 3.0) continue;
      y = lerp(y, gy, 1 - smoothstep(rT - 1.0, rT + 3.0, d));
    }
    return y;
  }

  // 区間 i の位置 t(0..1)における歩廊の高さ。
  // walls.js は自前の YQ(節点の直線補間)を持っていて、塔の天端で歩廊を
  // 水平に寄せたときに描画だけ取り残された(実測 0.35m の浮き)。
  // 「描画と足が同じ式を見る」ための唯一の入口をここに置く。
  function wallWalkYOn(i, t) {
    const nP = wallPts.length;
    const A = wallPts[(i - 1 + nP) % nP], B = wallPts[i % nP];
    const tt = clamp(t, 0, 1);
    return wallWalkYAt({ i, x: lerp(A[0], B[0], tt), z: lerp(A[1], B[1], tt),
      y: lerp(A[2], B[2], tt) });
  }

  // 塔の王冠に開く「歩廊の門口」の方位角 — 可視形状と衝突の唯一の定義。
  // 塔はどれも壁のノードに立つので、門口は前後のノードを向く。
  // (ここを塔ごとに開け忘れると、王冠のリングが歩廊を塞いだまま体だけ通る)
  const TOWER_NODE_KIND = { minceta: 'minceta', bokar: 'bokar', stjohn: 'stjohn', neCorner: 'tower' };
  const NNODE = WALL_PATH_RAW.length - 1;   // 末尾は始点の複製
  const towerGaps = {};
  for (const [name, kind] of Object.entries(TOWER_NODE_KIND)) {
    const mi = WALL_PATH_RAW.findIndex(pp => pp[3] === kind);
    if (mi < 0 || !TOWERS[name]) continue;
    const t = TOWERS[name];
    towerGaps[name] = [WALL_PATH_RAW[(mi - 1 + NNODE) % NNODE], WALL_PATH_RAW[(mi + 1) % NNODE]]
      .map(pp => Math.atan2(pp[1] - t.z, pp[0] - t.x));
  }
  const mincetaGaps = towerGaps.minceta;
  const angDist = (a, b) => {
    let d = Math.abs(a - b) % (Math.PI * 2);
    return d > Math.PI ? Math.PI * 2 - d : d;
  };
  const stairLens = new Map();
  for (const st of WALL_STAIRS) stairLens.set(st.id, polylineLength(st.pts));

  // 階段の側壁の幾何 — 描画(walls.js)と衝突(collide)の唯一の定義。
  // walls.js は区間ごとに法線方向へ平行移動した板を立てる。衝突が
  // 「折れ線からの距離(カプセル)」で判定すると折れ点で食い違うので、
  // 衝突側も同じ「区間ごとの符号付き横距離」を見る。
  const STAIR_FACE = 0.18;    // 中心線から壁の面まで(w/2 + これ)
  const STAIR_RAIL_T = 0.26;  // 露天階段の手すり壁の厚み
  for (const st of WALL_STAIRS) {
    const half = st.w / 2 + STAIR_FACE;
    let cum = 0;
    st.segs = [];
    for (let i = 1; i < st.pts.length; i++) {
      const [ax, az, ay] = st.pts[i - 1], [bx, bz, by] = st.pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      const nx = -dz, nz = dx;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      // 谷側(城壁中心線から遠い側)に手すりが立つ — walls.js と同じ判定
      const dP = nearestOnPolyline(wallPts, mx + nx * half, mz + nz * half).d;
      const dM = nearestOnPolyline(wallPts, mx - nx * half, mz - nz * half).d;
      st.segs.push({
        i, ax, az, ay, bx, bz, by, len, dx, dz, nx, nz, half,
        s0: cum, railSign: dP > dM ? 1 : -1,
      });
      cum += len;
    }
    // 折れ点のマイター(留め継ぎ)。区間ごとに平行移動しただけの板は、
    // 曲がり角で隣の通路を斜めに横切る — そこを体が通り抜けていた。
    // 頂点を共有すれば板は角で止まる。offAt(k, ±1) が唯一の面の定義。
    st.miter = st.pts.map((_, k) => {
      const prev = st.segs[k - 1], next = st.segs[k];
      const a = prev || next, b = next || prev;
      let mx = a.nx + b.nx, mz = a.nz + b.nz;
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml; mz /= ml;
      const ref = next || prev;
      return { mx, mz, scale: 1 / Math.max(0.45, Math.abs(mx * ref.nx + mz * ref.nz)) };
    });
    st.offAt = (k, side, dist) => {
      const m = st.miter[k], p = st.pts[k];
      return [p[0] + m.mx * m.scale * dist * side, p[1] + m.mz * m.scale * dist * side];
    };
  }

  // 歩廊デッキの縁(中心線からの距離)— 描画も地面解決もこの一つの寸法に従う。
  // ここがずれると、デッキの縁とその外の床の間に「石の無い数センチ」が生まれる。
  function deckEdgeAt(x, z) {
    const q = nearestOnPolyline(wallPts, x, z);
    const i0 = Math.max(0, q.i - 1);
    const L = Math.hypot(wallPts[q.i][0] - wallPts[i0][0], wallPts[q.i][1] - wallPts[i0][1]);
    const tt = L > 0.001 ? clamp(Math.hypot(q.x - wallPts[i0][0], q.z - wallPts[i0][1]) / L, 0, 1) : 0;
    return { nw: q, edge: lerp(wallNodeHalf[i0], wallNodeHalf[q.i], tt) - 0.02 };
  }

  // 階段の到着踊り場 — 階段の頭から歩廊の内縁へ渡す板。
  // walls.js の railGaps と同じ場所・同じ高さ(足の受け皿が無いと、頭は
  // 板の上にいるのに足は地面まで落ちる)。
  const landings = [];
  for (const st of WALL_STAIRS) {
    if (st.spiral) continue;
    const e = st.pts[st.pts.length - 1];
    const nwL = nearestOnPolyline(wallPts, e[0], e[1]);
    if (Math.abs(nwL.y - e[2]) > 1.5 || nwL.d < 0.01) continue;
    const ux = (nwL.x - e[0]) / nwL.d, uz = (nwL.z - e[1]) / nwL.d;
    // 階段が入ってくる側には広げない — 広げると板が段の上に庇のように張り出し、
    // 降りてくる者の頭がその石に入る。
    const px = -uz, pz = ux;
    const nPrev = st.pts[st.pts.length - 2];
    const dIn = Math.hypot(e[0] - nPrev[0], e[1] - nPrev[1]) || 1;
    const back = (-(e[0] - nPrev[0]) / dIn) * px + (-(e[1] - nPrev[1]) / dIn) * pz;
    // 階段が真正面から入ってくる(back≈1)ほど、その側は狭くする —
    // 板が段の上に庇のように張り出すと、降りてくる者の頭がその石に入る。
    const narrow = Math.abs(back) > 0.5 ? 0.25 : 0.75;
    landings.push({
      x: e[0], z: e[1], ux, uz, len: Math.max(0.6, nwL.d - 1.2), y: nwL.y,
      halfPos: back > 0 ? narrow : 1.35, halfNeg: back > 0 ? 1.35 : narrow,
    });
  }

  // 城壁外の実地形(描画・地面解決・水域判定の唯一の真実)
  const wallLoop = wallPts.map(p => [p[0], p[1]]);
  // 水平に敷かれた舗装(広場・大階段) — 素地形はこの下を通らねばならない
  const PAVED_FLATS = [
    ...PLAZAS.map(p => ({ x0: p.x0, x1: p.x1, z0: p.z0, z1: p.z1, yAt: () => p.y })),
    {
      x0: JESUIT_STAIR.x0, x1: JESUIT_STAIR.x1, z0: JESUIT_STAIR.z0, z1: JESUIT_STAIR.z1,
      yAt: (x, z) => lerp(JESUIT_STAIR.yLow, JESUIT_STAIR.yHigh,
        clamp((z - JESUIT_STAIR.z0) / (JESUIT_STAIR.z1 - JESUIT_STAIR.z0), 0, 1)),
    },
  ];

  // 門の敷居は市内側にも掘る(門をくぐる帯だけ地面を門の高さへ均す)。
  // 市内地面と門の高さが大きく食い違う門は掘らない — 街に穴が開く。
  // 門の開口の横方向は「壁の接線」。dir の文字列で近似すると斜めの門(ploce)で外れる。
  for (const g of GATES) {
    const nwg = nearestOnPolyline(wallPts, g.x, g.z);
    const i1 = Math.max(1, Math.min(nwg.i ?? 1, wallPts.length - 1));
    const A = wallPts[i1 - 1], B = wallPts[i1];
    const tl = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
    g.tx = (B[0] - A[0]) / tl; g.tz = (B[1] - A[1]) / tl;
  }
  // 掘る門は全部。以前は「市内地面と大きく食い違う門は掘らない」としていたが、
  // 掘らないと、その門の床(半径 6.5m の判定)だけが素地形の中に埋まるか、
  // 水の上に浮く。段差の代わりに、素地形へ滑らかに戻す擂鉢にする。
  // (定数の傾きで min を取ると、届かなかった所に必ず崖の輪ができる)
  const GATE_CARVE = GATES;
  function gateCarveAt(x, z, base) {
    // 天井は「門から 13m の円の中」だけで効かなければならない。
    // 初期値を base(= 素地形)にすると、門から遠い所でも landHeight が
    // 必ず Math.min(y, terrainHeight) で切られる。terrainHeight は z の
    // 1 次元プロファイルなので、城壁外の稜線 fBm(±11m)も rise(24〜34m)も
    // 丸ごと捨てられ、地形の 51% が素地形に張り付いた平原になっていた
    // (ロヴリイェナツの岩が 25.5m → 11.7m に切られ、要塞が 7m 浮いた原因)。
    let y = 1e9;
    for (const g of GATE_CARVE) {
      const dg = Math.hypot(x - g.x, z - g.z);
      if (dg > 13) continue;
      const k = 1 - smoothstep(5, 13, dg);
      // 効きを距離で抜く。天井そのものを持ち上げると、擂鉢の底(k=1)では
      // 門の床、縁(k=0)では 14m 上 = 実質天井なし、で連続に繋がる。
      y = Math.min(y, (g.y - 0.06) + (1 - k) * 14);
    }
    return y;
  }
  function landHeight(x, z) {
    // 擂鉢の基準は素地形。遠ざかるほど素地形へ戻るので、輪の崖ができない。
    const gateCarve = gateCarveAt(x, z, terrainHeight(x, z));
    // 市内は素地形のすぐ下(舗装 +0.02 が乗る余裕だけ)。深く沈めると、
    // 足がここに立ったとき地表の上に浮き、階段の一段目にも届かなくなる。
    if (pointInPoly(wallLoop, x, z)) {
      let y = terrainHeight(x, z) - 0.06;
      // 街路の舗装も同じ。3.2m グリッドの補間は数センチ上振れするので、
      // 舗装(streetY + 0.02)の下へ確実に潜らせないと地形が石畳を突き破る。
      for (const s2 of streets) {
        const q = nearestOnPolyline(s2.pts, x, z);
        const half = s2.w / 2 + 3.6;   // 地形グリッドは 3.19m。1.1 ではフェザーがセルより狭く溝が刻めない
        if (q.d > half) continue;
        const m = clamp((half - q.d) / 1.3, 0, 1);
        y = Math.min(y, lerp(y, streetY(s2, q.x, q.z) - 0.16, m));
      }
      // 広場と大階段は水平に敷かれる。斜面の素地形はそれを突き破るので、
      // 舗装の下へ潜らせる(縁は 2m で均して崖にしない)。
      for (const p of PAVED_FLATS) {
        if (x <= p.x0 - 4 || x >= p.x1 + 4 || z <= p.z0 - 4 || z >= p.z1 + 4) continue;
        const m = clamp(Math.min(x - p.x0 + 4, p.x1 + 4 - x, z - p.z0 + 4, p.z1 + 4 - z) / 4, 0, 1);
        y = Math.min(y, lerp(y, p.yAt(x, z) - 0.14, m));
      }
      return Math.min(y, gateCarve);
    }
    const nw = nearestOnPolyline(wallPts, x, z);
    const kind = wallKinds[Math.max(0, nw.i - 1)];
    const wk = WALL_KIND[kind] || WALL_KIND.sea;
    const d = Math.max(0, nw.d - wk.thick / 2);
    const rock = fbm2(x * 0.13, z * 0.13);
    // ロヴリイェナツの岩へ続く海岸。ピレ橋の取り付きの分岐が先に return して
    // いたので、そこだけ帯が消えて水で切れていた(実測 z 14〜22 が 2.1m の窪み)。
    // 分岐より前に一度だけ計算し、どの分岐から返るときも下限として効かせる。
    // 帯の始まりを矩形で切ると、境目に 1.4m の段差ができて登れない。
    // 東(ピレ側)と南へなだらかに消す。
    const lovGate = smoothstep(-178, -196, x) * smoothstep(-2, 8, z);
    const lovShore = lovGate > 0.001
      ? (4.8 + rock * 1.6) * (1 - smoothstep(8, 22, nearestOnPolyline(LOV_COAST, x, z).d)) * lovGate
      : 0;
    if (x > 150 && z > -58 && z < 84) {
      // 岸壁の平場。境目を矩形で切ると 3.2m の地形グリッドが崖を鈍らせ、
      // 歩ける縁(x<=181.5 / z<=58.5)がもう水面下に沈む = 海の上を歩く。
      // 落とすのは歩ける範囲の外側で。
      const apron = Math.min(
        1 - smoothstep(182.5, 187, x),
        1 - smoothstep(60.5, 65.5, z),
        smoothstep(-49.5, -45, z),
      );
      return Math.min(lerp(-2.2 + rock * 0.6, 1.45, apron), gateCarve);
    }
    // ピレ門の空壕。橋が「地面の上に置かれた板」に見えないよう、下を掘る。
    // 歩ける帯(OUTSIDE_WALKS の pileBridge)はこの上を渡る。
    if (x < -158 && x > -206 && Math.abs(z - 2) < 30) {
      // 掘るのは「橋が渡っている所」だけ。-183.5 まで掘ると、橋の西端(-176)の
      // 先に 10m の断崖ができ、取り付きのテラスへ渡れなくなる。
      // 壕の逆壕(西の肩)は橋台の真下で立ち上がらないといけない。緩い 3m の
      // 肩にしていたので、肩の頂上が橋のデッキ西端(x=-178.4)より 1m 手前で
      // 終わり、デッキとの間に 0.8m の段ができていた(登れない)。
      // 地形の格子は 3.2m。肩を格子の節(-178.4)に載せると、描かれる面と
      // 当たり判定が一致する — 節をまたぐ弦は橋の腹壁が隠す。
      // 壕の左右の肩は同じ場所には無い。|x+170| の対称式にしていたので、
      // 西の肩(橋台の下)を直すと東の肩(城壁の足元)まで 1.1m 内側へ動き、
      // 第三アーチが地面に埋まった。左右を別々に置く。
      // 西 = 橋のデッキ西端 -178.4(地形格子 3.2m の節に載る)。
      // 東 = 城壁の外面 -159.4。壕の底はその間で平ら。
      const { across, along, dig } = moatSection(x, z);
      // 橋の西の取り付き(ブルサリェのテラス)。ここが海面下だと、橋が海に
      // 突き出して途中で終わり、壕も水没して「海に浮いた灰色の箱」に見える。
      // 取り付きのテラスは x=−179 で消え、壕は |x+170| < 9.5 = x > −179.5 から
      // 始まる。その間の 0.5m が **どちらの枝にも入らず**、素の岩棚の式へ落ちて
      // 深さ −1.6m の溝になっていた。西から歩けるようになって初めて露出した
      // (橋の袂まで来て上がれない)。テラスを壕まで届かせて重ねる。
      const app = smoothstep(-177.6, -189, x) * (1 - smoothstep(13, 21, Math.abs(z - 2)));
      if (dig > 0.02 || app > 0.02) {
        const base2 = 3.6 + rock * 2.6;
        const shelf = base2 * Math.exp(-d / 8.5) - 1.6 * smoothstep(4, 22, d) + rock * 1.4 * Math.exp(-d / 20);
        // 空壕。実物は乾いた壕で、いまは庭園になっている。海面より上に保つ。
        // 底を 1.95m にしていたので、桁下(2.72m)まで 0.8m しかなく、
        // 三連アーチ(迫元 0.57m)が丸ごと地面に埋まっていた。橋が橋に見えず
        // 「地面に置いた壁の箱」になっていた正体。迫元より下まで掘る。
        //
        // 縁は「海の棚」ではなく「取り付きのテラスと同じ陸の高さ」に戻す。
        // 棚(最深 −2.6m)へ戻すと、壕の外側が海面下に落ちて橋の西に
        // 断崖ができる。横断方向(across)が壕、z 方向(along)が素地形。
        const rim = 2.45 + rock * 0.30;
        const floor2 = 0.20 + rock * 0.30;
        let y2 = lerp(rim, floor2, across);
        y2 = lerp(Math.max(shelf, -2.6), y2, along);
        y2 = lerp(y2, 2.55 + rock * 0.30, app * (1 - dig * 0.85));
        return Math.min(Math.max(y2, lovShore), gateCarve);
      }
    }
    if (z > 40 || x < -150) {
      const base = 3.6 + rock * 2.6;
      let y = base * Math.exp(-d / 8.5) - 1.6 * smoothstep(4, 22, d) + rock * 1.4 * Math.exp(-d / 20);
      // ロヴリイェナツの岩。滑らかな円錐にすると頂が尖り、その上に載せた要塞の
      // 底の縁が最大 12m 宙に浮く。実物は海から切り立つ 37m の岩で、天端は平ら。
      // 半径 16m の平坦な頂 + 7m 幅の絶壁(3.7:1)にする。
      const dl = Math.hypot(x - LOVRIJENAC.x, z - LOVRIJENAC.z);
      // 東面(海岸から取り付く側)だけ崖を長く伸ばして斜面にする。
      // 全周を断崖にすると、要塞は登れない置物になる。実物にも登り口がある。
      // 26m を 76−16=60m で登る = 勾配 43% ≈ 23°。歩ける。
      const la = Math.atan2(z - LOVRIJENAC.z, x - LOVRIJENAC.x);
      let ad = Math.abs(la - LOV_RAMP_A); while (ad > Math.PI) ad = Math.abs(ad - Math.PI * 2);
      const ramp = 1 - smoothstep(0.30, 1.05, ad);
      const cliff = LOVRIJENAC.cliff + 52 * ramp;   // 崖を立てたぶん、登り口は長く取る
      const lov = LOVRIJENAC.top * (1 - smoothstep(LOVRIJENAC.r, cliff, dl));
      y = Math.max(y, lov - 0.5, -2.6);
      // 岩へ続く海岸。実物のロヴリイェナツは岸の岩に建っていて陸続きで、
      // 石段で登れる。ここでは 40m の水で切れていて、島になっていた
      // (実測 z 20〜60 が全て水)。歩いて行けない要塞は「背景の絵」でしかない。
      y = Math.max(y, lovShore);
      return Math.min(y, gateCarve);
    }
    // 山裾の起伏。滑らかなドームは砂丘に見える。稜線を fBm で崩し、
    // 壁から 25m 以上離れた所だけに効かせる(門前と防波堤の平場は守る)。
    const relief = smoothstep(25, 95, d) * (fbm2(x * 0.014 + 5, z * 0.014 - 3) - 0.5) * 22
      + smoothstep(40, 140, d) * (fbm2(x * 0.045 - 8, z * 0.045 + 2) - 0.5) * 7;
    const innerY = nw.y - wk.parapet - 8;
    const moat = innerY - 4.5 + rock * 1.2;
    // 18→130m で 24〜34m 上がるのは勾配 1:4。門用のクランプが効いていた頃は
    // 見えなかったが、素の地形が出た今は港の真横に 38m の滑らかな絶壁が立つ。
    // 実際のプロチェ/スヴェティ・ヤコフは数百 m かけて同じ高さへ上がる。
    const rise = smoothstep(25, 320, d) * (28 + fbm2(x * 0.02, z * 0.02) * 12);
    // 近景リングの北端(z=-320)では、遠景メッシュの値へ寄せておく。
    // 寄せないと、リングの縁に「近景 40m / 遠景 6m」の崖が立つ。
    const near = Math.max(moat + rise + d * 0.05 + relief, 0.5);
    const k = smoothstep(150, 300, d);
    // 海から立ち上がる勾配は安息角を超えない。超えると、旧港の真横に
    // 滑らかな垂直の切羽(採石場の壁)が立つ。水際の低い崖 7m は許し、
    // その上は 1:2.6(21°)まで。
    const talus = 7.0 + seaDistAt(x, z) * 0.38;
    return Math.min(lerp(near, Math.max(near, farHeight(x, z)), k), gateCarve, talus);
  }

  // ---------------------------------------------------------- 海底 ----
  // 海が「深さで色を変える」には、まず海底に深さが要る。素の地形は水面下を
  // 一律 −1.9m で返していたので、岸から沖まで同じ色にしかならなかった。
  // 岸の白い岩棚(1〜4m)→ 斜面 → ドロップオフ(40m)の断面を作る。
  const SF = { x0: -900, x1: 1100, z0: -800, z1: 1200, n: 384 };
  SF.dx = (SF.x1 - SF.x0) / (SF.n - 1);
  SF.dz = (SF.z1 - SF.z0) / (SF.n - 1);
  {
    const n = SF.n, INF = 1e9;
    const d = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      const z = SF.z0 + j * SF.dz;
      for (let i = 0; i < n; i++) d[j * n + i] = landHeight(SF.x0 + i * SF.dx, z) > 0.05 ? 0 : INF;
    }
    const cd = Math.hypot(SF.dx, SF.dz);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i; let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + SF.dx);
      if (j > 0) v = Math.min(v, d[k - n] + SF.dz);
      if (i > 0 && j > 0) v = Math.min(v, d[k - n - 1] + cd);
      if (i < n - 1 && j > 0) v = Math.min(v, d[k - n + 1] + cd);
      d[k] = v;
    }
    for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
      const k = j * n + i; let v = d[k];
      if (i < n - 1) v = Math.min(v, d[k + 1] + SF.dx);
      if (j < n - 1) v = Math.min(v, d[k + n] + SF.dz);
      if (i < n - 1 && j < n - 1) v = Math.min(v, d[k + n + 1] + cd);
      if (i > 0 && j < n - 1) v = Math.min(v, d[k + n - 1] + cd);
      d[k] = v;
    }
    SF.d = d;
    // 逆向きの距離場: 陸の点から「いちばん近い海」までの距離。
    // 海から陸へ立ち上がる勾配を安息角で抑えるために使う。
    const e = new Float32Array(n * n);
    for (let k = 0; k < n * n; k++) e[k] = d[k] > 0 ? 0 : INF;   // 海=0, 陸=INF
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i; let v = e[k];
      if (i > 0) v = Math.min(v, e[k - 1] + SF.dx);
      if (j > 0) v = Math.min(v, e[k - n] + SF.dz);
      if (i > 0 && j > 0) v = Math.min(v, e[k - n - 1] + cd);
      if (i < n - 1 && j > 0) v = Math.min(v, e[k - n + 1] + cd);
      e[k] = v;
    }
    for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
      const k = j * n + i; let v = e[k];
      if (i < n - 1) v = Math.min(v, e[k + 1] + SF.dx);
      if (j < n - 1) v = Math.min(v, e[k + n] + SF.dz);
      if (i < n - 1 && j < n - 1) v = Math.min(v, e[k + n + 1] + cd);
      if (i > 0 && j < n - 1) v = Math.min(v, e[k + n - 1] + cd);
      e[k] = v;
    }
    SF.e = e;
  }
  // 海までの距離(双一次)。SF ができるまでは「無限に遠い」= 抑えなし。
  function seaDistAt(x, z) {
    if (!SF.e) return 1e9;
    const u = (x - SF.x0) / SF.dx, v = (z - SF.z0) / SF.dz;
    if (u < 0 || v < 0 || u > SF.n - 1 || v > SF.n - 1) return 1e9;
    const i0 = Math.min(SF.n - 2, u | 0), j0 = Math.min(SF.n - 2, v | 0);
    const fu = u - i0, fv = v - j0, n = SF.n;
    const a0 = SF.e[j0 * n + i0], b0 = SF.e[j0 * n + i0 + 1];
    const c0 = SF.e[(j0 + 1) * n + i0], d0 = SF.e[(j0 + 1) * n + i0 + 1];
    return lerp(lerp(a0, b0, fu), lerp(c0, d0, fu), fv);
  }
  // ---- 見えている地面 ------------------------------------------------
  // 近景の地形メッシュ(ground.js)は outsideHeight をこの格子で標本化し、
  // 三角形 2 枚で線形補間して描く。つまり「関数の値」と「目に見える面」は
  // 格子の間で食い違う(実測: 平均 0.10m、最悪 8m)。
  // 物を地面に置くときに関数を見ると、その差だけ沈むか浮く。
  // 置く側は必ずこちらを見る。メッシュと同じ格子・同じ三角形分割なので、
  // 一致は構造的に保証される(許容差で吸収するのではない)。
  const NEAR = { x0: -300, x1: 310, z0: -320, z1: 330, step: 3.2 };
  NEAR.nx = Math.ceil((NEAR.x1 - NEAR.x0) / NEAR.step);
  NEAR.nz = Math.ceil((NEAR.z1 - NEAR.z0) / NEAR.step);
  NEAR.dx = (NEAR.x1 - NEAR.x0) / NEAR.nx;
  NEAR.dz = (NEAR.z1 - NEAR.z0) / NEAR.nz;
  const nearCache = new Map();
  const latH = (i, j) => {
    const k = j * (NEAR.nx + 1) + i;
    let v = nearCache.get(k);
    if (v === undefined) { v = outsideHeight(NEAR.x0 + i * NEAR.dx, NEAR.z0 + j * NEAR.dz); nearCache.set(k, v); }
    return v;
  };
  /** 描かれている地面の高さ。近景格子の外では関数そのもの。 */
  function surfaceAt(x, z) {
    if (x <= NEAR.x0 || x >= NEAR.x1 || z <= NEAR.z0 || z >= NEAR.z1) return outsideHeight(x, z);
    const fi = (x - NEAR.x0) / NEAR.dx, fj = (z - NEAR.z0) / NEAR.dz;
    const i = Math.min(NEAR.nx - 1, Math.floor(fi)), j = Math.min(NEAR.nz - 1, Math.floor(fj));
    const u = fi - i, v = fj - j;
    const h00 = latH(i, j), h10 = latH(i + 1, j), h01 = latH(i, j + 1), h11 = latH(i + 1, j + 1);
    // PlaneGeometry の分割は (a,b,d) と (b,c,d) — 対角線は (i+1,j)–(i,j+1)。
    // u + v <= 1 の側が (i,j)(i+1,j)(i,j+1) の三角形。
    return (u + v <= 1)
      ? h00 + (h10 - h00) * u + (h01 - h00) * v
      : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  // 描かれている舗装の高さ。**ground.js が帯を張るのと同じ式・同じ幅**で引く。
  // surfaceAt は地形の格子しか見ないので、「舗装の上に置く物」(巾木・鉢・卓・
  // 露店・井戸蓋)がこれを使わないと、描かれた石畳に 0.12〜0.30m 沈む
  // (実測 巾木 159 個・鉢 4 個ほか)。舗装が無ければ null。
  function pavedY(x, z) {
    let best = null;
    const put = (y) => { if (best === null || y > best) best = y; };
    for (const p of PLAZAS) {
      if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1) put(p.y + 0.02);
    }
    for (const s of streets) {
      const near = nearestOnPolyline(s.pts, x, z);
      if (near.d >= (s.w + 0.9) / 2) continue;          // 帯の実半幅
      // 帯は折れ線の長さぶんしか張られない。端は四角く切る(groundAt と同じ)。
      const a0 = s.pts[0], a1 = s.pts[1];
      const la = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1;
      if (((x - a0[0]) * (a1[0] - a0[0]) + (z - a0[1]) * (a1[1] - a0[1])) / la < -0.001) continue;
      const b0 = s.pts[s.pts.length - 2], b1 = s.pts[s.pts.length - 1];
      const lb = Math.hypot(b1[0] - b0[0], b1[1] - b0[1]) || 1;
      if (((x - b1[0]) * (b1[0] - b0[0]) + (z - b1[1]) * (b1[1] - b0[1])) / lb > 0.001) continue;
      const lift = s.kind === 'stradun' ? 0.012 : s.kind === 'alley' ? 0.002 : 0.007;
      put(streetY(s, near.x, near.z) + lift);
    }
    // 段のある路地の踏面。ground.js は stepPool.addRun([a, b], s.w + 0.95) で
    // **路地より 0.95m 広く** 石を張るので、通行帯(w/2 + 0.40)の外にも踏面が
    // 乗る。そこに立つ物がこの高さを知らないと踏面に潜る(実測 巾木 47 個)。
    //
    // quantizeRun の格子で近似すると **箱の実物と 0.08〜0.12m ずれる**
    // (踏面の箱は奥行 tread+0.06 で重なり合い、射線は上の一枚に当たる)。
    // addRun と同じ式で **箱そのものを並べて** 中に入っているか見る。
    const RISE = 0.16;
    for (const s of streets) {
      if (s.kind !== 'alley') continue;
      const half = (s.w + 0.95) / 2;
      for (const seg of alleySamples(s).segs) {
        if (!seg.stepped) continue;
        const x0 = seg.a[0], z0 = seg.a[1], y0 = seg.a[2];
        const x1 = seg.b[0], z1 = seg.b[1], y1 = seg.b[2];
        const dh = y1 - y0, len = Math.hypot(x1 - x0, z1 - z0);
        if (Math.abs(dh) < RISE * 1.2 || len < 0.01) continue;
        const n = Math.max(1, Math.round(Math.abs(dh) / RISE));
        const dirx = (x1 - x0) / len, dirz = (z1 - z0) / len;
        const along = (x - x0) * dirx + (z - z0) * dirz;
        const lat = Math.abs((x - x0) * -dirz + (z - z0) * dirx);
        if (lat > half) continue;
        const treadD = len / n + 0.06;
        for (let k = 0; k <= n; k++) {
          const c = (k / n) * len;
          if (Math.abs(along - c) > treadD / 2) continue;
          put(y0 + dh * (k / n));
        }
      }
    }
    return best;
  }

  // 広場の縁に立つ擁壁(ground.js が段差 0.30m 以上の縁にだけ張る立ち上がり)。
  // **描いた物は、置く側も知っていなければならない。** 知らせずに壁だけ描いたら、
  // 鉢 2 個と人 2 人が壁の中に立った(ユーザー報告)。
  // (x, z) が壁の線から margin 以内なら {yBot, yTop} を返す。無ければ null。
  function plazaWall(x, z, margin = 0.45) {
    for (const q of PLAZAS) {
      const yTop = q.y + 0.02;
      const ring = [[q.x0, q.z1], [q.x1, q.z1], [q.x1, q.z0], [q.x0, q.z0], [q.x0, q.z1]];
      for (let e = 0; e < 4; e++) {
        const [ax, az] = ring[e], [bx, bz] = ring[e + 1];
        const L = Math.hypot(bx - ax, bz - az);
        const dx = (bx - ax) / L, dz = (bz - az) / L, nx = -dz, nz = dx;
        // 線分までの距離を先に見る(遠ければ床を引かない)
        const t = Math.max(0, Math.min(L, (x - ax) * dx + (z - az) * dz));
        const cx = ax + dx * t, cz = az + dz * t;
        if (Math.hypot(x - cx, z - cz) > margin) continue;
        const adj = surfaceAt(cx + nx * 0.6, cz + nz * 0.6);
        const pv = pavedY(cx + nx * 0.6, cz + nz * 0.6);
        const low = pv !== null && pv > adj ? pv : adj;
        if (yTop - low < 0.30) continue;              // 段差の無い縁に壁は無い
        // 大階段が取り付く縁には壁を張らない(ground.js と同じ判定)
        if (cx > JESUIT_STAIR.x0 - 1 && cx < JESUIT_STAIR.x1 + 1
          && cz > JESUIT_STAIR.z0 - 1.5 && cz < JESUIT_STAIR.z1 + 1.5) continue;
        return { yBot: low, yTop };
      }
    }
    return null;
  }

  // 岸までの距離(双一次)。範囲外は「沖」として大きな値。
  function shoreDistAt(x, z) {
    const u = (x - SF.x0) / SF.dx, v = (z - SF.z0) / SF.dz;
    if (u < 0 || v < 0 || u > SF.n - 1 || v > SF.n - 1) return 900;
    const i0 = Math.min(SF.n - 2, u | 0), j0 = Math.min(SF.n - 2, v | 0);
    const fu = u - i0, fv = v - j0, n = SF.n;
    const a = SF.d[j0 * n + i0], b = SF.d[j0 * n + i0 + 1];
    const c = SF.d[(j0 + 1) * n + i0], e = SF.d[(j0 + 1) * n + i0 + 1];
    return lerp(lerp(a, b, fu), lerp(c, e, fu), fv);
  }
  // ドロップオフの深さ倍率。地形なので生では動かせない — 読み直しで効く
  // (?dropoff=1.6 / コンソールから __sea.dropoff(1.6))。
  // 浅場の 2 項は触らない。深い 2 項だけを伸ばす:
  // 「浅い所は今のまま、沖だけ深く」を 1 つの数字で言えるようにするため。
  const DEEP = (typeof location !== 'undefined' && new URLSearchParams(location.search).has('dropoff'))
    ? Number(new URLSearchParams(location.search).get('dropoff')) : 1;
  // 海底断面(m)。岸で 0.4、45m で 4、190m で 14、620m で 40(DEEP=1 のとき)。
  function seaDepth(dc) {
    // ドゥブロヴニクの岸は棚ではなく崖。岩棚は数十mで終わり、そこから落ちる。
    // 緩い断面(50m 先でまだ 3.8m)にすると、うねりが常に砕ける「遠浅の海岸」に
    // なってしまう — この街の海はそうではない。
    // 岸から 6m で 2m 落とす。岩の岸も浚渫した埠頭も、水際で一気に落ちる。
    // ここを緩くすると、埠頭の縁が「くるぶしの深さ」になり、白い石灰岩の
    // 海底がそのまま透けて、広い水面が牛乳のように白く飛ぶ。
    return 2.2 * smoothstep(0, 6, dc) + 3.2 * smoothstep(4, 55, dc)
      + 12 * DEEP * smoothstep(40, 175, dc) + 22 * DEEP * smoothstep(140, 560, dc);
  }
  function outsideHeight(x, z) {
    const y = landHeight(x, z);
    if (y > 0.05) return y;
    const dc = shoreDistAt(x, z);
    // 岸の際は岩棚(転石でざらつく)。沖ほど滑らかな砂泥。
    const rough = (fbm2(x * 0.055, z * 0.055) - 0.5) * 3.2 * Math.exp(-dc / 45)
      + (fbm2(x * 0.011, z * 0.011) - 0.5) * 2.2 * Math.exp(-dc / 160);
    // 掘った空堀(門の前)は海ではない。そこは素の地形より深くしない。
    // ただしこの抑えを全域に効かせると、沖まで一律 −2.6m の「洗面器」になり、
    // 海底図の水深が 2m で頭打ちになる(= 浅場が終わらず、砕波判定も常時真)。
    // 陸からの距離で空堀と外海を分ける。
    const seaY = -seaDepth(dc) + rough;
    const moat = 1 - smoothstep(4, 26, dc);
    return lerp(seaY, Math.max(seaY, Math.min(y, -0.25) - 2.4), moat);
  }

  // 城壁への階段の通り道に立つ家・庭塀は撤去する。
  // (階段室の中に家の衝突箱が残っていた = 見えない行き止まりの正体)
  {
    const stairPts = [];
    for (const st of WALL_STAIRS) {
      for (let i = 1; i < st.pts.length; i++) {
        const [x0, z0] = st.pts[i - 1], [x1, z1] = st.pts[i];
        const L = Math.hypot(x1 - x0, z1 - z0);
        for (let sSm = 0; sSm <= L; sSm += 0.8) {
          stairPts.push([x0 + (x1 - x0) * (sSm / L), z0 + (z1 - z0) * (sSm / L), st.w / 2 + 0.75]);
        }
      }
    }
    for (let hi = houses.length - 1; hi >= 0; hi--) {
      const h = houses[hi];
      for (const [sx, sz, m] of stairPts) {
        if (Math.abs(sx - h.x) < h.w / 2 + m && Math.abs(sz - h.z) < h.d / 2 + m) {
          houses.splice(hi, 1);
          break;
        }
      }
    }
  }

  // 家屋の空間ハッシュ(衝突・可視化)
  // monuments.js は buildPlan の後に houses へ量塊(教会・修道院)を push する。
  // 一度きりの構築だと、その 13 棟は「描かれるが当たらない」建物になる —
  // 索引は必ず houses.length に追随させること。
  const CELL = 10;
  const hashGrid = new Map();
  const key = (cx, cz) => cx + ':' + cz;
  let indexedHouses = 0;
  function indexHouses() {
    for (; indexedHouses < houses.length; indexedHouses++) {
      const h = houses[indexedHouses];
      const x0 = Math.floor((h.x - h.w / 2) / CELL), x1 = Math.floor((h.x + h.w / 2) / CELL);
      const z0 = Math.floor((h.z - h.d / 2) / CELL), z1 = Math.floor((h.z + h.d / 2) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const k = key(cx, cz);
        if (!hashGrid.has(k)) hashGrid.set(k, []);
        hashGrid.get(k).push(indexedHouses);
      }
    }
  }
  indexHouses();

  // 追加の衝突箱(記念建築・門脇など)は monuments.js / walls.js が push する
  const extraColliders = [];   // {x0,z0,x1,z1,y0,y1}
  const extraCylinders = [];   // {x,z,r,y0,y1}
  for (const t of Object.values(TOWERS)) extraCylinders.push({ x: t.x, z: t.z, r: t.r, y0: -2, y1: t.collideTop ?? (t.galleryY - 0.2) });
  // 砲座の塊。天端より上では効かず、階段の上でも免除される(collide 側の規則)。
  extraCylinders.push({ x: CAVALIER.x, z: CAVALIER.z, r: CAVALIER.rMass, y0: 8, y1: CAVALIER.y - 0.15 });

  // ---- 多層地面の解決 --------------------------------------------------
  // 候補: 街路 / 広場 / 大階段 / 岸壁 / 城壁歩廊 / 壁階段 / 塔テラス / 素地形
  function groundAt(px, pz, curY) {
    const cands = [];

    // 広場
    for (const p of PLAZAS) {
      if (px > p.x0 && px < p.x1 && pz > p.z0 && pz < p.z1) {
        cands.push({ y: p.y, zone: p.id === 'luza' || p.id === 'pile' ? 'stradun' : 'square', pri: 4 });
      }
    }
    // イエズス会大階段
    const js = JESUIT_STAIR;
    if (px > js.x0 && px < js.x1 && pz > js.z0 - 1 && pz < js.z1 + 1) {
      const t = clamp((pz - js.z0) / (js.z1 - js.z0), 0, 1);
      cands.push({ y: quantizeRun(js.yLow, js.yHigh, t, 0.155), zone: 'square', pri: 4 });
    }
    // 街路(コリドー内 → 中心線上の縦断で決まる高さ)。
    // 重なる街路は全部候補にする — 舗装リボンは重ね張りなので、
    // 見える床は常に上のリボン(交差点の段差はそこで生まれる)。
    for (const s of streets) {
      const near = nearestOnPolyline(s.pts, px, pz);
      const half = s.w / 2 + 0.40;   // 舗装リボンの実半幅(w/2+0.45)より内側
      if (near.d >= half) continue;
      // **端でも「いちばん近い点」は返る。** 折れ線の外側にいても、端点に
      // 吸着して距離が半幅以内になれば通行帯の中と判定されていた。
      // オドプチャの東端(x=118)の 1.8m 先、大聖堂前の広場(y3.1)の上に
      // 高さ 4.25 の見えない床が出て、人が 1.13m 宙に浮いていた(実測)。
      // 舗装リボンは折れ線の長さぶんしか描かれない。床もそこで終わる。
      // 端は **四角く** 切る。nearestOnPolyline は端点に吸着するので、
      // 折れ線の外にいても距離が半幅以内なら通行帯の中と判定され、
      // 半径 2.2m の半円の笠ができていた。舗装リボンの端は四角い。
      {
        const a0 = s.pts[0], a1 = s.pts[1];
        const la = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1;
        if (((px - a0[0]) * (a1[0] - a0[0]) + (pz - a0[1]) * (a1[1] - a0[1])) / la < -0.001) continue;
        const b0 = s.pts[s.pts.length - 2], b1 = s.pts[s.pts.length - 1];
        const lb = Math.hypot(b1[0] - b0[0], b1[1] - b0[1]) || 1;
        if (((px - b1[0]) * (b1[0] - b0[0]) + (pz - b1[1]) * (b1[1] - b0[1])) / lb > 0.001) continue;
      }
      let y = streetY(s, near.x, near.z);
      // 路地は視覚の石段と同じ格子で足を刻む(滑らかなランプだと段を突き抜ける)
      if (s.kind === 'alley') {
        const { pts: run, segs } = alleySamples(s);
        const tG = clamp(near.s / Math.max(1e-6, polylineLength(s.pts)), 0, 0.9999);
        const idx = Math.min(segs.length - 1, Math.floor(tG * (run.length - 1)));
        const seg = segs[idx];
        const tIn = tG * (run.length - 1) - idx;
        y = seg.stepped ? quantizeRun(seg.a[2], seg.b[2], tIn) : lerp(seg.a[2], seg.b[2], tIn);
      }
      const zone = s.kind === 'stradun' ? 'stradun'
        : s.kind === 'alley' ? 'alley'
        : s.kind === 'port' ? 'port' : 'street';
      cands.push({ y, zone, pri: 4 });
    }
    // 城壁外の通行帯
    for (const w of OUTSIDE_WALKS) {
      if (px <= w.x0 || px >= w.x1 || pz <= w.z0 || pz >= w.z1) continue;
      if (w.has && !w.has(px, pz)) continue;   // 矩形ではない帯(橋)
      cands.push({ y: w.yAt ? w.yAt(px, pz) : w.y, zone: w.id === 'porporela' ? 'port' : 'gate', pri: 4 });
    }
    // 門の通行帯(壁の下を潜る)。
    // 半径 6.5m の円だと、開口幅 3.2m の門でも床が横へ 6.5m 溢れる。
    // プロチェ門ではそれが水面の上に 4.4m 浮いた「見えない床」になっていた。
    // 壁に沿う方向は開口幅、壁を貫く方向だけ長く取る。
    for (const g of GATES) {
      const dx = px - g.x, dz = pz - g.z;
      if (dx * dx + dz * dz > 44) continue;
      const lat = Math.abs(dx * g.tx + dz * g.tz);
      const nrm = Math.abs(dx * g.tz - dz * g.tx);
      if (lat < g.w / 2 + 0.9 && nrm < 3.6) {   // 壁体の半厚(最大 3.0)+ 余裕
        cands.push({ y: g.y, zone: 'gate', pri: 5 });
      }
    }
    // 城壁歩廊 — 実際に張られているデッキの内側だけ
    const { nw, edge: deckEdge } = deckEdgeAt(px, pz);
    if (nw.d < deckEdge) cands.push({ y: wallWalkYAt(nw), zone: 'wall', pri: 6, wallS: nw.s, wallD: nw.d });
    // 塔テラス・ギャラリー(描かれた床のある範囲だけ)
    for (const [name, t] of Object.entries(TOWERS)) {
      const d = Math.hypot(px - t.x, pz - t.z);
      let rTerr = t.terraceR ?? (t.crownR - 0.80);
      const ang = Math.atan2(pz - t.z, px - t.x);
      if (t.well && angDist(ang, (t.well.a0 + t.well.a1) / 2) < (t.well.a1 - t.well.a0) / 2) rTerr = t.well.r;
      // 天板が歩廊の高さにある塔は、門口の扇を切り抜いてある(walls.js)。
      // そこは天板ではなく歩廊のランプが床。
      const topIsWalk = (t.galleryY ?? t.topY) > t.topY - 0.6;
      const inGate = topIsWalk && (towerGaps[name] || []).some(g => angDist(ang, g) < 0.42);
      if (!inGate && d < rTerr + 0.4) cands.push({ y: t.topY, zone: 'wall', pri: 6, tower: name });
      // ギャラリー床は歩廊の帯を空けてある(登ってくるランプの天井にしない)
      if (name === 'minceta' && d < t.crownR + 0.2 && nw.d >= deckEdge) {
        cands.push({ y: t.galleryY, zone: 'wall', pri: 6, tower: name });
      }
    }
    // 砲座の天端(見晴らしの床)
    if (Math.hypot(px - CAVALIER.x, pz - CAVALIER.z) < CAVALIER.r + 0.25) {
      cands.push({ y: CAVALIER.y, zone: 'wall', pri: 6 });
    }
    // 壁階段。段の箱は区間ごとに置かれるので、見える床はその和集合の最高面。
    // 最近傍の区間だけを見ると、折れ点で隣の区間の段に足がめり込む。
    for (const st of WALL_STAIRS) {
      let sy = -1e9;
      for (const sg of st.segs) {
        const t = (px - sg.ax) * sg.dx + (pz - sg.az) * sg.dz;
        if (t < -0.03 || t > sg.len + 0.03) continue;
        const lat = Math.abs((px - sg.ax) * sg.nx + (pz - sg.az) * sg.nz);
        if (lat > st.w / 2) continue;                  // 箱の実寸(幅 w)より外に床は無い
        const y = quantizeRun(sg.ay, sg.by, clamp(t / sg.len, 0, 1));
        if (y > sy) sy = y;
      }
      if (sy > -1e8) cands.push({ y: sy, zone: st.enclosed ? 'shaft' : 'stair', pri: 7 });
    }
    // 階段の到着踊り場(歩廊の内縁へ渡す板 — walls.js が同じ場所に石を置く)
    for (const lg of landings) {
      const t = (px - lg.x) * lg.ux + (pz - lg.z) * lg.uz;
      const lat = (px - lg.x) * -lg.uz + (pz - lg.z) * lg.ux;
      if (t > -0.15 && t < lg.len + 0.4 && lat < lg.halfPos && lat > -lg.halfNeg) {
        cands.push({ y: lg.y, zone: 'wall', pri: 6 });
      }
    }
    // 素地形(最後の受け皿)。城壁の外では実外部地形 — 水面下は歩けない値が返る。
    // 受け皿は「描かれた地面」そのもの。+0.28 を足すと、舗装の無いところで
    // 足だけが地表の上に浮く(市内の地形メッシュは -0.28 で張られている)。
    const fbTerrain = outsideHeight(px, pz);
    cands.push({ y: fbTerrain, zone: 'street', pri: 0 });

    // 選択則(三層):
    //  tier2 = 継ぎ目(±0.55m)— ここでだけ層を乗り換える。
    //          まず「専用の道」(pri 大)が勝つ。これが無いと、階段を下る途中で
    //          脇の歩廊デッキに吸い上げられて二度と降りられない。
    //          同じ層どうし(舗装と舗装・歩廊と塔)なら上に張られた面が勝つ —
    //          リボンは重ね張りで、上にある面が実際に見えている床だから。
    //  tier1 = 届く範囲(±1.8m)— 今の層に最も近い高さへ(pri で奪わない)。
    //          これが無いと、デッキの下を並走する階段が足を引きずり下ろす。
    //  tier0 = それ以外 — 最も近い高さへ(受け皿)。
    // ---- curY の罠(今日 3 度踏んだので書いておく)
    //   groundAt は「curY にいちばん近い床」を返す。だから curY は
    //   **その物が居るべき層の高さ** でなければならない。
    //   ・curY = 200 / 500 は「いちばん高い床」の意味になる。プレイヤーの
    //     生成と瞬間移動(壁上のプリセット)だけが正しい使い道。
    //   ・地面に置く物(巾木・汚れ帯・鉢・卓・灯)に 200 を渡すと、
    //     歩廊や砲座の天端に載る。実際に汚れ帯が砲座の上に立ち、視点に
    //     よっては画面の 30.4% を半透明の黒い板で塗っていた。
    //   ・省略も同じ穴(下)。
    //   置いた結果は tools/_ondeck.mjs で数えられる
    //   (「街路の物が歩廊・階段の天端に載っていないか」)。
    //
    // **curY を渡さない呼び出しが 4 箇所あった**(巾木・窓まわり・鉢)。
    // その場合 dy が NaN になり、tier が全部 0、比較もすべて false になるので
    // **候補の並び順の最初**がそのまま返っていた(= 広場があれば広場、無ければ
    // 最初に当たった街路)。実測で巾木 168 個が 0.12〜0.30m 沈んでいた原因。
    // 基準の高さが無いなら「見える床」= いちばん高い候補を返す。
    if (!(typeof curY === 'number' && isFinite(curY))) {
      let hi = null;
      for (const c of cands) if (!hi || c.y > hi.y) hi = c;
      return hi ? { ...hi, tier: 2, dy: 0 } : { y: fbTerrain, zone: 'street', tier: 0, dy: 0 };
    }
    let best = null;
    for (const c of cands) {
      if (c.y > curY + 1.45) continue;
      const dy = Math.abs(c.y - curY);
      const tier = dy <= 0.55 ? 2 : dy <= 1.8 ? 1 : 0;
      const better = !best
        || tier > best.tier
        || (tier === best.tier && tier === 2
          && (c.pri > best.pri || (c.pri === best.pri && c.y > best.y + 0.005)))
        || (tier === best.tier && tier < 2 && dy < best.dy);
      if (better) best = { ...c, tier, dy };
    }
    if (!best) best = { y: Math.min(fbTerrain, curY + 1.2), zone: 'street', tier: 0, dy: 0 };
    return best;
  }

  // ---- 衝突解決(円 vs 家AABB・壁・端) --------------------------------
  function collide(px, pz, r, py) {
    if (indexedHouses !== houses.length) indexHouses();   // 後から生えた量塊も必ず当たる
    let x = px, z = pz;
    // 通行帯の免除は先に判定(門の下・階段の上では体をぶつけない)
    let inGate = false, gateBlock = false;
    // 半径 5.6m の円で免除すると、開口幅 3.4m の外側 — つまり石の中 — まで
    // 素通しになる。通路の軸に垂直な距離で判定し、開口の中だけを免除する。
    for (const g of GATES) {
      const dx = x - g.x, dz = z - g.z;
      if (dx * dx + dz * dz > 64) continue;
      if (py > g.y + g.h - 0.25) continue;              // アーチより上は壁
      const lat = Math.abs(dx * g.tx + dz * g.tz);   // 壁の接線方向の距離
      // 門ブロック(幅 W=9)は壁体より 0.2m 厚い。柱の脇でここを見落とすと、
      // 押し出しの面が石の面より内側になり、袖柱に体が刺さる。
      if (lat < 4.7) gateBlock = true;
      if (lat < g.w / 2 - 0.12) { inGate = true; break; }
    }
    let inStair = false;
    for (const st of WALL_STAIRS) {
      const ns = nearestOnPolyline(st.pts, x, z);
      if (ns.d < st.w / 2 + 0.8 && Math.abs(py - ns.y) < 2.4) inStair = true;
    }
    // 踊り場の上では歩廊のレールで縛らない(板は歩廊の外まで渡してある)
    let onLanding = false;
    for (const lg of landings) {
      const t = (x - lg.x) * lg.ux + (z - lg.z) * lg.uz;
      const lat = (x - lg.x) * -lg.uz + (z - lg.z) * lg.ux;
      if (t > -0.9 && t < lg.len + 0.8 && lat < lg.halfPos + 0.4 && lat > -lg.halfNeg - 0.4
        && Math.abs(py - lg.y - 1.0) < 2.0) onLanding = true;
    }
    // 家屋(足元より十分高い屋根上は無視 — 歩廊から見下ろす屋根)
    for (let iter = 0; iter < 2; iter++) {
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const list = hashGrid.get(key(gx, gz));
        if (!list) continue;
        for (const i of list) {
          const h = houses[i];
          if (py > h.eaves + 0.5) continue;
          const hx = h.w / 2 + r, hz = h.d / 2 + r;
          const dx = x - h.x, dz = z - h.z;
          if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
            const ox = hx - Math.abs(dx), oz = hz - Math.abs(dz);
            if (ox < oz) x = h.x + Math.sign(dx || 1) * hx;
            else z = h.z + Math.sign(dz || 1) * hz;
          }
        }
      }
      // 追加衝突
      for (const b of extraColliders) {
        if (py > b.y1) continue;
        const hx = (b.x1 - b.x0) / 2 + r, hz = (b.z1 - b.z0) / 2 + r;
        const mx = (b.x0 + b.x1) / 2, mz = (b.z0 + b.z1) / 2;
        const dx = x - mx, dz = z - mz;
        if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
          const ox = hx - Math.abs(dx), oz = hz - Math.abs(dz);
          if (ox < oz) x = mx + Math.sign(dx || 1) * hx;
          else z = mz + Math.sign(dz || 1) * hz;
        }
      }
      for (const c of extraCylinders) {
        if (py > c.y1 - 0.3 || inGate || inStair) continue;
        const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz);
        if (d < c.r + r && d > 0.001) {
          x = c.x + (dx / d) * (c.r + r);
          z = c.z + (dz / d) * (c.r + r);
        }
      }
    }

    // 城壁: 下にいるときは壁体が壁、上にいるときは歩廊の縁がレール
    const nw = nearestOnPolyline(wallPts, x, z);
    const kind = wallKinds[Math.max(0, nw.i - 1)];
    const wk = WALL_KIND[kind] || WALL_KIND.sea;
    // 「歩廊の上にいる」の判定に高さしか使っていなかった。城壁から 91m 離れた
    // 北の斜面でも、たまたま標高が歩廊と 2.6m 以内に入れば「歩廊の上」と見なされ、
    // 縁のレールへ 89.6m 引き戻された(構造アサーションが実測)。
    // 歩廊に「いる」には、水平にも歩廊の上でなければならない。
    // 高さの窓は groundAt の「届く範囲」と一致していなければならない。
    // groundAt は候補が curY より 1.45m 以上高いと捨てる(届かない床)のに、
    // ここは 2.6m 下まで「歩廊の上」と見なしていた。その 1.45〜2.6m の帯では
    // **壁体に弾かれもせず、歩廊にも乗れない** — 城壁の footprint の中に
    // 入り込んで、外は 5m の崖、内は登れない段、という袋小路になる
    // (南の海側 (-115, 82.8) で報告。歩廊 14.70 に対し足 11.54)。
    // 下側の窓を groundAt の到達距離に合わせる。上側は歩廊の上に立つ余裕。
    const onWall = py > nw.y - 1.4 && py < nw.y + 2.6 && nw.d < wk.rT / 2 + 3.0;
    // 階段: 下腹は質量、コリドーの側壁は薄いシェルで閉じる(石壁を突き抜けない)
    for (const st of WALL_STAIRS) {
      const ns = nearestOnPolyline(st.pts, x, z);
      // 段の下も段の脇も石の塊。足が段の面より下にあるのに階段の footprint に
      // いるなら、それは段の中に立っている — 外へ出す。
      // (広場や街路から階段の横腹へ歩き込めてしまい、石段が頭の上に来ていた)
      if (ns.d < st.w / 2 + r && py < ns.y + 0.7) {
        const lim = st.w / 2 + r;
        // 中心線に重なっているときは接線の法線側へ逃がす(0除算で素通りしない)
        const nx2 = ns.d > 0.01 ? (x - ns.x) / ns.d : -ns.tz;
        const nz2 = ns.d > 0.01 ? (z - ns.z) / ns.d : ns.tx;
        x = ns.x + nx2 * lim; z = ns.z + nz2 * lim;
      }
      // 側壁 — 描画と同じマイターした面で判定する。
      // 石の面は中心線から seg.half。中にいる者は面の手前へ、外にいる者は面の先へ。
      // 「中にいるのに外へ弾き出す」分岐を作らないこと — それが壁抜けの正体だった。
      // 螺旋(mincetaTop)は横から一歩で乗る階段なので側壁を立てない
      // (立てると入口が塞がる。踏み外しても下は塔のギャラリー床)。
      const L = stairLens.get(st.id);
      if (!st.spiral) {
        let bestSeg = null, bestAbs = 1e9, bestY = 0, bestS = 0;
        for (const sg of st.segs) {
          const t = (x - sg.ax) * sg.dx + (z - sg.az) * sg.dz;
          if (t < 0 || t > sg.len) continue;          // 板はこの区間にしか無い
          const lat = Math.abs((x - sg.ax) * sg.nx + (z - sg.az) * sg.nz);
          if (lat < bestAbs) {
            bestAbs = lat; bestSeg = sg;
            bestY = sg.ay + (sg.by - sg.ay) * (t / sg.len);
            bestS = sg.s0 + t;
          }
        }
        // 両端(乗り換え口)は開けたまま。高さ帯は体が石に重なる範囲だけ。
        if (bestSeg && bestS > 0.15 && bestS < L - 1.7
          && py > bestY - 0.5 && py < bestY + (st.enclosed ? 2.4 : 2.0)) {
          const sg = bestSeg;
          // マイターした側壁の線に対する符号付き距離(正 = 石の外)
          for (const side of [1, -1]) {
            const A = st.offAt(sg.i - 1, side, sg.half), B = st.offAt(sg.i, side, sg.half);
            const ux = B[0] - A[0], uz = B[1] - A[1];
            const ul = Math.hypot(ux, uz) || 1;
            let qx = -uz / ul, qz = ux / ul;
            if ((qx * sg.nx + qz * sg.nz) * side < 0) { qx = -qx; qz = -qz; }
            const d = (x - A[0]) * qx + (z - A[1]) * qz;
            if (d > -r && d < 0) { x += qx * (-r - d); z += qz * (-r - d); }        // 中 → 面の手前
            else if (d >= 0 && d < r) { x += qx * (r - d); z += qz * (r - d); }     // 外 → 面の先
          }
        }
      }
    }
    // ミンチェタ王冠のリング(ギャラリー高さは門口だけ通す・天端は全周閉)
    {
      const t = TOWERS.minceta;
      const dxT = x - t.x, dzT = z - t.z, dT = Math.hypot(dxT, dzT);
      if (dT > t.r - 0.35 && dT < t.crownR + 0.45 && py > t.galleryY - 0.4 && dT > 0.01) {
        const ang = Math.atan2(dzT, dxT);
        const atTop = py > t.topY - 0.6;
        const inGap = !atTop && mincetaGaps.some(g => angDist(ang, g) < 0.5);
        if (!inGap) {
          const target = dT < (t.r + t.crownR) / 2 ? t.r - 0.4 : t.crownR + 0.5;
          x = t.x + (dxT / dT) * target;
          z = t.z + (dzT / dT) * target;
        }
      }
    }
    let onTower = null;
    for (const [name, t] of Object.entries(TOWERS)) {
      if (Math.hypot(x - t.x, z - t.z) < t.crownR + 1.2) onTower = t;
    }
    if (onWall && nw.d > 0.01) {
      // 歩廊の上: 中心線からの張り出しをクランプ(胸壁レール)
      const lim = wk.walkHalf - 0.28;
      if (nw.d > lim && !inStair && !onTower && !onLanding) {
        const nx = (x - nw.x) / nw.d, nz = (z - nw.z) / nw.d;
        x = nw.x + nx * lim; z = nw.z + nz * lim;
      }
    } else if (!inGate && !inStair && py < nw.y - 1.2) {
      // 市中・市外: 壁体に押し出される
      const hIdx = Math.max(0, Math.min(nw.i ?? 0, wallNodeHalf.length - 1));
      const lim = Math.max(wk.thick / 2, wallNodeHalf[hIdx]) + (gateBlock ? 0.2 : 0) + r;
      if (nw.d < lim) {
        // 押し出す向きは「中心線から見てどちら側にいるか」で決めていた。
        // 石の厚みの中では中心線までの距離が 1m 未満になり、向きがほとんど
        // 乱数になる。南の海壁ではそれで海側へ弾き出され、外は 5m の崖・
        // 内は登れない段、という袋小路に閉じ込められた(実測 z 82.8 → 85.23)。
        // 側は「壁の輪の内か外か」で決める。遠くでは同じ答えになり、
        // 石の中では安全な側(市内)に倒れる。
        const i1 = Math.max(1, Math.min(nw.i ?? 1, wallPts.length - 1));
        const A = wallPts[i1 - 1], B = wallPts[i1];
        const tx = B[0] - A[0], tz = B[1] - A[1];
        const tl = Math.hypot(tx, tz) || 1;
        let nx = -tz / tl, nz = tx / tl;
        if (!pointInPoly(wallLoop, nw.x + nx * lim, nw.z + nz * lim)) { nx = -nx; nz = -nz; }
        // 城壁の外を歩く帯(岸壁・防波堤・橋)に居る者は、そのまま外へ。
        // それ以外は「中心線から 0.9m 外側まで」を市内側とみなす —
        // 石の厚みの中で迷ったら、閉じ込めるより街へ戻すほうが常に正しい。
        let outside = false;
        for (const wlk of OUTSIDE_WALKS) {
          if (x <= wlk.x0 - 2 || x >= wlk.x1 + 2 || z <= wlk.z0 - 2 || z >= wlk.z1 + 2) continue;
          outside = true; break;
        }
        if (!outside) {
          const proj = (x - nw.x) * nx + (z - nw.z) * nz;   // + = 市内側
          outside = proj < -0.9;
        }
        if (outside) { nx = -nx; nz = -nz; }
        x = nw.x + nx * lim; z = nw.z + nz * lim;
      }
    }
    // 塔テラス・ギャラリーの縁(歩廊コリドー上と階段上は通す)
    if (onTower) {
      const nearWalkCorridor = nw.d < wk.walkHalf + 0.35;
      const atTop = Math.abs(py - onTower.topY) < 2;
      const atGallery = onTower.galleryY !== undefined && Math.abs(py - onTower.galleryY) < 2 && !atTop;
      if ((atTop || atGallery) && !inStair && !nearWalkCorridor) {
        const dx = x - onTower.x, dz = z - onTower.z, d = Math.hypot(dx, dz);
        // テラスの縁は「描かれた床の縁」— 螺旋の井筒へ踏み出させない
        const lim = atTop
          ? (onTower.terraceR ?? (onTower.crownR - 0.80)) - 0.25
          : onTower.crownR - 0.55;
        if (d > lim) { x = onTower.x + (dx / d) * lim; z = onTower.z + (dz / d) * lim; }
      }
    }
    // 防波堤・岸壁・橋の端(海へ落ちない)
    for (const w of OUTSIDE_WALKS) {
      if (px > w.x0 - 2 && px < w.x1 + 2 && pz > w.z0 - 2 && pz < w.z1 + 2 && Math.abs(py - w.y) < 2) {
        if (w.id === 'porporela') {
          // 南縁はエプロン接続部(x≤182)だけ開放。北縁と突端は海。
          if (z > w.z1 - 0.4) z = w.z1 - 0.4;
          if (z < w.z0 + 0.4 && x > 182) z = w.z0 + 0.4;
          x = Math.min(x, w.x1 - 0.4);
        }
        // 橋の西端は行き止まりではなくなった(岩から下りた岸が続く)。
        // x を橋台より東へ押し戻す壁が残っていて、橋の袂に立つと 2.2m
        // 東へ弾かれ、いつまでも橋に上がれなかった。横(壕)だけ押す。
        if (w.id === 'pileBridge' && px > w.x0 + 0.3) z = clamp(z, w.z0 + 0.4, w.z1 - 0.4);
        // 斜めの橋(has を持つ帯)は帯の中心線からの横距離で押し戻す
        if (w.has && w.halfW) {
          const dbx = w.bx[0] - w.ax[0], dbz = w.bx[1] - w.ax[1];
          const L2 = dbx * dbx + dbz * dbz;
          const t = clamp(((x - w.ax[0]) * dbx + (z - w.ax[1]) * dbz) / L2, 0, 1);
          const cx = w.ax[0] + dbx * t, cz = w.ax[1] + dbz * t;
          const dl = Math.hypot(x - cx, z - cz);
          const lim = w.halfW - 0.35;
          // 端(t=0/1)では地面が続くので押さない。橋の途中だけ落ちないようにする。
          if (dl > lim && t > 0.02 && t < 0.98 && dl > 0.001) {
            x = cx + (x - cx) / dl * lim; z = cz + (z - cz) / dl * lim;
          }
        }
      }
    }
    if (py < 3.5 && x > 158) { // 岸壁の水際(城壁外の歩行帯の上は除く)
      const quay = streets.find(s => s.id === 'quay');
      const nq = nearestOnPolyline(quay.pts, x, z);
      if (nq.d > quay.w / 2 - 0.35 && x > nq.x) {
        const onWalkRect = OUTSIDE_WALKS.some(w2 =>
          x > w2.x0 - 0.5 && x < w2.x1 + 0.5 && z > w2.z0 - 0.5 && z < w2.z1 + 0.5 && Math.abs(py - w2.y - 1) < 2.5);
        if (!onWalkRect) { const nx = (x - nq.x) / nq.d, nz2 = (z - nq.z) / nq.d; x = nq.x + nx * (quay.w / 2 - 0.35); z = nq.z + nz2 * (quay.w / 2 - 0.35); }
      }
    }
    // 水には入れない。岸は 2〜6m の崖なので、落ちると二度と戻れない
    // (実測 ポルポレラの先端と、プロチェ橋の東の磯で 2 箇所)。
    // 判定は「地形が水面より下か」ではなく「**足が乗る床**が低いか」。
    // 前者だと、海の上に架かる防波堤や岸壁に立っている者まで押し出す。
    // 敷居は水面のすぐ下(−0.25m)。これより上げると、ロヴリイェナツへの
    // 低い取り付き(0.3〜2.8m)まで塞いで、そちらが袋小路になる。
    {
      // py は「足元 + 1.0m」で渡ってくる(player.js / life.js とも)。
      // 床の解決は足の高さで問わないと、1m ぶん違う層を拾う。
      const feet = py - 1.0;
      // 水そのものに加えて、「汀まで落ちる縁」も塞ぐ。汀の岩(0〜0.9m)は
      // 背後が 2〜8m の崖なので、降りられても登れない。落差 1.6m 以上で
      // 行き先が 1.2m より低いなら、そこは海へ落ちる縁。
      // 一度押しただけでは境界の外へ出きらないことがある(実測 0.36m しか
      // 動かず、罠がひとつ残った)。境界に届くまで繰り返す — 呼び手が渡して
      // くる点は既に禁止域の中なので、返る点は「元居た所の際」になる。
      for (let it = 0; it < 4; it++) {
        const g2 = groundAt(x, z, feet);
        if (!g2) break;
        const fall = feet - g2.y;
        // 「水に落ちる縁」だけを塞いでいたが、崖はどこにでもできる。
        // 登れる段差は 0.55m なので、**1.6m 以上の落差はすべて一方通行** —
        // 落ちた先が水面より上でも同じこと。南の街区を不整形にしたら、
        // 家の帯の隙間に 1 マスの落とし穴が 3 箇所できた(trapstest)。
        // 高さで例外を作らない。落ちれば戻れない縁は、全部縁。
        if (!(g2.y < -0.25 || fall > 1.6)) break;
        // 地形の勾配を登る向きへ押す
        const gx = surfaceAt(x + 1.2, z) - surfaceAt(x - 1.2, z);
        const gz = surfaceAt(x, z + 1.2) - surfaceAt(x, z - 1.2);
        const gl = Math.hypot(gx, gz);
        if (gl < 1e-4) break;
        x += (gx / gl) * 0.8; z += (gz / gl) * 0.8;
      }
    }
    return { x, z };
  }

  return {
    alleySamples, mincetaGaps, towerGaps, outsideHeight, surfaceAt, pavedY, plazaWall, NEAR, landings, shoreDistAt, seaDepth,
    HOUSE_BASE_BURY,
    streets, northXs, southXs, houses, PLAZAS, MONUMENTS, GATES,
    JESUIT_STAIR, WALL_STAIRS, OUTSIDE_WALKS, TOWERS, TERRACES, moatAt, alleyXAt,
    wallPts, wallKinds, wallLen, WALL_KIND, wallNodeHalf, deckEdgeAt, wallSegN, wallWalkYAt, wallWalkYOn,
    terrainHeight, streetY, groundAt, collide, inNoBuild,
    extraColliders, extraCylinders, CAVALIER,
  };
}

// ---------------------------------------------------------------- ルート ----
// おすすめの散歩道。自動ウォークモードと実路テストが同じ定義を使う。
// wp: {x, z, pause?, gaze?{yaw,pitch}, hint?}
export function makeRoutes(plan) {
  const aN = x0 => plan.northXs.reduce((a, b) => (Math.abs(b - x0) < Math.abs(a - x0) ? b : a));
  const st = id => plan.WALL_STAIRS.find(s2 => s2.id === id);
  const P = (x, z, extra) => ({ x, z, ...(extra || {}) });
  const stairWps = (id, rev = false) => {
    const pts = st(id).pts.map(p2 => P(p2[0], p2[1]));
    return rev ? [...pts].reverse() : pts;
  };

  // ① 朝のストラドゥン → 路地で迷う → ルジャ広場
  const a1 = aN(-64), a2 = aN(18), a3 = aN(96);
  const routeA = {
    id: 'stradun', name: '朝のストラドゥンと路地', time: 8.2,
    wps: [
      P(-147, 0.3, { hint: 'ピレ門から、磨かれた石の上を' }),
      P(-100, 0), P(a1 - 0.2, 0.4),
      P(a1, -3, { hint: '路地へ — 空が細くなる' }),
      P(a1, -20, { pause: 2.5, gaze: { yaw: Math.PI, pitch: 0.12 } }),
      P(a1, -35),
      P(a1 + 1, -36), P(a2 - 1, -36, { hint: 'プリイェコ通り — 迷いの横糸' }),
      P(a2, -35), P(a2, -3),
      P(a2 + 1, 0), P(80, 0), P(a3, 0.5),
      P(120, 0.5), P(138, 1, { pause: 3, gaze: { yaw: -1.35, pitch: 0.35 }, hint: '鐘楼 — 街の時計' }),
    ],
  };

  // ② ミンチェタ登頂(階段室の暗がり → 歩廊 → 王冠 → テラス)
  const shaft = stairWps('mincetaShaft');
  const spiral = stairWps('mincetaTop');
  const routeB = {
    id: 'minceta', name: 'ミンチェタ登頂(黄金の時間)', time: 19.0,
    wps: [
      P(-88, -74, { hint: 'ペリネ通り — 壁の足元の道' }),
      P(-100, -74.4),
      shaft[0], ...shaft.slice(1).map(w => ({ ...w })),
      P(-107, -85.6),
      P(-112, -84.9, { hint: '歩廊 — 屋根の海の上' }),
      P(-119.5, -82.8),
      P(-124, -82),
      spiral[0], ...spiral.slice(1),
      P(-117, -84.5, { pause: 6, gaze: { yaw: -2.36, pitch: -0.12 }, hint: 'ミンチェタ — 街でいちばん高いところ' }),
    ],
  };

  // ③ 城壁一周(ピレの大階段 → 南へ → ピレ門上 → 北回りで一周 → 大階段へ戻る)
  // 壁ノードは 0..30(31 は 0 の複製)。大階段の取り付き(29-30 区間)から
  // 南へ → ピレ門上(0)→ 北回りで一周 → 取り付きへ戻る。
  const order = [30, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29];
  const loopWps = order.map(i => P(plan.wallPts[i][0], plan.wallPts[i][1]));
  // 眺めのポーズ(順序配列の位置で指定)
  loopWps[5] = { ...loopWps[5], pause: 4, gaze: { yaw: -2.3, pitch: -0.1 }, hint: 'ミンチェタから — 屋根の海と、その先の海' };  // (-122,-82)
  loopWps[17] = { ...loopWps[17], pause: 3, gaze: { yaw: 0.6, pitch: -0.15 }, hint: '旧港 — 舫い舟と防波堤' };                 // (168,16)
  loopWps[24] = { ...loopWps[24], pause: 3, gaze: { yaw: 2.9, pitch: -0.05 }, hint: '外は開けた海 — ロクルムが浮かぶ' };        // (18,104)

  const routeC = {
    id: 'walls', name: '城壁一周(大めぐり)', time: 17.2,
    wps: [
      P(-146, 10, { hint: 'ピレの大階段から城壁へ' }),
      ...stairWps('pileStair'),
      P(-154.7, 24.8),   // デッキへ渡る(階段の扇の上を横切らない)
      ...loopWps,
      P(-154.7, 24.8),
      ...stairWps('pileStair', true),
    ],
  };

  // ④ ルジャ → ポンテ門 → 旧港 → 防波堤の突端
  const routeD = {
    id: 'porat', name: '旧港と防波堤(夕暮れ)', time: 19.6,
    wps: [
      P(146, 2, { hint: 'ルジャ広場から港へ' }),
      P(156, -2), P(162, -5),
      P(166, -6, { hint: 'ポンテ門 — 石の喉の先に水明かり' }),
      P(171, -6.5),
      // 岸壁の中ほどを歩く。壁際を通すとアルセナルの柱(壁面から 2.7m 出る)に
      // 当たり続けて前へ進めない。柱は x 168.5〜174.2 に並ぶ。
      // 絶対方位。真横(1.86)だと 3.5m の距離で石の壁になる。前方斜めに見る。
      P(176.6, -3.4, { gaze: { yaw: 2.72, pitch: 0.12 }, hint: 'アルセナル — 中世の造船所' }),
      P(176.6, 8), P(176.6, 20), P(176.4, 32),
      P(175.2, 42, { pause: 2.5, gaze: { yaw: 0.6, pitch: 0.1 } }),
      P(177.5, 46),
      P(180.7, 52.5),
      P(180.7, 58),
      P(181.5, 61.5),
      P(196, 61.5),
      P(210, 61.5, { pause: 6, gaze: { yaw: 1.35, pitch: 0.06 }, hint: '防波堤の突端 — 海から見る城' }),
    ],
  };

  return [routeA, routeB, routeC, routeD];
}

// プリセット(しるべの場所)。時刻もセットで切り替える。
// 路地は生成に依存するので、plan から実在の路地 x に吸着させる。
export function makePresets(plan) {
  const alleyNear = x0 => plan.northXs.reduce((a, b) => Math.abs(b - x0) < Math.abs(a - x0) ? b : a);
  // yaw: 前方 = (−sin yaw, 0, −cos yaw)。北=0 / 東=−π/2 / 南=π / 西=+π/2
  return [
    { id: 1, name: 'ピレ門・朝のストラドゥン', x: -147, z: 0.3, yaw: -Math.PI / 2, pitch: 0.02, time: 8.2 },
    { id: 2, name: '真昼の階段路地', x: alleyNear(-64), z: -22, yaw: 0, pitch: -0.05, time: 12.6 },
    { id: 3, name: 'ミンチェタ・黄金の時', x: -99, z: -88.4, yaw: -2.36, pitch: -0.14, time: 19.7 },
    { id: 4, name: '日没の海の胸壁', x: 60, z: 100.5, yaw: -2.62, pitch: -0.03, time: 20.1 },
    // ---- 眺めの場所。時刻は変えない(今の空のまま連れて行く)。
    // 数値は目で選んでいない。tools/viewtest.mjs が全ての行ける場所へ
    // 144 本の射線を撃って測った「正面 180° の海の割合」と
    // 「22m 以内で視界を塞ぐ割合」。向きも「海がいちばん見える半円」の中心。
    { id: 5, view: 1, name: '見晴らしの砲座(聖イヴァン)', x: 177.5, z: 57.5,
      yaw: -2.967, pitch: -0.02, h: 17.4, sea: 90, block: 0 },
    { id: 6, view: 1, name: 'ロヴリイェナツの岩', x: -248, z: 95,
      yaw: -3.142, pitch: -0.02, h: 25.5, sea: 86, block: 0 },
    { id: 7, view: 1, name: '南の海壁', x: 120, z: 88,
      yaw: -2.967, pitch: -0.02, h: 16.0, sea: 94, block: 3 },
    { id: 8, view: 1, name: 'ミンチェタ天板(街と屋根)', x: -122, z: -82,
      yaw: -2.967, pitch: -0.06, h: 34.7, sea: 57, block: 36 },
    { id: 9, view: 1, name: '旧港の防波堤', x: 200, z: 60,
      yaw: -2.793, pitch: -0.02, h: 1.5, sea: 83, block: 6 },
    { id: 0, view: 1, name: 'ルジャ広場', x: 140, z: 0,
      yaw: 2.967, pitch: 0.0, h: 2.6, sea: 1, block: 75 },
  ];
}
