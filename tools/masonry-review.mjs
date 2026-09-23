import {readFileSync,writeFileSync} from 'node:fs';

const before=process.argv[2]||'sept30stonebase',after=process.argv[3]||'sept30stoneaccepted';
for(const value of [before,after])if(!/^[\w-]+$/.test(value))throw new Error('Record names must be simple file stems');
const dir=new URL('../shots/rendercheck/',import.meta.url);
const report=JSON.parse(readFileSync(new URL(after+'.json',dir),'utf8'));
const rows=report.rows.filter(r=>r.view==='masonry-atlas');
if(rows.length!==18||report.errors.length)throw new Error('Complete, passing stone comparison required');
const labels={'parapet-front':'胸壁・正面','parapet-oblique':'胸壁・斜め','fort-distant':'要塞・遠景',
  pileStair:'ピレ門の階段',mincetaShaft:'ミンチェタの内部階段',stjohnStair:'聖ヨハネの階段',
  ploceStair:'プロチェ門の階段',stjohnTop:'聖ヨハネの上部階段',mincetaTop:'ミンチェタの上部階段'};
const options=[...new Set(rows.map(r=>r.id))].map(id=>`<option value="${id}">${labels[id]||id}</option>`).join('');
const page=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>石材の比較 — Dubrovnik</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f0e9;color:#302e28;font:16px/1.7 system-ui,sans-serif}
main{max-width:1320px;margin:auto;padding:28px}h1{font:500 27px Georgia,serif;margin:0 0 8px}
p{max-width:900px}a{color:#5a4936}label{display:inline-flex;gap:10px;align-items:center;margin:0 20px 12px 0}
select,button{font:inherit;background:#fffdf7;color:inherit;border:1px solid #a29a8a;padding:7px 12px;border-radius:3px}
.view{position:relative;width:100%;aspect-ratio:1.6;background:#d8d2c8;overflow:hidden}
.view img{position:absolute;width:100%;height:100%;object-fit:contain}.after{clip-path:inset(0 0 0 50%)}
.divider{position:absolute;inset:0 auto 0 50%;width:2px;background:#fff;pointer-events:none}
.caption{display:flex;justify-content:space-between;gap:20px;margin-top:8px}input{width:100%;accent-color:#74664e}
.data{font-size:14px;color:#625b50}video{display:block;width:100%;max-height:700px;background:#171713}
details{margin:28px 0}summary{cursor:pointer;font-weight:600}footer{border-top:1px solid #cbc3b5;margin-top:28px;padding-top:16px}
@media(max-width:650px){main{padding:16px}.caption{font-size:13px}}
</style><main><h1>城壁と階段の石材を比較</h1>
<p>6系統の共通材質で、壁全体の4.2m周期を石ごとの組合せへ変更しました。形状・太陽・カメラ・露出は同一です。
変更前を左、変更後を右に表示します。スライダーで境界を動かせます。</p>
<label>視点<select id="station">${options}</select></label>
<label>時刻<select id="time"><option value="7.9">朝 07:54</option><option value="12.87">昼 12:52</option></select></label>
<div class="view"><img id="old" alt="変更前の石材"><img class="after" id="new" alt="変更後の石材"><div class="divider" id="divider"></div></div>
<label style="display:block;margin:8px 0"><span class="data">比較境界</span><input id="split" aria-label="変更前後の表示境界" type="range" min="0" max="100" value="50"></label>
<div class="caption"><a id="oldLink" target="_blank">変更前の原寸画像</a><a id="newLink" target="_blank">変更後の原寸画像</a></div>
<p id="stats" class="data"></p>
<p class="data">4.2mずらした反射率のGPU計測：旧方式の相関は縦横1.0、新方式は横0.132・縦0.010。
18視点の描画数・三角形数・インスタンス数はすべて変更前と同じです。海・地理・階段の踏面形状は今回変更していません。</p>
<details><summary>日没から夜までの連続検証</summary><p>19:18〜21:48。時計と露出を連続更新し、1,181点を測定。追加のシェーダーコンパイル0、最大151描画。
波や人物のアニメーション位相は比較用に固定しています。</p><video controls preload="none" src="sept29birdposes-sunset.webm"></video></details>
<footer><a href="/">街を歩く</a> · <a href="/docs/september-campaign.md">作業記録</a>
<p class="data">残る課題：階段脇の接合を再調査中。遠景の植生と屋根視点の性能、写真に対する海の彩度差も未解決です。</p></footer></main>
<script>
const rows=${JSON.stringify(rows.map(({id,time,drawCalls,triangles,instances})=>({id,time,drawCalls,triangles,instances})))},before=${JSON.stringify(before)},after=${JSON.stringify(after)};
const el=id=>document.getElementById(id);
function show(){const id=el('station').value,t=el('time').value,row=rows.find(r=>r.id===id&&r.time===+t);
el('old').src=el('oldLink').href=before+'-'+id+'-'+t+'.png';el('new').src=el('newLink').href=after+'-'+id+'-'+t+'.png';
el('stats').textContent=row.drawCalls+' 描画 / '+row.instances.toLocaleString()+' インスタンス / '+row.triangles.toLocaleString()+' 三角形';}
el('station').onchange=el('time').onchange=show;el('split').oninput=()=>{const v=el('split').value+'%';el('new').style.clipPath='inset(0 0 0 '+v+')';el('divider').style.left=v;};show();
</script></html>`;
writeFileSync(new URL(after+'-review.html',dir),page);console.log(new URL(after+'-review.html',dir).pathname);
