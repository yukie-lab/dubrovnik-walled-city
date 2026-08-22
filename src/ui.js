// ============================================================================
// ui.js — 旅人の道具だけ。
// ・時刻 = 太陽の弧(ドラッグで一日が動く)
// ・地図 = 手描き風(オフが基本 — 迷うことが本体。M は慈悲)
// ・計器 = ドローコール/三角形/インスタンス数(検証可能な予算)
// ============================================================================
import { clamp, lerp } from './util.js';
import { SUNRISE, SUNSET } from './sky.js';
import { LOKRUM, LOVRIJENAC } from './plan.js';
import { makeChart } from './chart.js';

// 時計が実際に回る範囲(main.js の折り返しと同じ値)。ドラッグと描画は
// **この 1 つの写像**を共有する。別々に持つと必ずずれる。
export const TIME_T0 = 4.7, TIME_T1 = 23.6;
const SUN_R = 7, ARC_PAD = SUN_R + 3;
// 太陽の印の x は「時刻に比例」。弧は高さだけを与える。
// 以前は x を弧の角度から出していたので、
//   ・R が高さで頭打ち(74px)になり、印は全幅の 50% しか動けない
//   ・x が余弦分布なので端でほとんど動かない
//   ・日没の先で角度がクランプされ 20:50 以降は完全に止まる
// が重なって、ポインタとの最大ずれが 296px 中 76px あった。
export const timeToU = (t) => clamp((t - TIME_T0) / (TIME_T1 - TIME_T0), 0, 1);
export const uToTime = (u) => TIME_T0 + clamp(u, 0, 1) * (TIME_T1 - TIME_T0);
// キャンバス幅 w の中で、u(0〜1)が占める x。両端は太陽の円ぶん空ける。
export const uToX = (u, w) => ARC_PAD + clamp(u, 0, 1) * (w - ARC_PAD * 2);
export const xToU = (x, w) => clamp((x - ARC_PAD) / (w - ARC_PAD * 2), 0, 1);

