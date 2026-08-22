// ============================================================================
// chart.js — 1600 年代の銅版海図としての地図。
//
// 前提が一つだけある: **ビュランは線しか刻めない。**
// 灰色という物が存在しない。海の調子も、山の陰も、街区の詰まり具合も、
// すべて「線の間隔」で作る。塗り潰し・グラデーション・影・ぼかし・セピアの
// かぶせは、どれか一つでもあれば「銅版画の絵」であって銅版画ではない。
//
// 幾何は歩ける街と同じ plan から取る。だから足元の街路と食い違いようがない。
// 彫師が省くところは正直に省く(家一軒ではなく街区)が、位相は正しい。
// ============================================================================

const SEED = 0x5ea17;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 低周波の揺れ(手の震え・紙の繊維)。同じ値を何度も引けるよう格子で持つ。
function makeNoise(rng, n = 512) {
  const t = new Float32Array(n);
  for (let i = 0; i < n; i++) t[i] = rng() * 2 - 1;
  return (x) => {
    const u = ((x % n) + n) % n, i = u | 0, f = u - i;
    const a = t[i], b = t[(i + 1) % n];
    return a + (b - a) * (f * f * (3 - 2 * f));
  };
}

// ---------------------------------------------------------------- ビュラン ----
// 刃は銅に食い込みながら太り、抜けながら細る。均一 1px の線は一本も無い。
// 効率のため、一群の線を一つのパスに畳んでから塗る(数十万点でも一回の fill)。
class Burin {
  constructor(ctx, rng) {
    this.ctx = ctx; this.rng = rng;
    this.nx = makeNoise(rng); this.ny = makeNoise(rng);
    this.phase = rng() * 400;
  }
  begin(alpha = 1, tint = null) {
    this.ctx.beginPath();
    this.ctx.fillStyle = tint || `rgba(34,26,18,${alpha})`;
  }
  end() { this.ctx.fill(); }
  /**
   * 一本刻む。pts = [x,y,x,y,...]。
   * w0/w1 は端の太さ、wMid は腹の太さ(ふくらみ)。
   * tremor = 震えの振幅、skip = 刃が飛ぶ確率。
   */
  cut(pts, { w = 1.1, swell = 1.45, tremor = 0.45, skip = 0, step = 2.2, taper = true } = {}) {
    const P = pts;
    if (P.length < 4) return;
    // 等間隔に取り直す
    const S = [];
    let acc = 0;
    S.push(P[0], P[1]);
    for (let i = 2; i < P.length; i += 2) {
      const x0 = P[i - 2], y0 = P[i - 1], x1 = P[i], y1 = P[i + 1];
      const L = Math.hypot(x1 - x0, y1 - y0);
      if (L < 1e-6) continue;
      let t = 0;
      while (acc + (L - t) >= step) {
        t += step - acc; acc = 0;
        S.push(x0 + (x1 - x0) * (t / L), y0 + (y1 - y0) * (t / L));
      }
      acc += L - t;
    }
    const n = S.length / 2;
    if (n < 2) return;
    const ph = this.phase += 17.3;
    const L = [], R = [];
    let cum = 0;
    for (let i = 0; i < n; i++) {
      const x = S[i * 2], y = S[i * 2 + 1];
      const px = i === 0 ? S[2] - S[0] : x - S[(i - 1) * 2];
      const pz = i === 0 ? S[3] - S[1] : y - S[(i - 1) * 2 + 1];
      const pl = Math.hypot(px, pz) || 1;
      const ux = -pz / pl, uy = px / pl;                       // 法線
      cum += step;
      const tr = this.nx(ph + cum * 0.06) * tremor + this.ny(ph * 0.7 + cum * 0.021) * tremor * 1.4;
      const t = n > 1 ? i / (n - 1) : 0.5;
      // 端で細り、腹でふくらむ。太さそのものにも粗い揺れを入れる
      const env = taper ? Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.42) : 1;
      const hw = 0.5 * w * (0.55 + 0.45 * env) * swell
        * (1 + this.nx(ph * 1.9 + cum * 0.035) * 0.22);
      const cxp = x + ux * tr, cyp = y + uy * tr;
      L.push(cxp + ux * hw, cyp + uy * hw);
      R.push(cxp - ux * hw, cyp - uy * hw);
    }
    // 刃が飛ぶ = 途中で切れる
    const runs = [];
    if (skip > 0 && n > 8) {
      let s = 0;
      for (let i = 3; i < n - 3; i++) {
        if (this.rng() < skip) {
          runs.push([s, i]); s = i + 1 + ((this.rng() * 2) | 0);
          i = s + 2;
        }
      }
      runs.push([s, n - 1]);
    } else runs.push([0, n - 1]);
    const c = this.ctx;
    for (const [a, b] of runs) {
      if (b - a < 1) continue;
      c.moveTo(L[a * 2], L[a * 2 + 1]);
      for (let i = a + 1; i <= b; i++) c.lineTo(L[i * 2], L[i * 2 + 1]);
      for (let i = b; i >= a; i--) c.lineTo(R[i * 2], R[i * 2 + 1]);
      c.closePath();
    }
  }
}

