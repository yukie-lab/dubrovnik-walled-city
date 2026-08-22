// 汀線 — 水が触れた石は濡れている。
//
// 岸の岩や埠頭の石は、水位の上下ぶんだけ「常に濡れた帯」を持つ。乾いた
// 石灰岩は白くて粗い。濡れると暗く、彩度が上がり、鏡のように滑らかになる。
// この帯が無いと、水面はどこまで行っても「板が地面に刺さっている」ように
// 見え、海と陸が触れ合っている感じが一切出ない。
//
// 帯の高さは固定ではない。うねりが来れば水位は上がり、引けば下がる。
// 同じ位相の波を海面シェーダと共有して、水と岩が同じ時計で動くようにする。
import * as THREE from 'three';

// 海面 (sea.js) の主要なうねりと同じ向き・同じ速さ。ここがずれると、
// 波が引いているのに岩だけ濡れる、という不整合が目に見える。
export const WET_GLSL = /* glsl */`
uniform float uWetTime;
// 岸での水位(m)。沖のゲルストナー和を、汀で効く 3 成分だけに落としたもの。
float wetWaterLine(vec2 p) {
  return sin(dot(p, vec2(-0.62, -0.785)) * 0.085 - uWetTime * 0.62) * 0.30
       + sin(dot(p, vec2( 0.31, -0.951)) * 0.190 - uWetTime * 0.98) * 0.15
       + sin(dot(p, vec2(-0.87,  0.492)) * 0.420 - uWetTime * 1.42) * 0.07;
}
float wetHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wetNoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wetHash(i), wetHash(i + vec2(1,0)), f.x),
             mix(wetHash(i + vec2(0,1)), wetHash(i + vec2(1,1)), f.x), f.y);
}
`;

// 全マテリアルで一つの時計を共有する(同じ uniform オブジェクトを配る)。
const wetTime = { value: 0 };
export function setWetTime(t) { wetTime.value = t; }

/**
 * MeshStandardMaterial に濡れ帯を足す。既存の onBeforeCompile があれば残す。
 * @param {THREE.Material} mat
 * @param {object} o  wet: 濡れの最大減光, top: 水位から上の濡れ残り(m), foam: 汀の泡の強さ
 */
export function patchWet(mat, o = {}) {
  // 「濡れ帯」は海面からの高さだけで決まる。海に面していない低い床
  // (ピレの空壕は底 0.3m)まで濡らしてしまい、泡の縁まで走って
  // **乾いた壕が川に見えていた**。高さは「濡れているか」を決めない。
  // dry:true を渡した材質は、頂点属性 aDry(1 = 決して濡れない)を読む。
  const useDry = !!o.dry;
  const wet = (o.wet ?? 0.46).toFixed(3);
  const top = (o.top ?? 0.62).toFixed(3);
  const foam = (o.foam ?? 0.55).toFixed(3);
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, renderer) => {
    if (prev) prev(sh, renderer);
    sh.uniforms.uWetTime = wetTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWetP;'
        + (useDry ? '\nattribute float aDry;\nvarying float vDry;' : ''))
      // worldpos_vertex はインスタンス行列も通す(舟・ボラードのような
      // InstancedMesh でも汀の位置が合う)。
      .replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n  vWetP = worldPosition.xyz;'
        + (useDry ? '\n  vDry = aDry;' : ''));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWetP;\n${useDry ? 'varying float vDry;' : ''}\n${WET_GLSL}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          float wl = wetWaterLine(vWetP.xz);
          float above = vWetP.y - wl;
          // 水位のすぐ上までは濡れている。さらに上は、さっきの波がまだ引ききって
          // いない分だけ半端に濡れる(帯の上端をぼかす)。
          float w = 1.0 - smoothstep(-0.10, ${top}, above);
          ${useDry ? 'float dryF = clamp(vDry, 0.0, 1.0);' : 'float dryF = 0.0;'}
          w = max(w, 0.35 * (1.0 - smoothstep(${top}, ${top} * 2.1, above)));
          w *= 1.0 - smoothstep(2.6, 4.2, vWetP.y);   // 上げ潮でも届かない高さ
          // 水面下 1.6m より深い所は「濡れ帯」ではない。ここを濡れ扱いすると、
          // 白い石灰岩の浅場が一律 0.46 倍に暗くされ、鏡になって空を返す
          // (アドリア海の浅場が光る、という最大の特徴が消える)。
          w *= smoothstep(-1.6, -0.5, above);
          w *= 1.0 - dryF;
          diffuseColor.rgb *= mix(1.0, ${wet}, w);
          // 0.10 まで落とすと、scene.environment の空を鏡面で返して
          // 拡散の減光を上回り、汀が「明るい帯」になる(実測 水際のほうが明るい)。
          roughnessFactor = mix(roughnessFactor, 0.34, w);
          // 汀の泡 — 白い縁が水位に沿って走る。まだらにして線に見せない。
          // 一層の値ノイズだけだと格子が見えて、泡が「縞」になる。二層重ねる。
          float fn = wetNoise(vWetP.xz * 1.1 + vec2(uWetTime * 0.30, -uWetTime * 0.19)) * 0.62
                   + wetNoise(vWetP.xz * 3.7 - vec2(uWetTime * 0.44, uWetTime * 0.27)) * 0.38;
          float fb = (1.0 - smoothstep(0.0, 0.22, abs(above - 0.05))) * smoothstep(0.34, 0.72, fn);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.94, 0.95), fb * (1.0 - dryF) * ${foam});
          // 潮上帯 — 波が届かなくなる高さに、塩と地衣の白い線が残る。
          // 濡れ(暗)/ 白線(明)/ 乾き(中) の層序ができて、水位が読める。
          // 帯は狭く。広く取ると岩全体が白く飛ぶ。色もリニア値なので、
          // 0.90 は sRGB 245 相当 = 紙のような白になる。
          float bleach = (1.0 - smoothstep(${top} + 0.35, ${top} + 1.10, above))
                       * smoothstep(${top} - 0.15, ${top} + 0.35, above);
          // 潮上帯も「海が届く所」にしか無い。ここだけ乾き判定を通していな
          // かったので、空壕の底(0.4〜0.9m)に **水平の白い帯** が一本走り、
          // 壕が川に見える最大の原因になっていた。
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.60, 0.55), bleach * (1.0 - dryF) * 0.30);
        }`);
  };
  const key = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => (key ? key.call(mat) : '') + '|wet';
  return mat;
}
