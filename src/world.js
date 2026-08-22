// ============================================================================
// world.js — 街の組み立て。ここが「世界とは何か」の唯一の定義。
//
// 以前は main.js の中に組み立て順が直書きされていて、検証ツールは
// ブラウザを立ち上げて window.__world を覗くしかなかった。つまり
// 「レンダリングできないと世界を問い合わせられない」状態だった。
//
// 組み立てはレンダリングに一切依存しない(WebGL も canvas も DOM も要らない)。
// three のオブジェクトは CPU 側のデータ構造なので、Node でそのまま作れる。
// tex.js だけが canvas を要るが、テクスチャの画素は幾何に一切影響しない
// (寸法は coverM のような定数で決まる)ので、ヘッドレスでは薄い canvas の
// 影武者を噛ませて「同じコード」を走らせる。tools/structure/domshim.mjs 参照。
//
// 組み立て順は意味を持つ:
//   plan → monuments(合成レコードを家に足す)→ ground/walls(StepPool へ石段
//   を注ぐ)→ buildings → surround/sea/sky/life → steps.finalize
// ============================================================================
import * as THREE from 'three';
import { setWorldSeed, getWorldSeed } from './seed.js';
import { buildPlan, makeRoutes, makePresets } from './plan.js';
import { makeTextures } from './tex.js';
import { makeSky } from './sky.js';
import { makeSea } from './sea.js';
import { makeGround, makeStepPool } from './ground.js';
import { makeBuildings, getSharedSkyVis, specularEnvTargets } from './buildings.js';
import { makeWalls } from './walls.js';
import { makeMonuments } from './monuments.js';
import { makeSurround } from './surround.js';
import { makeLife } from './life.js';

/**
 * 街を一つ作る。同じ seed からは必ず同じ街が出る。
 * @param {object} o
 * @param {number} [o.seed]      省略時は既定のシード
 * @param {boolean} [o.life]     生活(人・鳩・洗濯物)を含めるか
 * @param {boolean} [o.sky]      天蓋を含めるか
 * @param {boolean} [o.sea]      海を含めるか
 */
export function buildWorld({ seed, life = true, sky = true, sea = true } = {}) {
  if (seed !== undefined) setWorldSeed(seed);
  // 同一プロセスで二度組むとき(決定性の検証)に前回の残骸を持ち越さない。
  specularEnvTargets.length = 0;

  const plan = buildPlan();
  const tex = makeTextures();
  const stepPool = makeStepPool(tex);

  const monuments = makeMonuments(plan, tex);
  const ground = makeGround(plan, tex, stepPool);
  const walls = makeWalls(plan, tex, stepPool, plan.outsideHeight);
  const buildings = makeBuildings(plan, tex);
  const surround = makeSurround(plan, tex);
  const seaObj = sea ? makeSea(plan) : null;
  const skyObj = sky ? makeSky(tex) : null;
  const lifeObj = life ? makeLife(plan, tex, stepPool) : null;
  const steps = stepPool.finalize(getSharedSkyVis());

  const parts = { ground, walls, buildings, monuments, surround, sea: seaObj, sky: skyObj, life: lifeObj };
  const root = new THREE.Group();
  root.name = 'city';
  const groups = {};
  for (const [k, v] of Object.entries(parts)) {
    if (!v) continue;
    v.group.name = k;
    // 由来はここで一度だけ刻む。検証はこの札で対象を選ぶ。
    v.group.userData.kind = k;
    groups[k] = v.group;
    root.add(v.group);
  }
  steps.name = 'steps';
  steps.userData.kind = 'steps';
  groups.steps = steps;
  root.add(steps);
  root.updateMatrixWorld(true);

  return {
    seed: getWorldSeed(),
    plan, tex, stepPool, steps, root, groups,
    ground, walls, buildings, monuments, surround,
    sea: seaObj, sky: skyObj, life: lifeObj,
    routes: makeRoutes(plan),
    presets: makePresets(plan),
    counts: {
      houses: buildings.counts.houses,
      windows: buildings.counts.windows,
      shutters: buildings.counts.shutters,
      steps: stepPool.count,
      merlons: walls.counts.merlons,
      pines: surround.counts.pines,
      cloths: lifeObj ? lifeObj.counts.cloths : 0,
      pots: lifeObj ? lifeObj.counts.pots : 0,
      swifts: lifeObj ? lifeObj.counts.swifts : 0,
    },
  };
}
