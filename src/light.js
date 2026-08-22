// ============================================================================
// light.js — 光がエンジン。
// ・世界で唯一の太陽(方向光)+ 空の半球光。すべての色は sunState から。
// ・影のボリュームは動的: 路地では足元 60m を高精細に、城壁に上がると
//   全市 300m を覆う(屋根海に影が要る)。テクセルスナップでちらつき防止。
// ・露出はゾーン制 + 暗順応のラグ: 路地に入ると目が慣れるまで暗く、
//   海へ出ると眩しさが遅れて収まる。その差分がブルームになる。
// ============================================================================
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './util.js';
import { glassNightUniform, litWindowsMat, specularEnvTargets } from './buildings.js';
import { urbanTint, bounceRad, groundRefY } from './skyvis.js';
import { SKY_GAIN } from './sky.js';

// 直射を強くしたぶん露出は下げる。石灰岩のアルベドは 0.6 前後で「白」ではない。
const ZONE_EXPOSURE = {
  // 日向の石灰岩が出力リニア 0.60〜0.68(sRGB 205〜218)に座る露出。
  // ここが 1.0 だと Neutral のハイライトでも 249 まで上がり、面の向きの差が消える。
  // ブルーム閾値を 1.95 に下げたので、露出を ×0.92 して素地が滲まないようにする。
  // 太陽・海のきらめき・ガラスの映り込みだけが白飛びする位置。
  stradun: 0.800, square: 0.782, street: 0.818, alley: 0.885, shaft: 0.950,
  gate: 0.912, stair: 0.809, wall: 0.762, port: 0.762,
};

