// ============================================================================
// audio.js — 耳が先に本物だと信じる街。すべて WebAudio 合成。
// ・足音: ゾーンで残響が変わる(路地=石の谷の明るい反響 / ストラドゥン=
//   開けて乾いた広がり / 階段室=こもった flutter / 胸壁=風に散る)
// ・鐘: 鐘楼の位置から 3D 減衰で届く時報 — 迷子のための正直な方位標
// ・波は城壁の外から、風は高さから、アマツバメの声は夕暮れの空から。
// ============================================================================
import { clamp, lerp, smoothstep } from './util.js';

export class CityAudio {
  constructor(bellPos) {
    this.ctx = null;
    this.bellPos = bellPos;
    this.muted = false;
    this._swiftT = 4;
    this._gullT = 8;
    this._slapT = 5;
    this._babT = 2;
    this._clinkT = 3;
    this._lastHour = null;
    this._bellQueue = 0;
    this._bellT = 0;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    this.master.connect(comp).connect(ctx.destination);

    // ピンクノイズ台地
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + 0.029 * w;
      b1 = 0.985 * b1 + 0.032 * w;
      b2 = 0.950 * b2 + 0.048 * w;
      d[i] = (b0 + b1 + b2 + w * 0.05) * 0.55;
    }
    this.noise = buf;

    // ---- 持続音: 波(2層)・風・港のさざめき
    this.seaLow = this._loop(240, 0.0);
    this.seaWash = this._loop(900, 0.0);
    this.wind = this._loop(420, 0.0);
    this.windHigh = this._loop(1500, 0.0);
    // 群衆のベッド。風と同じ lowpass を使うと「風が少し増えた」としか聞こえない。
    // 人声は 300〜900Hz に山を持つ帯域なので、bandpass で山を作り、
    // 左右に分けて広がりを出し、ゆっくりした振幅の揺れを与える。
    this.crowd = this._band(620, 1.1, 0.0, -0.35);
    this.crowdHi = this._band(1750, 2.0, 0.0, 0.40);
    this.fount = this._band(1150, 0.75, 0.0, 0.0);   // 落水(オノフリオ)

    // ---- 残響(ゾーン別 IR)
    this.verbAlley = this._convolver(this._impulse(0.5, 3.2, [0.012, 0.024, 0.039], 0.5));
    this.verbShaft = this._convolver(this._impulse(0.9, 2.2, [0.017, 0.031, 0.052, 0.074], 0.7));
    this.verbOpen = this._convolver(this._impulse(0.3, 4.5, [0.03], 0.2));
    this.verbBell = this._convolver(this._impulse(2.6, 1.6, [], 0.0));
    this.verbBell.wet.gain.value = 0.5;

