// ============================================================================
// main.js — 組み立てと呼吸。
// 起動順が大事: plan → monuments(合成レコードを家に足す)→ ground/walls
// (StepPool へ石段を注ぐ)→ buildings → 生活と音。
// ============================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { buildWorld } from './world.js';
import { makeRenderDiagnostics } from './diagnostics.js';
import { makeInstanceLOD } from './instance-lod.js';
import { sunState } from './sky.js';
import { SEA_LAYER } from './sea.js';
import { setWetTime } from './wet.js';
import { monumentTime } from './monuments.js';
import { makeLighting } from './light.js';
import { MesopicShader } from './mesopic.js';
import {makeRadianceStorage,RadianceOutputPass} from './radiance-storage.js';
import { shareFrameShadows } from './frame-shadows.js';
import { warmShadowPrograms } from './shader-warmup.js';
import { CityAudio } from './audio.js';
import { makeAudioControls } from './audio-controls.js';
import { Player } from './player.js';
import { makeUI } from './ui.js';
import { makeWaterControls } from './water-controls.js';
import { clamp, lerp } from './util.js';

const Q = new URLSearchParams(location.search);
const qf = (k, d) => (Q.has(k) ? parseFloat(Q.get(k)) : d);
const SHOT = Q.has('shot');

// ---------------------------------------------------------------- 世界 ----
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// Retina では画素が 4 倍になり、実機で 23fps まで落ちる。
// 上限を 1.6 にし、さらに下の adaptive で実測に合わせて動かす。
const DPR_MAX = Math.min(devicePixelRatio, 1.6);
renderer.setPixelRatio(DPR_MAX);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;   // r185 で PCFSoft は PCF に統合された(警告を出さない)
// ACES のショルダーは出力 0.72〜0.93 で傾き 0.13 以下。日向の石灰岩がそこに
// 座ると、テクスチャに ±24% の分散があっても画面では ±4% に潰れる。
// Khronos PBR Neutral はハイライトの傾きを保つので、石が石に見える。
// Neutral(Khronos PBR Neutral)は白背景に製品を置くための変換で、
// min ch ≥ 0.08 の全画素から一律 0.04 を引く。日陰の舗石は 43% を失う。
// AgX は暗部のトウが減算ではなく、上側も 1 段 8LSB で潰れない。
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 0.58;
renderer.info.autoReset = false;   // 1フレーム分のドローコールを正しく数える
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
// 垂直画角を固定すると、横長の窓では **水平画角が開きすぎる**。
// 66° 固定は 16:9 で水平 98°、2.07:1(2000×966)では **106.8°** になり、
// 画面の端で垂直な線が大きく倒れる。首を少し振るだけでパラソルの棒や
// 柱が左右に振れて見える(ユーザー報告「棒が左右にゆらゆらします」)。
// **水平画角に上限を掛け**、超える窓では垂直画角を下げる。
// 撮影の定点は 1600×1000(縦横比 1.6)で画角 44〜62 なので、水平は最大 96° —
// この上限には触れない = キャンペーンの実測値は 1 枚も動かない。
const HFOV_MAX_TAN = Math.tan((100 * Math.PI / 180) / 2);   // 水平 100°
function fovFor(vDeg, aspect) {
  const tanH = Math.tan((vDeg * Math.PI) / 360) * aspect;
  if (tanH <= HFOV_MAX_TAN) return vDeg;
  return (2 * Math.atan(HFOV_MAX_TAN / aspect) * 180) / Math.PI;
}
const FOV_V = qf('fov', 66);
const camera = new THREE.PerspectiveCamera(
  fovFor(FOV_V, innerWidth / innerHeight), innerWidth / innerHeight, 0.1, 6000);

// 組み立ては world.js が唯一の定義。ここに順序を書き写すと、検証ツールが
// 見ている世界とプレイヤーが歩く世界が静かに食い違う。
const world = buildWorld({ seed: Q.has('seed') ? qf('seed', undefined) : undefined });
const { plan, tex, stepPool, monuments, ground, walls, buildings, surround, sea, sky, life, steps, cafe } = world;

scene.add(world.root);
const instanceLOD = makeInstanceLOD(world.root, plan);
const diagnostics = makeRenderDiagnostics(world.root, camera);
window.__RENDER_STATS = diagnostics.stats;
if (SHOT) window.__captureFrame = () => diagnostics.captureNextFrame();

