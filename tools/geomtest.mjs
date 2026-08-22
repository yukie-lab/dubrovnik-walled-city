// ============================================================================
// geomtest.mjs — 「描画された三角形」を真実として、自動ウォークを検証する。
//
// piercetest.mjs は plan.js の衝突モデルを plan.js の衝突モデルで検証している。
// モデルが自己整合なら ALL CLEAN になる — 見た目が壊れていても。
// このツールは実ブラウザでシーンを組み、walls/buildings/ground/monuments/steps
// の実三角形を XZ グリッドに索引して、実際の auto.update() を回しながら測る。
//
//   FLOOR_NONE  足の下に床の三角形が無い(= 海や虚空の上を歩いている)
//   FLOOR_LOW   描画の床が足より低い(浮いている)
//   FLOOR_HIGH  描画の床が足より高い(石にめり込んでいる)
//   PIERCE      胸の高さで、描画された石の三角形を横断した(= 壁抜け)
//
// 実行: python3 -m http.server 8765 && node tools/geomtest.mjs [routeId...]
// ============================================================================
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8765';
const only = process.argv.slice(2);

// ---------------------------------------------------------- ページ内実装 ----
function install() {
  const { THREE, solids } = window.__world;
  const CELL = 4;
  const BOX = { x0: -340, x1: 350, z0: -220, z1: 360 };

  // ---- 実三角形の抽出(InstancedMesh も実インスタンスに展開)
  const T = [];      // [ax,ay,az,bx,by,bz,cx,cy,cz] * n
  const TAG = [];    // 由来グループ名
  const v = new THREE.Vector3();
  const m4 = new THREE.Matrix4();

  function addGeometry(geo, mat, tag) {
    const pos = geo.attributes.position;
    if (!pos) return;
    const idx = geo.index;
    const n = idx ? idx.count : pos.count;
    const p = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i + 2 < n; i += 3) {
      let ok = true;
      for (let k = 0; k < 3; k++) {
        const j = idx ? idx.getX(i + k) : i + k;
        v.set(pos.getX(j), pos.getY(j), pos.getZ(j)).applyMatrix4(mat);
        if (v.x < BOX.x0 || v.x > BOX.x1 || v.z < BOX.z0 || v.z > BOX.z1) { ok = false; break; }
        p[k * 3] = v.x; p[k * 3 + 1] = v.y; p[k * 3 + 2] = v.z;
      }
      if (!ok) continue;   // 遠景の山・遠景の海は市域外なので落ちる
      T.push(p.slice());
      TAG.push(tag);
    }
  }

  const TAGS = ['ground', 'walls', 'buildings', 'monuments', 'steps'];
  solids.forEach((root, gi) => {
    const tag = TAGS[gi] || ('g' + gi);
    root.updateWorldMatrix?.(true, true);
    root.traverse(o => {
      if (!o.isMesh) return;
      if (o.isInstancedMesh) {
        const im = new THREE.Matrix4();
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, im);
          m4.multiplyMatrices(o.matrixWorld, im);
          addGeometry(o.geometry, m4, tag);
        }
      } else {
        addGeometry(o.geometry, o.matrixWorld, tag);
      }
    });
  });

  // ---- XZ グリッド索引
  const grid = new Map();
  const kOf = (cx, cz) => cx + ':' + cz;
  T.forEach((t, i) => {
    const x0 = Math.min(t[0], t[3], t[6]), x1 = Math.max(t[0], t[3], t[6]);
    const z0 = Math.min(t[2], t[5], t[8]), z1 = Math.max(t[2], t[5], t[8]);
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL);
    const cz0 = Math.floor(z0 / CELL), cz1 = Math.floor(z1 / CELL);
    if ((cx1 - cx0 + 1) * (cz1 - cz0 + 1) > 400) return;   // 病的に大きい三角形は索引しない
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const k = kOf(cx, cz);
      let a = grid.get(k);
      if (!a) { a = []; grid.set(k, a); }
      a.push(i);
    }
  });

  // ---- Möller–Trumbore(両面)
  function rayTri(ox, oy, oz, dx, dy, dz, t) {
    const e1x = t[3] - t[0], e1y = t[4] - t[1], e1z = t[5] - t[2];
    const e2x = t[6] - t[0], e2y = t[7] - t[1], e2z = t[8] - t[2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-9) return -1;
    const inv = 1 / det;
    const tx = ox - t[0], ty = oy - t[1], tz = oz - t[2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) return -1;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const vv = (dx * qx + dy * qy + dz * qz) * inv;
    if (vv < 0 || u + vv > 1) return -1;
    return (e2x * qx + e2y * qy + e2z * qz) * inv;
  }

  function cellsOfSegment(x0, z0, x1, z1) {
    const cx0 = Math.floor(Math.min(x0, x1) / CELL), cx1 = Math.floor(Math.max(x0, x1) / CELL);
    const cz0 = Math.floor(Math.min(z0, z1) / CELL), cz1 = Math.floor(Math.max(z0, z1) / CELL);
    const out = [];
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) out.push(kOf(cx, cz));
    return out;
  }

  // 足元の床面(上向き三角形だけ拾う — 天井・胸壁の裏は床ではない)
  //   stand = 足の高さ+tol 以下でいちばん高い床(実際に立っている面)
  //   above = 足より上に迫り出している床(= 石にめり込んでいる証拠)
  function floorUnder(x, z, foot, tol) {
    let stand = null, above = null;
    for (const k of cellsOfSegment(x, z, x, z)) {
      const list = grid.get(k);
      if (!list) continue;
      for (const i of list) {
        const t = T[i];
        // 面法線(巻き順)。ny > 0.2 = 上を向いた面 = 床
        const e1x = t[3] - t[0], e1y = t[4] - t[1], e1z = t[5] - t[2];
        const e2x = t[6] - t[0], e2y = t[7] - t[1], e2z = t[8] - t[2];
        const ny = e1z * e2x - e1x * e2z;
        const nl = Math.hypot(e1y * e2z - e1z * e2y, ny, e1x * e2y - e1y * e2x);
        if (nl < 1e-9 || ny / nl < 0.2) continue;
        const hit = rayTri(x, foot + 40, z, 0, -1, 0, T[i]);
        if (hit <= 0) continue;
        const y = foot + 40 - hit;
        if (y <= foot + tol) { if (!stand || y > stand.y) stand = { y, tag: TAG[i] }; }
        else if (y < foot + 1.5) { if (!above || y < above.y) above = { y, tag: TAG[i] }; }
      }
    }
    return { stand, above };
  }

  // 線分が石を横断したか(最初の当たりを返す)
  function crossing(x0, y0, z0, x1, y1, z1, skipTags) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return null;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    let best = -1, tag = null;
    const seen = new Set();
    for (const k of cellsOfSegment(x0, z0, x1, z1)) {
      const list = grid.get(k);
      if (!list) continue;
      for (const i of list) {
        if (seen.has(i)) continue;
        seen.add(i);
        if (skipTags && skipTags.has(TAG[i])) continue;
        const t = rayTri(x0, y0, z0, ux, uy, uz, T[i]);
        if (t > 1e-4 && t < len && (best < 0 || t < best)) { best = t; tag = TAG[i]; }
      }
    }
    return best < 0 ? null : { t: best, tag, x: x0 + ux * best, y: y0 + uy * best, z: z0 + uz * best };
  }

  // 体が石に埋まっているか(胸の高さで八方に短い光線 — 多数が当たれば中にいる)
  function embedded(x, y, z, r) {
    let hit = 0, tag = null;
    for (let a = 0; a < 8; a++) {
      const th = (a / 8) * Math.PI * 2;
      const c = crossing(x, y, z, x + Math.cos(th) * r, y, z + Math.sin(th) * r, null);
      if (c) { hit++; tag = tag || c.tag; }
    }
    return { hit, tag };
  }

  window.__geom = { T, TAG, grid, floorUnder, crossing, embedded, CELL };
  return { tris: T.length, cells: grid.size };
}

