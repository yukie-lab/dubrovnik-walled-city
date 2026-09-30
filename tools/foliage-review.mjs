import {readFileSync,writeFileSync,existsSync} from 'node:fs';

// node tools/foliage-review.mjs <output-name> <capture-name> [...capture-names]
const [name,...records]=process.argv.slice(2),dir=new URL('../shots/rendercheck/',import.meta.url);
if(!name||!records.length||[name,...records].some(s=>!/^[-\w]+$/.test(s)))
  throw new Error('Provide an output name and passing foliage capture names');
const rows=records.flatMap(record=>{
  const report=JSON.parse(readFileSync(new URL(record+'.json',dir),'utf8'));
  const comparisons=report.rows.filter(r=>r.view==='foliage-normal');
  if(report.errors.length||!comparisons.length||comparisons.some(r=>!r.restored||r.gpuError))
    throw new Error('Passing, stable foliage comparisons required: '+record);
  return comparisons.map(({id,time,stats})=>{
    if(!/^[-\w]+$/.test(id)||!Number.isFinite(time))throw new Error('Invalid capture identifier');
    const before=`${record}-${id}-${time}-before.png`,after=`${record}-${id}-${time}-after.png`;
    if(![before,after].every(file=>existsSync(new URL(file,dir))))throw new Error('Missing comparison image');
    return {record,id,time,stats,before,after};
  });
});
const labels={aleppoPine:'松',cypress:'糸杉',olive:'オリーブ',maquis:'低木',roofs:'城壁からの遠景',
  v1_stradun:'ストラドゥン',v2_alley:'路地',v3_roofs:'城壁と屋根',v4_srd:'スルジ山',
  v5_sea:'海',v6_lovrijenac:'ロヴリイェナツ要塞',v7_harbour:'港',v8_luza:'ルジャ広場'};
const stations=[...new Map(rows.map(r=>[r.record+'/'+r.id,{record:r.record,id:r.id}])).values()];
const page=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>木々の陰影を比較 — Dubrovnik</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f0e9;color:#302e28;font:16px/1.7 system-ui,sans-serif}
main{max-width:1320px;margin:auto;padding:28px}h1{font:500 28px Georgia,serif;margin:0 0 10px}
p{max-width:850px}a{color:#3d5846}label{display:inline-flex;gap:10px;align-items:center;margin:0 20px 12px 0}
select{font:inherit;background:#fffdf7;color:inherit;border:1px solid #a29a8a;padding:7px 12px;border-radius:3px}
.view{position:relative;width:100%;aspect-ratio:1.6;background:#d8d2c8;overflow:hidden}
.view img{position:absolute;width:100%;height:100%;object-fit:contain}.after{clip-path:inset(0 0 0 50%)}
.divider{position:absolute;inset:0 auto 0 50%;width:2px;background:white;pointer-events:none}
.caption{display:flex;justify-content:space-between;gap:20px;margin-top:8px}input{width:100%;accent-color:#526d53}
.data{font-size:14px;color:#625b50}footer{border-top:1px solid #cbc3b5;margin-top:28px;padding-top:16px}
@media(max-width:650px){main{padding:16px}.caption{font-size:13px}}
</style><main><h1>木々の陰影を比較</h1>
<p>葉の表裏で混ざっていた面の向きを直し、細かな白い斑点を減らしました。
同じ位置・時刻で、左に変更前、右に変更後を表示します。スライダーで境界を動かせます。</p>
<label>視点<select id="station">${stations.map((s,i)=>`<option value="${i}">${labels[s.id]||s.id}</option>`).join('')}</select></label>
<label>時刻<select id="time"></select></label>
<div class="view"><img id="old" alt="変更前の木々の陰影"><img class="after" id="new" alt="変更後の木々の陰影"><div class="divider" id="divider"></div></div>
<label style="display:block;margin:8px 0"><span class="data">比較境界</span><input id="split" aria-label="変更前後の表示境界" type="range" min="0" max="100" value="50"></label>
<div class="caption"><a id="oldLink" target="_blank" rel="noopener">変更前の原寸画像</a><a id="newLink" target="_blank" rel="noopener">変更後の原寸画像</a></div>
<p id="stats" class="data" aria-live="polite"></p>
<p class="data">1,490本の木に共通する描画を修正。樹木や葉の配置は維持しています。
遠景の枝葉の密度や樹形には、引き続き改善の余地があります。</p>
<footer><a href="/">街を歩く</a> · <a href="/docs/september-campaign.md">作業記録</a></footer></main>
<script>
const rows=${JSON.stringify(rows)},stations=${JSON.stringify(stations)},el=id=>document.getElementById(id);
const times={'7.9':'朝 07:54','12.87':'昼 12:52','19.3':'夕方 19:18','21.2':'夜 21:12'};
function matching(){const s=stations[+el('station').value];return rows.filter(r=>r.record===s.record&&r.id===s.id);}
function show(){const r=matching().find(r=>r.time===+el('time').value);
el('old').src=el('oldLink').href=r.before;el('new').src=el('newLink').href=r.after;
el('stats').textContent=r.stats.drawCalls+' 描画 / '+r.stats.instances.toLocaleString()+' インスタンス / 描画DPR '+r.stats.dpr;}
function changeStation(){const previous=el('time').value;el('time').replaceChildren(...matching().map(r=>new Option(times[r.time],r.time)));
if(matching().some(r=>String(r.time)===previous))el('time').value=previous;show();}
el('station').onchange=changeStation;el('time').onchange=show;
el('split').oninput=()=>{const v=el('split').value+'%';el('new').style.clipPath='inset(0 0 0 '+v+')';el('divider').style.left=v;};
el('station').value=String(Math.max(0,stations.findIndex(s=>s.id==='aleppoPine')));changeStation();
</script></html>`;
writeFileSync(new URL(name+'-review.html',dir),page);console.log(new URL(name+'-review.html',dir).pathname);
