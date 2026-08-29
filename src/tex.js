// ============================================================================
// tex.js — 手続きテクスチャ工房。外部画像は使わない。
// 方針: ベタ塗り禁止。すべての面に筆致(トーンの揺らぎ・染み・経年)を入れる。
// 色マップ + 高さ→法線。実寸 UV(石やタイルの寸法は世界のどこでも実寸)。
// ============================================================================
import * as THREE from 'three';
import { mulberry32, clamp, lerp } from './util.js';
import { rngFor } from './seed.js';

function canvas(size, h = size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

function toTex(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 16;   // 城壁歩廊のような掠める面はここで決まる
  return t;
}

// 高さ(キャンバスの明度)→ 法線マップ
function heightToNormal(src, strength = 2.0) {
  const w = src.width, h = src.height;
  const sctx = src.getContext('2d');
  const sd = sctx.getImageData(0, 0, w, h).data;
  const [c, ctx] = canvas(w, h);
  const out = ctx.createImageData(w, h);
  const hAt = (x, y) => sd[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * strength;
    const dy = (hAt(x, y + 1) - hAt(x, y - 1)) * strength;
    const inv = 1 / Math.hypot(dx, dy, 1);
    const i = (y * w + x) * 4;
    out.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
    out.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
    out.data[i + 2] = (inv * 0.5 + 0.5) * 255;
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

// 低周波の値ノイズ。**石を跨ぐ尺度**の斑をつくるためだけに使う。
// 石ひとつの中で色相を動かすのは禁止(パッチワークの色砂岩になる)が、
// 「雨に洗われて白茶けた面」と「風下に汚れが溜まった面」が同じ壁に同居するのは
// 実在する。それは石より大きい尺度の話なので、ここで作る。
// cells は一辺の格子数。整数なのでタイルの継ぎ目で必ず値が一致する。
function lfNoise(seedA, cells) {
  const h = (i, j) => {
    const ii = ((i % cells) + cells) % cells, jj = ((j % cells) + cells) % cells;
    const v = Math.sin(ii * 127.1 + jj * 311.7 + seedA) * 43758.5453;
    return v - Math.floor(v);
  };
  return (fx, fy) => {
    const i = Math.floor(fx), j = Math.floor(fy);
    const u = fx - i, v = fy - j;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    return (h(i, j) * (1 - su) + h(i + 1, j) * su) * (1 - sv)
      + (h(i, j + 1) * (1 - su) + h(i + 1, j + 1) * su) * sv;
  };
}

// 筆致: 領域に半透明の色斑を重ねる(絵具の厚み)
function dabs(ctx, x0, y0, w, h, n, rng, hue, sat, lit, spread, alpha = 0.10) {
  for (let i = 0; i < n; i++) {
    const x = x0 + rng() * w, y = y0 + rng() * h;
    // 大きさは対数一様。同じ直径の円が等間隔に並ぶと、一目でスタンプに見える。
    const r = 1.2 + spread * Math.pow(rng(), 2.4);
    ctx.fillStyle = `hsla(${hue + (rng() - 0.5) * 14},${sat + (rng() - 0.5) * 12}%,${lit + (rng() - 0.5) * 13}%,${alpha * (0.4 + rng() * 0.9)})`;
    ctx.beginPath();
    // 水は下へ流れる。縦長にして、傾きを ±12° に抑える。
    ctx.ellipse(x, y, r * (0.45 + rng() * 0.5), r * (0.9 + rng() * 1.4), (rng() - 0.5) * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- 石壁 ----
// coverM: テクスチャが覆う実寸(m)。石は 0.62×0.30 目安の切石積み。
// 実測: 段高 0.22〜0.32m(平均 0.26)、長さ 0.40〜0.90m(平均 0.62)、目地は 6〜12mm 沈む。
// 石灰岩の単一素材の街なので、ブロックごとに変わってよいのは「明度」だけ。
// 色相が振れるとパッチワークの色砂岩に見え、赤瓦・緑鎧戸・青い海の三色が濁る。
function limestoneWall(rng, { size = 1024, coverM = 3.2, courseM = 0.26, tone = 0 }) {
  const [c, ctx] = canvas(size);
  const [hc, hctx] = canvas(size);
  const px = size / coverM; // 1m のピクセル数
  // 地 = 目地。石より「暗い」こと(明るい目地はタイルに見える)。
  ctx.fillStyle = `hsl(42,${13 - tone * 2}%,${44 + tone * 3}%)`;   // 目地は沈んだ影(石との差 ΔL 27)
  ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#787878'; hctx.fillRect(0, 0, size, size);

  const courseH = courseM * px;
  // 彩度の低周波。石灰岩は「方解石の中性〜寒色の地」に「酸化鉄と地衣の暖色の染み」が
  // 乗った物で、雨に洗われた面は彩度 6〜8%、庇の下や風下は 18〜22%。
  // 街中の石が一律 15〜17% だと、青い天空光がどの面でも同じ暖色に吸われ、
  // 日陰の立面が無彩の灰色の板になる(実測 彩度 0.018)。
  const lfS = lfNoise(17.3, 6), lfS2 = lfNoise(91.7, 2);
  let y = 0, row = 0;
  while (y < size + courseH) {
    const ch = courseH * (0.85 + rng() * 0.3);
    let x = -rng() * 0.5 * px;
    while (x < size + px) {
      const bw = (0.40 + rng() * 0.50) * px;
      // 石ひとつ: 明度だけを振る。色相 ±0.3° / 彩度 ±1.5% に固定。
      const litBase = 71 + tone * 3 + (rng() - 0.5) * 12;   // 目地が太くなるぶん石の振れは詰める
      const hueBase = 42 + (rng() - 0.5) * 0.6;
      const nq = (lfS(x / size * 6, y / size * 6) * 0.55 + lfS2(x / size * 2, y / size * 2) * 0.45) - 0.5;
      const satBase = clamp(16 + (rng() - 0.5) * 3 + nq * 15, 7, 25);
      ctx.fillStyle = `hsl(${hueBase},${satBase}%,${litBase}%)`;
      // 目地の **色** 側だけ 2px 固定で取り残されていた(320px/m で実寸 6mm)。
      // 高さ側は 12mm 取ってあるのに、色はミップ 1 段で 1px、2 段で消える。
      // 遠景の石積みが「白い紙」になっていた実測 — 局所SD がどの尺でも 0.006。
      const jwc = Math.max(2.6, 0.014 * px);            // 実寸 14mm(切石の実際の目地は 8〜15mm)
      ctx.fillRect(x + jwc * 0.5, y + jwc * 0.5, bw - jwc, ch - jwc);
      // 石の面の筆致
      dabs(ctx, x + 2, y + 2, bw - 4, ch - 4, 4, rng, hueBase, satBase, litBase, bw * 0.12, 0.10);
      // 骨材の粒。大きな染みだけでは「塗った壁」で、掠め光で面が読めない
      // (実測 局所SD r=2 が 0.005〜0.009 = 石の面そのものに情報がゼロ)。
      // 半径 1.2〜2.3px = 実寸 4〜7mm の粒を面積比で撒く。
      // 骨材は **法線だけでなく色にも** 要る。高さ側 /150 に対し色側 /900 = 6:1 で、
      // 太陽が高い正午は法線が寄与しないので、面のアルベドに何も無い状態になっていた
      // (実測 単一ブロック内 SD 0.0064 = 相対 4.2%)。足りないのは振幅ではなく密度。
      dabs(ctx, x + 2, y + 2, bw - 4, ch - 4, Math.round(bw * ch / 60), rng,
        hueBase, satBase, litBase, 1.0, 0.035);
      // 高さ: 石面はわずかに膨らみ、目地が薄く沈む
      const bump = 168 + rng() * 52;   // 目地(地=140)より高く = 8mm の溝が出る
      // 1.5px 固定の目地は実寸 4.7mm。ミップ 1 段で消えて、街全体の法線が死ぬ。
      // 実寸 12mm で描き、縁にグラデを置いて 2〜3 段生き延びさせる。
      const jw = Math.max(2.2, 0.012 * px);
      hctx.fillStyle = `rgb(${bump},${bump},${bump})`;
      hctx.fillRect(x + jw, y + jw, bw - jw * 2, ch - jw * 2);
      const g = hctx.createRadialGradient(x + bw / 2, y + ch / 2, 1, x + bw / 2, y + ch / 2, bw * 0.6);
      g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0.06)');
      hctx.fillStyle = g; hctx.fillRect(x, y, bw, ch);
      // 高さ側は矩形とグラデ 1 枚だけで、**法線が目地の縁しか持っていなかった**。
      // 掠め光を当てても壁がガラスのようにのっぺりする実測の正体。骨材を焼く。
      hctx.save();
      hctx.beginPath(); hctx.rect(x + jw, y + jw, bw - jw * 2, ch - jw * 2); hctx.clip();
      // 振幅は「粒」であって「水玉」ではない。±20/255 を法線強度 2.6 で
      // 起こすと法線が ±0.22 振れ、1 個ずつの丸い凸として見えてしまう。
      // 密度 /150 = 粒の間隔 5.7cm・径 4〜7mm は「骨材」ではなく打ち出しの水玉。
      // 掠め光で点々と読め、高い太陽では消える。数を 6 倍にして振幅を半分にする。
      for (let k = 0; k < Math.round(bw * ch / 26); k++) {
        const gx = x + rng() * bw, gy2 = y + rng() * ch, gr = 0.4 + rng() * 0.9;
        const v = bump + (rng() < 0.5 ? -1 : 1) * (1.2 + rng() * 2.2);
        hctx.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
        hctx.beginPath();
        hctx.ellipse(gx, gy2, gr, gr * (0.7 + rng() * 0.6), rng() * 3.14, 0, 7);
        hctx.fill();
      }
      hctx.restore();
      x += bw;
    }
    y += ch; row++;
  }
  // 経年: 雨だれ・くすみの縦帯(かすかに — 強いとガラスの汚れに見える)
  for (let i = 0; i < 26; i++) {
    const x = rng() * size, w = (0.06 + rng() * 0.24) * px;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, 'rgba(70,64,52,0)');
    g.addColorStop(0.5, `rgba(70,64,52,${0.025 + rng() * 0.035})`);
    g.addColorStop(1, 'rgba(70,64,52,0)');
    ctx.fillStyle = g;
    const y0 = rng() * size * 0.6;
    ctx.fillRect(x, y0, w, size - y0);
  }
  // 地衣類・シミの斑
  dabs(ctx, 0, 0, size, size, 130, rng, 46, 18, 52, px * 0.10, 0.05);
  dabs(ctx, 0, 0, size, size, 60, rng, 90, 14, 48, px * 0.06, 0.04);
  return { map: toTex(c), normalMap: toTex(heightToNormal(hc, 2.6), { srgb: false }), coverM };
}

// 要塞の粗石積み(城壁用: 大きめ・粗い・海風の染み)
// 要塞の切石: 段高 0.30〜0.50m、長さ 0.60〜1.20m。coverM 7 だと 2.5m 級の巨石になる。
function fortStone(rng, { size = 1024, coverM = 4.2 }) {
  const [c, ctx] = canvas(size);
  const [hc, hctx] = canvas(size);
  const px = size / coverM;
  ctx.fillStyle = 'hsl(42,14%,44%)'; ctx.fillRect(0, 0, size, size);   // 目地は影
  // **目地は必ず沈む。** 地 136 に対し石が 120〜190 だったので、石の 22.9% が
  // 目地より低く、その石では目地が「隆起した明るいリッジ」になっていた
  // (実測 wall の歪度が 16 行中 13 行で正 = 明るい目地 = バスルームタイル)。
  // 地を石の下限より下に置く。差 10/255 × strength 2.4 で実効 8mm の溝。
  hctx.fillStyle = '#6e6e6e'; hctx.fillRect(0, 0, size, size);
  const lfF = lfNoise(53.9, 6), lfF2 = lfNoise(203.1, 2);
  let y = 0;
  while (y < size + px) {
    const ch = (0.30 + rng() * 0.20) * px;
    let x = -rng() * px;
    while (x < size + px) {
      const bw = (0.60 + rng() * 0.60) * px;
      // 要塞の石も単一素材。色相は動かさず、明度だけ。
      const lit = rng() < 0.05 ? 58 + rng() * 5 : 69 + (rng() - 0.5) * 10;
      const jw2 = Math.max(2.4, 0.014 * px);
      const nqf = (lfF(x / size * 6, y / size * 6) * 0.55 + lfF2(x / size * 2, y / size * 2) * 0.45) - 0.5;
      // 海風と雨に洗われた面は白茶け、風下は汚れが溜まる。彩度だけを低周波で振る。
      const satF = clamp(15 + rng() * 3 + nqf * 13, 7, 25);
      ctx.fillStyle = `hsl(${42 + (rng() - 0.5) * 0.8},${satF}%,${lit}%)`;
      // 色側の目地も高さ側と同じ幅にする(3px 固定ではミップで消えていた)
      ctx.fillRect(x + jw2 * 0.5, y + jw2 * 0.5, bw - jw2, ch - jw2);
      dabs(ctx, x + 2, y + 2, bw - 4, ch - 4, 6, rng, 34, 12, lit, bw * 0.14, 0.12);
      dabs(ctx, x + 2, y + 2, bw - 4, ch - 4, Math.round(bw * ch / 70), rng, 34, 12, lit, 1.0, 0.032);
      const bump = 120 + rng() * 70;
      hctx.fillStyle = `rgb(${bump},${bump},${bump})`;
      hctx.fillRect(x + jw2, y + jw2, bw - jw2 * 2, ch - jw2 * 2);
      // 要塞石にも骨材。城壁は画面を占める面積がいちばん大きい。
      hctx.save();
      hctx.beginPath(); hctx.rect(x + jw2, y + jw2, bw - jw2 * 2, ch - jw2 * 2); hctx.clip();
      // 等方の丸い粒を 5.7cm 間隔・径 4〜14mm で撒くと、それは骨材ではなく
      // **打ち出しの板金**になる(全部同じ大きさ・全部同じ形・全部凸)。
      // 石工が石を仕上げるときの跡は方向を持つ — 一つの石の中では向きが揃い、
      // 石が変われば向きも変わる。長軸 8〜25mm の短い線分にして、
      // 数を 7 倍・振幅を半分にする。
      // 向きの揃った長い線分だけにすると、石ではなく **木肌** に見える。
      // 実物のビシャン叩きは「向きの揃った短い打痕」と「等方の骨材」の混合。
      // 7 割を短い打痕(5〜13mm)、3 割を等方の粒にする。振幅は浅く。
      const ang0 = rng() * Math.PI;
      for (let k = 0; k < Math.round(bw * ch / 20); k++) {
        const gx = x + rng() * bw, gy2 = y + rng() * ch;
        const dir = rng() < 0.7;
        const gl = (dir ? 0.005 + rng() * 0.008 : 0.0015 + rng() * 0.0025) * px;
        const v = bump + (rng() < 0.5 ? -1 : 1) * (0.9 + rng() * 1.8);
        hctx.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
        hctx.beginPath();
        hctx.ellipse(gx, gy2, gl, dir ? Math.max(0.42, gl * 0.30) : gl * (0.7 + rng() * 0.6),
          dir ? ang0 + (rng() - 0.5) * 0.55 : rng() * 3.14, 0, 7);
        hctx.fill();
      }
      hctx.restore();
      x += bw;
    }
    y += ch;
  }
  dabs(ctx, 0, 0, size, size, 160, rng, 34, 10, 44, px * 0.16, 0.05);
  // 下部の潮の帯りは幾何(頂点色)で付けるのでテクスチャは中立に保つ
  // 目地を深くし、粒を細かくしたぶん、法線の強度は落とす(walls.js の
  // normalScale と合わせて 4.76 → 3.24 = 68%)。目地は強くなり、粒は柔らかくなる。
  return { map: toTex(c), normalMap: toTex(heightToNormal(hc, 2.4), { srgb: false }), coverM };
}

// 框・迫石・窓台・巾木・柱 — **一枚石の見付**。目地は入らない。
// これらは BoxGeometry の面ごとに UV 0..1 なので、幅 0.17m の縦枠の正面に
// 3.2m 分の切石が丸ごと入り、段高 0.26m が 13.8mm の縞に潰れていた
// (= 石ではなく段ボールの小口)。**四つ目の仕上げ**はここで作る。
// 目地の無い細かい肌なので、どの UV 尺で貼っても破綻しない。
function dressedFace(rng, { size = 512, coverM = 0.9 } = {}) {
  const [c, ctx] = canvas(size);
  const [hc, hctx] = canvas(size);
  const px = size / coverM;
  ctx.fillStyle = 'hsl(41,15%,66%)'; ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#8c8c8c'; hctx.fillRect(0, 0, size, size);
  // 低周波のむら(一枚石の中の色の差)。周期は面より大きくならないよう 2 格子。
  const lfD = lfNoise(311.5, 4);
  for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++) {
    const v = lfD(gx + 0.5, gy + 0.5);
    ctx.fillStyle = `rgba(${v > 0.5 ? '255,250,238' : '96,88,72'},${Math.abs(v - 0.5) * 0.10})`;
    ctx.fillRect(gx * size / 4 - 2, gy * size / 4 - 2, size / 4 + 4, size / 4 + 4);
  }
  // 骨材。磨いた見付なので浅く細かい。
  dabs(ctx, 0, 0, size, size, Math.round(size * size / 90), rng, 41, 14, 66, 1.0, 0.030);
  dabs(ctx, 0, 0, size, size, Math.round(size * size / 2600), rng, 38, 16, 58, 2.2, 0.045);
  // ノミの跡。向きは 1 枚の中で揃える(一枚石だから)。
  const ang = rng() * Math.PI;
  for (let k = 0; k < Math.round(size * size / 26); k++) {
    const gx = rng() * size, gy = rng() * size;
    const gl = (0.004 + rng() * 0.006) * px;
    const v = 140 + (rng() < 0.5 ? -1 : 1) * (1.0 + rng() * 2.0);
    hctx.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
    hctx.beginPath();
    hctx.ellipse(gx, gy, gl, Math.max(0.42, gl * 0.28), ang + (rng() - 0.5) * 0.5, 0, 7);
    hctx.fill();
  }
  return { map: toTex(c), normalMap: toTex(heightToNormal(hc, 1.1), { srgb: false }), coverM };
}

// ---------------------------------------------------------------- 舗装 ----
// ストラドゥン: 鏡のように磨かれた石灰岩の長板。roughnessMap で中央ほど磨く。
// **床は画面でいちばんカメラに近い面**(足元 1.6m)なのに、テクセル密度が
// 街でいちばん粗かった(170.7 px/m。ファサードは 320、要塞石は 243.8)。
// タイルの周期(coverM)を詰めると反復が見えるので、解像度のほうを上げる。
function stradunPaving(rng, { size = 2048, coverM = 6 }) {
  const [c, ctx] = canvas(size);
  const [hc, hctx] = canvas(size);
  const [rc, rctx] = canvas(size);
  const px = size / coverM;
  ctx.fillStyle = 'hsl(35,14%,28%)'; ctx.fillRect(0, 0, size, size);   // 目地の細い影(石 L=55 に対し ΔL 27)
  // 地 153 に対し石が 150〜180 で、石の 10% が目地より低かった(明るい目地)。
  hctx.fillStyle = '#8a8a8a'; hctx.fillRect(0, 0, size, size);
  rctx.fillStyle = '#b4b4b4'; rctx.fillRect(0, 0, size, size);   // 目地はざらつく
  // 長板 1.1×0.55(通りを横切る向きに敷かれる)
  let y = 0, rowk = 0;
  while (y < size + px) {
    const ch = 0.55 * px * (0.9 + rng() * 0.2);
    let x = -px * (0.7 + rng() * 0.4) + (rowk % 2) * 0.5 * px;   // 必ず左端の外から始める
    while (x < size + px) {
      const bw = 1.05 * px * (0.85 + rng() * 0.3);
      // ストラドゥンは磨き上げた単一の石灰岩。版ごとに色を散らすのは嘘で、
      // 「明度がばらけた市松」に見える。振れ幅は ΔL* < 4 に抑える。
      // **磨いた石は「暗くて光る」。** L=70 は摩耗舗石(61)より 9 ポイント明るく、
      // 画面で最も明るい面(中央値 0.640)になっていた。拡散の一部が鏡面ローブへ
      // 移るぶん磨石は暗くなるのが物理で、上に鏡面の帯を置く余白もそこで生まれる。
      // **磨いた床は摩耗した床より暗い。** 62 は摩耗舗石(58)よりまだ明るく、
      // 「磨いた床が街でいちばん白い」という逆転が残っていた(実測 逆光の朝で
      // 無彩の白が 7.4% → 11.0% に増えた原因)。粗い床の下へ回す。
      const lit = 55 + (rng() - 0.5) * 3.4 + (rng() < 0.10 ? -6 : 0);   // 1割だけ沈んだ石
      ctx.fillStyle = `hsl(${40 + (rng() - 0.5) * 2},${22 + rng() * 3}%,${lit}%)`;
      // 目地が色側 2px 固定(= ミップ1段で1px、2段で消える)。実寸は 11.7mm と
      // 正しいのに、テクセル幅が足りず 9.6m 先で目地が消えていた。実寸から引く。
      const jp = Math.max(3.4, 0.012 * px);            // 実寸 12mm
      ctx.fillRect(x + jp * 0.5, y + jp * 0.5, bw - jp, ch - jp);
      dabs(ctx, x + 2, y + 2, bw - 4, ch - 4, 5, rng, 40, 14, lit + 2, bw * 0.10, 0.05);
      // 骨材の粒。磨いた石なので壁より疎く、浅く — 見えるのではなく掠め光で読める。
      dabs(ctx, x + 2, y + 2, bw - 4, ch - 4, Math.round(bw * ch / 700), rng, 40, 14, lit, 0.9, 0.030);
      const bump = 150 + rng() * 30;
      hctx.fillStyle = `rgb(${bump},${bump},${bump})`;
      hctx.fillRect(x + jp, y + jp, bw - jp, ch - jp);
      // 版は平らな板ではない。700 年の靴で **中央が皿状に窪む**(6〜9mm)。
      // 完全な平面鏡は「映るものが動かない鏡」= 一様に少し明るい面にしかならない。
      // 窪みがあると、映った空と立面が縦に裂けて長い筋になる。
      {
        const dg = hctx.createRadialGradient(x + bw / 2, y + ch / 2, 2, x + bw / 2, y + ch / 2, bw * 0.62);
        dg.addColorStop(0, `rgba(0,0,0,${0.030 + rng() * 0.016})`);   // 中央が沈む
        dg.addColorStop(0.78, 'rgba(0,0,0,0)');
        dg.addColorStop(1, 'rgba(255,255,255,0.020)');                // 縁だけ残る
        hctx.fillStyle = dg; hctx.fillRect(x + jp, y + jp, bw - jp, ch - jp);
      }
      // 骨材。皿のグラデの上に置くので、値の置換ではなく半透明の加減算で。
      hctx.save();
      hctx.beginPath(); hctx.rect(x + jp, y + jp, bw - jp, ch - jp); hctx.clip();
      for (let k = 0; k < Math.round(bw * ch / 300); k++) {
        const gx = x + rng() * bw, gy2 = y + rng() * ch;
        const gr = (0.0012 + rng() * 0.0026) * px;      // 実寸 1.2〜3.8mm
        const up = rng() < 0.5;
        hctx.fillStyle = up ? `rgba(255,255,255,${0.010 + rng() * 0.020})`
          : `rgba(0,0,0,${0.008 + rng() * 0.016})`;
        hctx.beginPath();
        hctx.ellipse(gx, gy2, gr, gr * (0.7 + rng() * 0.6), rng() * 3.14, 0, 7);
        hctx.fill();
      }
      hctx.restore();
      // 磨き: 石の中央は滑らか(暗)・縁と目地はざらつく(明)。
      // three は roughnessMap の G を読む。赤だけに書くと roughness=0 の
      // 完全な鏡になり、石畳が濡れたプラスチックになる。
      const rg = rctx.createRadialGradient(x + bw / 2, y + ch / 2, 2, x + bw / 2, y + ch / 2, bw * 0.55);
      // three は roughnessFactor *= texel.g(乗算)。0.26 × 0.157 = 実効 0.041 =
      // 完全な鏡で、逆光の路面が階調ごと 1.0 に貼り付いていた。
      // 110/255 × 材質 0.74 = 実効 0.32 は艶消しの陶器。700 年靴に磨かれた
      // 石灰岩は 0.13〜0.22。逆光でも夜でも路面が一度も光らない実測の正体。
      // 白飛びは材質を潰して防ぐのではなく、鏡面の上限で切る(ground.js)。
      const v0 = Math.round(46 + rng() * 22), v1 = 178;   // 中央ほど滑らか
      rg.addColorStop(0, `rgb(${v0},${v0},${v0})`);
      rg.addColorStop(1, `rgb(${v1},${v1},${v1})`);
      rctx.fillStyle = rg; rctx.fillRect(x + 1, y + 1, bw - 2, ch - 2);
      x += bw;
    }
    y += ch; rowk++;
  }
  // 磨きが **版ごとの放射グラデ** だけだと、磨きの周期が板の周期(1.05m)に縛られ、
  // 掠め角の照りが板を跨いで繋がらず点々で終わる。実物のストラドゥンは
  // 通りの軸に沿った「歩行帯」が版を跨いで磨かれている。その帯を上から掛ける。
  rctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 7; i++) {
    const cx = rng() * size, hw = px * (0.55 + rng() * 0.45);   // 帯幅 1.1〜2.0m
    const g3 = rctx.createLinearGradient(cx - hw, 0, cx + hw, 0);
    g3.addColorStop(0, 'rgba(255,255,255,0)');
    // 帯を暗くしすぎると実効 roughness が 0.073 の完全な鏡になり、逆光の朝に
    // 画面の 8.8% が白へ貼り付く(第1パスの 6.2% からの退行)。帯の役目は
    // 「磨きが版を跨いで通りの軸に沿う」ことであって、鏡を強くすることではない。
    g3.addColorStop(0.5, `rgba(84,84,84,${0.18 + rng() * 0.20})`);
    g3.addColorStop(1, 'rgba(255,255,255,0)');
    rctx.fillStyle = g3; rctx.fillRect(0, 0, size, size);
  }
  rctx.globalCompositeOperation = 'source-over';
  const fix = (cv) => { const cx = cv.getContext('2d'); cx.globalCompositeOperation = 'source-over'; return cv; };
  return {
    map: toTex(c), normalMap: toTex(heightToNormal(hc, 2.6), { srgb: false }),
    roughnessMap: toTex(fix(rc), { srgb: false }), coverM,
  };
}

// 路地・広場の摩耗した敷石(マット・不規則)
function wornPaving(rng, { size = 2048, coverM = 5 }) {
  const [c, ctx] = canvas(size);
  const [hc, hctx] = canvas(size);
  const px = size / coverM;
  const [rc2, rctx2] = canvas(size);
  ctx.fillStyle = 'hsl(37,16%,38%)'; ctx.fillRect(0, 0, size, size);   // 目地は沈む
  // 地 144 に対し石が 130〜185 で、石の 25.5% が目地より低かった。
  hctx.fillStyle = '#787878'; hctx.fillRect(0, 0, size, size);
  rctx2.fillStyle = '#ececec'; rctx2.fillRect(0, 0, size, size);       // 目地はざらつく
  let y = 0, rowk = 0;
  while (y < size + px) {
    const ch = 0.45 * px * (0.8 + rng() * 0.45);
    let x = -px * (0.6 + rng() * 0.5) + (rowk % 2) * 0.4 * px;   // 必ず左端の外から始める
    while (x < size + px) {
      const bw = 0.62 * px * (0.75 + rng() * 0.6);
      // 明度 67 = rgb 191 = 反射率 0.70。日向の石灰岩の反射率は 0.42〜0.55 で、
      // 実測は平坦画素率 81.3% = 画面の 8 割が情報ゼロの白になっていた。
      // 石ひとつごとの明度の振れが ΔL 18 で、ファサード(12)より広かった。
      // 結果、広場が「版ごとにランダムに着色された市松」= 近年敷き直した床に見える。
      // ストラドゥンは tex.js の規約どおり ΔL<4 に抑えてあり、同じ判断を広げる。
      // 失った変化は「石を跨ぐ尺度」(摩耗の帯・水溜まりの跡)が担う。
      const lit = 58 + (rng() - 0.5) * 5 + (rng() < 0.10 ? -5 : 0);
      ctx.fillStyle = `hsl(${37 + (rng() - 0.5) * 4},${18 + rng() * 5}%,${lit}%)`;
      const jp2 = Math.max(3.2, 0.010 * px);           // 実寸 10mm
      ctx.fillRect(x + jp2 * 0.5, y + jp2 * 0.5, bw - jp2, ch - jp2);
      dabs(ctx, x + 1, y + 1, bw - 2, ch - 2, 4, rng, 38, 12, lit, bw * 0.11, 0.05);
      dabs(ctx, x + 1, y + 1, bw - 2, ch - 2, Math.round(bw * ch / 180), rng, 38, 12, lit, 1.0, 0.030);
      const bump = 130 + rng() * 55;
      hctx.fillStyle = `rgb(${bump},${bump},${bump})`;
      hctx.fillRect(x + jp2, y + jp2, bw - jp2, ch - jp2);
      // 摩耗した敷石にも骨材。高さ側に一粒も無く、手のひらが何にも引っかからなかった。
      hctx.save();
      hctx.beginPath(); hctx.rect(x + jp2, y + jp2, bw - jp2, ch - jp2); hctx.clip();
      for (let k = 0; k < Math.round(bw * ch / 180); k++) {
        const gx = x + rng() * bw, gy2 = y + rng() * ch;
        const gr = (0.0014 + rng() * 0.0032) * px;     // 実寸 1.4〜4.6mm
        const v = bump + (rng() < 0.5 ? -1 : 1) * (1.4 + rng() * 2.6);
        hctx.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
        hctx.beginPath();
        hctx.ellipse(gx, gy2, gr, gr * (0.7 + rng() * 0.6), rng() * 3.14, 0, 7);
        hctx.fill();
      }
      hctx.restore();
      // 摩耗した舗石は「わずかに照る所とざらつく所の斑」であって一様マットではない。
      // roughnessMap はこれまでストラドゥンにしか無かった。
      const rg2 = rctx2.createRadialGradient(x + bw / 2, y + ch / 2, 2, x + bw / 2, y + ch / 2, bw * 0.55);
      const w0 = Math.round(150 + rng() * 30);
      rg2.addColorStop(0, `rgb(${w0},${w0},${w0})`);
      rg2.addColorStop(1, 'rgb(236,236,236)');
      rctx2.fillStyle = rg2; rctx2.fillRect(x + 1, y + 1, bw - 2, ch - 2);
      x += bw;
    }
    y += ch; rowk++;
  }
  dabs(ctx, 0, 0, size, size, 110, rng, 40, 10, 50, px * 0.10, 0.045);
  // 舗石の目地は 6〜10mm しか沈まない。強度 3.4 は正午に目地の縁を白く跳ねさせる。
  return { map: toTex(c), normalMap: toTex(heightToNormal(hc, 2.6), { srgb: false }),
    roughnessMap: toTex(rc2, { srgb: false }), coverM };
}

// ---------------------------------------------------------------- 屋根 ----
// バレル瓦。色はシェーダが per-instance / 列ごとに揺らすので、ここは
// 「瓦の形(法線)と目地の陰・素の中間色」を持つ。coverM=2m 四方。
function roofTiles(rng, { size = 512, coverM = 2 }) {
  const [c, ctx] = canvas(size);
  const [hc, hctx] = canvas(size);
  const px = size / coverM;
  // 働き幅 180mm は実物のクパ・カナリツァ(155〜185mm)に合っている。
  // 働き長さは 0.34 → 0.30(直った UV スケールで斜面上 318mm。実物 290〜330mm)。
  // **地図は「形と素地」、色はインスタンス側が持つ。**
  // 地の彩度 42% は、家ごとの色(彩度 31〜60%)に **掛けられる**。
  // 赤い地図 × 赤い個体色は R/G を二乗し、書かれた色相幅 14.5° を 3.9° に潰し、
  // 青チャンネルをリニア 0.0024(石灰岩の 1/100)まで落としていた。
  // 実測: 地図だけなら h 50.3°/R/G 1.75、個体色だけなら h 54.7°/1.80。
  //       掛けた瞬間に h 35.9°/R/G 3.31 — 橙ではなく朱になる。
  const tileW = 0.18 * px, rowH = 0.30 * px;
  ctx.fillStyle = 'hsl(24,15%,70%)'; ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#666'; hctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size + rowH; y += rowH) {
    for (let x = 0; x < size + tileW; x += tileW) {
      const jx = (rng() - 0.5) * 1.5, jy = (rng() - 0.5) * 2.5;
      // 山(凸)の断面(法線用)
      const g = hctx.createLinearGradient(x + jx, 0, x + jx + tileW, 0);
      g.addColorStop(0, '#3c3c3c'); g.addColorStop(0.18, '#8e8e8e'); g.addColorStop(0.5, '#e2e2e2');
  g.addColorStop(0.82, '#8e8e8e'); g.addColorStop(1, '#3c3c3c');
      hctx.fillStyle = g;
      hctx.fillRect(x + jx, y + jy, tileW, rowH - 1.5);
      hctx.fillStyle = 'rgba(0,0,0,0.6)';
      hctx.fillRect(x + jx, y + jy + rowH - 4.5, tileW, 4.5);
      // 色: 一枚ごとの窯むら(帯のコントラストは弱く — 強いと波板になる)
      const lit = 70 + (rng() - 0.5) * 16;
      const hue = 24 + (rng() - 0.5) * 14;
      const sat = 15 + (rng() - 0.5) * 12;
      ctx.fillStyle = `hsl(${hue},${sat}%,${lit}%)`;
      ctx.fillRect(x + jx, y + jy, tileW, rowH - 1);
      const cg = ctx.createLinearGradient(x + jx, 0, x + jx + tileW, 0);
      // 法線が距離で失われても、アルベドの縞が瓦の律動を残すようにする。
      cg.addColorStop(0, 'rgba(60,30,22,0.34)');
      cg.addColorStop(0.18, 'rgba(60,30,22,0.12)');
      cg.addColorStop(0.5, 'rgba(255,220,190,0.14)');
      cg.addColorStop(0.82, 'rgba(60,30,22,0.12)');
      cg.addColorStop(1, 'rgba(60,30,22,0.34)');
      ctx.fillStyle = cg;
      ctx.fillRect(x + jx, y + jy, tileW, rowH - 1);
      // 段の重なり(下端の濃い影 — 横の律動が瓦を瓦にする)
      // 段の下端の影は buildings.js の谷影と **二回** 引かれていた。地図側は微かに。
      ctx.fillStyle = `rgba(50,24,16,${0.18 + rng() * 0.12})`;
      ctx.fillRect(x + jx, y + jy + rowH - 4.5, tileW, 4.5);
      ctx.fillStyle = 'rgba(255,225,200,0.16)';
      ctx.fillRect(x + jx, y + jy + 0.5, tileW, 1.6);
    }
  }
  // 地衣類・埃の斑(控えめ)
  dabs(ctx, 0, 0, size, size, 70, rng, 38, 14, 42, px * 0.05, 0.05);
  dabs(ctx, 0, 0, size, size, 26, rng, 80, 12, 44, px * 0.035, 0.035);
  return { map: toTex(c), normalMap: toTex(heightToNormal(hc, 3.4), { srgb: false }), coverM };
}

// ---------------------------------------------------------------- 木 ----
function woodTex(rng, { size = 512 }) {
  const [c, ctx] = canvas(size);
  const [hc, hctx] = canvas(size);
  ctx.fillStyle = 'hsl(28,22%,42%)'; ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, size, size);
  const plankW = size / 6;
  for (let p = 0; p < 6; p++) {
    const x = p * plankW;
    const lit = 38 + (rng() - 0.5) * 12;
    ctx.fillStyle = `hsl(${26 + (rng() - 0.5) * 8},${18 + rng() * 10}%,${lit}%)`;
    ctx.fillRect(x + 1, 0, plankW - 2, size);
    hctx.fillStyle = `rgb(${115 + rng() * 40},0,0)`; hctx.fillRect(x + 1, 0, plankW - 2, size);
    // 木目
    for (let i = 0; i < 14; i++) {
      const gx = x + rng() * plankW;
      ctx.strokeStyle = `hsla(${24 + rng() * 8},24%,${lit - 8 - rng() * 8}%,${0.25 + rng() * 0.3})`;
      ctx.lineWidth = 0.8 + rng() * 1.4;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      for (let yy = 0; yy <= size; yy += 24) ctx.lineTo(gx + Math.sin(yy * 0.02 + i) * 3 + (rng() - 0.5) * 2, yy);
      ctx.stroke();
    }
    ctx.fillStyle = `rgba(30,22,14,${0.12 + rng() * 0.12})`;
    ctx.fillRect(x + 1, 0, plankW - 2, 8 + rng() * 20);
  }
  return { map: toTex(c), normalMap: toTex(heightToNormal(hc, 1.2), { srgb: false }) };
}