// ---- 1 ルートを実際の auto.update() で歩き、実三角形で測る
function runRoute(routeIdx, opts) {
  const { plan, player, auto, routes } = window.__world;
  const { floorUnder, crossing, embedded } = window.__geom;
  const SAMPLE = opts.sample;
  const TOL = opts.tol;
  const CHEST = 1.0;   // plan.collide が体の高さとして使う値と同じ

  const route = routes[routeIdx];
  player.frozen = false;
  auto.start(route);

  const events = [];
  let open = null;
  const push = (type, tag, p, note) => {
    if (open && open.type === type && open.tag === tag
      && Math.hypot(open.x - p.x, open.z - p.z) < 2.0) { open.n++; return; }
    open = { type, tag, x: p.x, z: p.z, y: p.y, wp: p.wp, zone: p.zone, note, n: 1 };
    events.push(open);
  };

  let prev = { x: player.x, z: player.z, gy: player.groundY };
  let frames = 0, samples = 0;
  const dt = 1 / 60;
  const MAXF = opts.maxFrames;
  let worstLow = 0, worstHigh = 0;

  while (auto.active && frames < MAXF) {
    auto.update(dt);
    frames++;
    if (frames % SAMPLE) continue;
    samples++;
    const cur = { x: player.x, z: player.z, gy: player.groundY };
    const p = { x: cur.x, z: cur.z, y: cur.gy, wp: auto.wpIdx, zone: player.zone };

    // ---- 床
    const { stand, above } = floorUnder(cur.x, cur.z, cur.gy, TOL);
    if (!stand) {
      push(cur.gy < 2.2 ? 'OVER_SEA' : 'FLOOR_NONE', above ? above.tag : '-', p,
        `足 y${cur.gy.toFixed(2)} の下に床の三角形なし`);
    } else if (stand.y < 0.15) {
      push('OVER_SEA', stand.tag, p, `床 y${stand.y.toFixed(2)} は海面下 / 足 y${cur.gy.toFixed(2)}`);
    } else {
      const d = stand.y - cur.gy;
      if (d < -TOL) { worstLow = Math.min(worstLow, d); push('FLOOR_LOW', stand.tag, p, `床 y${stand.y.toFixed(2)} / 足 y${cur.gy.toFixed(2)} (${(-d).toFixed(2)}m 浮き)`); }
      else if (above) { worstHigh = Math.max(worstHigh, above.y - cur.gy); push('FLOOR_HIGH', above.tag, p, `足 y${cur.gy.toFixed(2)} の上 ${(above.y - cur.gy).toFixed(2)}m に床面(めり込み)`); }
      else open = (open && (open.type.startsWith('FLOOR') || open.type === 'OVER_SEA')) ? null : open;
    }

    // ---- 壁抜け(胸の高さの移動線分が石を横断)
    const c = crossing(prev.x, prev.gy + CHEST, prev.z, cur.x, cur.gy + CHEST, cur.z, opts.skip);
    if (c) push('PIERCE', c.tag, p, `(${c.x.toFixed(1)}, ${c.y.toFixed(1)}, ${c.z.toFixed(1)}) の三角形を横断`);

    // ---- 体が石の中にある
    const em = embedded(cur.x, cur.gy + CHEST, cur.z, 0.3);
    if (em.hit >= 5) push('EMBED', em.tag, p, `胸の高さの八方光線 ${em.hit}/8 が 0.3m 以内で石に当たる`);

    prev = cur;
  }
  auto.stop();
  return {
    id: route.id, name: route.name, frames, samples,
    end: { x: +player.x.toFixed(1), z: +player.z.toFixed(1), y: +player.groundY.toFixed(1) },
    worstLow: +worstLow.toFixed(2), worstHigh: +worstHigh.toFixed(2),
    events,
  };
}

