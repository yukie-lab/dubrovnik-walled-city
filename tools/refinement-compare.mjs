// Compare each immutable campaign view, and persist the results next to the PNGs.
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const [before, after] = process.argv.slice(2);
if (!before || !after) throw new Error('Usage: refinement-compare.mjs before after');
const dir = new URL('../shots/cv/', import.meta.url);
const rows = [];
for (const file of readdirSync(dir).filter(n => n.startsWith(before + '_') && n.endsWith('.png')).sort()) {
  const suffix = file.slice(before.length + 1);
  const a = new URL(file, dir), b = new URL(after + '_' + suffix, dir);
  if (!existsSync(b)) { rows.push({ view: suffix, missing: true }); continue; }
  const result = spawnSync(process.execPath,
    [new URL('./_imgdiff.mjs', import.meta.url).pathname, a.pathname, b.pathname], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const line = result.stdout.split('\n')[0];
  const match = line.match(/画素 ([\d.]+)%\s+平均ΔY ([\d.+-]+)\s+最大\|ΔY\| ([\d.]+)/);
  if (!match) throw new Error('Unrecognised image comparison: ' + line);
  const row = { view: suffix, changedPercent: +match[1], meanDeltaY: +match[2], maxDeltaY: +match[3] };
  rows.push(row);
  console.log(`${suffix.padEnd(30)} ${row.changedPercent.toFixed(2).padStart(6)}%  ΔY ${row.meanDeltaY.toFixed(5)}`);
}
writeFileSync(new URL(`diff-${before}-${after}.json`, dir), JSON.stringify(rows, null, 2) + '\n');
if (rows.length !== 32 || rows.some(r => r.missing)) {
  console.error(`Incomplete comparison: ${rows.filter(r => !r.missing).length}/32.`);
  process.exitCode = 1;
}
