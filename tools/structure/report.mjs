// ============================================================================
// report.mjs — 違反の束ね方と出し方。
//
// 30 個の浮いた物が同じ生成経路から出ているなら、それはバグ 1 個であって
// 30 個ではない。報告がそれを言わないと、人間は 30 回同じ判断をさせられる。
// ============================================================================
import fs from 'node:fs';

const SEV = { plate: 5, terrainAgreement: 5, manifold: 5, backface: 5, walkability: 4, grounding: 4, footprintCorner: 4,
  envelope: 4, colliderAgreement: 3, thickness: 3, stairs: 3, crossRepresentation: 3,
  interpenetration: 2, coplanar: 1 };

/** 同じ cause を持つ違反を束ねる。 */
export function cluster(violations) {
  const m = new Map();
  for (const v of violations) {
    const k = v.cause || `${v.check}:${v.tag}`;
    if (!m.has(k)) m.set(k, { cause: k, check: v.check, count: 0, worst: v, sample: [] });
    const c = m.get(k);
    c.count++;
    if (c.sample.length < 3) c.sample.push(v);
    const ae = (x) => (x === Infinity ? 1e9 : Math.abs(Number(x) || 0));
    if (ae(v.error) > ae(c.worst.error)) c.worst = v;
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

export function writeJson(path, payload) {
  fs.mkdirSync(path.replace(/\/[^/]+$/, ''), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(payload, null, 2));
}

const C = { red: '\x1b[31m', yel: '\x1b[33m', grn: '\x1b[32m', dim: '\x1b[2m', off: '\x1b[0m', bold: '\x1b[1m' };

export function printSummary(result) {
  const { violations, stats, timings, seed } = result;
  const byCheck = new Map();
  for (const v of violations) (byCheck.get(v.check) || byCheck.set(v.check, []).get(v.check)).push(v);
  const order = [...byCheck.keys()].sort((a, b) => (SEV[b] || 0) - (SEV[a] || 0));

  console.log(`\n${C.bold}構造アサーション — シード ${seed}${C.off}`);
  console.log(`${C.dim}物 ${stats.objects} / 三角 ${stats.triangles.toLocaleString()} / 索引 ${stats.gridCells} セル / 組み立て ${timings.build}ms${C.off}`);

  for (const name of order) {
    const list = byCheck.get(name);
    const sev = SEV[name] || 0;
    const col = sev >= 4 ? C.red : sev >= 3 ? C.yel : C.dim;
    console.log(`\n${col}▌ ${name}${C.off}  ${list.length} 件  ${C.dim}(${timings[name] ?? '?'}ms)${C.off}`);
    const cl = cluster(list);
    for (const c of cl.slice(0, 8)) {
      const w = c.worst;
      const m = w.measured === null ? '—' : String(w.measured);
      console.log(`   ${String(c.count).padStart(5)} × ${c.cause}`);
      console.log(`         ${C.dim}最悪: ${w.id} @ ${w.pos.join(', ')}  実測 ${m} / 許容 ${w.tolerance}${C.off}`);
      console.log(`         ${C.dim}${w.note}${C.off}`);
    }
    if (cl.length > 8) console.log(`   ${C.dim}… ほか ${cl.length - 8} 群${C.off}`);
  }

  const clean = [];
  for (const [name] of Object.entries(SEV)) if (!byCheck.has(name)) clean.push(name);
  if (clean.length) console.log(`\n${C.grn}✅ 違反なし:${C.off} ${clean.join(' ')}`);
  console.log(`\n${violations.length === 0 ? C.grn + 'ALL CLEAN' : C.red + `違反 ${violations.length} 件 / ${cluster(violations).length} 群`}${C.off}`);
}

/**
 * 接地誤差の俯瞰図(SVG)。赤 = 浮き、青 = 沈み、灰 = 着地。
 * レンダラは要らない。上から見た矩形を誤差で塗るだけで、空間的な偏りが判る。
 */
export function writeGroundingMap(path, objects, violations, plan) {
  const W = 1400, H = 900;
  const xs = [], zs = [];
  for (const h of plan.houses) { xs.push(h.x); zs.push(h.z); }
  const x0 = Math.min(...xs) - 30, x1 = Math.max(...xs) + 30;
  const z0 = Math.min(...zs) - 30, z1 = Math.max(...zs) + 30;
  const sx = (x) => ((x - x0) / (x1 - x0)) * W;
  const sz = (z) => ((z - z0) / (z1 - z0)) * H;
  const errAt = new Map();
  for (const v of violations) {
    if (v.check !== 'grounding' && v.check !== 'footprintCorner') continue;
    errAt.set(`${Math.round(v.pos[0])},${Math.round(v.pos[2])}`, v.error);
  }
  const col = (e) => {
    if (e === undefined) return '#b9b6ae';
    if (e === Infinity) return '#ff00ff';
    const t = Math.max(-1, Math.min(1, e / 0.3));
    return t > 0 ? `rgb(${220 + t * 35 | 0},${(1 - t) * 150 | 0},${(1 - t) * 120 | 0})`
      : `rgb(${(1 + t) * 120 | 0},${(1 + t) * 160 | 0},${200 - t * 55 | 0})`;
  };
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#101216"/>`];
  parts.push(`<polyline fill="none" stroke="#4a5560" stroke-width="2" points="${plan.wallPts.map(p => `${sx(p[0]).toFixed(1)},${sz(p[1]).toFixed(1)}`).join(' ')}"/>`);
  for (const h of plan.houses) {
    const e = errAt.get(`${Math.round(h.x)},${Math.round(h.z)}`);
    const w = Math.max(1.5, (h.w / (x1 - x0)) * W), d = Math.max(1.5, (h.d / (z1 - z0)) * H);
    parts.push(`<rect x="${(sx(h.x) - w / 2).toFixed(1)}" y="${(sz(h.z) - d / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${d.toFixed(1)}" fill="${col(e)}" fill-opacity="${e === undefined ? 0.35 : 0.95}"/>`);
  }
  parts.push(`<text x="16" y="28" fill="#e8e4dc" font-family="sans-serif" font-size="18">接地誤差 — 赤=浮き 青=沈み 灰=着地 桃=床が無い</text>`);
  parts.push('</svg>');
  fs.mkdirSync(path.replace(/\/[^/]+$/, ''), { recursive: true });
  fs.writeFileSync(path, parts.join('\n'));
}