// ------------------------------------------------------------ 彫った文字 ----
// 活字を置くのではなく、字を刻む。骨格を線で持ち、ビュランで太らせる。
// 0=太い縦画 1=細い髪の毛 2=弧(太) 3=弧(細)。y は上向き(0 足元 / 1 頭)。
const A_ = (cx, cy, rx, ry, a0, a1, thin) => [thin ? 3 : 2, cx, cy, rx, ry, a0, a1];
const GLYPH = {
  ' ': [0.34, []],
  'A': [0.74, [[0, 0.07, 0, 0.37, 1], [0, 0.37, 1, 0.67, 0], [1, 0.18, 0.30, 0.56, 0.30],
    [1, 0, 0, 0.15, 0], [1, 0.59, 0, 0.74, 0]]],
  'B': [0.70, [[0, 0.13, 0, 0.13, 1], [0, 0.13, 1, 0.36, 1], A_(0.36, 0.78, 0.21, 0.22, -1.57, 1.57),
    [0, 0.13, 0.56, 0.38, 0.56], A_(0.38, 0.28, 0.25, 0.28, -1.57, 1.57), [0, 0.13, 0, 0.38, 0],
    [1, 0.03, 1, 0.25, 1], [1, 0.03, 0, 0.25, 0]]],
  'C': [0.70, [A_(0.38, 0.50, 0.32, 0.50, 0.55, 5.73), [1, 0.60, 0.80, 0.70, 0.90], [1, 0.60, 0.20, 0.70, 0.10]]],
  'D': [0.74, [[0, 0.13, 0, 0.13, 1], [0, 0.13, 1, 0.40, 1], A_(0.40, 0.50, 0.26, 0.50, -1.57, 1.57),
    [0, 0.13, 0, 0.40, 0], [1, 0.03, 1, 0.25, 1], [1, 0.03, 0, 0.25, 0]]],
  'E': [0.64, [[0, 0.13, 0, 0.13, 1], [1, 0.13, 1, 0.60, 1], [1, 0.13, 0.52, 0.48, 0.52],
    [1, 0.13, 0, 0.62, 0], [1, 0.03, 1, 0.25, 1], [1, 0.03, 0, 0.25, 0]]],
  'F': [0.60, [[0, 0.13, 0, 0.13, 1], [1, 0.13, 1, 0.58, 1], [1, 0.13, 0.52, 0.46, 0.52],
    [1, 0.03, 1, 0.25, 1], [1, 0.03, 0, 0.25, 0]]],
  'G': [0.76, [A_(0.38, 0.50, 0.32, 0.50, 0.58, 5.42), [0, 0.71, 0.42, 0.71, 0.13],
    [1, 0.46, 0.42, 0.71, 0.42], [1, 0.60, 0.80, 0.70, 0.90]]],
  'H': [0.76, [[0, 0.13, 0, 0.13, 1], [0, 0.63, 0, 0.63, 1], [1, 0.13, 0.52, 0.63, 0.52],
    [1, 0.03, 1, 0.25, 1], [1, 0.03, 0, 0.25, 0], [1, 0.53, 1, 0.75, 1], [1, 0.53, 0, 0.75, 0]]],
  'I': [0.36, [[0, 0.18, 0, 0.18, 1], [1, 0.06, 1, 0.30, 1], [1, 0.06, 0, 0.30, 0]]],
  'J': [0.46, [[0, 0.32, 1, 0.32, 0.22], A_(0.18, 0.22, 0.14, 0.22, 0, 3.14), [1, 0.20, 1, 0.44, 1]]],
  'K': [0.74, [[0, 0.13, 0, 0.13, 1], [1, 0.66, 1, 0.22, 0.46], [0, 0.30, 0.58, 0.70, 0],
    [1, 0.03, 1, 0.25, 1], [1, 0.03, 0, 0.25, 0]]],
  'L': [0.60, [[0, 0.13, 0, 0.13, 1], [1, 0.13, 0, 0.60, 0], [1, 0.03, 1, 0.25, 1]]],
  'M': [0.90, [[0, 0.10, 0, 0.10, 1], [1, 0.10, 1, 0.45, 0.10], [1, 0.45, 0.10, 0.80, 1],
    [0, 0.80, 0, 0.80, 1], [1, 0.01, 1, 0.20, 1], [1, 0.70, 1, 0.89, 1], [1, 0.01, 0, 0.20, 0], [1, 0.70, 0, 0.89, 0]]],
  'N': [0.78, [[0, 0.13, 0, 0.13, 1], [0, 0.13, 1, 0.65, 0.08], [0, 0.65, 0, 0.65, 1],
    [1, 0.03, 1, 0.25, 1], [1, 0.55, 0, 0.76, 0]]],
  'O': [0.80, [A_(0.40, 0.50, 0.34, 0.50, 0, 6.2832)]],
  'P': [0.66, [[0, 0.13, 0, 0.13, 1], [0, 0.13, 1, 0.37, 1], A_(0.37, 0.78, 0.22, 0.22, -1.57, 1.57),
    [0, 0.13, 0.56, 0.37, 0.56], [1, 0.03, 1, 0.25, 1], [1, 0.03, 0, 0.25, 0]]],
  'Q': [0.80, [A_(0.40, 0.50, 0.34, 0.50, 0, 6.2832), [0, 0.46, 0.20, 0.74, -0.14]]],
  'R': [0.74, [[0, 0.13, 0, 0.13, 1], [0, 0.13, 1, 0.37, 1], A_(0.37, 0.78, 0.22, 0.22, -1.57, 1.57),
    [0, 0.13, 0.56, 0.37, 0.56], [0, 0.36, 0.56, 0.71, 0],
    [1, 0.03, 1, 0.25, 1], [1, 0.03, 0, 0.25, 0]]],
  'S': [0.64, [[0, 0.58, 0.84, 0.44, 0.99, 0.24, 0.98, 0.11, 0.86, 0.13, 0.68, 0.30, 0.57,
    0.48, 0.46, 0.58, 0.32, 0.54, 0.12, 0.35, 0.01, 0.16, 0.04, 0.05, 0.18]]],
  'T': [0.66, [[0, 0.33, 0, 0.33, 1], [1, 0.02, 1, 0.64, 1], [1, 0.21, 0, 0.45, 0]]],
  'U': [0.76, [[0, 0.13, 1, 0.13, 0.26], A_(0.38, 0.26, 0.25, 0.26, 3.14, 6.2832), [0, 0.63, 0.26, 0.63, 1],
    [1, 0.03, 1, 0.25, 1], [1, 0.53, 1, 0.75, 1]]],
  'V': [0.74, [[0, 0.05, 1, 0.37, 0], [1, 0.37, 0, 0.69, 1], [1, 0, 1, 0.18, 1], [1, 0.57, 1, 0.74, 1]]],
  'W': [1.02, [[0, 0.03, 1, 0.26, 0], [1, 0.26, 0, 0.50, 0.74], [0, 0.50, 0.74, 0.74, 0], [1, 0.74, 0, 0.99, 1],
    [1, 0, 1, 0.16, 1], [1, 0.86, 1, 1.02, 1]]],
  'X': [0.74, [[0, 0.07, 1, 0.67, 0], [1, 0.07, 0, 0.67, 1], [1, 0, 1, 0.18, 1], [1, 0.56, 1, 0.74, 1],
    [1, 0, 0, 0.18, 0], [1, 0.56, 0, 0.74, 0]]],
  'Y': [0.72, [[0, 0.06, 1, 0.36, 0.52], [1, 0.66, 1, 0.36, 0.52], [0, 0.36, 0.52, 0.36, 0],
    [1, 0, 1, 0.17, 1], [1, 0.55, 1, 0.72, 1], [1, 0.24, 0, 0.48, 0]]],
  'Z': [0.66, [[1, 0.06, 1, 0.60, 1], [0, 0.60, 1, 0.06, 0], [1, 0.06, 0, 0.62, 0]]],
  '0': [0.60, [A_(0.30, 0.50, 0.24, 0.50, 0, 6.2832)]],
  '1': [0.40, [[0, 0.22, 0, 0.22, 1], [1, 0.22, 1, 0.10, 0.84], [1, 0.08, 0, 0.36, 0]]],
  '2': [0.56, [[0, 0.07, 0.80, 0.18, 0.97, 0.38, 0.97, 0.48, 0.80, 0.42, 0.60, 0.06, 0.02], [1, 0.06, 0, 0.52, 0]]],
  '3': [0.56, [[0, 0.08, 0.90, 0.28, 1.0, 0.46, 0.90, 0.40, 0.60, 0.24, 0.54],
    [0, 0.24, 0.54, 0.46, 0.48, 0.52, 0.24, 0.36, 0.02, 0.12, 0.06]]],
  '4': [0.58, [[1, 0.38, 0, 0.38, 1], [1, 0.38, 1, 0.05, 0.28], [1, 0.05, 0.28, 0.54, 0.28]]],
  '5': [0.56, [[1, 0.48, 1, 0.14, 1], [0, 0.14, 1, 0.12, 0.60], [0, 0.12, 0.60, 0.36, 0.62, 0.50, 0.44, 0.46, 0.18, 0.26, 0.02, 0.06, 0.10]]],
  '6': [0.56, [[0, 0.46, 0.94, 0.24, 0.98, 0.10, 0.72, 0.09, 0.34], A_(0.30, 0.24, 0.22, 0.24, 0, 6.2832)]],
  '7': [0.54, [[1, 0.05, 1, 0.52, 1], [0, 0.52, 1, 0.20, 0]]],
  '8': [0.58, [A_(0.30, 0.76, 0.19, 0.24, 0, 6.2832), A_(0.30, 0.26, 0.24, 0.26, 0, 6.2832)]],
  '9': [0.56, [[0, 0.10, 0.06, 0.32, 0.02, 0.46, 0.28, 0.47, 0.66], A_(0.28, 0.74, 0.20, 0.24, 0, 6.2832)]],
  '.': [0.28, [[0, 0.12, 0.03, 0.16, 0.03]]],
  ',': [0.28, [[0, 0.14, 0.04, 0.10, -0.12]]],
  '-': [0.42, [[1, 0.06, 0.46, 0.36, 0.46]]],
  '·': [0.30, [[0, 0.13, 0.44, 0.17, 0.44]]],
};

/** 弧を折れ線に開く */
function arcPts(cx, cy, rx, ry, a0, a1, n = 22) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    out.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  return out;
}

/** 字送りの合計(em 単位) */
function advance(str, tracking) {
  let w = 0;
  for (const ch of str) {
    const g = GLYPH[ch] || GLYPH[' '];
    w += g[0] + tracking;
  }
  return w - tracking;
}

/**
 * 字を刻む。place(u) は「文字列の左からの距離 u(em)」を紙の上の点と向きに写す。
 * これ一本で、直線にも、島の輪郭に沿う弧にも同じ字が置ける。
 */
function engraveText(burin, str, place, {
  size = 20, tracking = 0.12, slant = 0, weight = 1.0, thin = 0.52, tremor = 0.35,
} = {}) {
  let u = 0;
  for (const ch of str) {
    const g = GLYPH[ch] || GLYPH[' '];
    for (const st of g[1]) {
      const isArc = st[0] === 2 || st[0] === 3;
      const isThin = st[0] === 1 || st[0] === 3;
      const raw = isArc ? arcPts(st[1], st[2], st[3], st[4], st[5], st[6]) : st.slice(1);
      const pts = [];
      for (let i = 0; i < raw.length; i += 2) {
        const gx = raw[i], gy = raw[i + 1];
        const p = place(u + gx + gy * slant);
        // 字の縦方向は place の法線へ
        pts.push(p.x + p.s * gy * size, p.y - p.c * gy * size);
      }
      burin.cut(pts, {
        w: weight * (isThin ? thin : 1) * (size / 20),
        swell: isThin ? 1.0 : 1.35, tremor, step: Math.max(1.4, size * 0.09), skip: 0,
      });
    }
    u += g[0] + tracking;
  }
}

/** 直線の baseline。y は「文字の足元」。 */
function lineAt(x, y, size, ang = 0) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return (u) => ({ x: x + c * u * size, y: y + s * u * size, c, s });
}