// ---- 歩行網の静的スキャン(自動ルート以外 — 手で歩く場所も測る)
function scanNetwork(tol) {
  const { plan } = window.__world;
  const { floorUnder, embedded } = window.__geom;
  const out = [];
  let n = 0;
  const check = (where, x, z, curY) => {
    const g = plan.groundAt(x, z, curY);
    // そもそも立てない点は測らない: 押し出される点・建物の footprint の中
    const c = plan.collide(x, z, 0.35, g.y + 1.0);
    if (Math.hypot(c.x - x, c.z - z) > 0.25) return;
    for (const h of plan.houses) {
      if (Math.abs(x - h.x) < h.w / 2 + 0.4 && Math.abs(z - h.z) < h.d / 2 + 0.4) return;
    }
    n++;
    const { stand, above } = floorUnder(x, z, g.y, tol);
    let type = null, note = '';
    const boxProbe = where.startsWith('gate:');
    if (!stand) { if (!boxProbe) { type = g.y < 2.2 ? 'OVER_SEA' : 'FLOOR_NONE'; note = `足 y${g.y.toFixed(2)} の下に床なし`; } }
    else if (stand.y < 0.15) { if (!boxProbe) { type = 'OVER_SEA'; note = `床 y${stand.y.toFixed(2)} は海面下`; } }
    else if (stand.y < g.y - tol) { if (!boxProbe) { type = 'FLOOR_LOW'; note = `床 y${stand.y.toFixed(2)} / 足 y${g.y.toFixed(2)} (${(g.y - stand.y).toFixed(2)}m 浮き)`; } }
    // 門の粗い ±9m 格子は、門から離れた階段の上にも撒かれる。段の上に段が
    // あるのは当たり前なので、門の判定は「通行帯の中」だけに限る。
    else if (above && !(boxProbe && g.zone !== 'gate')) { type = 'FLOOR_HIGH'; note = `足の上 ${(above.y - g.y).toFixed(2)}m に床面`; }
    if (!type) {
      // 体が石に埋まっていないか。胸の高さで八方に 0.5m の光線を撃ち、
      // 6 本以上が当たったら「石の中に立っている」。門の下は通路なので、
      // 通路の軸方向(前後)は当たらないはず。
      const e = embedded(x, (stand ? stand.y : g.y) + 1.35, z, 0.5);
      const need = e.tag === 'ground' ? 8 : 6;   // 斜面は地形に何本か当たるのが普通
      if (e.hit >= need) { type = 'IN_SOLID'; note = `胸の高さの八方 ${e.hit}/8 が ${e.tag} に当たる`; }
    }
    if (type) out.push({ type, where, x: +x.toFixed(1), z: +z.toFixed(1), zone: g.zone, note });
  };

  for (const s of plan.streets) {
    const [ax, az] = s.pts[0], [bx, bz] = s.pts[1];
    const L = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    for (let t = 0.5; t < L; t += 1.5) {
      for (const o of [-(s.w / 2 - 0.45), 0, s.w / 2 - 0.45]) {
        const x = ax + dx * t - dz * o, z = az + dz * t + dx * o;
        check(`street:${s.id}`, x, z, plan.streetY(s, x, z));
      }
    }
  }
  // 門のまわりは 0.6m 刻みで密に見る(通れる幅と石の中の境目はここでしか出ない)
  for (const g of plan.GATES) {
    for (let dx2 = -9; dx2 <= 9; dx2 += 0.6) {
      for (let dz2 = -9; dz2 <= 9; dz2 += 0.6) {
        check(`gate:${g.id}`, g.x + dx2, g.z + dz2, g.y + 6);
      }
    }
  }
  // 広場と城壁外の通行帯
  for (const p2 of plan.PLAZAS) {
    for (let x = p2.x0 + 1; x < p2.x1; x += 2.0) {
      for (let z = p2.z0 + 1; z < p2.z1; z += 2.0) check(`plaza:${p2.id}`, x, z, p2.y);
    }
  }
  for (const w of plan.OUTSIDE_WALKS) {
    // has() を持つ帯(斜めの橋)は矩形ではない。矩形で撒くと海の上を数えてしまう。
    for (let x = w.x0 + 0.6; x < w.x1; x += 1.2) {
      for (let z = w.z0 + 0.6; z < w.z1; z += 1.2) {
        if (w.has && !w.has(x, z)) continue;
        check(`walk:${w.id}`, x, z, w.yAt ? w.yAt(x, z) : w.y);
      }
    }
  }
  for (const st of plan.WALL_STAIRS) {
    for (const sg of st.segs) {
      for (let t = 0.3; t < sg.len; t += 1.0) {
        const y = sg.ay + (sg.by - sg.ay) * (t / sg.len);
        for (const o of [-(st.w / 2 - 0.5), 0, st.w / 2 - 0.5]) {
          check(`stair:${st.id}`, sg.ax + sg.dx * t + sg.nx * o, sg.az + sg.dz * t + sg.nz * o, y);
        }
      }
    }
  }
  for (let i = 1; i < plan.wallPts.length; i++) {
    const A = plan.wallPts[i - 1], B = plan.wallPts[i];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (L < 0.01) continue;
    const dx = (B[0] - A[0]) / L, dz = (B[1] - A[1]) / L;
    const wk = plan.WALL_KIND[plan.wallKinds[i - 1]] || plan.WALL_KIND.sea;
    for (let t = 0; t <= L; t += 2) {
      const y = A[2] + (B[2] - A[2]) * (t / L);
      for (const o of [-(wk.walkHalf - 0.45), 0, wk.walkHalf - 0.45]) {
        check('wall', A[0] + dx * t - dz * o, A[1] + dz * t + dx * o, y);
      }
    }
  }
  for (const p of plan.PLAZAS) {
    for (let x = p.x0 + 1; x < p.x1; x += 3) for (let z = p.z0 + 1; z < p.z1; z += 3) check(`plaza:${p.id}`, x, z, p.y);
  }
  for (const w of plan.OUTSIDE_WALKS) {
    for (let x = w.x0 + 0.8; x < w.x1; x += 2) for (let z = w.z0 + 0.8; z < w.z1; z += 2) {
      if (w.has && !w.has(x, z)) continue;
      check(`walk:${w.id}`, x, z, w.yAt ? w.yAt(x, z) : w.y);
    }
  }
  return { n, out };
}