// ---------------------------------------------------------------- 布 ----
function clothTex(rng, { size = 256 }) {
  const [c, ctx] = canvas(size);
  ctx.fillStyle = 'hsl(40,26%,92%)'; ctx.fillRect(0, 0, size, size);
  // 織り目
  for (let y = 0; y < size; y += 3) {
    ctx.fillStyle = `hsla(40,20%,${86 + Math.random() * 8}%,0.5)`;
    ctx.fillRect(0, y, size, 1.4);
  }
  for (let x = 0; x < size; x += 3) {
    ctx.fillStyle = `hsla(40,14%,${88 + Math.random() * 6}%,0.35)`;
    ctx.fillRect(x, 0, 1.4, size);
  }
  // 裾の縫い目
  ctx.strokeStyle = 'rgba(120,110,95,0.5)'; ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, size - 8, size - 8);
  return { map: toTex(c) };
}

// ------------------------------------------------------------- 岩・山 ----
function rockTex(rng, { size = 1024, coverM = 14 }) {
  const [c, ctx] = canvas(size);
  const [hc, hctx] = canvas(size);
  ctx.fillStyle = 'hsl(36,14%,58%)'; ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, size, size);
  // 層理。実寸 1.0〜3.0m の帯。これが無いと山に 3〜15m の構造が皆無で、
  // 特徴が 4〜26cm しか無い「粘土の塊」になる(実測 一意色数 1.96%)。
  for (let i = 0; i < 40; i++) {
    const yb = rng() * size, hb = size * (0.07 + rng() * 0.15);
    hctx.save(); hctx.translate(size / 2, yb); hctx.rotate((rng() - 0.5) * 0.49);
    const v = 128 + (rng() < 0.5 ? -1 : 1) * (10 + rng() * 16);
    hctx.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
    hctx.fillRect(-size, -hb / 2, size * 2, hb); hctx.restore();
  }
  // 亀裂の入った石灰岩のカルスト: 細かい割れの集積(豹柄にしない)
  for (let i = 0; i < 900; i++) {
    const x = rng() * size, y = rng() * size, r = 3 + rng() * 16;
    const ar = 0.5 + rng() * 0.5, ang = rng() * Math.PI;      // 色と高さで同じ楕円を使う
    const lit = 54 + (rng() - 0.5) * 14;
    ctx.fillStyle = `hsla(${35 + (rng() - 0.5) * 8},${10 + rng() * 7}%,${lit}%,0.28)`;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * ar, ang, 0, 7); ctx.fill();
    // 半透明の楕円を高さに焼くと、内側が一定値になって縁だけが段差になり、
    // 法線が輪になる = 石鹸の泡。不透明の同心 3 段にして、内側にも勾配を作る。
    // (このコードは plasterTex で同じ症状を対策済みだが、岩は未対策だった)
    // 段で塗ると段の数だけ輪ができる。縁の値を地(128)に合わせた **連続の
    // 勾配** にすれば、輪郭の段差そのものが消える。
    hctx.save();
    hctx.translate(x, y); hctx.rotate(ang); hctx.scale(1, ar);
    const rg = hctx.createRadialGradient(0, 0, 0, 0, 0, r);
    const vi = 128 + (rng() < 0.5 ? -1 : 1) * (7 + rng() * 13);
    rg.addColorStop(0, `rgb(${vi | 0},${vi | 0},${vi | 0})`);
    rg.addColorStop(0.62, `rgb(${((vi + 128) / 2) | 0},${((vi + 128) / 2) | 0},${((vi + 128) / 2) | 0})`);
    rg.addColorStop(1, 'rgb(128,128,128)');
    hctx.fillStyle = rg;
    hctx.beginPath(); hctx.arc(0, 0, r, 0, 7); hctx.fill();
    hctx.restore();
  }
  dabs(ctx, 0, 0, size, size, 300, rng, 36, 8, 48, size * 0.006, 0.06);
  return { map: toTex(c), normalMap: toTex(heightToNormal(hc, 2.6), { srgb: false }), coverM };
}