/** 折れ線に沿わせる(島や海の名を地形に沿って湾曲させる) */
function pathAt(poly, size, startFrac = 0.5, totalEm = 0) {
  const seg = [];
  let total = 0;
  for (let i = 2; i < poly.length; i += 2) {
    const L = Math.hypot(poly[i] - poly[i - 2], poly[i + 1] - poly[i - 1]);
    seg.push({ x0: poly[i - 2], y0: poly[i - 1], x1: poly[i], y1: poly[i + 1], L, s0: total });
    total += L;
  }
  const start = total * startFrac - totalEm * size * 0.5;
  return (u) => {
    let d = start + u * size;
    d = Math.max(0, Math.min(total - 0.001, d));
    let k = 0;
    while (k < seg.length - 1 && d > seg[k].s0 + seg[k].L) k++;
    const sg = seg[k], t = (d - sg.s0) / sg.L;
    const c = (sg.x1 - sg.x0) / sg.L, s = (sg.y1 - sg.y0) / sg.L;
    return { x: sg.x0 + (sg.x1 - sg.x0) * t, y: sg.y0 + (sg.y1 - sg.y0) * t, c, s };
  };
}

// ------------------------------------------------------------ 等値線 ----
/** マーチングスクエア。格子 f[j*n+i] の閾値 t の等値線を折れ線の配列で返す。 */
function isoLines(f, nx, ny, t, x0, y0, dx, dy) {
  const segs = [];
  const ip = (a, b) => (t - a) / (b - a || 1e-9);
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = f[j * nx + i], b = f[j * nx + i + 1];
      const c = f[(j + 1) * nx + i + 1], d = f[(j + 1) * nx + i];
      let k = 0;
      if (a > t) k |= 1; if (b > t) k |= 2; if (c > t) k |= 4; if (d > t) k |= 8;
      if (k === 0 || k === 15) continue;
      const X = x0 + i * dx, Y = y0 + j * dy;
      const T = () => [X + dx * ip(a, b), Y];
      const R = () => [X + dx, Y + dy * ip(b, c)];
      const B = () => [X + dx * ip(d, c), Y + dy];
      const L = () => [X, Y + dy * ip(a, d)];
      const push = (p, q) => segs.push(p[0], p[1], q[0], q[1]);
      switch (k) {
        case 1: push(L(), T()); break;
        case 2: push(T(), R()); break;
        case 3: push(L(), R()); break;
        case 4: push(R(), B()); break;
        case 5: push(L(), T()); push(R(), B()); break;
        case 6: push(T(), B()); break;
        case 7: push(L(), B()); break;
        case 8: push(B(), L()); break;
        case 9: push(B(), T()); break;
        case 10: push(T(), R()); push(B(), L()); break;
        case 11: push(B(), R()); break;
        case 12: push(R(), L()); break;
        case 13: push(R(), T()); break;
        case 14: push(T(), L()); break;
      }
    }
  }
  // つなぐ
  const key = (x, y) => `${Math.round(x * 64)},${Math.round(y * 64)}`;
  const from = new Map();
  for (let i = 0; i < segs.length; i += 4) {
    const k = key(segs[i], segs[i + 1]);
    (from.get(k) || from.set(k, []).get(k)).push(i);
  }
  const used = new Uint8Array(segs.length / 4);
  const out = [];
  for (let s = 0; s < segs.length; s += 4) {
    if (used[s / 4]) continue;
    used[s / 4] = 1;
    const poly = [segs[s], segs[s + 1], segs[s + 2], segs[s + 3]];
    for (let guard = 0; guard < 40000; guard++) {
      const k = key(poly[poly.length - 2], poly[poly.length - 1]);
      const cand = from.get(k);
      let nxt = -1;
      if (cand) for (const ci of cand) if (!used[ci / 4]) { nxt = ci; break; }
      if (nxt < 0) break;
      used[nxt / 4] = 1;
      poly.push(segs[nxt + 2], segs[nxt + 3]);
    }
    if (poly.length >= 8) out.push(poly);
  }
  return out;
}