const lighting = makeLighting(renderer, scene, tex, sky, sea);
const radianceStorage=makeRadianceStorage(scene,sea);
const frameShadows = shareFrameShadows(renderer, scene, camera);
const audio = new CityAudio(monuments.bellPos);
window.__audio = audio;   // ヘッドレス検証用

// ---------------------------------------------------------------- 状態 ----
const presets = world.presets;
const state = {
  // 表題は「早朝の低い日が磨いた石灰岩を舐める」時刻から始まる。
  // 方位 80°(ほぼ真東)= ストラドゥンの通り芯。街路が光の廊下になる。
  time: qf('time', SHOT ? presets[0].time : 7.1),
  flow: qf('flow', 36),            // 1実秒 = 36ゲーム秒(1時間≒100秒)
  paused: false,
  elapsed: 0,
};

const spawn = Q.has('x')
  ? { x: qf('x', 0), z: qf('z', 0), yaw: qf('yaw', 0), pitch: qf('pitch', 0), groundY: Q.has('gy') ? qf('gy', 500) : undefined }
  : presets[0];
const player = new Player(plan, spawn);
if (SHOT) player.frozen = true;

const counts = {
  houses: buildings.counts.houses,
  win: buildings.counts.windows,
  shut: buildings.counts.shutters,
  steps: stepPool.count,
  merlon: walls.counts.merlons,
  pine: surround.counts.pines,
  cloth: life.counts.cloths,
  pot: life.counts.pots,
  swift: life.counts.swifts,
};
const ui = makeUI(plan, counts, presets);
ui.onTimeDrag = (t) => { state.time = t; };
makeWaterControls(lighting.waterLight.optics,{
  getPaused:()=>state.paused,setPaused:value=>{state.paused=value;},
});

// ---------------------------------------------------- おまかせで歩く ----
// ルート定義は plan と共有(tools/walktest.mjs が同じ道を衝突込みで検証する)。
const routes = world.routes;
const AUTO_KEYS = new Set(['KeyW']);
const EMPTY_KEYS = new Set();
const shortestAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const auto = {
  active: false, route: null, wpIdx: 0, pauseT: 0, stuckT: 0, lastDist: 1e9,
  start(route) {
    this.route = route; this.wpIdx = 1; this.pauseT = 0; this.stuckT = 0; this.lastDist = 1e9;
    this.active = true;
    if (route.time !== undefined) state.time = route.time;
    const w0 = route.wps[0], w1 = route.wps[1];
    player.teleport(w0.x, w0.z, Math.atan2(-(w1.x - w0.x), -(w1.z - w0.z)), 0);
    if (w0.hint) ui.hint(w0.hint, 4200);
  },
  stop(msg) {
    if (!this.active) return;
    this.active = false;
    if (msg) ui.hint(msg, 3800);
  },
  update(dt) {
    const wps = this.route.wps;
    const w = wps[this.wpIdx];
    // 眺めのポーズ: 立ち止まり、視線をゆっくり合わせる
    if (this.pauseT > 0) {
      this.pauseT -= dt;
      if (w.gaze) {
        player.yaw += shortestAngle(w.gaze.yaw - player.yaw) * Math.min(1, dt * 1.6);
        player.pitch += (w.gaze.pitch - player.pitch) * Math.min(1, dt * 1.6);
      }
      player.update(dt, EMPTY_KEYS);
      if (this.pauseT <= 0) this.advance();
      return;
    }
    const dx = w.x - player.x, dz = w.z - player.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1.25) {
      if (w.hint) ui.hint(w.hint, 3600);
      if (w.pause) { this.pauseT = w.pause; return; }
      this.advance();
      return;
    }
    // 進めない見張り(6秒進捗なしなら次へ — 立ち往生させない)
    if (dist > this.lastDist - 0.02) this.stuckT += dt; else this.stuckT = 0;
    this.lastDist = dist;
    if (this.stuckT > 6) { console.warn('auto: skip wp', this.wpIdx); this.stuckT = 0; this.advance(); return; }
    // 操舵: 大回頭中は足を止める(散歩の呼吸)
    const desired = Math.atan2(-dx, -dz);
    const dYaw = shortestAngle(desired - player.yaw);
    player.yaw += Math.max(-dt * 2.1, Math.min(dt * 2.1, dYaw));
    player.pitch += (0 - player.pitch) * Math.min(1, dt * 0.7);
    player.update(dt, Math.abs(dYaw) < 1.15 ? AUTO_KEYS : EMPTY_KEYS);
  },
  advance() {
    this.wpIdx++;
    this.lastDist = 1e9;
    if (this.wpIdx >= this.route.wps.length) this.stop('着きました — ここからは、あなたの足で');
  },
};
window.__auto = auto;
// ヘッドレス幾何検証用(tools/geomtest.mjs)— 「描画された三角形」を真実として測る
window.__world = {
  THREE, scene, camera, plan, player, auto, routes, life,
  solids: [ground.group, walls.group, buildings.group, monuments.group, steps,...(cafe?[cafe.group]:[])],
  cafe,
  renderer,
  radianceStorage,
  instanceLOD,
  frameShadows,
  counts: world.counts,
  // 光の計器(tools/lightprobe.mjs)— 露出・放射照度・影の設定を数字で読む
  get lighting() { return lighting; },
  get sunState() { const s = sunState(state.time); lighting.atmosphere.applyState(s); return s; },
  atmosphere: lighting.atmosphere,
  get worldState() { return state; },
};

