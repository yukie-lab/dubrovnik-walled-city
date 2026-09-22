export function makeWaterControls(optics,clock) {
  const panel=document.createElement('details');panel.id='waterOptics';
  panel.innerHTML=`<summary>海の光学</summary><div class="waterBody">
    <p>減衰を上げると海底から届く光が減り、散乱を上げると水中から戻る光が増えます。</p>
    <label class="waterPause"><input type="checkbox"> 時刻を止めて比較</label>
    <div class="waterFields"></div>
    <div class="waterActions"><button type="button" data-action="reset">既定値へ戻す</button>
      <button type="button" data-action="baseline">開始時の係数</button></div>
    <label class="waterExport">現在の係数<textarea readonly rows="6" spellcheck="false"></textarea></label>
  </div>`;
  const fields=panel.querySelector('.waterFields'),inputs=[];
  const names=['赤の帯域','緑の帯域','青の帯域'];
  for(const [key,title,unit,limits]of [
    ['extinction','減衰','m⁻¹',[[.04,2.0],[.008,.5],[.003,.3]]],
    ['backscatter','後方への体積散乱','m⁻¹ sr⁻¹',[[1e-7,.004],[1e-7,.004],[1e-7,.004]]],
  ]) {
    const set=document.createElement('fieldset'),legend=document.createElement('legend');
    legend.textContent=`${title} (${unit})`;set.appendChild(legend);fields.appendChild(set);
    names.forEach((name,index)=>{
      const row=document.createElement('label'),[lo,hi]=limits[index];
      row.innerHTML=`<span>${name}</span><input type="number" min="0" step="any" aria-label="${title} ${name} の係数">
        <input type="range" min="0" max="1000" step="1" aria-label="${title} ${name}">`;
      const number=row.querySelector('[type=number]'),range=row.querySelector('[type=range]');
      const apply=value=>{const values=optics.values;values[key][index]=value;optics.set(values);};
      number.addEventListener('change',()=>{
        const value=Number(number.value);
        if(Number.isFinite(value)&&value>=(key==='extinction'?1e-5:0))apply(value);
        else update(optics.values);
      });
      range.addEventListener('input',()=>apply(lo*(hi/lo)**(Number(range.value)/1000)));
      inputs.push({key,index,number,range,lo,hi});set.appendChild(row);
    });
  }
  {
    const set=document.createElement('fieldset');
    set.innerHTML='<legend>海底の拡散反射率</legend><label><span>石灰岩の基準値</span><input type="number" min="0" max="1" step=".01" aria-label="海底の反射率"><input type="range" min="0" max="1000" step="1" aria-label="海底の反射率スライダー"></label>';
    const number=set.querySelector('[type=number]'),range=set.querySelector('[type=range]');
    number.addEventListener('change',()=>{
      const value=Number(number.value);
      if(Number.isFinite(value)&&value>=0&&value<=1)optics.set({bottomAlbedo:value});else update(optics.values);
    });
    range.addEventListener('input',()=>optics.set({bottomAlbedo:Number(range.value)/1000}));
    inputs.push({key:'bottomAlbedo',number,range,lo:0,hi:1,linear:true});fields.appendChild(set);
  }
  function update(values) {
    for(const {key,index,number,range,lo,hi,linear}of inputs) {
      const value=index===undefined?values[key]:values[key][index];number.value=Number(value.toPrecision(6));
      range.value=linear?value*1000:Math.max(0,Math.min(1000,Math.log(Math.max(lo,value)/lo)/Math.log(hi/lo)*1000));
    }
    panel.querySelector('textarea').value=JSON.stringify(values,null,2);
  }
  optics.subscribe(update);update(optics.values);
  panel.querySelector('[data-action=reset]').addEventListener('click',()=>optics.reset());
  panel.querySelector('[data-action=baseline]').addEventListener('click',()=>optics.baseline());
  const pause=panel.querySelector('.waterPause input');
  pause.addEventListener('change',()=>clock.setPaused(pause.checked));
  panel.addEventListener('toggle',()=>{pause.checked=clock.getPaused();});
  for(const event of ['keydown','keyup','pointerdown'])panel.addEventListener(event,e=>e.stopPropagation());
  const host=document.getElementById('hud');host.insertBefore(panel,document.getElementById('map'));
  return panel;
}
