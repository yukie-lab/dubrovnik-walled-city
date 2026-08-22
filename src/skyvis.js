// ============================================================================
// skyvis.js — 天空可視率(sky visibility)をビルド時に頂点へ焼く。
//
// 幅 2.5m・高さ 15m の路地では、床が見ている空は全天の 1割ほどしかない。
// 半球光も IBL も形を見ないので、そのままでは路地の底も屋根の上も同じ明るさ
// になる — これが「模型に見える」最大の原因。
//
// スクリーン空間の AO(GTAO)は半径が数十cm〜1m なので、6m のトンネルや
// 4m の路地の底のような「建築スケールの遮蔽」は原理的に作れない。
// ここで焼く値は間接光(半球光 + IBL)にだけ掛ける。直射に掛けると影が二重になる。
// ============================================================================
import * as THREE from 'three';
import { clamp, smoothstep } from './util.js';

// 天空可視率で「塞がれた分」は黒ではなく、日向の石灰岩の壁である。
// ここに色を与えないと、路地の床が青いインクになる(実測 日陰の舗石 B/R 1.50 /
// すぐ隣の日陰の壁 B/R 0.96 — 床のほうが暖色を多く受けるはずなのに逆転していた)。
export const urbanTint = { value: new THREE.Vector3(1, 1, 1) };

// 日向の舗石からの照り返し(放射輝度)。天空可視率とは独立の「加算」項で、
// これが無いとアーチの内輪・巾木の際・岸壁が例外なく sRGB 12〜17 に落ちる
// (同じ材質・6m 隣の日向と輝度比 15:1。実写の内輪は sRGB 70〜110)。
export const bounceRad = { value: new THREE.Vector3(0, 0, 0) };

// 照り返しの基準となる地面の高さ(毎フレーム、プレイヤーの足元から)。
// 高さで減衰させないと、15m の壁の上まで舗石の照り返しが届いてしまう。
export const groundRefY = { value: 2.6 };

const HS = 20;      // 空間ハッシュのセル(m)
const REACH = 26;   // これより遠い建物は見上げ角が小さく効かない

export function makeSkyVis(plan) {
  const grid = new Map();
  const add = (o) => {
    const gx0 = Math.floor((o.x - o.w / 2) / HS), gx1 = Math.floor((o.x + o.w / 2) / HS);
    const gz0 = Math.floor((o.z - o.d / 2) / HS), gz1 = Math.floor((o.z + o.d / 2) / HS);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const k = gx + ',' + gz;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(o);
    }
  };
  for (const h of plan.houses) add(h);
  // 城壁も遮蔽物。歩廊の内側(市側)の路地は、城壁の高さで空を削られる。
  for (let i = 1; i < plan.wallPts.length; i++) {
    const A = plan.wallPts[i - 1], B = plan.wallPts[i];
    const n = Math.max(1, Math.round(Math.hypot(B[0] - A[0], B[1] - A[1]) / 8));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      add({
        x: A[0] + (B[0] - A[0]) * t, z: A[1] + (B[1] - A[1]) * t,
        w: 9, d: 9, eaves: A[2] + (B[2] - A[2]) * t,
      });
    }
  }

  // 方位 (ux,uz) を見上げたときに空を塞ぐ最大の仰角
  function blockAngle(x, z, y, ux, uz) {
    let best = 0;
    const gx0 = Math.floor((x - REACH) / HS), gx1 = Math.floor((x + REACH) / HS);
    const gz0 = Math.floor((z - REACH) / HS), gz1 = Math.floor((z + REACH) / HS);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const cell = grid.get(gx + ',' + gz);
        if (!cell) continue;
        for (const o of cell) {
          const dx = o.x - x, dz = o.z - z;
          const fwd = dx * ux + dz * uz;
          if (fwd < 0.5 || fwd > REACH) continue;
          const lat = Math.abs(dx * -uz + dz * ux);
          if (lat > (o.w + o.d) / 4 + 1.2) continue;
          const dh = o.eaves - y;
          if (dh <= 0.2) continue;
          const th = Math.atan2(dh, Math.max(fwd - (o.w + o.d) / 4, 0.4));
          if (th > best) best = th;
        }
      }
    }
    return best;
  }

  // nrm は世界座標の面法線。上向きの面は 8 方位を、垂直な面は正面だけを見る。
  const NAZ = 8;
  return function skyAt(x, z, y, nx, ny, nz) {
    if (ny > 0.55) {
      // 上を向く面: 方位ごとに塞がれた仰角を測り、コサイン重みで開空率を出す
      let open = 0;
      for (let k = 0; k < NAZ; k++) {
        const a = (k / NAZ) * Math.PI * 2;
        const th = blockAngle(x, z, y, Math.cos(a), Math.sin(a));
        open += Math.cos(th) * Math.cos(th);      // その方位の帯のうち開いている割合
      }
      open /= NAZ;
      return 0.08 + 0.92 * Math.pow(clamp(open, 0, 1), 0.80);
    }
    const l = Math.hypot(nx, nz) || 1;
    const th = blockAngle(x, z, y, nx / l, nz / l);
    const open = 1 - th / (Math.PI / 2);
    // 下を向く面(軒裏・アーチの内輪)は空をほとんど見ない
    const down = smoothstep(-0.3, -0.85, ny);
    return (0.06 + 0.94 * Math.pow(clamp(open, 0, 1), 0.80)) * (1 - down * 0.85);
  };
}