// ---------------------------------------------------------------- 後段 ----
// WebGLRenderer の antialias はデフォルトフレームバッファにしか効かない。
// EffectComposer は自前の RT に描くので、samples を渡さないと AA がゼロになる。
const _dpr = DPR_MAX;
const composerRT = new THREE.WebGLRenderTarget(innerWidth * _dpr, innerHeight * _dpr, {
  type: THREE.HalfFloatType, samples: 4,
});
// ---- 水中パス。海の屈折・吸収・反射が読む「水の下に在る物」だけを描く。
// 街全体を二度描かずに、深度バッファと海底の色を手に入れるための一枚。
const underScale = 0.7;
const rtUnder = new THREE.WebGLRenderTarget(
  Math.max(2, Math.round(innerWidth * _dpr * underScale)),
  Math.max(2, Math.round(innerHeight * _dpr * underScale)),
  { type: THREE.HalfFloatType, depthBuffer: true },
);
rtUnder.depthTexture = new THREE.DepthTexture(rtUnder.width, rtUnder.height);
rtUnder.depthTexture.format = THREE.DepthFormat;
rtUnder.depthTexture.type = THREE.UnsignedIntType;
// 海底・岩棚・岸壁・島。城壁は「水面に映る物」でもあるので入れる。
// 記念建築も入れる。入れないと SSR が読むバッファに鐘楼もドームも無く、
// 港の水面に街の輪郭が一切映らない。
// buildings/life まで入れるとドローコールが 210 になり上限 200 を超えるので、
// 水面に映って意味のあるもの(城壁・要塞・岸壁・舟・島・鐘楼)に絞る。
for (const g of [ground.group, walls.group, surround.group, monuments.group]) {
  g.traverse(o => { if (o.isMesh || o.isPoints) o.layers.enable(SEA_LAYER); });
}
// three はライトも camera.layers で選別する。ここを忘れると水中パスが
// 完全な無照明になり、海底が真っ黒に沈んで「浅場が光る」が起きない。
scene.traverse(o => { if (o.isLight) o.layers.enable(SEA_LAYER); });
// uRes は「海面を描いている画面」の解像度。水中パスの解像度(0.7 倍)を
// 渡すと gl_FragCoord/uRes が 1 を超え、画面の上 3 割で海底が読めなくなる
// (= 一定距離から先が一様な色になり、水平線と平行な段差が出る)。
sea.setTargets(rtUnder.texture, rtUnder.depthTexture,
  Math.round(innerWidth * _dpr), Math.round(innerHeight * _dpr));
sea.uniforms.uDebug.value = qf('seadbg', 0);
function resizeUnder(dpr) {
  const w = Math.max(2, Math.round(innerWidth * dpr * underScale));
  const h = Math.max(2, Math.round(innerHeight * dpr * underScale));
  if (w !== rtUnder.width || h !== rtUnder.height) rtUnder.setSize(w, h);
  sea.setTargets(rtUnder.texture, rtUnder.depthTexture,
    Math.round(innerWidth * dpr), Math.round(innerHeight * dpr));
}
function renderUnder() {
  camera.layers.set(SEA_LAYER);
  renderer.setRenderTarget(rtUnder);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, false);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  camera.layers.set(0);
}

