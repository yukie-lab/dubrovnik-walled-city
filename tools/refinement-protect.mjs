// Fixed source and geographic invariants for the September refinement campaign.
// node tools/refinement-protect.mjs --record  (only at the original baseline)
// node tools/refinement-protect.mjs           (verify; never rewrites the baseline)
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { installDomShim } from './structure/domshim.mjs';

const root = new URL('..', import.meta.url);
const manifest = new URL('docs/september-protected.json', root);
const hash = v => createHash('sha256').update(v).digest('hex');
const protectedFiles = [
  'src/sea.js', 'src/plan.js', 'src/seed.js', 'src/light.js', 'src/sky.js',
  'src/wet.js', 'tools/campaign.txt',
];
// User-authorized revision, 21 September: physical atmosphere replaces the
// painted sky. Keep the original hashes immutable and name the exceptions.
// The sea illumination adapter is audited separately; sea.js itself stays fixed.
const revisedByUser = new Set(['src/sky.js', 'src/light.js']);
const sources = Object.fromEntries(protectedFiles.map(f => [f, hash(readFileSync(new URL(f, root)))]));

installDomShim();
const { buildWorld } = await import('../src/world.js');
const w = buildWorld();
const geoFields = ['x', 'z', 'w', 'd', 'yBase', 'eaves', 'roofH', 'ridgeAxis', 'garden', 'monument'];
const geography = {
  seed: w.seed,
  houses: w.plan.houses.map(h => Object.fromEntries(geoFields.map(k => [k, h[k]]))),
  wall: w.plan.wallPts,
  streets: w.plan.streets,
  routes: w.routes,
  presets: w.presets,
};
const actual = { sources, geography: hash(JSON.stringify(geography)), houseCount: w.plan.houses.length };
if (process.argv.includes('--record')) {
  try { readFileSync(manifest); throw new Error('Baseline already exists; refusing to replace it.'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  writeFileSync(manifest, JSON.stringify(actual, null, 2) + '\n');
  console.log('Recorded original source and geographic invariants.');
} else {
  const expected = JSON.parse(readFileSync(manifest, 'utf8'));
  const failures = protectedFiles.filter(f => !revisedByUser.has(f) && actual.sources[f] !== expected.sources[f]);
  if (actual.geography !== expected.geography) failures.push('generated geography / routes');
  if (failures.length) {
    console.error('PROTECTION FAILED:', failures.join(', '));
    process.exitCode = 1;
  } else console.log(`Protection passed: ${protectedFiles.length-revisedByUser.size} unchanged sources, ${actual.houseCount} house records, wall, streets, routes and presets. User-authorized atmosphere revision: ${[...revisedByUser].join(', ')}; original manifest retained.`);
}