export function makeUI(plan, counts, presets = []) {
  const $ = id => document.getElementById(id);
  const els = {
    title: $('title'), btnStart: $('btnStart'), hint: $('hint'),
    ttlMain: $('ttlMain'), btnSound: $('btnSound'), btnKeys: $('btnKeys'), keysCard: $('keysCard'),
    timeArc: $('timeArc'), timeLabel: $('timeLabel'), timeCtl: $('timeCtl'),
    debug: $('debug'), map: $('map'), mapCanvas: $('mapCanvas'), fade: $('fade'),
    spots: $('spots'),
  };

  // ---------------------------------------------------------- 時刻の弧 ----
  const arcCtx = els.timeArc.getContext('2d');
  // 時刻 → 太陽の印の位置。x は時刻に比例(= ポインタにぴたり付く)、
  // y は「その時刻に太陽がどれだけ空に上がっているか」だけを表す。
  const sunPos = (t, w, h) => {
    const cy = h - 8, R = h - 8 - ARC_PAD;
    const x = uToX(timeToU(t), w);
    const d = (t - SUNRISE) / (SUNSET - SUNRISE);          // 0=日の出 1=日没
    const y = (d >= 0 && d <= 1) ? cy - Math.sin(Math.PI * d) * R : cy + 4;
    return { x, y, cy, R, up: d >= 0 && d <= 1 };
  };
  function drawArc(time) {
    const w = els.timeArc.width, h = els.timeArc.height;
    const cy = h - 8;
    arcCtx.clearRect(0, 0, w, h);
    // 地平線 — 一日の全幅に引く(ドラッグできる範囲そのもの)
    arcCtx.strokeStyle = 'rgba(239,230,210,0.35)';
    arcCtx.lineWidth = 2;
    arcCtx.beginPath();
    arcCtx.moveTo(2, cy); arcCtx.lineTo(w - 2, cy);
    arcCtx.stroke();
    // 太陽の道。円弧ではなく **時刻に比例した横軸の上の日周** —
    // 印と同じ式で描かないと、印が道から外れる。
    arcCtx.strokeStyle = 'rgba(239,230,210,0.5)';
    arcCtx.beginPath();
    for (let k = 0; k <= 48; k++) {
      const t2 = lerp(SUNRISE, SUNSET, k / 48);
      const p2 = sunPos(t2, w, h);
      if (k === 0) arcCtx.moveTo(p2.x, p2.y); else arcCtx.lineTo(p2.x, p2.y);
    }
    arcCtx.stroke();
    // 夜の側は地平線の下の点線(ここもドラッグできることを示す)
    arcCtx.strokeStyle = 'rgba(239,230,210,0.22)';
    arcCtx.setLineDash([3, 4]);
    for (const [ta, tb] of [[TIME_T0, SUNRISE], [SUNSET, TIME_T1]]) {
      arcCtx.beginPath();
      arcCtx.moveTo(uToX(timeToU(ta), w), cy + 4);
      arcCtx.lineTo(uToX(timeToU(tb), w), cy + 4);
      arcCtx.stroke();
    }
    arcCtx.setLineDash([]);
    // 太陽
    const sp = sunPos(time, w, h);
    arcCtx.fillStyle = sp.up ? 'rgba(255,196,110,0.98)' : 'rgba(200,205,230,0.9)';
    arcCtx.beginPath();
    arcCtx.arc(sp.x, sp.y, SUN_R, 0, 7);
    arcCtx.fill();
    const hh = Math.floor(time), mm = Math.floor((time - hh) * 60);
    els.timeLabel.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  let onTimeDrag = null;
  const dragTime = (ev) => {
    const rect = els.timeArc.getBoundingClientRect();
    // 描画と同じ写像の逆を取る。キャンバスの実ピクセル幅で解くので、
    // CSS の拡大率(2x)や余白が変わっても印とポインタはずれない。
    const xCanvas = ((ev.clientX - rect.left) / rect.width) * els.timeArc.width;
    if (onTimeDrag) onTimeDrag(uToTime(xToU(xCanvas, els.timeArc.width)));
  };
  let dragging = false;
  els.timeCtl.addEventListener('pointerdown', (e) => { dragging = true; dragTime(e); e.stopPropagation(); });
  window.addEventListener('pointermove', (e) => { if (dragging) dragTime(e); });
  window.addEventListener('pointerup', () => { dragging = false; });

  // ------------------------------------------------------- 銅版の海図 ----
  // 地図は UI ではない。1600 年代の銅版海図を一枚、紙に刷って持ち歩いている。
  // 版は一度だけ彫って取っておく(高解像度・固定シード)。毎フレーム彫らない。
  let chart = null;
  const engrave = () => {
    if (chart) return chart;
    chart = makeChart(plan, { LOKRUM, LOVRIJENAC }, { size: els.mapCanvas.width });
    return chart;
  };
  // 版は起動直後の暇な時間に彫っておく。M を押した瞬間に 1 秒止まらないように。
  (window.requestIdleCallback || ((f) => setTimeout(f, 2200)))(() => engrave(), { timeout: 6000 });
  const wax = (() => {
    // 封蝋の粒。形は一度だけ決める(毎回ぶれると「点滅する印」になる)。
    const pts = [];
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * 6.2832;
      const rr = 1 + Math.sin(a * 3 + 1.1) * 0.07 + Math.sin(a * 5 + 2.4) * 0.05;
      pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    return pts;
  })();

  function drawMap(playerPos) {
    const c = els.mapCanvas, ctx = c.getContext('2d');
    engrave();
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(chart.canvas, 0, 0);
    if (!playerPos) return;
    // 旅人の印は「紙に落とした封蝋」。光らない・扇を出さない・ピンを刺さない。
    const x = chart.px(playerPos.x), y = chart.py(playerPos.z);
    const [x0, y0, x1, y1] = chart.plate;
    if (x < x0 || x > x1 || y < y0 || y > y1) return;
    const R = c.width * 0.0072;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(wax[0] * R, wax[1] * R);
    for (let i = 2; i < wax.length; i += 2) ctx.lineTo(wax[i] * R, wax[i + 1] * R);
    ctx.closePath();
    ctx.fillStyle = 'rgba(140,32,26,0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(84,16,14,0.9)';
    ctx.lineWidth = Math.max(1, R * 0.16);
    ctx.stroke();
    // 蝋に押した小さな十字(印章の跡)
    ctx.strokeStyle = 'rgba(70,12,10,0.75)';
    ctx.lineWidth = Math.max(1, R * 0.13);
    ctx.beginPath();
    ctx.moveTo(-R * 0.42, 0); ctx.lineTo(R * 0.42, 0);
    ctx.moveTo(0, -R * 0.42); ctx.lineTo(0, R * 0.42);
    ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------- 計器 ----
  // 位置も出す。「あそこに板がある」と言われたときに、目で場所を推理する
  // のではなく座標で受け取れる。推理は何度も外した。
  function debugText(renderer, fps, zone, time, exposure, pos, yaw, pitch) {
    const i = renderer.info.render;
    const inst = Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' ');
    const at = pos ? `  @ ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`
      + `  yaw ${yaw.toFixed(3)} pitch ${pitch.toFixed(3)}` : '';
    els.debug.textContent =
      `draw calls ${i.calls}  tris ${(i.triangles / 1000).toFixed(0)}k  fps ${fps.toFixed(0)}\n` +
      `zone ${zone}  t ${time.toFixed(2)}  exp ${exposure.toFixed(2)}${at}\n` +
      `instances: ${inst}`;
  }

  // ---------------------------------------------------------- 案内 ----
  let hintTimer = null;
  function hint(text, ms = 3400) {
    els.hint.textContent = text;
    els.hint.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => els.hint.classList.remove('show'), ms);
  }

  function fade(on) {
    els.fade.style.opacity = on ? 1 : 0;
  }

  // ---------------------------------------------------- 眺めの場所(V) ----
  // 数字キーで跳べるが、番号を覚えている人はいない。札を出す。
  // 数値は tools/viewtest.mjs の実測 — 「正面 180° の海」と
  // 「22m 以内で視界を塞ぐ割合」。眺めの良し悪しを主観で書かない。
  let onWarp = null;
  {
    const key = (i) => (i === 9 ? '0' : String(i + 1));
    let html = '<h4>眺めの場所 &nbsp;—&nbsp; V で開閉</h4>';
    presets.forEach((p, i) => {
      if (i >= 10) return;
      if (i === 4) html += '<div class="sep"></div>';
      const v = p.view
        ? `${p.h.toFixed(0)}m &nbsp; 海 ${p.sea}% &nbsp; 遮り ${p.block}%`
        : `${(p.time ?? 0).toFixed(1)}時`;
      html += `<div class="row" data-i="${i}"><span class="k">${key(i)}</span>`
        + `<span class="n">${p.name}</span><span class="v">${v}</span></div>`;
    });
    els.spots.innerHTML = html;
    els.spots.addEventListener('click', (e) => {
      const row = e.target.closest('.row');
      if (row && onWarp) onWarp(presets[Number(row.dataset.i)]);
    });
  }

  return {
    els, drawArc, drawMap, debugText, hint, fade,
    set onWarp(fn) { onWarp = fn; },
    toggleSpots() {
      els.spots.classList.toggle('show');
      return els.spots.classList.contains('show');
    },
    set onTimeDrag(fn) { onTimeDrag = fn; },
    toggleMap(playerPos) {
      els.map.classList.toggle('show');
      if (els.map.classList.contains('show')) drawMap(playerPos);
      return els.map.classList.contains('show');
    },
    isMapOpen() { return els.map.classList.contains('show'); },
    // 表題は「現れる」— 滑り込ませない。一字ずつ、字送りが落ち着くまで 2 秒半。
    carveTitle(word = 'DUBROVNIK') {
      const h = els.ttlMain;
      if (!h) return;
      h.textContent = '';
      [...word].forEach((ch, i) => {
        const sp = document.createElement('span');
        sp.textContent = ch;
        sp.style.animationDelay = `${0.18 + i * 0.075}s`;
        h.appendChild(sp);
      });
    },
    // 入城 — 溶けて消える。暗転も継ぎ目も作らない(カメラは動き続ける)。
    enterTitle() { els.title.classList.add('entering'); },
    toggleKeys() { els.keysCard.classList.toggle('show'); },
    hideTitle() { els.title.classList.add('hidden'); },
    showTitle() { els.title.classList.remove('hidden'); },
    // CSS の既定が none なので、インライン値ではなく **実際に効いている値** を
    // 見る。インラインだけ見ると初回の F3 が「消す」向きに働く。
    toggleDebug() {
      const on = getComputedStyle(els.debug).display !== 'none';
      els.debug.style.display = on ? 'none' : 'block';
    },
  };
}