const composer = new EffectComposer(renderer, composerRT);
// RenderPass/bloom keep readBuffer (rt2); mesopic and OutputPass swap twice,
// returning both buffers to these roles at the end of every frame. Only rt2
// draws geometry. The observer writes one full-screen colour per pixel, so a
// second multisample colour/depth allocation and resolve cannot add edge AA.
composer.renderTarget1.samples = 0;
composer.renderTarget1.depthBuffer = false;
composer.renderTarget1.texture.name = 'city.observer';
composer.addPass(new RenderPass(scene, camera));
// 接地の翳りは GTAO ではなく「天空可視率」を頂点に焼いて作る(skyvis.js)。
// スクリーン空間の AO は半径が数十cm なので、6m のトンネル・4m の路地の底・
// 3m のアーケードといった建築スケールの遮蔽を原理的に作れない。
// 実測でも GTAO は 2.3% の画素しか変えず、描画コール +71 と fps −13 を要した。
// radius 0.55 は最下位ミップまで滲み、画面全体に乳白の膜を作る。
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.35, 0.85);
composer.addPass(bloom);
// Luminance-dependent observer response precedes exposure and display encoding.
// No painted colour grade, grain, vignette or lifted night-black floor.
const mesopic = new ShaderPass(MesopicShader);
mesopic.uniforms.uRadianceScale=radianceStorage.scale;
composer.addPass(mesopic);
composer.addPass(new RadianceOutputPass(radianceStorage.scale));
// An explicit render target has physical dimensions; EffectComposer otherwise
// treats them as logical when sizing newly added passes, applying DPR twice.
// Establish the same logical size used by all subsequent resize operations.
composer.setSize(innerWidth, innerHeight);
window.__world.postprocessing = { composer, bloom, mesopic };

// ------------------------------------------------------ 表題のカメラ ----
// 背景は絵でも動画でもない。**動いている街そのもの**。
// ストラドゥンをゆっくり後退しながら、低い朝日が磨石を舐めるのを見ている。
// 旋回もデモリールもしない — 映画の頭のように、ただ漂う。
// 入城は「切り替え」ではなく **降下**。型が溶け、カメラはそのまま下りて
// ピレ側のストラドゥンに立つ。暗転も読み込み画面も継ぎ目も無い。
const titleCam = {
  t: 0,                      // 漂いの経過(秒)
  enter: -1,                 // 降下の経過。-1 = まだ始まっていない
  DUR: 2.6,                  // 降下にかける秒。2〜3 秒
  // 漂い: x を西へ、高さをわずかに下げ、俯角をゆるめる。全部 1 本の運動。
  pose(el) {
    // 等速。両端をなめらかに立ち上げると、最初の数秒が止まって見える
    // (実測 2.5 秒で 0.13m しか動かず「静止画」と区別が付かなかった)。
    // 速さは 6.5m / 36秒 = **0.18 m/s**。人が表題を見る 6 秒で 1.1m 動く。
    // 0.09 m/s まで落とすと 2.5 秒で 0.23m しか動かず、また静止画に戻る
    // (計器の閾値 0.25m を設計値が下回っていて、通っていたのは偶然だった)。
    const e = Math.min(el / 36, 1);
    const x = lerp(-139.5, -146.0, e);
    const gy = plan.streetY(plan.streets[0], x, 0.3);
    return { x, z: 0.3, y: gy + lerp(5.0, 4.0, e), yaw: -Math.PI / 2, pitch: lerp(-0.098, -0.072, e) };
  },
};