// ------------------------------------------------------------------ 実行 ----
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--headless=new', '--use-angle=metal', '--window-size=1280,800'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 400)));

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction('window.__world !== undefined', { timeout: 40000 });

const idx = await page.evaluate(install);
console.log(`索引: 三角形 ${idx.tris.toLocaleString()} / セル ${idx.cells.toLocaleString()}`);

let total = 0;

// ---- 歩行網スキャン(--scan)
if (only.includes('--scan')) {
  const r = await page.evaluate(scanNetwork, 0.35);
  console.log('');
  console.log(`=== 歩行網スキャン(${r.n.toLocaleString()} 点)`);
  const by = new Map();
  for (const e of r.out) by.set(e.type, (by.get(e.type) || 0) + 1);
  if (!r.out.length) console.log('    違反なし');
  else {
    console.log('    ' + [...by.entries()].map(([k, n]) => `${k}×${n}`).join('  '));
    for (const e of r.out.slice(0, 40)) {
      console.log(`    [${e.type.padEnd(10)}] ${e.where.padEnd(22)} (${e.x}, ${e.z}) zone=${e.zone} ${e.note}`);
    }
    if (r.out.length > 40) console.log(`    … 他 ${r.out.length - 40} 件`);
  }
  total += r.out.length;
}