// スルジ山の乾いた斜面(草地とカルストの斑・遠景用の大きな筆)
// **この 1024² の絵は、統計的に無地の灰色板と区別が付かなかった。**
// 実測: 全画素の SD 1.00 L*、64texel ブロックで 0.45 L*。同じ線形平均の
// 4×4 単色に差し替えても、画面の局所SD は r1 で 0.03 L*、r64 で 0.01 L* しか
// 変わらない(弁別閾の 1/30)。何も描いていないのと同じだった。
// **平均は動かさず、分散だけ入れる。** 平均を動かすと第1パスで採点済みの
// 空気遠近(/空Y比)に触れてしまう。
function scrubTex(rng, { size = 1024, coverM = 22 }) {
  const [c, ctx] = canvas(size);
  ctx.fillStyle = 'hsl(52,14%,50%)'; ctx.fillRect(0, 0, size, size);
  // 低周波の大筆(タイル 22m に対し 4.8m と 2.4m)。遠景で最初に効くのはこれ。
  dabs(ctx, 0, 0, size, size, 34, rng, 96, 18, 26, size * 0.22, 0.34);   // 谷筋の濃緑
  dabs(ctx, 0, 0, size, size, 42, rng, 42, 9, 74, size * 0.11, 0.30);    // 白い露頭
  // 中〜高周波。明度の振れを 38/60/64 から 28/46/76 へ開き、alpha も上げる。
  dabs(ctx, 0, 0, size, size, 520, rng, 62, 16, 28, 26, 0.34);   // 灌木(乾いた緑)
  dabs(ctx, 0, 0, size, size, 560, rng, 46, 15, 46, 30, 0.40);   // 乾いた草
  dabs(ctx, 0, 0, size, size, 300, rng, 38, 10, 76, 18, 0.45);   // 露岩
  // coverM を返さないと ground.js の `${(tex.scrub.coverM*0.45).toFixed(2)}` が
  // 文字列 "NaN" を生み、GLSL が未定義識別子でコンパイルに失敗する。
  return { map: toTex(c), coverM };
}