// ---------------------------------------------------------------- 入力 ----
const keys = new Set();
let started = SHOT;
if (SHOT) {
  ui.hideTitle();
  // hidden はトランジション(2.2s)で消える。撮影は __READY の 1.4 秒後なので、
  // 表題の幕(上下 46%/40% の暗いグラデーション)と字が **消えかけの状態で
  // 焼き込まれる**。しかも消え具合が読み込み時間で変わるため、同じ定点の
  // 2 枚が比較できない。撮影では要素ごと外す。
  document.getElementById('title').style.display = 'none';
  if (Q.get('hud') === '0') document.getElementById('hud').style.display = 'none';
  if (Q.get('map') === '1') ui.toggleMap({ x: qf('x', 0), z: qf('z', 0), yaw: qf('yaw', 0) });
}

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.shiftKey && e.code >= 'Digit1' && e.code <= 'Digit4') {
    startRoute(routes[Number(e.code.slice(5)) - 1]); return;   // 街の中からおまかせ歩き
  }
  if (!started) return;
  if (auto.active && ['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) {
    auto.stop('手動へ — 気の向くままに');
  }
  if (e.code === 'KeyM') {
    const open = ui.toggleMap({ x: player.x, z: player.z, yaw: player.yaw });
    if (open) ui.hint('地図は慈悲 — 街を読む目が育ったら、また閉じて');
  }
  // 計器の読み出し。F3 は macOS が Mission Control に横取りする(押すと全
  // ウィンドウが散る)。OS が先に食うキーは preventDefault では取り返せない。
  // バッククォートにも逃がせない — **JIS 配列に ` の物理キーが無い**。
  // Shift+@ で ` は出るが、その物理キーの code は 'BracketLeft'、つまり
  // 「時刻を戻す」キーそのもの(実測 押すと時間が動いた)。
  // 文字ではなく **物理キーの位置** で選ぶ。I なら JIS でも US でも同じ場所。
  if (e.code === 'KeyI') { ui.toggleDebug(); e.preventDefault(); }
  if (e.code === 'KeyH') { ui.toggleKeys(); e.preventDefault(); }   // 操作の札(街の中でも)
  if (e.code === 'KeyC'&&cafe) { applyPreset(cafe.layout.approach);e.preventDefault(); }
  if (e.code === 'KeyP') state.paused = !state.paused;
  // 時計の折り返し(4.7〜23.6)と同じ範囲にする。自動進行だけ 23.6 まで
  // 伸ばして、キーは 21.9 のままだったので、手で送ると 21:54 で頭打ちに
  // なり「9 時から 5 時まで飛んでいる」ように見えていた。
  if (e.code === 'KeyT' || e.code === 'BracketLeft') state.time = Math.max(4.7, state.time - 0.25);
  if (e.code === 'KeyG' || e.code === 'BracketRight') state.time = Math.min(23.6, state.time + 0.25);
  // 眺めの場所へ跳ぶ。数字を覚えなくていいように V で一覧が出る。
  if (e.code === 'KeyV') {
    const open = ui.toggleSpots();
    if (open) ui.hint('数字キーで跳ぶ — 数値は実測(正面の海 / 視界を塞ぐ割合)');
  }
  const pi = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
    'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'].indexOf(e.code);
  if (pi >= 0 && presets[pi]) applyPreset(presets[pi]);
});
addEventListener('keyup', (e) => keys.delete(e.code));

function applyPreset(p) {
  if (auto.active) auto.stop('眺めへ');
  ui.fade(true);
  setTimeout(() => {
    player.teleport(p.x, p.z, p.yaw, p.pitch);
    // 眺めの場所は「今の空のまま」連れて行く。情景プリセットだけ時刻を動かす。
    if (p.time != null) state.time = p.time;
    ui.hint(p.view
      ? `${p.name} — 高さ ${p.h.toFixed(1)}m / 正面の海 ${p.sea}% / 視界を塞ぐ ${p.block}%`
      : p.name);
    ui.fade(false);
  }, 620);
}

ui.onWarp = (p) => { if (p) applyPreset(p); };

renderer.domElement.addEventListener('click', () => {
  if (!started) return;
  renderer.domElement.requestPointerLock();
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === renderer.domElement) {
    player.look(auto.active ? 0 : e.movementX, e.movementY);
  }
});
// おまかせ歩きは表題から外した(扉はひとつ)。街の中から Shift+1〜4 で呼ぶ。
function startRoute(r) {
  if (!r) return;
  if (!started) { titleCam.enter = 0; ui.enterTitle(); }
  try { audio.start(); } catch (err) { console.warn('audio:', err); }
  auto.start(r);
}

// ---- 音。表題と街の中で、同じ起動・ミュート・再開状態を表示する。
makeAudioControls(audio,[ui.els.btnSound,ui.els.btnSoundWalk]);
ui.els.btnKeys?.addEventListener('click', (e) => { e.stopPropagation(); ui.toggleKeys(); });