    this._t = 0;
  }

  _loop(freq, gain) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return g;
  }

  // 帯域を絞ったループ(人声・ざわめき用)。pan を持つ。
  _band(freq, q, gain, pan) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    src.connect(bp).connect(g).connect(p).connect(this.master);
    src.start();
    return g;
  }

  _impulse(dur, bright, earlyTaps, tapGain) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let chn = 0; chn < 2; chn++) {
      const d = buf.getChannelData(chn);
      for (let i = 0; i < n; i++) {
        const t = i / ctx.sampleRate;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * bright * 3.5) * 0.5;
      }
      for (const tap of earlyTaps) {
        const idx = Math.floor(tap * ctx.sampleRate * (chn ? 1.13 : 1));
        if (idx < n) d[idx] += (Math.random() * 0.5 + 0.5) * tapGain;
      }
    }
    return buf;
  }

  _convolver(buf) {
    const ctx = this.ctx;
    const conv = ctx.createConvolver();
    conv.buffer = buf;
    const wet = ctx.createGain(); wet.gain.value = 1;
    conv.connect(wet).connect(this.master);
    return { conv, wet };
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.85;
  }

  // 毎フレーム: ゾーンと地形から音場を組む
  update(dt, env) {
    if (!this.ctx || this.muted) return;
    const { zone, y, seaDist, sun, time, camYaw, pos } = env;
    const ctx = this.ctx, t = ctx.currentTime;
    this._t += dt;

    // ---- 波: 岸までの距離で減衰。路地の中ではさらに壁1枚ぶんこもる。
    const seaAmt = Math.exp(-Math.max(0, seaDist - 6) / 55);
    const muffle = zone === 'alley' || zone === 'shaft' ? 0.4 : zone === 'street' ? 0.6 : 1;
    this.seaLow.gain.setTargetAtTime(0.055 * seaAmt * muffle + 0.004, t, 0.4);
    this.seaWash.gain.setTargetAtTime(0.045 * seaAmt * muffle * (0.7 + 0.3 * Math.sin(this._t * 0.43)), t, 0.35);

    // ---- 風: 高所ほど強い。胸壁では主役。
    const hi = smoothstep(6, 16, y);
    this.wind.gain.setTargetAtTime(0.012 + hi * 0.075 * (0.75 + 0.25 * Math.sin(this._t * 0.31 + 1)), t, 0.6);
    this.windHigh.gain.setTargetAtTime(hi * 0.028 * (0.6 + 0.4 * Math.sin(this._t * 0.57)), t, 0.5);

    // ---- アマツバメ(朝夕の空)
    const swiftAct = smoothstep(32, 14, Math.abs(sun.el - 8)) * (1 - sun.night);
    this._swiftT -= dt * (0.3 + swiftAct * 1.6);
    if (this._swiftT <= 0 && swiftAct > 0.15 && zone !== 'shaft') {
      this._swiftT = 2.5 + Math.random() * 6;
      const nb = 2 + (Math.random() * 4 | 0);
      for (let i = 0; i < nb; i++) this._swiftScream(t + i * (0.12 + Math.random() * 0.15), swiftAct);
    }
    // ---- カモメ(昼・海と港の側)
    this._gullT -= dt * (0.4 + seaAmt);
    if (this._gullT <= 0 && sun.night < 0.4 && seaAmt > 0.2) {
      this._gullT = 7 + Math.random() * 14;
      const nb = 1 + (Math.random() * 3 | 0);
      for (let i = 0; i < nb; i++) this._gull(t + i * (0.3 + Math.random() * 0.25), seaAmt);
    }
    // ---- 港の水音(舫い舟の舷を叩く)
    this._slapT -= dt;
    if (this._slapT <= 0) {
      this._slapT = 2.5 + Math.random() * 5;
      if (env.portDist < 60) this._slap(t, Math.exp(-env.portDist / 40));
    }

    // ---- 人のざわめき。目の前に人がいて音がしないと、街は書き割りになる。
    const nf = env.nearFolk ?? 0;
    const dens = clamp(nf / 26, 0, 1.25);
    const zoneK = zone === 'stradun' ? 1.0 : zone === 'square' ? 0.92
      : zone === 'gate' ? 0.72 : zone === 'street' ? 0.46
        : zone === 'alley' || zone === 'shaft' ? 0.20 : zone === 'port' ? 0.34 : 0.08;
    const awake = 1 - sun.night * 0.55;   // 夜も人は歩くが、声は落ちる
    // 一定の量で鳴らすと環境ノイズに聞こえる。人の群れは必ず波を打つ。
    const swell = 0.72 + 0.28 * Math.sin(this._t * 0.27) * Math.sin(this._t * 0.11 + 1.7);
    const crowdG = 0.075 * dens * zoneK * awake * swell;
    this.crowd.gain.setTargetAtTime(crowdG, t, 0.6);
    this.crowdHi.gain.setTargetAtTime(crowdG * 0.34 * muffle * (0.7 + 0.3 * Math.sin(this._t * 0.19 + 2.4)), t, 0.6);
    this._babT -= dt * (0.35 + dens * zoneK * 2.2);
    if (this._babT <= 0) {
      this._babT = 1.3 + Math.random() * 3.4;
      if (dens * zoneK > 0.08) this._babble(t, dens * zoneK * awake, this._panTo(env, env.nearList));
    }
    // ---- カフェの食器。座っている人がいるところだけ。
    this._clinkT -= dt;
    if (this._clinkT <= 0) {
      this._clinkT = 2.6 + Math.random() * 6.5;
      const sk = clamp((env.nearSitting ?? 0) / 6, 0, 1);
      if (sk > 0.1) this._clink(t, sk * awake, this._panTo(env, (env.nearList || []).filter(p2 => p2.sit)));
    }

    // ---- 他人の足音。340 人が歩いていて自分の靴しか鳴らないのが最大の嘘だった。
    for (const st of env.nearSteps || []) {
      const pan = this._panOne(env, st.x, st.z);
      this.step(zone, 0.45 * clamp(9 / (st.d2 + 3), 0.02, 1.0), pan);
    }
    // ---- 噴水。オノフリオは街の中心で、水音がしないと「白い塔」のままになる。
    {
      const fd = Math.hypot(pos.x - (-136), pos.z - 11);
      this.fount.gain.setTargetAtTime(0.085 * Math.exp(-Math.max(fd - 4, 0) / 11), t, 0.4);
    }

    // ---- 時報(ゲーム内時刻が時を跨いだら鳴らす)
    const hour = Math.floor(time);
    if (this._lastHour === null) this._lastHour = hour;
    if (hour !== this._lastHour && Math.abs(time - hour) < 0.02) {
      const strikes = ((hour + 11) % 12) + 1;
      this._bellQueue = strikes;
      this._bellT = 0;
      this._lastHour = hour;
    }
    if (hour !== this._lastHour) this._lastHour = hour;   // スライダーで飛んだ時は鳴らさない
    if (this._bellQueue > 0) {
      this._bellT -= dt;
      if (this._bellT <= 0) {
        this._bellT = 2.4;
        this._bellQueue--;
        this.bell(env);
      }
    }
  }

  // 鐘: 鐘楼からの距離・方位で届く(遠いほど低域だけが残る)
  bell(env, vol = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.02;
    const dx = this.bellPos.x - env.pos.x, dz = this.bellPos.z - env.pos.z;
    const dist = Math.hypot(dx, dz);
    const amp = vol * 0.5 * clamp(90 / (dist + 25), 0.12, 1.0);
    // 方位(視線基準でパン)
    const angTo = Math.atan2(-dx, -dz);
    const rel = angTo - env.camYaw;
    const pan = clamp(Math.sin(rel) * -0.85, -1, 1);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = clamp(4200 - dist * 12, 700, 4200);   // 遠いほどこもる
    panner.connect(lp);
    lp.connect(this.master);
    lp.connect(this.verbBell.conv);
    const f0 = 233;   // 鐘楼の鐘(実物はバリトンの澄んだ音)
    for (const [ratio, a, dec] of [[0.5, 0.55, 6.5], [1, 1, 5.2], [2.01, 0.5, 3.4], [2.74, 0.32, 2.4], [4.07, 0.18, 1.5], [5.43, 0.08, 0.9]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f0 * ratio * (1 + (Math.random() - 0.5) * 0.002);
      const g = ctx.createGain();
      g.gain.setValueAtTime(amp * a, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g).connect(panner);
      o.start(t); o.stop(t + dec + 0.1);
    }
  }

  _swiftScream(when, act) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 4400; bp.Q.value = 3.5;
    const g = ctx.createGain(); g.gain.value = 0;
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * 0.8;
    o.connect(bp).connect(g).connect(pan).connect(this.master);
    const f0 = 3800 + Math.random() * 1400;
    o.frequency.setValueAtTime(f0 * 0.85, when);
    o.frequency.linearRampToValueAtTime(f0 * 1.12, when + 0.16);
    o.frequency.linearRampToValueAtTime(f0 * 0.9, when + 0.30);
    const amp = (0.009 + Math.random() * 0.008) * act;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(amp, when + 0.05);
    g.gain.linearRampToValueAtTime(0, when + 0.34);
    o.start(when); o.stop(when + 0.4);
  }

  // 遠くの人声 — 語ではなく「うねり」。帯域を絞ったノイズを 0.4 秒だけ開ける。
  _babble(when, amt, pan = null) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 380 + Math.random() * 480; bp.Q.value = 1.5;
    const g = ctx.createGain(); g.gain.value = 0;
    const p = ctx.createStereoPanner();
    p.pan.value = pan === null ? (Math.random() * 2 - 1) * 0.8 : pan;
    src.connect(bp).connect(g).connect(p).connect(this.master);
    const dur = 0.28 + Math.random() * 0.5;
    const amp = (0.010 + Math.random() * 0.013) * amt;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(amp, when + 0.07);
    // 抑揚(声は一定にならない)
    g.gain.linearRampToValueAtTime(amp * 0.55, when + dur * 0.55);
    g.gain.linearRampToValueAtTime(amp * 0.85, when + dur * 0.8);
    g.gain.linearRampToValueAtTime(0, when + dur);
    src.start(when); src.stop(when + dur + 0.02);
  }

  // 皿とグラス — テラスの近くでだけ鳴る細い高音
  _clink(when, amt, pan = null) {
    const ctx = this.ctx;
    const n = 1 + (Math.random() * 2 | 0);
    for (let k = 0; k < n; k++) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 2100 + Math.random() * 1900;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = o.frequency.value; bp.Q.value = 9;
      const g = ctx.createGain(); g.gain.value = 0;
      const p = ctx.createStereoPanner();
      p.pan.value = pan === null ? (Math.random() * 2 - 1) * 0.6 : pan;
      o.connect(bp).connect(g).connect(p).connect(this.master);
      const w2 = when + k * (0.05 + Math.random() * 0.09);
      const amp = (0.004 + Math.random() * 0.005) * amt;
      g.gain.setValueAtTime(0, w2);
      g.gain.linearRampToValueAtTime(amp, w2 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, w2 + 0.16);
      o.start(w2); o.stop(w2 + 0.2);
    }
  }

  _gull(when, amt) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 2.2;
    const g = ctx.createGain(); g.gain.value = 0;
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * 0.7;
    o.connect(bp).connect(g).connect(pan).connect(this.master);
    const f0 = 980 + Math.random() * 320;
    o.frequency.setValueAtTime(f0 * 1.3, when);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.74, when + 0.34);
    const amp = (0.012 + Math.random() * 0.012) * amt;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(amp, when + 0.06);
    g.gain.setValueAtTime(amp * 0.9, when + 0.22);
    g.gain.linearRampToValueAtTime(0, when + 0.4);
    o.start(when); o.stop(when + 0.46);
  }

  _slap(when, amt) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 1.4 + Math.random();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 600 + Math.random() * 500; bp.Q.value = 2.5;
    const g = ctx.createGain();
    const amp = 0.03 * amt;
    g.gain.setValueAtTime(amp, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.16);
    src.connect(bp).connect(g).connect(this.master);
    src.start(when, Math.random() * 1.5, 0.2);
  }

  // 足音: ゾーンごとに響きが変わる — 耳の真実
  // 画面上の方位からステレオ定位を出す(鐘と同じ式)
  _panOne(env, x, z) {
    const dx = x - env.pos.x, dz = z - env.pos.z;
    const rel = Math.atan2(-dx, -dz) - env.camYaw;
    return clamp(Math.sin(rel) * -0.85, -1, 1);
  }

  _panTo(env, list) {
    if (!list || !list.length) return null;
    const p2 = list[(Math.random() * list.length) | 0];
    return this._panOne(env, p2.x, p2.z);
  }

  step(zone, pace = 1, pan = null) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.5;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    // ストラドゥンの磨かれた石は硬く高く鳴る
    const hard = zone === 'stradun' || zone === 'square' ? 1.25 : 1.0;
    bp.frequency.value = (430 + Math.random() * 260) * hard;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    const amp = (0.05 + Math.random() * 0.022) * pace;
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.085);
    src.connect(bp).connect(g);
    if (pan === null) {
      g.connect(this.master);
    } else {
      // 他人の足音は「その人がいる方向」から鳴る
      const p2 = ctx.createStereoPanner();
      p2.pan.value = pan;
      g.connect(p2).connect(this.master);
    }
    // ゾーン別の残響へ送る
    if (zone === 'alley' || zone === 'gate') g.connect(this.verbAlley.conv);
    else if (zone === 'shaft') g.connect(this.verbShaft.conv);
    else if (zone === 'stradun' || zone === 'square' || zone === 'street') g.connect(this.verbOpen.conv);
    // 胸壁・港は乾いたまま(風と波が場を語る)
    src.start(t, Math.random() * 1.5, 0.12);
  }
}