// ---------------------------------------------------------------- 雲 ----
// 積雲アトラス 2×2。密度場 + 侵食 + 平底 + 上面光。
function cloudAtlas(rng, { size = 1024 }) {
  const [c, ctx] = canvas(size);
  ctx.clearRect(0, 0, size, size);
  const cell = size / 2;
  for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) {
    const ox = cx * cell, oy = cy * cell;
    const img = ctx.createImageData(cell, cell);
    const blobs = [];
    const nb = 7 + (rng() * 5 | 0);
    for (let i = 0; i < nb; i++) {
      blobs.push({
        x: 0.22 + rng() * 0.56,
        y: 0.42 + rng() * 0.50 - (i / nb) * 0.30, // 上に積み上がる
        r: 0.10 + rng() * 0.16,
      });
    }
    const flat = 0.30 + rng() * 0.03; // 平底ライン
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const u = x / cell, v = 1 - y / cell; // v: 0=下
      let d = 0;
      for (const b of blobs) {
        const dd = Math.hypot(u - b.x, (v - b.y) * 0.85);   // 1.25 は塊を UV 上で潰し、スプライト側の 0.42 と二段で積雲を煎餅にしていた
        d += Math.max(0, 1 - dd / b.r) * 0.9;
      }
      if (v < flat) d *= Math.max(0, 1 - (flat - v) * 9); // 平底
      // 縁の侵食
      const e = (Math.sin(u * 61 + cx * 9) + Math.sin(v * 47 + u * 31) + Math.sin((u + v) * 83)) / 3;
      d -= Math.max(0, 0.22 - Math.abs(d - 0.22)) * (e * 0.5 + 0.5) * 0.9;
      const a = clamp(d * 1.5, 0, 1);
      if (a <= 0.003) continue;
      // 上面光・底面影
      const litT = clamp(0.55 + (v - 0.45) * 1.3, 0, 1);
      const rcol = lerp(176, 255, litT), gcol = lerp(199, 252, litT), bcol = lerp(210, 246, litT);
      const i4 = (y * cell + x) * 4;
      img.data[i4] = rcol; img.data[i4 + 1] = gcol; img.data[i4 + 2] = bcol;
      img.data[i4 + 3] = Math.pow(a, 0.85) * 255;
    }
    ctx.putImageData(img, ox, oy);
  }
  const t = toTex(c, { repeat: false });
  return t;
}