/** ダグラス・ポイカー(彫師は点を打たない。折れの意味だけ残す) */
function simplify(poly, tol) {
  if (poly.length <= 6) return poly;
  const n = poly.length / 2;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const st = [[0, n - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    if (b - a < 2) continue;
    const ax = poly[a * 2], ay = poly[a * 2 + 1], bx = poly[b * 2], by = poly[b * 2 + 1];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
    let best = -1, bd = tol;
    for (let i = a + 1; i < b; i++) {
      const px = poly[i * 2] - ax, py = poly[i * 2 + 1] - ay;
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / L2));
      const d = Math.hypot(px - dx * t, py - dy * t);
      if (d > bd) { bd = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; st.push([a, best], [best, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(poly[i * 2], poly[i * 2 + 1]);
  return out;
}

/** 2-3 チャンファ距離(セル単位)。seed=1 の所から測る。 */
function chamfer(seed, nx, ny) {
  const INF = 1e9, d = new Float32Array(nx * ny);
  for (let i = 0; i < d.length; i++) d[i] = seed[i] ? 0 : INF;
  const a = 1, b = 1.41421356;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; let v = d[k];
    if (i > 0) v = Math.min(v, d[k - 1] + a);
    if (j > 0) v = Math.min(v, d[k - nx] + a);
    if (i > 0 && j > 0) v = Math.min(v, d[k - nx - 1] + b);
    if (i < nx - 1 && j > 0) v = Math.min(v, d[k - nx + 1] + b);
    d[k] = v;
  }
  for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i; let v = d[k];
    if (i < nx - 1) v = Math.min(v, d[k + 1] + a);
    if (j < ny - 1) v = Math.min(v, d[k + nx] + a);
    if (i < nx - 1 && j < ny - 1) v = Math.min(v, d[k + nx + 1] + b);
    if (i > 0 && j < ny - 1) v = Math.min(v, d[k + nx - 1] + b);
    d[k] = v;
  }
  return d;
}
function blur(f, nx, ny, times = 1) {
  let a = f, b = new Float32Array(f.length);
  for (let t = 0; t < times; t++) {
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      let s = 0, c = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        s += a[jj * nx + ii]; c++;
      }
      b[k] = s / c;
    }
    const t2 = a; a = b; b = t2;
  }
  return a;
}
function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ================================================================ 海図 ====
export function makeChart(plan, K, opts = {}) {
  const N = opts.size || 2600;
  const rng = mulberry32(SEED);
  const cv = (typeof OffscreenCanvas !== 'undefined' && opts.offscreen)
    ? new OffscreenCanvas(N, N) : document.createElement('canvas');
  cv.width = N; cv.height = N;
  const ctx = cv.getContext('2d');
  const B = new Burin(ctx, rng);

  // 世界 → 紙(北が上・回らない)
  const WX0 = -345, WZ0 = -300, SPAN = 950;
  const S = N / SPAN;
  const px = (x) => (x - WX0) * S;
  const py = (z) => (z - WZ0) * S;
  const M = (m) => m * S;                         // メートル → 画素

  // ---- 陸と海(歩ける街と同じ関数から) --------------------------------
  const wallLoop = plan.wallPts.map((p) => [p[0], p[1]]);
  const LOK = K.LOKRUM, LOV = K.LOVRIJENAC;
  const cL = Math.cos(-LOK.rot), sL = Math.sin(-LOK.rot);
  const inLokrum = (x, z) => {
    const dx = x - LOK.x, dz = z - LOK.z;
    const u = dx * cL - dz * sL, v = dx * sL + dz * cL;
    return (u * u) / (LOK.rx * LOK.rx) + (v * v) / (LOK.rz * LOK.rz) < 1;
  };
  // 「陸らしさ」。0 が渚。等値線が滑らかに出るよう高さで持つ。
  const landness = (x, z) => {
    if (inLokrum(x, z)) {
      const dx = x - LOK.x, dz = z - LOK.z;
      const u = dx * cL - dz * sL, v = dx * sL + dz * cL;
      const r = Math.sqrt((u * u) / (LOK.rx * LOK.rx) + (v * v) / (LOK.rz * LOK.rz));
      return (1 - r) * 26;
    }
    if (pointInPoly(wallLoop, x, z)) return 14;
    const base = Math.max(-24, Math.min(24, plan.outsideHeight(x, z)));
    // 街から離れた岸は「彫師の海岸」。地形関数は z の 1 次元断面なので、
    // そのまま等値線を引くと定規で引いたような直線の渚と、分岐の段差による
    // 垂直の崖が出る。街の位相には触れず、遠景だけ揺らす。
    const dCity = Math.max(0, Math.hypot(x - 5, z - 5) - 150) / 190;
    const k = Math.min(1, dCity);
    if (k <= 0) return base;
    const w1 = Math.sin(x * 0.0121 + 1.3) * Math.cos(z * 0.0093 - 0.4);
    const w2 = Math.sin(x * 0.0287 - 2.1) * Math.cos(z * 0.0242 + 1.9);
    const w3 = Math.sin(x * 0.0061 - 0.7) * Math.cos(z * 0.0052 + 2.6);
    const wob = (w1 * 9.0 + w2 * 3.6 + w3 * 12.0) * k;
    // 北(z < -60)は山越しの本土。海が入り込むのは誤り。
    if (z < -60) return Math.max(base, 7 + wob * 0.5);
    return base + wob;
  };

  const GN = 352, GD = SPAN / (GN - 1);
  const land = new Float32Array(GN * GN);
  for (let j = 0; j < GN; j++) {
    for (let i = 0; i < GN; i++) land[j * GN + i] = landness(WX0 + i * GD, WZ0 + j * GD);
  }
  const seaSeed = new Uint8Array(GN * GN);
  for (let i = 0; i < land.length; i++) seaSeed[i] = land[i] > 0 ? 1 : 0;
  const dSea = blur(chamfer(seaSeed, GN, GN), GN, GN, 2);       // 海側: 岸からのセル距離
  const isSea = (x, z) => landness(x, z) <= 0;

  // 渚(0 の等値線)
  const coasts = isoLines(land, GN, GN, 0, WX0, WZ0, GD, GD)
    .map((p) => simplify(p, 1.2)).filter((p) => p.length >= 12);
  const toPaper = (poly) => {
    const o = new Array(poly.length);
    for (let i = 0; i < poly.length; i += 2) { o[i] = px(poly[i]); o[i + 1] = py(poly[i + 1]); }
    return o;
  };

  // ---- 紙 -----------------------------------------------------------
  // 「紙は塗るのではなく漉く」。簾の目・鎖線・繊維の斑・狐斑を線と点で置く。
  const PAPER = '#e9dfc6';
  ctx.fillStyle = '#00000000';
  ctx.clearRect(0, 0, N, N);
  // 耳(デッケル)。四辺をわずかに波打たせた紙の形。
  const deckle = [];
  {
    const m = N * 0.018, jag = N * 0.0055;
    const edge = (x0, y0, x1, y1) => {
      const n = 90;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const nx2 = -(y1 - y0), ny2 = (x1 - x0);
        const L = Math.hypot(nx2, ny2) || 1;
        const w = (Math.sin(t * 37 + rng() * 0.4) * 0.4 + (rng() - 0.5) * 1.2) * jag;
        deckle.push(x0 + (x1 - x0) * t + (nx2 / L) * w, y0 + (y1 - y0) * t + (ny2 / L) * w);
      }
    };
    edge(m, m, N - m, m); edge(N - m, m, N - m, N - m);
    edge(N - m, N - m, m, N - m); edge(m, N - m, m, m);
  }
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(deckle[0], deckle[1]);
  for (let i = 2; i < deckle.length; i += 2) ctx.lineTo(deckle[i], deckle[i + 1]);
  ctx.closePath();
  ctx.fillStyle = PAPER; ctx.fill();
  ctx.clip();

  // 簾の目(細い横線)と鎖線(太い縦線 25mm 間隔)
  ctx.globalAlpha = 1;
  B.begin(0.045);
  for (let y = 0; y < N; y += N / 520) {
    B.cut([0, y + (rng() - 0.5) * 0.8, N, y + (rng() - 0.5) * 0.8],
      { w: 0.5, swell: 1, tremor: 0.5, step: 26, taper: false });
  }
  B.end();
  B.begin(0.075);
  for (let x = N * 0.03; x < N; x += N / 26) {
    B.cut([x, 0, x + (rng() - 0.5) * 3, N], { w: 1.5, swell: 1, tremor: 1.1, step: 40, taper: false });
  }
  B.end();
  // 繊維の斑と狐斑(点であって階調ではない)
  ctx.fillStyle = 'rgba(150,126,86,0.13)';
  for (let i = 0; i < 42000; i++) ctx.fillRect(rng() * N, rng() * N, 1, 1);
  ctx.fillStyle = 'rgba(255,250,235,0.16)';
  for (let i = 0; i < 16000; i++) ctx.fillRect(rng() * N, rng() * N, 1, 1);
  for (let i = 0; i < 190; i++) {
    const fx = rng() * N, fy = rng() * N, fr = 3 + rng() * 11;
    ctx.fillStyle = `rgba(150,104,52,${0.05 + rng() * 0.07})`;
    for (let k = 0; k < 26; k++) {
      const a = rng() * 6.2832, r = Math.sqrt(rng()) * fr;
      ctx.fillRect(fx + Math.cos(a) * r, fy + Math.sin(a) * r, 1.4, 1.4);
    }
  }
  ctx.restore();

  // ---- プレートマーク(銅版が紙に押した窪みの縁) ----------------------
  const PM = N * 0.062;                       // 版の縁は紙の耳より内側
  const plate = [PM, PM, N - PM, N - PM];
  {
    B.begin(0.30);
    const r = [];
    const side = (x0, y0, x1, y1) => { r.length = 0; r.push(x0, y0, x1, y1); B.cut(r, { w: 2.6, swell: 1, tremor: 1.0, step: 30, taper: false }); };
    side(PM, PM, N - PM, PM); side(N - PM, PM, N - PM, N - PM);
    side(N - PM, N - PM, PM, N - PM); side(PM, N - PM, PM, PM);
    B.end();
    // 窪みの内側の縁に、刷りの縁が少しだけ濃く出る(点で)
    ctx.fillStyle = 'rgba(60,44,28,0.09)';
    for (let i = 0; i < 5200; i++) {
      const t = rng(), s2 = rng() * 7;
      const e = (i % 4);
      let x, y;
      if (e === 0) { x = PM + t * (N - 2 * PM); y = PM + s2; }
      else if (e === 1) { x = N - PM - s2; y = PM + t * (N - 2 * PM); }
      else if (e === 2) { x = PM + t * (N - 2 * PM); y = N - PM - s2; }
      else { x = PM + s2; y = PM + t * (N - 2 * PM); }
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // 版の中だけを彫る
  ctx.save();
  ctx.beginPath();
  ctx.rect(PM + 1, PM + 1, N - 2 * PM - 2, N - 2 * PM - 2);
  ctx.clip();

  // ---- 海(彫った波線)-------------------------------------------------
  // 岸に沿う等距離線を数本。岸で詰まり、沖へ行くほど間遠になる。
  // これは「濃淡」ではなく「間隔」で作られた調子。
  const RINGS = [1.6, 4.2, 7.6, 12.0, 17.5, 24.5, 33.5, 45, 59, 76, 96, 120, 148, 182, 222];
  for (let k = 0; k < RINGS.length; k++) {
    const dcell = RINGS[k] / GD;
    const lines = isoLines(dSea, GN, GN, dcell, WX0, WZ0, GD, GD)
      .map((p) => simplify(p, 0.9)).filter((p) => p.length >= 14);
    const w = 0.95 - k * 0.035;
    B.begin(0.78 - k * 0.025);
    for (const poly of lines) {
      const pp = toPaper(poly);
      // 波線は真っ直ぐではない。等距離線に細かいうねりを足す
      const q = [];
      for (let i = 0; i < pp.length; i += 2) {
        const t = i * 0.5;
        q.push(pp[i] + Math.sin(t * 0.11 + k) * 1.3, pp[i + 1] + Math.cos(t * 0.13 + k * 1.7) * 1.3);
      }
      B.cut(q, { w: Math.max(0.5, w), swell: 1.15, tremor: 0.55, step: 3.2, skip: 0.004 });
    }
    B.end();
    if (k > 9) break;
  }
  // 沖は点刻。岸に近いほど密。
  {
    ctx.fillStyle = 'rgba(38,28,18,0.55)';
    const tries = 150000;
    for (let i = 0; i < tries; i++) {
      const x = WX0 + rng() * SPAN, z = WZ0 + rng() * SPAN;
      const gi = Math.min(GN - 1, Math.max(0, Math.round((x - WX0) / GD)));
      const gj = Math.min(GN - 1, Math.max(0, Math.round((z - WZ0) / GD)));
      if (land[gj * GN + gi] > 0) continue;
      const d = dSea[gj * GN + gi] * GD;
      // 岸から 250m で密度 0 まで落とす。判定は「間隔」であって不透明度ではない
      const p = Math.max(0, 1 - d / 250) * 0.30;
      if (rng() > p) continue;
      ctx.fillRect(px(x), py(z), 1.25, 1.25);
    }
  }

  // 飾りの占める矩形。ラム線も水深もこの下を通さない(彫師は避けて彫る)。
  const CT = { x0: N * 0.072, x1: N * 0.452, y0: N * 0.600, y1: N * 0.826 };
  const inCartouche = (x, y) => x > CT.x0 - N * 0.045 && x < CT.x1 + N * 0.045
    && y > CT.y0 - N * 0.075 && y < CT.y1 + N * 0.115;

  // ---- ラム線(ポルトラーノの流儀。海の上だけ)------------------------
  const ROSE = { x: 352, z: 92 };
  {
    const cx = px(ROSE.x), cy = py(ROSE.z);
    B.begin(0.34);
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * 6.2832 + 0.02;
      const dx = Math.cos(a), dy = Math.sin(a);
      let run = null;
      for (let r = M(56); r < N * 1.6; r += M(3.2)) {
        const wx = ROSE.x + dx * (r / S), wz = ROSE.z + dy * (r / S);
        const x = cx + dx * r, y = cy + dy * r;
        const ok = x > PM && x < N - PM && y > PM && y < N - PM && isSea(wx, wz) && !inCartouche(x, y);
        if (ok) { if (!run) run = [x, y]; else run.push(x, y); }
        else if (run) { if (run.length >= 6) B.cut(run, { w: 0.55, swell: 1, tremor: 0.5, step: 9, taper: false }); run = null; }
      }
      if (run && run.length >= 6) B.cut(run, { w: 0.55, swell: 1, tremor: 0.5, step: 9, taper: false });
    }
    B.end();
  }

  // ---- 渚(二重の毛羽立った海岸線)------------------------------------
  for (const poly of coasts) {
    const pp = toPaper(poly);
    B.begin(0.95);
    B.cut(pp, { w: 1.7, swell: 1.25, tremor: 0.5, step: 3.0, skip: 0.002 });
    B.end();
    // 陸側へ短い毛(彫師の海岸線)。長さは岸から内へ入るほど短く。
    B.begin(0.62);
    let acc = 0;
    for (let i = 2; i < pp.length; i += 2) {
      const x0 = pp[i - 2], y0 = pp[i - 1], x1 = pp[i], y1 = pp[i + 1];
      const L = Math.hypot(x1 - x0, y1 - y0);
      if (L < 1e-6) continue;
      const ux = (x1 - x0) / L, uy = (y1 - y0) / L;
      let nx2 = -uy, ny2 = ux;
      const wx = (x0 + (WX0 * S)) / S, wz = (y0) / S + WZ0;
      const mx = poly[i - 2] + (-((poly[i + 1] - poly[i - 1]) / (L / S))) * 3;
      const mz = poly[i - 1] + ((poly[i] - poly[i - 2]) / (L / S)) * 3;
      if (landness(mx, mz) <= 0) { nx2 = -nx2; ny2 = -ny2; }
      for (acc = acc % 5.4; acc < L; acc += 5.4) {
        const bx = x0 + ux * acc, by = y0 + uy * acc;
        const h = M(1.4) * (0.55 + rng() * 0.9);
        B.cut([bx, by, bx + nx2 * h, by + ny2 * h], { w: 0.75, swell: 1.1, tremor: 0.2, step: 2.4 });
      }
      acc -= L;
    }
    B.end();
  }

  // ---- 山(等高線ではなく「土まんじゅう」)------------------------------
  // 1600 年代に等高線は無い。あれば知っている目に必ず見咎められる。
  const molehill = (cx, base, w, h, lightFromLeft = true) => {
    const prof = [];
    const n = 26;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = cx - w / 2 + w * t;
      const y = base - h * Math.pow(Math.sin(Math.PI * t), 0.78)
        * (1 + Math.sin(t * 11 + cx * 0.03) * 0.06);
      prof.push(x, y);
    }
    B.begin(0.92);
    B.cut(prof, { w: 1.25, swell: 1.3, tremor: 0.45, step: 2.6 });
    B.end();
    // 陰の側だけを斜線で。光は左上から。
    B.begin(0.62);
    const k0 = lightFromLeft ? Math.round(n * 0.46) : 0;
    const k1 = lightFromLeft ? n : Math.round(n * 0.54);
    for (let i = k0; i <= k1; i += 1) {
      const x = prof[i * 2], y = prof[i * 2 + 1];
      const t = (i - k0) / Math.max(1, k1 - k0);
      const len = h * (0.72 - 0.5 * Math.abs(t - 0.35)) * (0.8 + rng() * 0.4);
      if (len < 1.5) continue;
      const dx = lightFromLeft ? 0.36 : -0.36;
      B.cut([x, y, x + len * dx, y + len], { w: 0.62, swell: 1.05, tremor: 0.3, step: 2.4 });
    }
    B.end();
  };
  {
    // 本土。等間隔に同じ山を並べると壁紙になる。彫師は尾根に沿って群れで置く。
    {
      const seeds = [];
      for (let i = 0; i < 260; i++) {
        const x = -340 + rng() * 820;
        const z = -258 + Math.pow(rng(), 0.75) * 232;
        if (landness(x, z) <= 3) continue;
        if (pointInPoly(wallLoop, x, z)) continue;
        if (Math.hypot(x - 5, z - 5) < 150) continue;      // 街のまわりは空けておく
        if (z > -246 && z < -204 && x > -230 && x < 350) continue;   // MONTE SERGIO の帯
        const hh = plan.terrainHeight(x, z);
        seeds.push({ x, z, h: hh });
      }
      // 近すぎるものを間引く(群れにはするが、重ねすぎない)
      const keep = [];
      for (const q of seeds) {
        let ok = true;
        for (const r2 of keep) if (Math.hypot(r2.x - q.x, r2.z - q.z) < 21 + rng() * 12) { ok = false; break; }
        if (ok) keep.push(q);
      }
      keep.sort((a, b) => a.z - b.z);
      for (const q of keep) {
        const big = 0.55 + Math.min(1, Math.max(0, (q.h - 8) / 26));
        molehill(px(q.x), py(q.z), M((15 + rng() * 20) * big), M((5.5 + rng() * 9) * big), rng() > 0.28);
      }
    }
    // 手前の小山(段になって重なる)
    for (let x = -290; x <= 430; x += 27) {
      if (rng() < 0.35) continue;
      const z = -52 + (rng() - 0.5) * 22;
      if (plan.terrainHeight(x, z) < 7) continue;
      if (pointInPoly(wallLoop, x, z)) continue;
      molehill(px(x + (rng() - 0.5) * 9), py(z), M(19 + rng() * 10), M(6 + rng() * 5), rng() > 0.3);
    }
    // ロヴリイェナツの岩とロクルムの背
    molehill(px(LOV.x), py(LOV.z + 14), M(34), M(19), false);
    for (let t = -0.55; t <= 0.55; t += 0.22) {
      const a = LOK.rot;
      const x = LOK.x + Math.cos(a) * t * LOK.rx * 1.3;
      const z = LOK.z + Math.sin(a) * t * LOK.rx * 1.3;
      molehill(px(x), py(z + 16), M(30 + rng() * 14), M(10 + rng() * 6), rng() > 0.3);
    }
  }

  // ---- 街区(家一軒ではなく塊で。省くなら正直に省く)--------------------
  let CHART_BLOCKS = [];
  {
    let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
    for (const p of wallLoop) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); bz0 = Math.min(bz0, p[1]); bz1 = Math.max(bz1, p[1]); }
    bx0 -= 6; bx1 += 6; bz0 -= 6; bz1 += 6;
    const CD = 0.65;
    const cnx = Math.ceil((bx1 - bx0) / CD) + 1, cny = Math.ceil((bz1 - bz0) / CD) + 1;
    const occ = new Float32Array(cnx * cny);
    for (const h of plan.houses) {
      if (h.garden) continue;
      const pad = 0.55;
      const i0 = Math.max(0, Math.floor((h.x - h.w / 2 - pad - bx0) / CD));
      const i1 = Math.min(cnx - 1, Math.ceil((h.x + h.w / 2 + pad - bx0) / CD));
      const j0 = Math.max(0, Math.floor((h.z - h.d / 2 - pad - bz0) / CD));
      const j1 = Math.min(cny - 1, Math.ceil((h.z + h.d / 2 + pad - bz0) / CD));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) occ[j * cnx + i] = 1;
    }
    const blocks = isoLines(blur(occ, cnx, cny, 1), cnx, cny, 0.5, bx0, bz0, CD, CD)
      .map((p) => simplify(p, 0.55)).filter((p) => p.length >= 14);
    // 輪郭
    B.begin(0.92);
    for (const p of blocks) B.cut(toPaper(p), { w: 1.15, swell: 1.2, tremor: 0.4, step: 2.4, skip: 0.003 });
    B.end();
    // 中は 45 度の斜線。街区の詰まりは「線の間隔」で言う。
    // 走査は街区の外接矩形の中だけ(紙全面に 1700 本引くと 20 秒かかる)。
    if (blocks.length) {
      let qx0 = 1e9, qx1 = -1e9, qy0 = 1e9, qy1 = -1e9;
      for (const p of blocks) {
        const pp = toPaper(p);
        for (let i = 0; i < pp.length; i += 2) {
          qx0 = Math.min(qx0, pp[i]); qx1 = Math.max(qx1, pp[i]);
          qy0 = Math.min(qy0, pp[i + 1]); qy1 = Math.max(qy1, pp[i + 1]);
        }
      }
      ctx.save();
      ctx.beginPath();
      for (const p of blocks) {
        const pp = toPaper(p);
        ctx.moveTo(pp[0], pp[1]);
        for (let i = 2; i < pp.length; i += 2) ctx.lineTo(pp[i], pp[i + 1]);
        ctx.closePath();
      }
      ctx.clip('evenodd');
      B.begin(0.55);
      const sp = M(1.5);
      for (let d = qx0 - (qy1 - qy0); d < qx1; d += sp) {
        B.cut([d, qy0, d + (qy1 - qy0), qy1], { w: 0.6, swell: 1, tremor: 0.35, step: 7, taper: false, skip: 0.02 });
      }
      B.end();
      // 交叉ハッチ。線を足すのではなく「間隔を詰める」ことで濃くする。
      B.begin(0.34);
      const spB = sp * 2.4;
      for (let d = qx0; d < qx1 + (qy1 - qy0); d += spB) {
        B.cut([d, qy0, d - (qy1 - qy0), qy1], { w: 0.5, swell: 1, tremor: 0.35, step: 9, taper: false, skip: 0.03 });
      }
      B.end();
      // 線が交わる所にインクが少しだけ溜まる。刷ればそこだけ濃く落ちる。
      // 家族 A は x−y=p、家族 B は x+y=q。交点は解いて置くだけでよい。
      ctx.fillStyle = 'rgba(34,26,18,0.5)';
      for (let dA = qx0 - (qy1 - qy0); dA < qx1; dA += sp) {
        const pA = dA - qy0;
        for (let dB = qx0; dB < qx1 + (qy1 - qy0); dB += spB) {
          if (rng() > 0.22) continue;
          const qB = dB + qy0;
          const ix = (pA + qB) / 2, iy = (qB - pA) / 2;
          if (ix < qx0 || ix > qx1 || iy < qy0 || iy > qy1) continue;
          const r2 = 0.55 + rng() * 0.5;
          ctx.fillRect(ix - r2 / 2, iy - r2 / 2, r2, r2);
        }
      }
      ctx.restore();
    }
    CHART_BLOCKS = blocks;
  }

  // ---- 城壁(二重線 + 塔)-----------------------------------------------
  {
    const NN = wallLoop.length - 1;
    const mit = [];
    for (let k = 0; k < NN; k++) {
      const p = wallLoop[k], a = wallLoop[(k - 1 + NN) % NN], b = wallLoop[(k + 1) % NN];
      let d1x = p[0] - a[0], d1z = p[1] - a[1], d2x = b[0] - p[0], d2z = b[1] - p[1];
      const l1 = Math.hypot(d1x, d1z) || 1, l2 = Math.hypot(d2x, d2z) || 1;
      d1x /= l1; d1z /= l1; d2x /= l2; d2z /= l2;
      let mx = (-d1z - d2z), mz = (d1x + d2x);
      const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
      if ((p[0] + mx * 3) * (p[0] + mx * 3) + (p[1] + mz * 3 - 15) * (p[1] + mz * 3 - 15)
        < (p[0] - mx * 3) * (p[0] - mx * 3) + (p[1] - mz * 3 - 15) * (p[1] - mz * 3 - 15)) { mx = -mx; mz = -mz; }
      mit.push([mx, mz, (plan.wallNodeHalf[k] || 2.6)]);
    }
    const ring = (sgn, w, alpha) => {
      const q = [];
      for (let k = 0; k <= NN; k++) {
        const i = k % NN, p = wallLoop[i], m = mit[i];
        q.push(px(p[0] + m[0] * m[2] * sgn), py(p[1] + m[1] * m[2] * sgn));
      }
      B.begin(alpha); B.cut(q, { w, swell: 1.3, tremor: 0.45, step: 2.6, skip: 0.002 }); B.end();
      return q;
    };
    const outer = ring(1, 2.0, 0.98);
    ring(-1, 1.35, 0.9);
    // 城壁の内側に短い横木(石積みの刻み)
    B.begin(0.5);
    for (let i = 2; i < outer.length; i += 2) {
      const x0 = outer[i - 2], y0 = outer[i - 1], x1 = outer[i], y1 = outer[i + 1];
      const L = Math.hypot(x1 - x0, y1 - y0); if (L < 1) continue;
      const ux = (x1 - x0) / L, uy = (y1 - y0) / L;
      for (let t = 0; t < L; t += M(2.4)) {
        const bx2 = x0 + ux * t, by2 = y0 + uy * t;
        B.cut([bx2, by2, bx2 + uy * M(1.6), by2 - ux * M(1.6)], { w: 0.6, swell: 1, tremor: 0.2, step: 2 });
      }
    }
    B.end();
    // 塔(円 + 内側に斜線)
    for (const [, t] of Object.entries(plan.TOWERS)) {
      const cx = px(t.x), cy = py(t.z), r = M(t.crownR);
      B.begin(0.96);
      B.cut(arcPts(cx, cy, r, r, 0, 6.2832, 34), { w: 1.5, swell: 1.2, tremor: 0.4, step: 2.6 });
      B.end();
      B.begin(0.5);
      for (let d = -r; d < r; d += M(1.5)) {
        const h = Math.sqrt(Math.max(0, r * r - d * d));
        B.cut([cx + d, cy - h, cx + d, cy + h], { w: 0.55, swell: 1, tremor: 0.25, step: 3 });
      }
      B.end();
    }
    // 門(小さな門符)
    for (const g of plan.GATES) {
      const cx = px(g.x), cy = py(g.z), r = M(3.4);
      B.begin(0.95);
      B.cut([cx - r, cy + r * 0.9, cx - r, cy - r * 0.2], { w: 1.2, swell: 1.1, tremor: 0.3, step: 2 });
      B.cut([cx + r, cy + r * 0.9, cx + r, cy - r * 0.2], { w: 1.2, swell: 1.1, tremor: 0.3, step: 2 });
      B.cut(arcPts(cx, cy - r * 0.2, r, r * 0.85, Math.PI, 6.2832, 16), { w: 1.2, swell: 1.1, tremor: 0.3, step: 2 });
      B.end();
    }
  }

  // ---- 水深(手で置いた小さな数字)-------------------------------------
  {
    const pts = [];
    for (let i = 0; i < 900 && pts.length < 46; i++) {
      const x = WX0 + rng() * SPAN, z = WZ0 + rng() * SPAN;
      if (!isSea(x, z)) continue;
      const d = plan.shoreDistAt(x, z);
      if (d < 10 || d > 340) continue;
      if (inCartouche(px(x), py(z))) continue;
      if (Math.hypot(px(x) - px(352), py(z) - py(92)) < M(62)) continue;
      let ok = true;
      for (const q of pts) if (Math.hypot(q[0] - x, q[1] - z) < 62) { ok = false; break; }
      if (!ok) continue;
      pts.push([x, z]);
    }
    B.begin(0.75);
    for (const [x, z] of pts) {
      const dep = Math.round(plan.seaDepth(plan.shoreDistAt(x, z)) * 0.55);   // パッソ
      if (dep < 1) continue;
      const str = String(dep);
      const size = M(5.2);
      const w = advance(str, 0.14) * size;
      engraveText(B, str, lineAt(px(x) - w / 2, py(z), size), { size, tracking: 0.14, weight: 0.62, thin: 0.6, tremor: 0.3 });
    }
    B.end();
  }

  // ---- 羅針図 -----------------------------------------------------------
  {
    const cx = px(ROSE.x), cy = py(ROSE.z), R = M(52);
    B.begin(0.9);
    B.cut(arcPts(cx, cy, R, R, 0, 6.2832, 60), { w: 1.3, swell: 1.15, tremor: 0.4, step: 3 });
    B.cut(arcPts(cx, cy, R * 0.92, R * 0.92, 0, 6.2832, 56), { w: 0.8, swell: 1, tremor: 0.4, step: 3 });
    B.cut(arcPts(cx, cy, R * 0.20, R * 0.20, 0, 6.2832, 24), { w: 0.9, swell: 1, tremor: 0.35, step: 2.5 });
    B.end();
    // 16 方位。各点は明暗の二枚に割る — 黒く塗るのではなく、片側だけ斜線。
    for (let k = 0; k < 16; k++) {
      const a = -Math.PI / 2 + (k / 16) * 6.2832;
      const len = (k % 4 === 0) ? R * 0.99 : (k % 2 === 0 ? R * 0.72 : R * 0.52);
      const wdt = (k % 4 === 0) ? R * 0.115 : R * 0.075;
      const tipx = cx + Math.cos(a) * len, tipy = cy + Math.sin(a) * len;
      const bx2 = cx + Math.cos(a + Math.PI / 2) * wdt, by2 = cy + Math.sin(a + Math.PI / 2) * wdt;
      const bx3 = cx + Math.cos(a - Math.PI / 2) * wdt, by3 = cy + Math.sin(a - Math.PI / 2) * wdt;
      B.begin(0.92);
      B.cut([cx, cy, tipx, tipy], { w: 0.85, swell: 1.05, tremor: 0.3, step: 3 });
      B.cut([bx2, by2, tipx, tipy], { w: 0.85, swell: 1.05, tremor: 0.3, step: 3 });
      B.cut([bx3, by3, tipx, tipy], { w: 0.85, swell: 1.05, tremor: 0.3, step: 3 });
      B.end();
      // 影の側(右回りの半分)を斜線で
      B.begin(0.6);
      const nn = 9;
      for (let i = 1; i < nn; i++) {
        const t = i / nn;
        const ax2 = cx + (bx3 - cx) * (1 - t), ay2 = cy + (by3 - cy) * (1 - t);
        const px2 = ax2 + (tipx - ax2) * 0, py2 = ay2;
        const ex = cx + (tipx - cx) * t, ey = cy + (tipy - cy) * t;
        const sx2 = bx3 + (tipx - bx3) * t, sy2 = by3 + (tipy - by3) * t;
        B.cut([ex, ey, sx2, sy2], { w: 0.5, swell: 1, tremor: 0.2, step: 3 });
        void px2; void py2;
      }
      B.end();
    }
    // 北のフルール・ド・リス
    {
      const h = R * 0.46, ty = cy - R * 1.06;
      B.begin(0.95);
      B.cut([cx, ty, cx - h * 0.16, ty + h * 0.72, cx, ty + h * 0.95, cx + h * 0.16, ty + h * 0.72, cx, ty],
        { w: 1.1, swell: 1.2, tremor: 0.3, step: 2.2 });
      B.cut(arcPts(cx - h * 0.42, ty + h * 0.62, h * 0.42, h * 0.34, -0.5, 2.6, 16), { w: 1.0, swell: 1.15, tremor: 0.3, step: 2.2 });
      B.cut(arcPts(cx + h * 0.42, ty + h * 0.62, h * 0.42, h * 0.34, 0.55, 3.65, 16), { w: 1.0, swell: 1.15, tremor: 0.3, step: 2.2 });
      B.cut([cx - h * 0.5, ty + h * 0.92, cx + h * 0.5, ty + h * 0.92], { w: 1.0, swell: 1.1, tremor: 0.25, step: 2.2 });
      B.end();
    }
    // 東の十字
    {
      const ex = cx + R * 1.13, ey = cy, h = R * 0.30;
      B.begin(0.95);
      B.cut([ex - h * 0.2, ey - h, ex - h * 0.2, ey + h], { w: 1.1, swell: 1.15, tremor: 0.28, step: 2.2 });
      B.cut([ex - h * 0.8, ey - h * 0.34, ex + h * 0.5, ey - h * 0.34], { w: 1.0, swell: 1.1, tremor: 0.28, step: 2.2 });
      B.end();
    }
  }

  // ---- カルトゥーシュ(帯金細工。同じ線の語彙で彫る)--------------------
  const spiral = (cx, cy, r0, r1, a0, turns, w) => {
    const p = [];
    const n = Math.round(30 * Math.abs(turns));
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = a0 + turns * 6.2832 * t, r = r0 + (r1 - r0) * t;
      p.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    B.begin(0.93); B.cut(p, { w, swell: 1.25, tremor: 0.35, step: 2.4 }); B.end();
  };
  const strap = (pts, hw, shadeSide = 1) => {
    const L2 = [], R2 = [];
    for (let i = 0; i < pts.length; i += 2) {
      const j = Math.min(pts.length - 2, Math.max(2, i));
      const dx = pts[j] - pts[j - 2], dy = pts[j + 1] - pts[j - 1];
      const l = Math.hypot(dx, dy) || 1, nx2 = -dy / l, ny2 = dx / l;
      L2.push(pts[i] + nx2 * hw, pts[i + 1] + ny2 * hw);
      R2.push(pts[i] - nx2 * hw, pts[i + 1] - ny2 * hw);
    }
    B.begin(0.93);
    B.cut(L2, { w: 1.15, swell: 1.2, tremor: 0.35, step: 2.4 });
    B.cut(R2, { w: 1.15, swell: 1.2, tremor: 0.35, step: 2.4 });
    B.end();
    B.begin(0.55);
    const src = shadeSide > 0 ? L2 : R2, dst = shadeSide > 0 ? R2 : L2;
    for (let i = 0; i < src.length; i += 6) {
      const t = 0.42;
      B.cut([src[i], src[i + 1], src[i] + (dst[i] - src[i]) * t, src[i + 1] + (dst[i + 1] - src[i + 1]) * t],
        { w: 0.55, swell: 1, tremor: 0.2, step: 2 });
    }
    B.end();
  };
  {
    const { x0, x1, y0, y1 } = CT;
    const w = x1 - x0, h = y1 - y0, cxm = (x0 + x1) / 2;
    // 中央の板(四隅を凹ませた盾形)
    const panel = [];
    const push = (x, y) => panel.push(x, y);
    const in1 = w * 0.10, in2 = h * 0.13;
    push(x0 + in1, y0); push(cxm - w * 0.12, y0 - h * 0.055); push(cxm + w * 0.12, y0 - h * 0.055);
    push(x1 - in1, y0); push(x1 + w * 0.035, y0 + in2); push(x1 + w * 0.035, y1 - in2);
    push(x1 - in1, y1); push(cxm + w * 0.14, y1 + h * 0.075); push(cxm - w * 0.14, y1 + h * 0.075);
    push(x0 + in1, y1); push(x0 - w * 0.035, y1 - in2); push(x0 - w * 0.035, y0 + in2);
    push(x0 + in1, y0);
    strap(panel, w * 0.017, 1);
    // 四隅の渦(スクロールワーク)
    const sc = Math.min(w, h) * 0.115;
    spiral(x0 + w * 0.055, y0 + h * 0.03, sc * 0.9, sc * 0.10, 0.4, 1.35, 1.15);
    spiral(x1 - w * 0.055, y0 + h * 0.03, sc * 0.9, sc * 0.10, 2.7, -1.35, 1.15);
    spiral(x0 + w * 0.055, y1 - h * 0.03, sc * 0.9, sc * 0.10, -0.4, -1.35, 1.15);
    spiral(x1 - w * 0.055, y1 - h * 0.03, sc * 0.9, sc * 0.10, 3.5, 1.35, 1.15);
    // 上の冠と下の垂れ
    {
      const cy0 = y0 - h * 0.055, hh = h * 0.135;
      const crest = [];
      for (let i = 0; i <= 22; i++) {
        const t = i / 22, a = Math.PI * t;
        crest.push(cxm - w * 0.215 + w * 0.43 * t, cy0 - hh * Math.sin(a) * (0.9 + 0.1 * Math.cos(a * 3)));
      }
      strap(crest, w * 0.013, -1);
      spiral(cxm - w * 0.215, cy0 - hh * 0.08, sc * 0.46, sc * 0.06, 2.2, -1.15, 1.0);
      spiral(cxm + w * 0.215, cy0 - hh * 0.08, sc * 0.46, sc * 0.06, 0.94, 1.15, 1.0);
      B.begin(0.9);
      B.cut([cxm, cy0 - hh * 0.98, cxm, cy0 - hh * 1.30], { w: 1.0, swell: 1.1, tremor: 0.3, step: 2.2 });
      B.cut(arcPts(cxm, cy0 - hh * 1.42, hh * 0.16, hh * 0.16, 0, 6.2832, 16), { w: 0.9, swell: 1, tremor: 0.25, step: 2 });
      B.end();
    }
    {
      const pend = [];
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        pend.push(cxm - w * 0.155 + w * 0.31 * t, y1 + h * 0.06 + h * 0.10 * Math.sin(Math.PI * t));
      }
      strap(pend, w * 0.012, 1);
      spiral(cxm - w * 0.155, y1 + h * 0.055, sc * 0.34, sc * 0.05, 3.8, 1.0, 0.95);
      spiral(cxm + w * 0.155, y1 + h * 0.055, sc * 0.34, sc * 0.05, 5.6, -1.0, 0.95);
    }
    // 板の内側に細かい斜線(帯金の陰。ここも間隔で作る)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(panel[0], panel[1]);
    for (let i = 2; i < panel.length; i += 2) ctx.lineTo(panel[i], panel[i + 1]);
    ctx.closePath(); ctx.clip();
    B.begin(0.16);
    for (let d = -N; d < N * 2; d += M(2.6)) B.cut([d, 0, d - N, N], { w: 0.5, swell: 1, tremor: 0.3, step: 8, taper: false });
    B.end();
    ctx.restore();
    // 題
    const t1 = 'RESPVBLICA', t2 = 'RAGVSINA';
    const s1 = h * 0.185, s2 = h * 0.215;
    const w1 = advance(t1, 0.16) * s1, w2 = advance(t2, 0.20) * s2;
    B.begin(0.97);
    engraveText(B, t1, lineAt(cxm - w1 / 2, y0 + h * 0.40, s1), { size: s1, tracking: 0.16, weight: 1.35, thin: 0.42, tremor: 0.4 });
    engraveText(B, t2, lineAt(cxm - w2 / 2, y0 + h * 0.72, s2), { size: s2, tracking: 0.20, weight: 1.5, thin: 0.42, tremor: 0.4 });
    B.end();
    const t3 = 'CITTA · ET · PORTO';
    const s3 = h * 0.072, w3 = advance(t3, 0.34) * s3;
    B.begin(0.8);
    engraveText(B, t3, lineAt(cxm - w3 / 2, y0 + h * 0.90, s3), { size: s3, tracking: 0.34, weight: 0.7, thin: 0.5, tremor: 0.35, slant: 0.20 });
    B.end();
  }

  // ---- 縮尺(パッシ)とディバイダ ---------------------------------------
  {
    const bx = CT.x0 + N * 0.012, by = CT.y1 + N * 0.062, bw = (CT.x1 - CT.x0) * 0.86, bh = N * 0.0145;
    const seg = 6, sw = bw / seg;
    B.begin(0.93);
    B.cut([bx, by, bx + bw, by, bx + bw, by + bh, bx, by + bh, bx, by], { w: 1.15, swell: 1.1, tremor: 0.3, step: 3 });
    for (let i = 1; i < seg; i++) B.cut([bx + i * sw, by, bx + i * sw, by + bh], { w: 0.9, swell: 1, tremor: 0.25, step: 3 });
    B.end();
    B.begin(0.6);
    for (let i = 0; i < seg; i += 2) {
      for (let d = M(0.5); d < sw - M(0.2); d += M(0.62)) {
        B.cut([bx + i * sw + d, by + 1.5, bx + i * sw + d, by + bh - 1.5],
          { w: 0.55, swell: 1, tremor: 0.2, step: 3 });
      }
    }
    B.end();
    const lab = 'SCALA DI PASSI CC';
    const sL = N * 0.0155;
    B.begin(0.85);
    engraveText(B, lab, lineAt(bx, by - N * 0.011, sL), { size: sL, tracking: 0.26, weight: 0.72, thin: 0.5, tremor: 0.35, slant: 0.18 });
    for (let i = 0; i <= seg; i += 2) {
      const s4 = N * 0.0125, str = String(i * 40);
      const w4 = advance(str, 0.14) * s4;
      engraveText(B, str, lineAt(bx + i * sw - w4 / 2, by + bh + N * 0.016, s4), { size: s4, tracking: 0.14, weight: 0.6, thin: 0.55, tremor: 0.3 });
    }
    B.end();
    // ディバイダ(両脚を開いて目盛を歩く)
    {
      const ax = bx + bw * 0.90, ay = by - N * 0.028, sp = sw * 0.80;
      B.begin(0.92);
      B.cut([ax, ay, ax - sp * 0.5, by - N * 0.003], { w: 1.3, swell: 1.15, tremor: 0.3, step: 3 });
      B.cut([ax, ay, ax + sp * 0.5, by - N * 0.003], { w: 1.3, swell: 1.15, tremor: 0.3, step: 3 });
      B.cut(arcPts(ax, ay, N * 0.006, N * 0.006, 0, 6.2832, 14), { w: 0.9, swell: 1, tremor: 0.25, step: 2 });
      B.end();
    }
  }

  // ---- 銘(彫った字。活字ではない)--------------------------------------
  const label = (str, wx, wz, size, o = {}) => {
    const sz = N * size;
    const w = advance(str, o.tracking ?? 0.18) * sz;
    B.begin(o.alpha ?? 0.93);
    engraveText(B, str, lineAt(px(wx) - w / 2, py(wz), sz, o.ang || 0), {
      size: sz, tracking: o.tracking ?? 0.18, weight: o.weight ?? 0.85,
      thin: o.thin ?? 0.48, tremor: 0.36, slant: o.slant ?? 0,
    });
    B.end();
  };
  const labelOn = (str, poly, size, o = {}) => {
    // 折れ線が右から左へ向いていると、baseline の「上」が下を向いて字が逆立ちする。
    if (poly[poly.length - 2] < poly[0]) {
      const r = [];
      for (let i = poly.length - 2; i >= 0; i -= 2) r.push(poly[i], poly[i + 1]);
      poly = r;
    }
    const sz = N * size;
    const tr = o.tracking ?? 0.18;
    B.begin(o.alpha ?? 0.93);
    engraveText(B, str, pathAt(poly, sz, o.at ?? 0.5, advance(str, tr)), {
      size: sz, tracking: tr, weight: o.weight ?? 0.85, thin: o.thin ?? 0.48,
      tremor: 0.36, slant: o.slant ?? 0,
    });
    B.end();
  };
  label('RAGVSA', 6, 142, 0.0335, { tracking: 0.30, weight: 1.35, thin: 0.40 });
  label('MARE ADRIATICO', 168, 232, 0.0245, { tracking: 0.62, weight: 0.78, thin: 0.5, slant: 0.20, alpha: 0.8 });
  label('MONTE SERGIO', 60, -216, 0.0205, { tracking: 0.42, weight: 0.85, thin: 0.5, slant: 0.20, alpha: 0.95 });
  {   // ラクロマは島の長軸に沿って弧を描く
    const a = LOK.rot, arc = [];
    for (let t = -1; t <= 1.0001; t += 0.1) {
      const x = LOK.x + Math.cos(a) * t * LOK.rx * 0.86;
      const z = LOK.z + Math.sin(a) * t * LOK.rx * 0.86 - 26 - 20 * (1 - t * t);
      arc.push(px(x), py(z));
    }
    labelOn('LACROMA', arc, 0.0175, { tracking: 0.40, weight: 0.75, thin: 0.5, slant: 0.18 });
  }
  {   // ストラドゥンは街路そのものに沿わせる
    const st = plan.streets.find((s2) => s2.kind === 'stradun');
    if (st) {
      const poly = [];
      for (const p of st.pts) poly.push(px(p[0]), py(p[1]) - M(7.0));
      labelOn('STRADONE', poly, 0.0126, { tracking: 0.30, weight: 0.70, thin: 0.52, slant: 0.16, alpha: 0.92 });
    }
  }
  label('PORTA PILLE', -232, -18, 0.0104, { tracking: 0.24, weight: 0.7, thin: 0.5, alpha: 0.96 });
  label('PORTA PLOCCE', 204, -70, 0.0104, { tracking: 0.24, weight: 0.7, thin: 0.5, alpha: 0.96 });
  label('PORTO', 208, 26, 0.0118, { tracking: 0.30, weight: 0.72, thin: 0.5, slant: 0.18, alpha: 0.96 });
  label('S · LAVRENTII', -222, 150, 0.0102, { tracking: 0.22, weight: 0.7, thin: 0.5, alpha: 0.96 });

  // ---- 手彩色(あるとすれば刷りの後。線が透けて見え、版とわずかにずれる)--
  {
    ctx.save();
    ctx.globalAlpha = 0.085;
    ctx.strokeStyle = '#6f9a9a';
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.translate(2.6, 1.9);                       // 見当ずれ
    ctx.lineWidth = M(3.0);
    for (const poly of coasts) {
      const pp = toPaper(poly);
      ctx.beginPath();
      ctx.moveTo(pp[0], pp[1]);
      for (let i = 2; i < pp.length; i += 2) ctx.lineTo(pp[i], pp[i + 1]);
      ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.075;
    ctx.fillStyle = '#c09659';
    ctx.translate(-2.2, 3.1);
    ctx.beginPath();
    for (const p of CHART_BLOCKS) {
      if (rng() < 0.18) continue;                 // 塗り残し
      const pp = toPaper(p);
      ctx.moveTo(pp[0], pp[1]);
      for (let i = 2; i < pp.length; i += 2) ctx.lineTo(pp[i], pp[i + 1]);
      ctx.closePath();
    }
    ctx.fill('evenodd');
    ctx.restore();
  }

  ctx.restore();     // 版の外へ
  return { canvas: cv, px, py, S, plate };
}