ui.els.btnStart?.addEventListener('click', () => {
  if (titleCam.enter >= 0) return;
  titleCam.enter = 0;                       // ここから 2.6 秒かけて降りる
  ui.enterTitle();                          // 型が溶け、抑えていた画が開く
  document.body.classList.remove('titling');  // 計器は降下と一緒に現れる
  try { audio.start(); } catch (e) { console.warn('audio:', e); }
  // ポインタロックは **この操作の中で** 要求する(後から呼ぶと拒否される)。
  // started はまだ false なので、降下中にマウスで視点は動かない。
  renderer.domElement.requestPointerLock?.();
  ui.hint('Walk slowly. The bells and the light off the sea will do the rest');
});
// 世界とリスナーの用意ができた — ここで初めて入口を開く
if (ui.els.btnStart) {
  ui.els.btnStart.disabled = false;
  ui.els.btnStart.textContent = 'ENTER THE CITY';
}
ui.carveTitle('DUBROVNIK');
if (!SHOT) document.body.classList.add('titling');   // 表題のあいだ計器は伏せる
// ---- 適応解像度: 60fps を保つように内部解像度を動かす。
// 画素数は 2 乗で効くので、1.6 → 1.1 で 2 倍速くなる。UI は影響を受けない。
const adaptive = { dpr: DPR_MAX, ms: 16.7, hold: 0 };
function adaptResolution(dt) {
  adaptive.ms += (dt * 1000 - adaptive.ms) * 0.06;
  adaptive.hold -= dt;
  if (adaptive.hold > 0) return;
  const lo = Math.min(0.85, DPR_MAX);
  let next = adaptive.dpr;
  if (adaptive.ms > 18.5 && adaptive.dpr > lo) next = Math.max(lo, adaptive.dpr - 0.15);
  else if (adaptive.ms < 13.8 && adaptive.dpr < DPR_MAX) next = Math.min(DPR_MAX, adaptive.dpr + 0.10);
  if (next === adaptive.dpr) return;
  adaptive.dpr = next;
  adaptive.hold = 0.8;            // 振動を防ぐ
  renderer.setPixelRatio(next);
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(next);
  composer.setSize(innerWidth, innerHeight);
  resizeUnder(next);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.fov = fovFor(FOV_V, camera.aspect);
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  resizeUnder(adaptive.dpr);
});

// ---------------------------------------------------------------- 呼吸 ----
audio && (player.onStep = (zone, pace) => audio.step(zone, pace));
// Prepare the initial lighting texture alongside the world resources. Every
// later environment update is scheduled across displayed frames.
player.pose(camera);
lighting.initialize(sunState(state.time),started?camera.position.y:titleCam.pose(0).y);
// Compile the complete material set, including seasonal/culled instances,
// against the actual HDR output and the stable light layout before display.
// Compiling against the canvas would warm a different tone-mapping variant.
renderer.setRenderTarget(composerRT);
await renderer.compileAsync(scene,camera);
renderer.setRenderTarget(null);
frameShadows.beginFrame();
window.__SHADOW_WARMUP=warmShadowPrograms(renderer,scene,camera);
let shaftHinted = false;
let cafeHintState='';
let last = performance.now();
let fps = 60, uiTimer = 0;

