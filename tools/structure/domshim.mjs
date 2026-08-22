// ============================================================================
// domshim.mjs — Node に「canvas の影武者」を置く。
//
// 目的は一つだけ: tex.js を書き換えずに、実物のコードをそのまま Node で走らせ
// ること。テクスチャの画素は幾何に一切影響しない(石の寸法は coverM のような
// 定数で決まり、UV は世界座標から計算される)ので、描画命令は捨ててよい。
// 捨ててよくないのは「返り値の形」— getImageData が .data を返さないと
// heightToNormal が落ちる。だから形だけは律儀に守る。
//
// この影武者は tools/ の中にある。src/ 側は本物の canvas しか知らないままで、
// つまり「検証のためにアプリ側を曲げる」ことをしていない。
// ============================================================================

class FakeImageData {
  constructor(w, h, data) {
    this.width = w; this.height = h;
    this.data = data || new Uint8ClampedArray(w * h * 4);
  }
}

// 呼ばれても何もしない描画命令。存在しないと tex.js が TypeError で落ちる。
const NOOP_METHODS = [
  'save', 'restore', 'translate', 'rotate', 'scale', 'transform', 'setTransform', 'resetTransform',
  'beginPath', 'closePath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'arc', 'arcTo',
  'ellipse', 'rect', 'roundRect', 'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'clearRect',
  'fillText', 'strokeText', 'drawImage', 'setLineDash', 'clip', 'scrollPathIntoView',
];

class FakeContext2D {
  constructor(canvas) {
    this.canvas = canvas;
    this._px = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    // tex.js が読む属性。書き込みは素通しでよい。
    this.fillStyle = '#000'; this.strokeStyle = '#000';
    this.lineWidth = 1; this.lineCap = 'butt'; this.lineJoin = 'miter';
    this.globalAlpha = 1; this.globalCompositeOperation = 'source-over';
    this.font = '10px sans-serif'; this.textAlign = 'start'; this.textBaseline = 'alphabetic';
    this.shadowBlur = 0; this.shadowColor = 'transparent'; this.filter = 'none';
    this.imageSmoothingEnabled = true; this.miterLimit = 10; this.lineDashOffset = 0;
    for (const m of NOOP_METHODS) this[m] = () => {};
  }
  measureText(t) { return { width: String(t).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }; }
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
  createConicGradient() { return { addColorStop() {} }; }
  createPattern() { return null; }
  createImageData(w, h) {
    if (w instanceof FakeImageData) return new FakeImageData(w.width, w.height);
    return new FakeImageData(w, h);
  }
  getImageData(x, y, w, h) {
    // 実キャンバスは黒(0,0,0,0)で始まる。描画を捨てているので黒のまま返す。
    // heightToNormal はこれを高さ 0 の平面として扱い、平らな法線マップを作る。
    return new FakeImageData(w, h);
  }
  putImageData(img) {
    if (img && img.data && img.data.length === this._px.length) this._px.set(img.data);
  }
  getLineDash() { return []; }
}

class FakeCanvas {
  constructor() { this.width = 300; this.height = 150; this._ctx = null; }
  getContext(kind) {
    if (kind !== '2d') return null;
    // 幅・高さは getContext より前に代入されるので、ここで初めて確定させる。
    if (!this._ctx || this._ctx.canvas !== this) this._ctx = new FakeContext2D(this);
    return this._ctx;
  }
  toDataURL() { return 'data:,'; }
  addEventListener() {}
  removeEventListener() {}
}

/** Node のグローバルに canvas 一式を置く。二度呼んでも安全。 */
export function installDomShim() {
  if (globalThis.__domShimInstalled) return;
  const doc = {
    createElement(tag) {
      if (String(tag).toLowerCase() === 'canvas') return new FakeCanvas();
      return { style: {}, appendChild() {}, addEventListener() {}, setAttribute() {} };
    },
    createElementNS(_ns, tag) { return doc.createElement(tag); },
    getElementById() { return null; },
    addEventListener() {}, removeEventListener() {},
    body: { appendChild() {}, style: {} },
  };
  globalThis.document = doc;
  globalThis.window = globalThis;
  globalThis.self = globalThis;
  globalThis.devicePixelRatio = 1;
  globalThis.innerWidth = 1600;
  globalThis.innerHeight = 1000;
  globalThis.HTMLCanvasElement = FakeCanvas;
  globalThis.ImageData = FakeImageData;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
  globalThis.__domShimInstalled = true;
}