const ids = await page.evaluate(() => window.__world.routes.map(r => r.id));
const routeFilter = only.filter(a => !a.startsWith('--'));
for (let i = 0; i < ids.length; i++) {
  if (only.includes('--scan') && !routeFilter.length) break;
  if (routeFilter.length && !routeFilter.includes(ids[i])) continue;
  const r = await page.evaluate(runRoute, i, {
    sample: 3, tol: 0.35, maxFrames: 60000,
    skip: null,
  });
  console.log('');
  console.log(`=== route:${r.id} — ${r.name}`);
  console.log(`    ${r.frames}f (${(r.frames / 60) | 0}s) 終点(${r.end.x}, ${r.end.z}) y${r.end.y}  浮き最大 ${r.worstLow}m / めり込み最大 ${r.worstHigh}m`);
  if (!r.events.length) { console.log('    違反なし'); continue; }
  const by = new Map();
  for (const e of r.events) {
    const k = e.type + '/' + e.tag;
    by.set(k, (by.get(k) || 0) + 1);
  }
  console.log('    ' + [...by.entries()].map(([k, n]) => `${k}×${n}`).join('  '));
  for (const e of r.events.slice(0, 60)) {
    console.log(`    [${e.type.padEnd(10)}] ${String(e.tag).padEnd(10)} wp${String(e.wp).padStart(2)} (${e.x.toFixed(1)}, ${e.z.toFixed(1)}) y${e.y.toFixed(2)} zone=${e.zone} ${e.note}${e.n > 1 ? ` ×${e.n}` : ''}`);
  }
  if (r.events.length > 60) console.log(`    … 他 ${r.events.length - 60} 件`);
  total += r.events.length;
}
console.log('');
console.log(total ? `合計 ${total} 件の違反` : 'ALL CLEAN(実三角形基準)');
await browser.close();
process.exit(total ? 1 : 0);