// 焼いた値を「間接光にだけ」掛けるためのシェーダ差し込み。
// aSky 属性(頂点あたり 1 float)を持つジオメトリに使う。
export function patchSkyVis(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, renderer) => {
    if (prev) prev(sh, renderer);
    sh.uniforms.uBounce = bounceRad;
    sh.uniforms.uGroundY = groundRefY;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n attribute float aSky; varying float vSkyV; varying float vBnc; uniform float uGroundY;')
      // これらのメッシュはワールド座標にマージ済みなので normal.y はそのまま世界の上下。
      // 下を向く面ほど地面からの照り返しを強く受ける。
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vSkyV = aSky;\n vBnc = clamp(0.75 - normal.y * 0.35, 0.25, 1.0) * exp(-max(position.y - uGroundY, 0.0) / 7.0);');
    sh.uniforms.uUrban = urbanTint;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n varying float vSkyV; varying float vBnc; uniform vec3 uUrban; uniform vec3 uBounce;')
      .replace('#include <aomap_fragment>', `
        // 天空可視率は「間接光の量」。直射に掛けると影が二重になる。
        // 塞がれた分は「日向の壁からの照り返し」。空 100% なら無着色、
        // 空 0% なら完全に街の色。これが路地の床を暖色に戻す。
        reflectedLight.indirectDiffuse *= vSkyV * mix(uUrban, vec3(1.0), vSkyV);
        // 舗石の照り返しは天空率と独立に「足す」。掛け算だけでは遮蔽ポケットが黒く落ちる。
        // 下限 0.30 は遮蔽ポケットにも常に照り返しを配る。しかも vBnc は
        // 床面直上で最大値を取るので、入隅で「遮蔽ゼロ + バウンス最大」になり、
        // **壁と床の入隅が画面で最も明るい** という逆転が起きていた
        // (実測 s08 入隅 V50% > 開けた床 V49%)。90° の入隅では天空の
        // コサイン重み可視率が約 50% に落ちる。下限を下げる。
        reflectedLight.indirectDiffuse += diffuseColor.rgb * uBounce * vBnc * (0.16 + 0.84 * vSkyV);
        // 環境マップには太陽芯が焼いてある(light.js の pow(sd,700)*110)。
        // 影のテストを掛けないと、日陰の磨いた舗石にも「太陽の鏡像」が乗り、
        // 影の色相が青から緑へ引き戻され、日向:日陰の比が 6.6:1 から 3.8:1 へ潰れる。
        float sMask = 1.0;
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
          sMask = getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize,
            directionalLightShadows[ 0 ].shadowIntensity, directionalLightShadows[ 0 ].shadowBias,
            directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] );
        #endif
        reflectedLight.indirectSpecular *= mix(0.55, 1.0, vSkyV) * mix(0.25, 1.0, sMask);`);
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
  mat.customProgramCacheKey = () => key + '|skyvis';
}

// ジオメトリの全頂点に aSky を焼く(法線は頂点法線を使う)
export function bakeSkyVis(geo, skyAt, { offsetY = 0 } = {}) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  const a = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    a[i] = skyAt(pos.getX(i), pos.getZ(i), pos.getY(i) + offsetY,
      nrm ? nrm.getX(i) : 0, nrm ? nrm.getY(i) : 1, nrm ? nrm.getZ(i) : 0);
  }
  geo.setAttribute('aSky', new THREE.BufferAttribute(a, 1));
}

// InstancedMesh 用。頂点ではなくインスタンスごとに 1 値を持つ(aSkyI)。
// 影のテストは掛けない軽量版 — 磨いた面でないものはこれで十分で、
// getShadow() の 16 タップを全材質に配ると 5〜8fps 落ちる。
export function patchSkyVisInstanced(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, renderer) => {
    if (prev) prev(sh, renderer);
    sh.uniforms.uUrban = urbanTint;
    sh.uniforms.uBounce = bounceRad;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n attribute float aSkyI; varying float vSkyI;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vSkyI = aSkyI;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n varying float vSkyI; uniform vec3 uUrban; uniform vec3 uBounce;')
      .replace('#include <aomap_fragment>', `
        reflectedLight.indirectDiffuse *= vSkyI * mix(uUrban, vec3(1.0), vSkyI);
        reflectedLight.indirectDiffuse += diffuseColor.rgb * uBounce * 0.40 * (0.30 + 0.70 * vSkyI);
        reflectedLight.indirectSpecular *= vSkyI;`);
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
  mat.customProgramCacheKey = () => key + '|skyvisI';
  return mat;
}

// items = [{x,y,z}, ...] の並び順で aSkyI を焼く(InstancedMesh の index と一致必須)
export function bakeSkyVisInstanced(geo, items, skyAt, { offsetY = 0.4 } = {}) {
  const a = new Float32Array(Math.max(1, items.length));
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    a[i] = skyAt(it.x, it.z, (it.y ?? 0) + offsetY, 0, 1, 0);
  }
  geo.setAttribute('aSkyI', new THREE.InstancedBufferAttribute(a, 1));
}
