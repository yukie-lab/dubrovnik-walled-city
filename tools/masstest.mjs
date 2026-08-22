// ============================================================================
// masstest.mjs — 「積み上げた塊の途中が丸ごと消えていないか」を実三角形で測る。
//
//   node tools/masstest.mjs [--step 0.5] [--all]
//
// 塔・要塞・鐘楼のように段を積んで作る塊は、段の y を 1 つ書き間違えるだけで
// 途中に空隙ができ、上半分が宙に浮く。ところがそれは **1 つのメッシュの中** で
// 起きるので、structure の seating(物と物の据わり)には原理的に映らない。
// 実測: ロヴリイェナツの主塔で 5.65m の空隙。目で見つけるまで誰も鳴らなかった。
//
// **問いの立て方が肝心。** 鉛直線の切れ目を数えると、中が空洞の塔(ミンチェタの
// 螺旋、鐘楼、教会の身廊)まで全部鳴る — 建物は中が空いているのが普通。
// 正しい問いは「**その高さに石が一片もあるか**」。水平に八方から撃って
// 一本も当たらない高さが、上下に石があるのに存在したら、そこで塊は切れている。
// ============================================================================
import { installDomShim } from './structure/domshim.mjs';
installDomShim();
import { collectObjects, buildTriangles, Grid, castRay } from './structure/geom.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : Number(argv[i + 1]); };
const STEP = flag('--step', 0.5);

const { buildWorld } = await import('../src/world.js');
const world = buildWorld({});
const plan = world.plan;
const objects = collectObjects(world.root);
const { tris, owner } = buildTriangles(objects, { filter: (o) => !o.isPoints && !o.backdrop });
const grid = new Grid(tris, 4);
const STONE = /^(wall\.|surround\.(lovrijenac|arsenal)|monument\.|house\.(body|gableFin))/;
const isStone = (oi) => STONE.test(objects[oi]?.tag || '');

const sites = [];
for (const [id, t] of Object.entries(plan.TOWERS || {})) {
  sites.push({ id: `tower:${id}`, x: t.x, z: t.z, r: (t.crownR ?? 6) + 3, y0: 0, y1: (t.topY ?? 30) + 8 });
}
sites.push({ id: 'lovrijenac', x: -248, z: 82, r: 20, y0: 18, y1: 64 });
// 記念建築は互いに近い。半径を決め打ちにすると隣の鐘楼や民家を拾って
// 「上に石がある」と誤判定する(実測 スポンザ d12.9 は鐘楼、イエズス会 d9.0 は民家)。
// その建物自身の footprint から取る。
for (const [id, mnt] of Object.entries(plan.MONUMENTS || {})) {
  if (mnt.x === undefined) continue;
  const h = plan.houses.find(q => q.monument && Math.abs(q.x - mnt.x) < 1 && Math.abs(q.z - mnt.z) < 1);
  // 柱・噴水のような「積んでいない単体」は対象外。半径を決め打ちにすると
  // 隣の鐘楼の窓の抜けを拾う(オルランドの柱で実測)。物と物の据わりは
  // structure の seating が見る。ここは **段を積んだ塊** だけを見る。
  if (!h) continue;
  sites.push({ id: `monument:${id}`, x: mnt.x, z: mnt.z, r: Math.max(h.w, h.d) / 2 + 1.0, y0: 2, y1: 46 });
}

// その高さに、その塊の石が一片でもあるか
// 遠くから撃つと隣の建物が先に当たり、castRay は最初の 1 つしか返さないので
// 「範囲外だから無し」と誤判定する(実測 スポンザが 10.5m 空白と出た)。
// **自分の足元のすぐ外**から撃つ。
const solidAt = (s, y) => {
  const R = s.r + 1.2;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const sx = s.x + Math.cos(a) * R, sz = s.z + Math.sin(a) * R;
    if (castRay(grid, owner, sx, y, sz, -Math.cos(a), 0, -Math.sin(a), R * 2, isStone)) return true;
  }
  return false;
};

const bad = [];
let nSlice = 0;
for (const s of sites) {
  const solid = [];
  for (let y = s.y0; y <= s.y1; y += STEP) { solid.push(solidAt(s, y)); nSlice++; }
  // 「石あり … 空 … 石あり」の空区間
  let i = 0;
  while (i < solid.length) {
    if (solid[i]) { i++; continue; }
    let j = i;
    while (j < solid.length && !solid[j]) j++;
    const hasBelow = solid.slice(0, i).some(Boolean);
    const hasAbove = solid.slice(j).some(Boolean);
    if (hasBelow && hasAbove) {
      bad.push({ id: s.id, from: s.y0 + i * STEP, to: s.y0 + (j - 1) * STEP, h: (j - i) * STEP });
    }
    i = j + 1;
  }
}

bad.sort((a, b) => b.h - a.h);
const C = { red: '\x1b[31m', grn: '\x1b[32m', dim: '\x1b[2m', off: '\x1b[0m' };
console.log(`\n塊 ${sites.length} 箇所 / 水平断面 ${nSlice} 枚 — 石が一片も無い高さ ${bad.length} 区間`);
const show = argv.includes('--all') ? bad : bad.slice(0, 12);
for (const b of show) {
  console.log(`  ${C.red}${b.h.toFixed(1)}m${C.off} 空白  ${b.id.padEnd(20)} y ${b.from.toFixed(1)} 〜 ${b.to.toFixed(1)}`);
}
if (bad.length > show.length) console.log(`  ${C.dim}… ほか ${bad.length - show.length} 件${C.off}`);
console.log(bad.length ? `${C.red}塊が途中で切れている ${bad.length} 区間${C.off}`
  : `${C.grn}ALL CLEAN — 積んだ石は途中で消えていない${C.off}`);
process.exit(bad.length ? 1 : 0);
