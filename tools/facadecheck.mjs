// Regression checks for ground-relative facade weathering. Uses the generated
// city plus two different observing-floor heights, not a second copy of the formula.
import assert from 'node:assert/strict';
import { installDomShim } from './structure/domshim.mjs';
installDomShim();
const { buildWorld } = await import('../src/world.js');
const { groundRefY } = await import('../src/skyvis.js');
const w = buildWorld();
const mesh = w.buildings.group.getObjectByName('house.body');
const { position, aWallUp } = mesh.geometry.attributes;
assert(aWallUp, 'Missing ground-relative height input');
assert.equal(position.count, aWallUp.count);
const values = [...aWallUp.array];
assert(values.every(Number.isFinite), 'Non-finite facade height');
assert(values.some(v => v > 8), 'No dry upper floors');
assert(values.some(v => v >= 0 && v < 1.65), 'No near-ground damp zone');
const shader = () => {
  const sh = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <map_fragment>\n#include <aomap_fragment>' };
  mesh.material.onBeforeCompile(sh);
  return sh;
};
const oldGround = groundRefY.value;
groundRefY.value = 2.6;
const low = shader();
groundRefY.value = 34.7;
const high = shader();
groundRefY.value = oldGround;
assert.match(low.vertexShader, /vUp\s*=\s*aWallUp\s*;/, 'Uninitialised wet-height varying');
assert.equal(low.vertexShader, high.vertexShader, 'Camera-dependent weathering code');
assert.doesNotMatch(low.fragmentShader, /smoothstep\(1\.65,\s*0\.0/, 'Undefined reversed smoothstep');
assert.doesNotMatch(low.fragmentShader, /smoothstep\(0\.38,\s*0\.18/, 'Undefined reversed smoothstep');
console.log(`Facade inputs passed: ${w.plan.houses.length} houses, ${values.length} finite vertex heights; upper floors dry; observer floor independent.`);