function frame(now) {
  renderer.info.reset();
  diagnostics.beginFrame();
  const frameMs = Math.max(1, now - last);
  const dt = clamp(frameMs / 1000, 0.001, 0.05);
  last = now;
  // Simulation steps are capped for collision stability. Frame-rate reporting
  // must use wall time, otherwise every rate below 20fps is reported as 20fps.
  fps += ((1000 / frameMs) - fps) * 0.06;

  if (started && !state.paused && !SHOT) {
    state.time += (dt * state.flow) / 3600;
    if (state.time > 23.6) state.time = 4.7;   // 23 時台(畳んだ傘・閉じた鎧戸)まで回す
  }
  state.elapsed = SHOT ? qf('anim', 40) : state.elapsed + dt;

  const sun = sunState(state.time);
  if (started) { if (auto.active) auto.update(dt); else player.update(dt, keys); }
  player.pose(camera);                     // 立ち位置(= 降下の行き先)
  if (!started) {
    // 表題のあいだ、そして降下のあいだ、カメラはここが決める。
    titleCam.t += dt;
    const a = titleCam.pose(titleCam.t);
    if (titleCam.enter < 0) {
      camera.position.set(a.x, a.y, a.z);
      camera.rotation.set(a.pitch, a.yaw, 0);
    } else {
      titleCam.enter += dt;
      const u = clamp(titleCam.enter / titleCam.DUR, 0, 1);
      // 端で速度ゼロの補間。跳ねさせない・弾ませない。
      const k = u * u * u * (u * (u * 6 - 15) + 10);
      const b = { x: camera.position.x, y: camera.position.y, z: camera.position.z,
        pitch: camera.rotation.x, yaw: camera.rotation.y };
      camera.position.set(lerp(a.x, b.x, k), lerp(a.y, b.y, k), lerp(a.z, b.z, k));
      camera.rotation.set(lerp(a.pitch, b.pitch, k), lerp(a.yaw, b.yaw, k), 0);
      // k=1 の瞬間、両者はビット一致している。だから継ぎ目が出ない。
      if (u >= 1) { started = true; ui.hideTitle(); }
    }
  }

  instanceLOD.restoreActors();
  life.update(state.elapsed, sun, camera.position, camera);
  cafe?.update(sun,camera.position);
  lighting.state.snap = SHOT;
  lighting.state.groundY = player.smoothY ?? (camera.position.y - 1.62);
  lighting.state.interiorMeter=cafe?.meterAt(camera.position)??null;
  const lightState = lighting.update(sun, camera.position, player.zone, dt, state.elapsed);
  radianceStorage.update(sun.ghi);
  sky.update(sun, state.elapsed, camera.position, camera, renderer);
  sea.update(sun, state.elapsed, camera, scene.fog ? scene.fog.density : null);
  lighting.waterLight.update(sun);
  setWetTime(state.elapsed);
  monumentTime.value = state.elapsed;
  walls.stairShadows.update(renderer, lighting.sun, camera);
  // Threshold in scene radiance tracks exposure; only sources and strong
  // reflections bloom. It cannot brighten an intrinsically dark night sky.
  bloom.strength = 0.0004 + lightState.glare * 0.002;
  bloom.threshold = 4.0 * radianceStorage.scale.value / Math.max(lightState.exposure, .01);
  bloom.highPassUniforms.smoothWidth.value=.01*radianceStorage.scale.value;
  bloom.radius = .18;
  buildings.setClock(sun.time);

  if (!shaftHinted && started && player.zone === 'shaft') {
    shaftHinted = true;
    ui.hint('壁の中の階段 — 上りきれば、歩廊', 4200);
  }
  if(cafe&&started) {
    const r=cafe.layout,inside=player.zone==='interior';
    const near=Math.hypot(player.x-r.doorX,player.z-r.z1)<5&&Math.abs(player.groundY-r.floor)<.4;
    const next=inside?'inside':near?'near':'';
    if(next&&next!==cafeHintState)ui.hint(inside?'カフェ — 店内を歩いて、同じ入口から通りへ戻れます':'KAVANA — 開いたアーチから、そのまま歩いて入れます',5000);
    cafeHintState=next;
  }
  if (audio.ctx?.state === 'running') {
    audio.update(dt, {
      zone: player.zone, y: camera.position.y - 1.62, pos: camera.position,
      seaDist: sea.shoreDist(camera.position.x, camera.position.z),
      portDist: Math.hypot(camera.position.x - 168, camera.position.z - 8),
      sun, time: state.time, camYaw: camera.rotation.y,
      nearFolk: life.near?.folk ?? 0, nearSitting: life.near?.sitting ?? 0,
      nearList: life.near?.list, nearSteps: life.near?.steps,
    });
  }

  if (!SHOT) adaptResolution(dt);
  instanceLOD.update(camera, lighting.sun, renderer);
  frameShadows.beginFrame();
  renderUnder();
  composer.render();
  diagnostics.finishFrame(renderer);

  uiTimer -= dt;
  if (uiTimer <= 0) {
    uiTimer = 0.25;
    ui.drawArc(state.time);
    ui.debugText(renderer, fps, player.zone, state.time, renderer.toneMappingExposure,
      camera.position, player.yaw, player.pitch, diagnostics.stats);
    if (ui.isMapOpen()) ui.drawMap({ x: player.x, z: player.z, yaw: player.yaw });
  }
  window.__READY = true;
  window.__FPS = fps;
  window.__CALLS = renderer.info.render.calls;
  window.__TRIS = renderer.info.render.triangles;
  window.__INSTANCES = diagnostics.stats.instances;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
