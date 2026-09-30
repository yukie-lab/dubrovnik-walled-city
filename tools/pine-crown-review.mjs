import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {writeFoliageReview} from './foliage-review.mjs';

// Reuse the accepted normal-correction captures as the before images: same
// geometry as 2ae8104, already using the corrected surface normals.
const dir=new URL('../shots/rendercheck/',import.meta.url);
const report=name=>{const r=JSON.parse(readFileSync(new URL(name+'.json',dir),'utf8'));assert.equal(r.errors.length,0);return r;};
const beforeNear='canopy-20260930-hidpi',afterNear='crown-20260930-a';
const beforeWide='canopy-20260930-sweep',afterWide='crown-20260930-sweep';
const originalNear=report(beforeNear).rows,rows=[];
for(const r of report(afterNear).rows.filter(r=>r.exactRestoration!==undefined&&!r.view.startsWith('motion-'))) {
  const old=originalNear.find(o=>o.view===r.view);assert(old?.exactRestoration&&r.exactRestoration);
  assert.deepEqual(r.station,old.station);
  rows.push({record:'near',id:r.view,time:7.9,stats:r.stats.density,
    before:`${beforeNear}-${r.view}-density.png`,after:`${afterNear}-${r.view}-density.png`});
}
for(const r of report('crown-20260930-hidpi').rows.filter(r=>r.view==='pine-crown'&&r.side===0)) {
  const old=originalNear.find(o=>o.view==='foliage-normal'&&o.id==='aleppoPine'&&o.time===r.time);
  assert(old?.restored&&r.stableFrames);assert.equal(old.stats.dpr,r.stats.dpr);
  for(const key of ['x','z','gy','yaw','pitch'])assert.equal(old.station[key],r.station[key]);
  rows.push({record:'hidpi',id:'aleppoPine-hidpi',time:r.time,stats:r.stats,
    before:`${beforeNear}-aleppoPine-${r.time}-after.png`,after:`crown-20260930-hidpi-pine-0-${r.time}.png`});
}
const times={t1am:7.9,t2noon:12.87,t3gold:19.3,t4dusk:21.2},originalWide=report(beforeWide).rows;
const wide=report(afterWide).rows;assert.equal(wide.length,32);
for(const r of wide) {
  assert(r.stableFrames);const [id,t]=r.view.split(/_(?=t\d)/),time=times[t];
  const old=originalWide.find(o=>o.id===id&&o.time===time);assert(old?.restored);
  const params=new URLSearchParams(r.query);
  for(const key of ['x','z','yaw','pitch','gy','fov'])if(old.station[key]!==undefined)
    assert.equal(+params.get(key),old.station[key],'Match the campaign camera');
  rows.push({record:'campaign',id,time,stats:{drawCalls:r.drawCalls,instances:r.instances,dpr:r.dpr},
    before:`${beforeWide}-${id}-${time}-after.png`,after:`${afterWide}-${r.view}-0-direct.png`});
}
writeFoliageReview('crown-20260930',rows,{
  title:'松の樹冠を比較',
  description:'平たく並んでいた枝先に高低差をつけ、上へ向かって枝が短くなる樹形に整えました。',
  note:'松681本の共通の生成方法を変更。木の配置、幹、葉の総数と面積は維持しています。葉束の細部や描画速度には、引き続き改善の余地があります。',
});