export function makeLighting(renderer, scene, tex) {
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  // 半径は 40(街路)〜170(城壁上)。3072 なら街路で 26mm/texel、遠景で 111mm/texel。
  // 4096 にすると 60fps を割る(実測 58)ので、半径を絞るほうを採る。
  sun.shadow.mapSize.set(3072, 3072);   // 影半径を 320→110 に縮めたぶん、解像度は下げても texel は細かい
  // 太陽は距離 500 に置く。深度レンジを 1050m も取ると精度が 4 倍失われ、
  // bias を積むしかなくなり、細い遮蔽物(手すり・脚・窓の見込み)の影が消える。
  sun.shadow.camera.near = 440;
  sun.shadow.camera.far = 700;   // 深度レンジ 260m(屋根同士の落影が入る距離)
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.025;
  scene.add(sun, sun.target);

  // 地面バウンス — 上を向く面(舗石・軒裏・段の踏面)は、実際には日向の壁と
  // 街路からの暖色の照り返しが主光源。HemisphereLight は上向き面に空色しか
  // 与えないので、路地の床が青いインクになる。影は落とさない。
  // 地面・壁からの照り返しは DirectionalLight では表せない。仰角 -35 度に置いても
  // 上向き面の dotNL は 0.000 のままで、路地の床には一切届かなかった(実測)。
  // 代わりに skyvis の「塞がれた分」に街の色を与える(urbanTint)。光源は増やさない。
  // 夜は月 — 9 時間ある夜に方向性の光が一つも無いと、立面が平らな板になる。
  const moon = new THREE.DirectionalLight(0xbcc8e8, 0.0);
  moon.castShadow = false;
  scene.add(moon, moon.target);

  const hemi = new THREE.HemisphereLight(0xbcd8ee, 0xc7a078, 1.55);
  scene.add(hemi);

  // 空気遠近。線形の霧を 400m から掛けると市内(直径300m)に奥行きが出ない。
  // 指数霧なら手前は素通し・遠景だけが空の色へ沈む — 屋根の海が奥へ退く。
  // 0.00135 は 1050m 先(スルジ稜線)で元の色が 13.4% しか残らない = 視程
  // 1.3km。アドリア海の夏の晴天ではなく霧の日の数字で、山が単色の
  // シルエットに潰れていた。0.00075 で 1050m の残存 54%・視程 2.3km。
  scene.fog = new THREE.FogExp2(0xdde8f0, 0.00075);

  // 環境マップ(ストラドゥンの照りが空を映すために)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envUniforms = {
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
    uGround: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() },
    uSunCol: { value: new THREE.Color() }, uSunAmt: { value: 1 },
  };
  envScene.add(new THREE.Mesh(
    new THREE.SphereGeometry(10, 24, 16),
    new THREE.ShaderMaterial({
      uniforms: envUniforms, side: THREE.BackSide,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vDir;
        uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunCol;
        uniform float uSunAmt;
        void main(){
          vec3 d = normalize(vDir);
          vec3 col = d.y > 0.0 ? mix(uHorizon, uZenith, pow(d.y, 0.6)) : mix(uHorizon, uGround, pow(-d.y, 0.5));
          // 本物の太陽は視直径 0.53°、空の 2万倍。pow(...,32)*1.6 では
          // roughness 0.06 のガラスにすら映らない。芯と暈を分けて入れる。
          float sd = clamp(dot(d, uSunDir), 0.0, 1.0);
          // 芯を 110 にすると、掠め角の GGX が舗石に太陽の鏡像を焼き、
          // 逆光で画面の 8% が階調ごと 1.0 に貼り付く。芯は弱く、暈は厚く。
          col += uSunAmt * (uSunCol * pow(sd, 700.0) * 48.0 + uSunCol * pow(sd, 40.0) * 0.85);
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  ));
  let envRT = null, envSunRT = null, lastEnvTime = -99;

  const state = {
    exposure: 0.87, targetExposure: 0.87, glare: 0, snap: false,
  };

  function update(sunState, camPos, zone, dt, elapsed) {
    // ---- 太陽
    // 夜は同じ DirectionalLight を月として使う。別ライトにすると影を落とせず
    // (影マップは 1 本しか無い)、9 時間ある夜に方向のある光が一つも無くなる。
    const isNight = sunState.night > 0.5;
    if (isNight) {
      // 満月は反太陽点にある。仰角も方位も太陽の逆。
      const md = sunState.dir;
      sun.position.set(camPos.x - md.x * 500, camPos.y - md.y * 500, camPos.z - md.z * 500);
      sun.color.setHex(0xbcc8e8);
      // 1.05 では月の放射照度が 0.61 で、空(0.109)より立面(0.030)が
      // 3.6 倍暗いという逆転が起きていた。満月の夜に垂直面がここまで落ちる
      // ことはない。月光が実際に「面の向きを読ませる」強さにする。
      sun.intensity = 2.2 * smoothstep(0.15, 0.85, sunState.night);
    } else {
      sun.position.set(camPos.x + sunState.dir.x * 500, sunState.dir.y * 500 + camPos.y, camPos.z + sunState.dir.z * 500);
      sun.color.copy(sunState.sunCol);
      sun.intensity = sunState.sunIntensity;
    }
    sun.target.position.set(camPos.x, camPos.y, camPos.z);
    sun.visible = isNight ? sunState.night > 0.05 : sunState.el > -1;

    // ---- 影ボリューム: 高所ほど広く(屋根海に影を)
    // 320 だと 4096 マップで 0.156m/texel になり、PCF が 1m の対角バンド(アクネ)を描く。
    // 「対地高度」で駆動しようとしたが、groundY = player.smoothY で
    // camera.y = smoothY + EYE なので恒久的に 1.62 = 分岐が到達不能だった。
    // 市街の地盤(≒2m)を基準にした絶対高度で駆動する。
    // 低い太陽は影が長い(鐘楼 20m → 影 142m)ので、そのぶん広げる。
    const upK = smoothstep(6, 30, camPos.y - 2.0);
    const elForShadow = isNight ? Math.max(-sunState.el, 4) : sunState.el;
    const lowSun = 1 + 0.40 * smoothstep(15, 5, Math.max(elForShadow, 0));
    const radius = lerp(40, 170, upK) * lowSun;
    const c = sun.shadow.camera;
    if (Math.abs(c.right - radius) > 1) {
      c.left = -radius; c.right = radius; c.top = radius; c.bottom = -radius;
      // 深度レンジを広げると bias の実効ワールド値も比例して伸び、影が漏れる。
      const far = 500 + radius * 2.4;
      c.near = 500 - radius * 1.2; c.far = far;
      // 低い太陽では、ワールド固定のバイアスが水平面で 0.156/sin(el) だけ影を後退させる
      // (el 2.5 度で 3.5m)。太陽高度で割り戻す。
      const elK = Math.max(0.28, Math.sin(Math.max(elForShadow, 2) * Math.PI / 180));
      sun.shadow.bias = -0.156 * elK / (far - c.near);
      // radius に比例させると城壁上で 0.125m になり、瓦の起伏(4cm)や窓の見込みの
      // セルフシャドウが丸ごと消える。平方根で伸ばす。
      sun.shadow.normalBias = 0.025 * Math.sqrt(radius / 34);
      c.updateProjectionMatrix();
    }
    // テクセルスナップ
    const texel = (radius * 2) / 3072;
    sun.target.position.x = Math.round(sun.target.position.x / texel) * texel;
    sun.target.position.z = Math.round(sun.target.position.z / texel) * texel;

    // ---- 半球光と霧
    {
      // 塞がれた天空の分を「日向の石灰岩」の色に置き換える。輝度は 0.62 に正規化して
      // 明るさは変えず、色だけを与える(明るさを足すと日陰が浮く)。
      const ut = sunState.sunCol.clone().multiply(sunState.hemiGround);
      const uy = 0.2126 * ut.r + 0.7152 * ut.g + 0.0722 * ut.b;
      // 輝度中立にする。0.62 に正規化すると mix(uUrban,1,vSkyV) が路地の底で
      // 間接光を 24.5% 削り、「色だけ与える」というコメントと逆の挙動になる。
      const k = uy > 1e-4 ? 1.0 / uy : 1;
      const day = 1 - sunState.night;
      // 輝度中立にしたぶん彩度が無制限に伸び、日没で R/B 8.2 になっていた。
      // 塞いだ天空の代替は「日向の石灰岩のバウンス」で、その色度は日没でも
      // CCT 3000K 相当(B/R 0.55)止まり。偏差をクランプする。
      const dev = Math.max(Math.abs(ut.r * k - 1), Math.abs(ut.g * k - 1), Math.abs(ut.b * k - 1));
      // 0.18 は B を最大 15% 削る。天空光を青くしたので、その青を
      // 打ち消す量を半分にする(実測 日陰の色相 61〜186° = 緑無彩の原因の一つ)。
      const uw = Math.min(day * 0.55, dev > 1e-4 ? 0.09 / dev : 1);
      urbanTint.value.set(lerp(1, ut.r * k, uw), lerp(1, ut.g * k, uw), lerp(1, ut.b * k, uw));
      // 日向の舗石が返す放射輝度。石灰岩のアルベド 0.62、直射の N·L はおよそ 0.75。
      // 環境光の 9 割をここに賭けると、減衰長 7m の外(腰から上・城壁の上)で
      // 環境光が消える。バウンスは「地面直上の暖かい溜まり」だけを担う。
      // 0.055 だと、この暖色の加算項は垂直面で半球光経路の 1.35 倍になり、
      // 天空光の青を完全に相殺する。地面直上の溜まりに戻す。
      const bq = sunState.sunIntensity * 0.030 * (1 - sunState.night);
      bounceRad.value.set(bq * 0.60, bq * 0.575, bq * 0.552);   // B/R 0.80 → 0.92
      // 城壁に上がると uGroundY≒22 になり、地上 20m の立面まで満額の舗石バウンスを
      // 受ける。市街の地盤より上には行かせない。
      // 4.0 でクランプすると城壁の歩廊(y≒17.5)でバウンスが exp(-13.5/7)=0.14 に
      // なり、空しか遮るもののない水平面が空の 1/27 に沈む。減衰長そのもので
      // 届く範囲を決めればよいので、クランプは要らない。
      groundRefY.value = state.groundY ?? (camPos.y - 1.62);
      // 月(方位は太陽の反対、高度は緩やかに)。影は落とさない。
      const maz = Math.atan2(sunState.dir.x, sunState.dir.z) + Math.PI;
      moon.intensity = 0;   // 影を落とせないので sun を月として流用する(上)
      moon.target.position.set(camPos.x, camPos.y, camPos.z);
      // 満月の仰角は反太陽点の高度(= -太陽高度)。固定にすると夜の光が真上から来る。
      const mel = Math.max(4, -sunState.el) * Math.PI / 180;
      moon.position.set(camPos.x + Math.sin(maz) * 120, camPos.y + 120 * Math.tan(mel), camPos.z + Math.cos(maz) * 120);
    }
    hemi.color.copy(sunState.hemiSky);
    hemi.groundColor.copy(sunState.hemiGround);
    // 直射:天空 ≒ 7:1。34:1 だと日陰が物理値の 4〜6 倍暗くなり、
    // 石が黒い紙に見える。地中海の晴天では空が影の主光源。
    // 2.40 では日陰が日向と同じ明るさになり、石が発泡スチロールに見えていた。
    // 実際の地中海の正午は 日向:日陰 ≒ 6:1。
    // 5.8 では日陰の絶対値が浮き(逆光の日陰立面が L* 44。実写は 25〜30)、
    // 画面から黒が消えて「30 枚中 25 枚に白も黒も無い」眠りの原因になっていた。
    // 夜側の 0.30 は落としすぎ(灯の届かない舗石が sRGB 28)。
    hemi.intensity = lerp(4.4, 4.6, sunState.dusk) * (1 - sunState.night * 0.12);
    scene.fog.color.copy(sunState.fogCol);
    // 0.001 では 300m でも透過率 90% = 市内に空気遠近がゼロ。
    const duskDay = sunState.dusk * (1 - sunState.night);   // 夜に「夕方」を持ち込まない
    // 0.00075 は 1050m で残存 54% = 視程 2.3km の霞んだ日の値。地中海の夏の
    // 晴天は視程 20〜40km あり、1km 先のスルジの稜線は明確に読める。
    scene.fog.density = lerp(0.00062, 0.00125, duskDay) * lerp(1, 0.72, sunState.night);

    // ---- 露出(暗順応: 暗い方への順応は遅く、明るい方へは速い)
    const zoneExp = ZONE_EXPOSURE[zone] ?? 1.05;
    // 正午の直射は薄暮の 3 倍近い。露出を太陽高度で下げないと、真昼の石灰岩が
    // 面の向きを失って一枚の白になる(実測 明部>0.90 が 14.5%)。
    const noonK = lerp(1.0, 0.88, smoothstep(20, 58, sunState.el));
    // 夜の環境光を 2.5 段落としたぶん、露出で持ち上げる(暗順応)
    // 夕方、日向の石灰岩が画面で最も暗い物になっていた(18:54 の胸壁 V59% <
    // 海 V74% < 空 V80%)。露出はゾーンと夜にしか反応せず、10:36 と 18:36 の
    // 同じ舗石が sRGB 231 と 121 = 3.6 倍違う。人の目もカメラも黄金時間には
    // 順応する。変わるのは色と影の長さで、明るさではない。
    // 上限 1.45 だと逆光の門(el 15.1°)で明部>0.90 が 5.4% → 8.8% に増えた。
    // 1.30 なら夕方の順応は残しつつ、太陽を正面に入れた絵が飽和しきらない。
    const lowSunK = lerp(1.0, lerp(1.30, 1.0, smoothstep(3, 34, sunState.el)), 1 - sunState.night);
    state.targetExposure = zoneExp * noonK * lowSunK * (1 + duskDay * 0.07) * lerp(1.0, 1.95, sunState.night);
    // SHOT では順応を待たない(tau 1.1〜2.6s のため 1.4s の待機では落ち着かず、
    // 同じ定点の 2 枚で 66% の画素が変わる = 回帰比較が原理的に成立しない)
    const tau = state.snap ? 0.0001 : (state.targetExposure > state.exposure ? 2.6 : 1.1);
    const prev = state.exposure;
    state.exposure += (state.targetExposure - state.exposure) * Math.min(1, dt / tau);
    renderer.toneMappingExposure = state.exposure;
    // 順応の途中差分 = 眩しさ(ブルームに渡す)
    state.glare = clamp(Math.abs(state.targetExposure - state.exposure) * 2.2, 0, 1);

    // ---- 夜の窓明かり
    glassNightUniform.value = smoothstep(-1, -6, sunState.el);
    litWindowsMat.opacity = glassNightUniform.value * 0.95;

    // ---- 環境ベイク(時刻が動いた時だけ)
    if (Math.abs(sunState.time - lastEnvTime) > 0.08) {
      lastEnvTime = sunState.time;
      // 天蓋は sky.js:171 で uSkyGain を掛けるのに IBL には掛けていなかった。
      // 「見えている空」と「照らしている空」が 2.6 倍ずれる。
      envUniforms.uZenith.value.copy(sunState.zenith).multiplyScalar(SKY_GAIN);
      envUniforms.uHorizon.value.copy(sunState.horizon).multiplyScalar(SKY_GAIN);
      // IBL の下半球も同じ橙にすると、垂直面の日陰が二重に黄色くなる
      envUniforms.uGround.value.copy(sunState.hemiGround).lerp(new THREE.Color(0x9aa4ae), 0.45 * (1 - sunState.night * 0.65));
      envUniforms.uSunDir.value.copy(sunState.dir);
      envUniforms.uSunCol.value.copy(sunState.sunCol).multiplyScalar(1 - sunState.night);
      // 拡散 IBL 用(太陽なし)と、鏡面用(太陽あり)を焼き分ける。
      // 1枚で済ませると、環境マップの太陽が「影の落ちない2つ目の太陽」になり、
      // 日向:日陰の比が 8:1 から 4:1 へ潰れる。
      envUniforms.uSunAmt.value = 0;
      const rtSky = pmrem.fromScene(envScene, 0.04);
      envUniforms.uSunAmt.value = 1;
      const rtSun = pmrem.fromScene(envScene, 0.04);
      if (envRT) envRT.dispose();
      if (envSunRT) envSunRT.dispose();
      envRT = rtSky; envSunRT = rtSun;
      scene.environment = rtSky.texture;
      for (const m of specularEnvTargets) { m.envMap = rtSun.texture; m.needsUpdate = true; }
      scene.environmentIntensity = lerp(0.66, 0.74, sunState.night);
    }

    // ---- 時計(鐘楼の針は本当の時刻)
    tex.clock.draw(sunState.time);

    return state;
  }

  return { sun, hemi, update, state };
}
