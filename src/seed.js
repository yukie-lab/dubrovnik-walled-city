// ============================================================================
// seed.js — 街ひとつぶんの乱数の源。
//
// 以前は各モジュールが `mulberry32(0xca5a)` のように自前の定数を握っていた。
// つまり「シードを変えた街」を作れず、生成が決定的であることも外から証明でき
// なかった。乱数の流れは一箇所から派生させる。
//
// 規則: モジュールは「塩(salt)」だけを持ち、実際の種は WORLD_SEED と混ぜて作る。
//   const rng = rngFor(0xca5a);
//
// hash2(x, z) のような「座標ハッシュ」はここには含めない。あれは乱数列では
// なく空間の関数で、同じ場所には同じ値を返すことが仕様(隣り合う二つの系が
// 同じ石の色を出すため)。シードを変えれば配置そのものが動くので、座標ハッシュ
// の出力も一緒に動く。
// ============================================================================
import { mulberry32 } from './util.js';

export const DEFAULT_SEED = 19790807;

let worldSeed = DEFAULT_SEED;

export function setWorldSeed(s) {
  worldSeed = (s >>> 0) || DEFAULT_SEED;
}

export function getWorldSeed() {
  return worldSeed;
}

/** モジュール固有の塩から、この街の乱数列を作る。 */
export function rngFor(salt) {
  return mulberry32((worldSeed ^ (salt >>> 0)) >>> 0);
}
