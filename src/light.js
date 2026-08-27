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
    uHorizonFar: { value: new THREE.Color() },
    uGround: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() },
    uSunCol: { value: new THREE.Color() }, uSunAmt: { value: 1 },
  };
  envScene.add(new THREE.Mesh(
    new THREE.SphereGeometry(10, 24, 16),
    new THREE.ShaderMaterial({
      uniforms: envUniforms, side: THREE.BackSide,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vDir;
        uniform vec3 uZenith, uHorizon, uHorizonFar, uGround, uSunDir, uSunCol;
        uniform float uSunAmt;
        void main(){
          vec3 d = normalize(vDir);
          // 天蓋(sky.js の skyRadiance)は水平線帯を pow(1-h, 3.2) の薄い帯にするのに、
          // ここは pow(d.y, 0.6) で仰角 30° でも水平線色を 34% 含んでいた(天蓋は 10.9%)。
          // 夕方に最も明るく最も暖かい帯を、**照らしている空だけが 3 倍多く**持つ。
          // 見える空と照らす空は同じ分布でなければならない。
          float hw = pow(1.0 - clamp(d.y, 0.0, 1.0), 3.2);
          // 水平線は方位を持つ。太陽側は焼けて明るく、反対側は青灰に沈む。
          // ここを uHorizon 一色にすると、日没に **全方位から橙が来る**ことになり、
          // 太陽に背を向けた壁まで暖色で満たされる(= 夕方の絵が一色刷りになる)。
          // 天蓋(sky.js の skyRadiance)と同じ式・同じ引数を使う。
          vec3 hor = mix(uHorizonFar, uHorizon, smoothstep(-0.4, 0.9, dot(d, uSunDir)));
          vec3 col = d.y > 0.0 ? mix(uZenith, hor, hw) : mix(hor, uGround, pow(-d.y, 0.5));
          // 本物の太陽は視直径 0.53°、空の 2万倍。pow(...,32)*1.6 では
          // roughness 0.06 のガラスにすら映らない。芯と暈を分けて入れる。
          float sd = clamp(dot(d, uSunDir), 0.0, 1.0);
          // 芯を 110 にすると、掠め角の GGX が舗石に太陽の鏡像を焼き、
          // 逆光で画面の 8% が階調ごと 1.0 に貼り付く。芯は弱く、暈は厚く。
          // pow(sd,40) は半値角 10.6° の暈。掠め角の GGX に乗ると舗石に巨大な
          // 白い帯を焼く。実在の光冠は 2〜3°(pow 150 で半値角 5.4°)。
          col += uSunAmt * (uSunCol * pow(sd, 700.0) * 48.0 + uSunCol * pow(sd, 150.0) * 0.55);
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  ));
  let envRT = null, envSunRT = null, lastEnvTime = -99;

  // ---- 空気遠近は方位を持つ。
  // three の霧は色が 1 個の uniform なので、太陽側も反対側も同じ色になる。
  // 実在の霞は前方散乱が後方散乱の 10〜30 倍で、太陽側は明るく暖かく、
  // 反対側は暗く青い。しかも天蓋(sky.js の skyRadiance)は方位を持つのに
  // 霧は持たないので、**同じ方向を見ているのに海と空で別の式**になり、
  // 水平線が消えていた(実測 t3gold で 海 Y0.4605 : 空 Y0.4672 = 差 1.5%)。
  // 天蓋と同じ式・同じ引数を霧にも与える。
  const fogFarCol = { value: new THREE.Color() };
  const fogSunDir = { value: new THREE.Vector3(0, 1, 0) };
  function patchDirectionalFog(mat) {
    if (!mat || mat.__dirFog || mat.fog === false) return;
    mat.__dirFog = true;
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      if (!sh.fragmentShader.includes('#include <fog_fragment>')) return;
      sh.uniforms.uFogFar = fogFarCol;
      sh.uniforms.uFogSunDir = fogSunDir;
      // viewMatrix の 3x3 は正規直交なので、転置が逆行列。mvPosition は
      // インスタンス行列・スキニングを通したあとの視点座標なので、
      // これを世界の向きへ戻せば「その画素を見ている視線」が得られる。
      sh.vertexShader = sh.vertexShader
        .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\n varying vec3 vFogDir;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\n vFogDir = transpose(mat3(viewMatrix)) * mvPosition.xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <fog_pars_fragment>', '#include <fog_pars_fragment>\n varying vec3 vFogDir;\n uniform vec3 uFogFar; uniform vec3 uFogSunDir;')
        .replace('#include <fog_fragment>', `
          #ifdef USE_FOG
            #ifdef FOG_EXP2
              float fogF = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
            #else
              float fogF = smoothstep( fogNear, fogFar, vFogDepth );
            #endif
            vec3 fogC = mix(uFogFar, fogColor, smoothstep(-0.4, 0.9, dot(normalize(vFogDir), uFogSunDir)));
            gl_FragColor.rgb = mix( gl_FragColor.rgb, fogC, fogF );
          #endif`);
    };
    const key = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
    mat.customProgramCacheKey = () => key + '|dirfog';
  }
  scene.traverse((o) => {
    const m = o.material;
    if (Array.isArray(m)) m.forEach(patchDirectionalFog); else patchDirectionalFog(m);
  });

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
      // 2.2 では反太陽点の満月が街を「照明を落とした昼」に照らし、赤瓦が正午より
      // 赤く読めるほど強かった。夜の街を形づくるのは灯であって月ではない。
      // ただし 1.0 まで落とすと城壁・海・山の夜景で暗部<0.02 が 48〜51% に達し、
      // 面の向きが読めなくなる(9 時間ある夜に方向のある光が要る)。
      // 「赤瓦が正午より赤い」ほうは中間視の彩度低下(main.js)が担う。
      sun.intensity = 1.5 * smoothstep(0.15, 0.85, sunState.night);
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
    // 低い太陽で影ボリュームを **広げる** のは接地に対して逆向き。texel が太くなり、
    // アクネを避けるのに要る深度バイアスも比例して増え、影が足元から離れる
    // (実測 el 4.7° で後退 1.11m — 人も煙突も影を失う)。しかも影長は
    // el 15°→4.7° で 3.3 倍に伸びるので、どのみち 1 枚の影マップでは覆えない。
    // 遠い影の先を捨てて接地を取る。el 4.7° の直射は水平面照度の 19% しか
    // 担っていないので、遠景の影を失う損失は小さい。
    const lowSun = lerp(1.0, 0.70, smoothstep(15, 4, Math.max(elForShadow, 0)));
    const radius = lerp(40, 170, upK) * lowSun;
    const c = sun.shadow.camera;
    if (Math.abs(c.right - radius) > 1) {
      c.left = -radius; c.right = radius; c.top = radius; c.bottom = -radius;
      // 深度レンジを広げると bias の実効ワールド値も比例して伸び、影が漏れる。
      const far = 500 + radius * 2.4;
      c.near = 500 - radius * 1.2; c.far = far;
      // アクネを避けるのに要る深度は「1 テクセルぶん横に動いたときの深度差」
      // = texel·cos(el)。以前は高度に **比例** する固定値 0.156·sin(el) を使い、
      // しかも sin に床 0.28 を置いていたので、el 16.3° 以下で補正が止まり、
      // 影の後退量が 1/sin(el) で発散していた(el 4.7° で bias 由来 0.537m)。
      const texelW = (2 * radius) / 3072;
      const elRad = Math.max(elForShadow, 1.2) * Math.PI / 180;
      sun.shadow.bias = -(texelW * 1.7 * Math.cos(elRad) + 0.006) / (far - c.near);
      // radius に比例させると城壁上で 0.125m になり、瓦の起伏(4cm)や窓の見込みの
      // セルフシャドウが丸ごと消える。平方根で伸ばす。
      // normalBias は法線方向のずらしなので、水平面では 1/tan(el) で効く。低い
      // 太陽では絞らないと、これだけで 0.575m 影が後退する。
      sun.shadow.normalBias = 0.025 * Math.sqrt(radius / 34)
        * clamp(Math.sin(elRad) / 0.35, 0.30, 1);
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
    // 天空の高度追随を色そのものへ移した(sky.js)ぶん、昼の環境光が 12% 下がる。
    // 正午の日陰の絶対値を動かさないためにレベルで戻す。4.4→5.3 / IBL 0.66→0.79。
    hemi.intensity = lerp(5.3, 5.5, sunState.dusk) * (1 - sunState.night * 0.12);
    scene.fog.color.copy(sunState.fogCol);
    // 0.001 では 300m でも透過率 90% = 市内に空気遠近がゼロ。
    const duskDay = sunState.dusk * (1 - sunState.night);   // 夜に「夕方」を持ち込まない
    // 0.00075 は 1050m で残存 54% = 視程 2.3km の霞んだ日の値。地中海の夏の
    // 晴天は視程 20〜40km あり、1km 先のスルジの稜線は明確に読める。
    // 夕方に **観測者から山までの水平方向の消散係数** が倍になる物理的理由は無い。
    // 夕方に増えるのは「太陽光が通ってくる斜めの道のり」(= am、既に sunCol と
    // sunIntensity が持っている)であって、視程ではない。実測 t3gold の
    // density 0.001069 は 1.2km で霞 81% になり、スルジ山を霧色で塗り潰していた。
    scene.fog.density = lerp(0.00062, 0.00072, duskDay) * lerp(1, 0.72, sunState.night);
    // 太陽側 = fog.color(= horizon 由来)、反対側 = horizonFar 由来。
    fogFarCol.value.copy(sunState.fogFar);
    fogSunDir.value.copy(sunState.dir);

    // ---- 露出(暗順応: 暗い方への順応は遅く、明るい方へは速い)
    const zoneExp = ZONE_EXPOSURE[zone] ?? 1.05;
    // **露出は高度の関数ではなく、その場の光の量の関数。**
    // 以前は noonK(高度で下げる)と lowSunK(高度で上げる)の二本の曲線の積で、
    // el 20.6° では両方が持ち上げ側の端に居た(1.0 × 1.12)。結果、逆光の
    // ストラドゥンを正午より 21% 明るく撮り、画面の 7.4% が白に貼り付いた。
    // 水平面の全天照度 ghi を測って、その冪で決める。順応は部分的(γ=0.155)—
    // 完全順応させると夜が昼と同じ明るさになる。この一本で noonK も lowSunK も要らない。
    const GHI_NOON = 16.24;
    const meterK = 0.88 * Math.pow(GHI_NOON / Math.max(sunState.ghi, 1e-3), 0.155);
    // 夜の環境光を 2.5 段落としたぶん、露出で持ち上げる(暗順応)
    // 夕方、日向の石灰岩が画面で最も暗い物になっていた(18:54 の胸壁 V59% <
    // 海 V74% < 空 V80%)。露出はゾーンと夜にしか反応せず、10:36 と 18:36 の
    // 同じ舗石が sRGB 231 と 121 = 3.6 倍違う。人の目もカメラも黄金時間には
    // 順応する。変わるのは色と影の長さで、明るさではない。
    // 夜の持ち上げは薄明順応(桿体)で、測光とは別の機構。測光が既に 1.33 倍
    // 上げているので、残りぶんだけを掛ける(合計はおよそ従来の 1.95 倍)。
    state.targetExposure = zoneExp * meterK * lerp(1.0, 1.42, sunState.night);
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
      envUniforms.uHorizonFar.value.copy(sunState.horizonFar).multiplyScalar(SKY_GAIN);
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
      // 夜に IBL を **上げる** 物理的理由は無い(露出が既に 1.95 倍持ち上げている)。
      // 上げていたぶん、影を落とさない暖色の第二光源が夜にだけ強くなり、
      // 月光の石が硬い落影つきの中性灰 = 「露出を落とした昼」に見えていた。
      scene.environmentIntensity = lerp(0.79, 0.66, sunState.night);
    }

    // ---- 時計(鐘楼の針は本当の時刻)
    tex.clock.draw(sunState.time);

    return state;
  }

  // envUniforms は計器(tools/lightprobe.mjs)が IBL の放射照度を積分するために要る。
  return { sun, hemi, update, state, envUniforms };
}
