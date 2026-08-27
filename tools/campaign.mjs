// ============================================================================
// campaign.mjs — 逐次精錬キャンペーンの定点撮影。
//   node tools/campaign.mjs <イテレーション名> [view名 …] [--time t1am,t3gold]
// tools/campaign.txt の view × time を全部撮って shots/cv/ に置く。
// 名前は <iter>_<view>_<time> — 別のパスの別のイテレーションでも同じ綴りになる。
// ============================================================================
import { readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
mkdirSync(root + 'shots/cv', { recursive: true });

const views = [], times = [];
for (const raw of readFileSync(root + 'tools/campaign.txt', 'utf8').split('\n')) {
  const line = raw.replace(/\s+#.*$/, '').trim();
  if (!line || line.startsWith('#')) continue;
  const m = line.match(/^(view|time)\s+(\S+)\s+(.+)$/);
  if (!m) continue;
  if (m[1] === 'view') views.push({ name: m[2], spec: m[3].trim() });
  else times.push({ name: m[2], t: m[3].trim() });
}

const argv = process.argv.slice(2);
const iter = argv.shift();
if (!iter) { console.error('usage: campaign.mjs <iter> [view…] [--time a,b]'); process.exit(1); }
let wantT = times.map(t => t.name), wantV = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--time') wantT = argv[++i].split(',');
  else wantV.push(argv[i]);
}
if (!wantV.length) wantV = views.map(v => v.name);

const specs = [];
for (const v of views.filter(v => wantV.includes(v.name)))
  for (const t of times.filter(t => wantT.includes(t.name))) {
    const p = v.spec.split(':');            // x:z:yaw:pitch:extra
    const extra = p.slice(4).join(':');
    specs.push(`cv/${iter}_${v.name}_${t.name}:${p[0]}:${p[1]}:${p[2]}:${p[3]}:${t.t}${extra ? ':' + extra : ''}`);
  }

console.log(`# ${specs.length} 枚 — ${wantV.length} 視点 × ${wantT.length} 時刻`);
const r = spawnSync('node', [root + 'tools/shot.mjs', ...specs], { stdio: 'inherit' });
process.exit(r.status ?? 1);