// ---------------------------------------------------------------- 葉 ----
function foliageTex(rng, { size = 256 }) {
  const [c, ctx] = canvas(size);
  ctx.clearRect(0, 0, size, size);
  // 葉のクラスタ(アルファ)。頂点色で緑を変調するので明度中心。
  for (let i = 0; i < 90; i++) {
    const x = size / 2 + (rng() - 0.5) * size * 0.8;
    const y = size / 2 + (rng() - 0.5) * size * 0.8;
    if (Math.hypot(x - size / 2, y - size / 2) > size * 0.46) continue;
    const r = 4 + rng() * 9, a = rng() * Math.PI;
    ctx.fillStyle = `hsla(${96 + rng() * 30},${30 + rng() * 22}%,${34 + rng() * 22}%,${0.85 + rng() * 0.15})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.45, a, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTex(c, { repeat: false });
}

/**
 * 松の針葉の房(アルファ)。板の縁を矩形のままにすると、樹冠が「厚紙の破片」に
 * 見える。逆光で空が透けるレースの輪郭は、この抜けが作る。
 *
 * 左上の隅(UV 0〜0.08)だけは完全不透明にしておく — 幹と枝はそこを指す。
 * 一枚のテクスチャで木と葉を賄うため(材質を分けると描画呼び出しが倍になる)。
 */
function needleTex(rng, { size = 256 }) {
  const [c, ctx] = canvas(size);
  ctx.clearRect(0, 0, size, size);
  const OP = Math.round(size * 0.085);          // 幹用の不透明な隅
  // 房 — 下辺の中央から放射する針の束。上から見た松の房はこの形。
  const cx = size * 0.5, cy = size * 0.94;
  for (let i = 0; i < 260; i++) {
    const a = -Math.PI / 2 + (rng() - 0.5) * 2.25;
    const L = size * (0.30 + Math.pow(rng(), 0.6) * 0.62);
    const x2 = cx + Math.cos(a) * L, y2 = cy + Math.sin(a) * L;
    // 房の縁は揃わない。長さと太さを散らし、外周を欠けさせる。
    // **葉が幹より暗いという逆転**。tube() の頂点は UV を持たないので
    // 「不透明の隅」(純白)を読み、幹の実効アルベドは頂点色そのまま(Y 0.0676)。
    // 一方、葉は房の不透明部の平均 Y 0.2623 を掛けられて Y 0.0228 に落ちる。
    // 実物は逆で、500m から見た松林の幹の帯は樹冠より暗い。房を明るくする。
    ctx.strokeStyle = `hsla(${104 + rng() * 26},${26 + rng() * 26}%,${58 + rng() * 26}%,${0.55 + rng() * 0.45})`;
    ctx.lineWidth = 1.0 + rng() * 1.9;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * L * 0.12, cy + Math.sin(a) * L * 0.12);
    // 針はまっすぐではなくわずかに反る
    ctx.quadraticCurveTo(cx + Math.cos(a + 0.10) * L * 0.6, cy + Math.sin(a + 0.10) * L * 0.6, x2, y2);
    ctx.stroke();
  }
  // 束の芯を少し詰める(中心が透けると房が輪に見える)
  for (let i = 0; i < 60; i++) {
    const a = -Math.PI / 2 + (rng() - 0.5) * 1.7, L = size * (0.08 + rng() * 0.26);
    ctx.strokeStyle = `hsla(${100 + rng() * 22},${30 + rng() * 20}%,${48 + rng() * 20}%,0.9)`;
    ctx.lineWidth = 1.6 + rng() * 2.2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); ctx.stroke();
  }
  // 幹・枝が指す不透明の隅。CanvasTexture は flipY なので、UV(0,0) は
  // キャンバスの **下**。上に置くと幹が丸ごと透明になる(実測で幹が消えた)。
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, size - OP, OP, OP);
  // 幹はこの隅を **1 テクセル**しか読んでいなかった(tube() が UV を持たない)。
  // 結果、幹・枝・糸杉の胴・オリーブの茎は全部が map = 1.0 の無地で、
  // 色は頂点色の明暗だけ = 糸杉が「六角形のガラスの紡錘」に見えていた。
  // 隅に樹皮の縦筋を焼き、tube() 側で隅の中を舐める UV を与える。
  // **alpha は 255 のまま** — alphaTest 0.42(surround.js)で幹が抜けてしまう。
  for (let i = 0; i < 22; i++) {
    const bx = rng() * OP, bw = 0.7 + rng() * 2.2;
    ctx.fillStyle = `rgb(${152 + rng() * 52 | 0},${144 + rng() * 48 | 0},${132 + rng() * 46 | 0})`;
    ctx.fillRect(bx, size - OP, bw, OP);
  }
  for (let i = 0; i < 14; i++) {                      // 割れ目(横の節)
    const by = size - OP + rng() * OP, bh = 0.6 + rng() * 1.4;
    ctx.fillStyle = `rgba(96,88,78,${0.30 + rng() * 0.35})`;
    ctx.fillRect(0, by, OP, bh);
  }
  const t = toTex(c, { repeat: false });
  t.userData = { opaqueUV: (OP * 0.5) / size, opaqueSize: OP / size };
  return t;
}

// ------------------------------------------------------------ 汚れ帯 ----
function grimeTex(rng, { size = 256 }) {
  const [c, ctx] = canvas(size);
  ctx.clearRect(0, 0, size, size);
  const g = ctx.createLinearGradient(0, size, 0, 0);
  // 乗算デカールなので、アルファは「暗くする強さ」。0.55 では画面で ΔL* 0.2 にしかならない。
  g.addColorStop(0, 'rgba(52,46,36,0.78)');
  g.addColorStop(0.42, 'rgba(58,52,40,0.34)');
  g.addColorStop(1, 'rgba(60,54,42,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) { // 上端の不規則なにじみ
    const x = rng() * size, w = 6 + rng() * 26, h = 12 + rng() * 60;
    ctx.fillStyle = `rgba(50,45,35,${0.05 + rng() * 0.12})`;
    ctx.beginPath(); ctx.ellipse(x, size - h, w, h, 0, 0, 7); ctx.fill();
  }
  // マクロ変調のタイルとして使うので必ず繰り返す(ClampToEdge だと
  // 世界原点の 1 タイル以外は端テクセルに張り付き、一律の減光になる)
  return toTex(c, { repeat: true });
}

// ------------------------------------------------------------ 時計盤 ----
function clockFace() {
  const size = 256;
  const [c, ctx] = canvas(size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  function draw(hours) {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#e8dcc2';
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size * 0.47, 0, 7); ctx.fill();
    ctx.strokeStyle = '#3c3428'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size * 0.44, 0, 7); ctx.stroke();
    ctx.fillStyle = '#3c3428';
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      const r0 = size * 0.36, r1 = size * 0.41;
      ctx.beginPath();
      ctx.moveTo(size / 2 + Math.sin(a) * r0, size / 2 - Math.cos(a) * r0);
      ctx.lineTo(size / 2 + Math.sin(a) * r1, size / 2 - Math.cos(a) * r1);
      ctx.lineWidth = 6; ctx.stroke();
    }
    const h = (hours % 12) / 12 * Math.PI * 2;
    const m = (hours % 1) * Math.PI * 2;
    ctx.lineWidth = 9; ctx.beginPath();
    ctx.moveTo(size / 2, size / 2);
    ctx.lineTo(size / 2 + Math.sin(h) * size * 0.22, size / 2 - Math.cos(h) * size * 0.22);
    ctx.stroke();
    ctx.lineWidth = 5; ctx.beginPath();
    ctx.moveTo(size / 2, size / 2);
    ctx.lineTo(size / 2 + Math.sin(m) * size * 0.33, size / 2 - Math.cos(m) * size * 0.33);
    ctx.stroke();
    tex.needsUpdate = true;
  }
  draw(8.2);
  return { tex, draw };
}

// ---------------------------------------------------------------- 出口 ----

// -------------------------------------------------------------- 漆喰 ----
// 旧市街の家がすべて素の切石ということはない。約3割は石灰モルタルの
// 塗り壁で、剥落した所から石が覗く。この「2種類あること」だけで、
// 石目のグリッドが街全体を覆う手続き生成の匂いが消える。
function plasterTex(rng, { size = 1024, coverM = 4.0 } = {}) {
  const [c, ctx] = canvas(size);
  const [hc, hctx] = canvas(size);
  const px = size / coverM;
  ctx.fillStyle = 'hsl(40,24%,74%)'; ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#c8c8c8'; hctx.fillRect(0, 0, size, size);
  // 鏝の斑(大きな明度のうねり)
  for (let i = 0; i < 220; i++) {
    const x = rng() * size, y = rng() * size, r = 30 + rng() * 120;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    const l = 74 + (rng() - 0.5) * 7.5;
    g.addColorStop(0, `hsla(${39 + (rng() - 0.5) * 6},${16 + rng() * 10}%,${l}%,0.34)`);
    g.addColorStop(1, 'hsla(40,22%,74%,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  // 剥落 — 塗りが落ちて下地の石が覗く。縁は厚み(0.02m)ぶん陰る。
  for (let i = 0; i < 7; i++) {
    const x = rng() * size, y = rng() * size, r = px * (0.05 + Math.pow(rng(), 1.8) * 0.42);
    // アルベドと高さで同じ輪郭を使う。高さだけ真円で焼くと、色は変わらず
    // 輪郭のリングだけが法線に出て「石鹸の泡」になる。
    const n = 9, poly = [];
    for (let k = 0; k <= n; k++) {
      const a = k / n * Math.PI * 2, rr = r * (0.6 + rng() * 0.7);
      poly.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
    }
    const trace = (cx2) => {
      cx2.beginPath();
      poly.forEach((v, k) => (k === 0 ? cx2.moveTo(v[0], v[1]) : cx2.lineTo(v[0], v[1])));
      cx2.closePath();
    };
    ctx.save(); trace(ctx); ctx.clip();
    // 下地の石は漆喰(L=74%)より暗い。明るくすると剥落に見えない。
    ctx.fillStyle = 'hsl(38,13%,67%)'; ctx.fillRect(x - r * 1.4, y - r * 1.4, r * 2.8, r * 2.8);
    dabs(ctx, x - r, y - r, r * 2, r * 2, 26, rng, 37, 12, 64, r * 0.34, 0.13);
    ctx.restore();
    ctx.save(); trace(ctx);
    ctx.strokeStyle = 'rgba(120,113,98,0.30)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
    // 高さは 3 段でなだらかに(厚さ 0.02m の剥落は法線で 1〜2px 相当)
    for (const [sc, v] of [[1.06, '#c8c8c8'], [1.0, '#b4b4b4'], [0.94, '#a2a2a2']]) {
      hctx.save(); hctx.beginPath();
      poly.forEach((q, k) => {
        const px2 = x + (q[0] - x) * sc, py2 = y + (q[1] - y) * sc;
        if (k === 0) hctx.moveTo(px2, py2); else hctx.lineTo(px2, py2);
      });
      hctx.closePath(); hctx.clip();
      hctx.fillStyle = v; hctx.fillRect(x - r * 1.5, y - r * 1.5, r * 3, r * 3);
      hctx.restore();
    }
  }
  // ひび(髪の毛ほどの太さ)
  ctx.lineCap = 'round';
  for (let i = 0; i < 11; i++) {
    let x = rng() * size, y = rng() * size;
    let a = rng() * Math.PI * 2;
    ctx.strokeStyle = `hsla(36,14%,${52 + rng() * 10}%,0.32)`;
    ctx.lineWidth = 0.8 + rng() * 0.7;
    hctx.strokeStyle = '#a0a0a0'; hctx.lineWidth = 2;
    ctx.beginPath(); hctx.beginPath();
    ctx.moveTo(x, y); hctx.moveTo(x, y);
    for (let k = 0; k < 7; k++) {
      a += (rng() - 0.5) * 0.55;
      x += Math.cos(a) * px * 0.055; y += Math.sin(a) * px * 0.055;
      ctx.lineTo(x, y); hctx.lineTo(x, y);
    }
    ctx.stroke(); hctx.stroke();
  }
  // 細かな骨材と鏝目(のっぺりした白面は紙にしか見えない)
  dabs(ctx, 0, 0, size, size, 900, rng, 40, 14, 70, px * 0.028, 0.07);
  for (let i = 0; i < 130; i++) {
    const x = rng() * size, y = rng() * size, w2 = px * (0.10 + rng() * 0.5), h2 = px * (0.02 + rng() * 0.05);
    ctx.save(); ctx.translate(x, y); ctx.rotate((rng() - 0.5) * 0.9);
    ctx.fillStyle = `hsla(38,16%,${rng() < 0.5 ? 66 : 82}%,0.16)`;
    ctx.fillRect(-w2 / 2, -h2 / 2, w2, h2);
    ctx.restore();
  }
  return { map: toTex(c), normalMap: toTex(heightToNormal(hc, 1.6), { srgb: false }), coverM };
}

// 鎧戸の羽根。板一枚の鎧戸は「窓に立てかけた板」に見える。
function louverTex(rng, { size = 128 } = {}) {
  const [c, ctx] = canvas(size, size);
  const [hc, hctx] = canvas(size, size);
  ctx.fillStyle = '#c6c6c6'; ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, size, size);
  const n = 26;                       // 羽根 26 枚(丈 1.68m → ピッチ 0.065m)
  for (let i = 0; i < n; i++) {
    const y0 = (i / n) * size, h = size / n;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
    g.addColorStop(0, 'rgba(0,0,0,0.42)');       // 羽根の上端は影
    g.addColorStop(0.34, 'rgba(255,255,255,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = '#cccccc'; ctx.fillRect(0, y0, size, h);
    ctx.fillStyle = g; ctx.fillRect(0, y0, size, h);
    const hg = hctx.createLinearGradient(0, y0, 0, y0 + h);
    hg.addColorStop(0, '#303030'); hg.addColorStop(0.5, '#c8c8c8'); hg.addColorStop(1, '#606060');
    hctx.fillStyle = hg; hctx.fillRect(0, y0, size, h);
  }
  // 上下の框(羽根が板から直接生えていることはない)
  for (const [y0, h] of [[0, size * 0.055], [size * 0.945, size * 0.055]]) {
    ctx.fillStyle = '#d8d8d8'; ctx.fillRect(0, y0, size, h);
    hctx.fillStyle = '#e0e0e0'; hctx.fillRect(0, y0, size, h);
  }
  return { map: toTex(c), normalMap: toTex(heightToNormal(hc, 1.2), { srgb: false }) };
}

// 雨だれの筋 — 窓台・水切りの下に必ず落ちる。垂直の汚れは、
// 建物が何十年も雨に打たれた証拠として最も読み取りやすい。
function streakTex(rng, { size = 256 } = {}) {
  const [c, ctx] = canvas(size);
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 46; i++) {
    const x = rng() * size;
    const w = 1 + rng() * 5;
    const top = rng() * size * 0.12;
    const len = size * (0.35 + rng() * 0.65);
    const g = ctx.createLinearGradient(0, top, 0, top + len);
    const al = 0.20 + rng() * 0.38;
    g.addColorStop(0, `rgba(58,54,46,${al})`);
    g.addColorStop(0.28, `rgba(64,60,50,${al * 0.8})`);
    g.addColorStop(1, 'rgba(70,66,56,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, top, w, len);
  }
  // 左右の端は消す(帯の縁が直線に切れると板に見える)
  const fade = ctx.createLinearGradient(0, 0, size, 0);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.12, 'rgba(0,0,0,0)');
  fade.addColorStop(0.88, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = fade; ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';
  return toTex(c, { repeat: false });
}

export function makeTextures() {
  const rng = rngFor(0xd0b0);
  return {
    wallStone: limestoneWall(rng, {}),
    wallStoneWarm: limestoneWall(rng, { tone: 1 }),
    // 記念建築(スポンザ・レクトル館・大聖堂)の切石は民家より大きい。
    // 実物の段高は 0.40〜0.60m、長さ 1.2〜2.0m。民家と同じ 0.26m で積むと、
    // 街でいちばん規律の効いた建物が隣の家と同じ石割りになる。
    monumentStone: limestoneWall(rng, { coverM: 5.0, courseM: 0.46, tone: 1 }),
    fortStone: fortStone(rng, {}),
    stradun: stradunPaving(rng, {}),
    paving: wornPaving(rng, {}),
    roof: roofTiles(rng, {}),
    wood: woodTex(rng, {}),
    cloth: clothTex(rng, {}),
    rock: rockTex(rng, {}),
    scrub: scrubTex(rng, {}),
    clouds: cloudAtlas(rng, {}),
    foliage: foliageTex(rng, {}),
    needle: needleTex(rng, {}),
    grime: grimeTex(rng, {}),
    plaster: plasterTex(rng, {}),
    dressed: dressedFace(rng, {}),
    streak: streakTex(rng, {}),
    louver: louverTex(rng, {}),
    clock: clockFace(),
    signs: signAtlas(rng, {}),
    awning: awningTex(rng, {}),
  };
}


// 看板の紋章。4x2 のアトラス。文字は読めなくてよい — 職種が分かればよい。
// パン / 鍵 / 鋏 / 魚 / 瓶 / 薬研 / 靴 / 櫛
function signAtlas(rng, { size = 512 } = {}) {
  const [c, ctx] = canvas(size);
  const cw = size / 4, chh = size / 2;
  const bg = ['#2e3a44', '#3d3129', '#243528', '#33262c', '#2b3540', '#3a3326', '#262c36', '#33302a'];
  for (let k = 0; k < 8; k++) {
    const cx0 = (k % 4) * cw, cy0 = ((k / 4) | 0) * chh;
    // 板の地。塗料の褪せと縁の摩耗。
    ctx.fillStyle = bg[k];
    ctx.fillRect(cx0, cy0, cw, chh);
    dabs(ctx, cx0 + 2, cy0 + 2, cw - 4, chh - 4, 22, rng, 38, 10, 26, cw * 0.10, 0.10);
    // 金色の縁取り
    ctx.strokeStyle = 'rgba(196,166,102,0.85)'; ctx.lineWidth = Math.max(2, cw * 0.028);
    ctx.strokeRect(cx0 + cw * 0.07, cy0 + chh * 0.10, cw * 0.86, chh * 0.80);
    ctx.save();
    ctx.translate(cx0 + cw / 2, cy0 + chh / 2);
    const S = Math.min(cw, chh) * 0.30;
    ctx.fillStyle = '#c9ab68'; ctx.strokeStyle = '#c9ab68';
    ctx.lineWidth = Math.max(2, S * 0.16); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (k === 0) {                       // パン(丸パンに切れ目)
      ctx.beginPath(); ctx.ellipse(0, 0, S, S * 0.68, 0, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = bg[k];
      for (const d of [-0.42, 0, 0.42]) {
        ctx.beginPath(); ctx.moveTo(-S * 0.55 + d * S, -S * 0.30); ctx.lineTo(-S * 0.15 + d * S, S * 0.30); ctx.stroke();
      }
    } else if (k === 1) {                // 鍵
      ctx.beginPath(); ctx.arc(-S * 0.45, 0, S * 0.40, 0, 6.2832); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-S * 0.05, 0); ctx.lineTo(S * 0.90, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(S * 0.60, 0); ctx.lineTo(S * 0.60, S * 0.42); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(S * 0.88, 0); ctx.lineTo(S * 0.88, S * 0.30); ctx.stroke();
    } else if (k === 2) {                // 鋏
      ctx.beginPath(); ctx.moveTo(-S * 0.8, -S * 0.7); ctx.lineTo(S * 0.5, S * 0.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-S * 0.8, S * 0.7); ctx.lineTo(S * 0.5, -S * 0.5); ctx.stroke();
      ctx.beginPath(); ctx.arc(S * 0.72, S * 0.72, S * 0.28, 0, 6.2832); ctx.stroke();
      ctx.beginPath(); ctx.arc(S * 0.72, -S * 0.72, S * 0.28, 0, 6.2832); ctx.stroke();
    } else if (k === 3) {                // 魚
      ctx.beginPath();
      ctx.moveTo(-S * 0.95, 0); ctx.quadraticCurveTo(0, -S * 0.72, S * 0.62, 0);
      ctx.quadraticCurveTo(0, S * 0.72, -S * 0.95, 0); ctx.fill();
      ctx.beginPath(); ctx.moveTo(S * 0.58, 0); ctx.lineTo(S * 1.05, -S * 0.45);
      ctx.lineTo(S * 1.05, S * 0.45); ctx.closePath(); ctx.fill();
    } else if (k === 4) {                // 瓶
      ctx.fillRect(-S * 0.18, -S * 1.0, S * 0.36, S * 0.5);
      ctx.beginPath(); ctx.moveTo(-S * 0.18, -S * 0.5); ctx.lineTo(-S * 0.52, S * 0.05);
      ctx.lineTo(-S * 0.52, S * 0.95); ctx.lineTo(S * 0.52, S * 0.95);
      ctx.lineTo(S * 0.52, S * 0.05); ctx.lineTo(S * 0.18, -S * 0.5); ctx.closePath(); ctx.fill();
    } else if (k === 5) {                // 薬研(乳鉢と杵)
      ctx.beginPath(); ctx.moveTo(-S * 0.8, -S * 0.1); ctx.lineTo(S * 0.8, -S * 0.1);
      ctx.lineTo(S * 0.42, S * 0.85); ctx.lineTo(-S * 0.42, S * 0.85); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-S * 0.1, -S * 0.2); ctx.lineTo(S * 0.75, -S * 1.0); ctx.stroke();
    } else if (k === 6) {                // 靴
      ctx.beginPath(); ctx.moveTo(-S * 0.9, S * 0.55); ctx.lineTo(-S * 0.9, -S * 0.2);
      ctx.quadraticCurveTo(-S * 0.5, -S * 0.35, -S * 0.15, S * 0.05);
      ctx.quadraticCurveTo(S * 0.35, S * 0.35, S * 0.95, S * 0.30);
      ctx.lineTo(S * 0.95, S * 0.55); ctx.closePath(); ctx.fill();
    } else {                             // 櫛
      ctx.fillRect(-S * 0.9, -S * 0.7, S * 1.8, S * 0.42);
      for (let t = 0; t < 7; t++) ctx.fillRect(-S * 0.85 + t * S * 0.26, -S * 0.3, S * 0.11, S * 0.9);
    }
    ctx.restore();
  }
  return { map: toTex(c, { repeat: false }) };
}

// 日よけの縞帆布。横 1 本で 8 種の縞(インスタンスの v オフセットで選ぶ)
function awningTex(rng, { size = 256 } = {}) {
  const [c, ctx] = canvas(size);
  const rows = 8, rh = size / rows;
  const pal = [['#e6ded0', '#8c3d33'], ['#e6ded0', '#2f5d52'], ['#efe6d6', '#2c3f61'],
    ['#e8dfcd', '#7a6a3f'], ['#efe9dc', '#5a3550'], ['#e4dccb', '#356b3f'],
    ['#eee7d8', '#8a5a25'], ['#e6dfd2', '#3c3c3c']];
  for (let r = 0; r < rows; r++) {
    const [a, b] = pal[r];
    ctx.fillStyle = a; ctx.fillRect(0, r * rh, size, rh);
    ctx.fillStyle = b;
    for (let x = 0; x < size; x += size / 7) ctx.fillRect(x, r * rh, size / 14, rh);
    dabs(ctx, 0, r * rh, size, rh, 14, rng, 36, 6, 70, size * 0.05, 0.06);
  }
  return { map: toTex(c) };
}
