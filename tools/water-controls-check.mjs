import {writeFileSync} from 'node:fs';
export async function waterControlsCheck(page,{name,dir,rows,errors}) {
  await page.setViewport({width:1400,height:950,deviceScaleFactor:1});
  await page.goto('http://localhost:8765/?shot=1&time=12.87&x=0&z=103&gy=16&yaw=3.14159265&pitch=-.14&fov=52',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
  await page.click('#waterOptics summary');
  const result=await page.evaluate(async()=>{
    const w=window.__world,api=window.__waterOptics,panel=document.getElementById('waterOptics');
    const initial=api.values,inputs=[...panel.querySelectorAll('input[type=number]')];
    inputs[1].value=.195;inputs[1].dispatchEvent(new Event('change',{bubbles:true}));
    inputs[5].value=.00019;inputs[5].dispatchEvent(new Event('change',{bubbles:true}));
    inputs[6].value=.18;inputs[6].dispatchEvent(new Event('change',{bubbles:true}));
    for(let i=0;i<16;i++)await window.__captureFrame();
    const actual=w.scene.getObjectByName('sea.surface').material.uniforms;
    const changed=api.values,sigma=actual.uSigma.value.toArray(),scatter=actual.uInscat.value.toArray(),bottomScale=actual.uBottomAlbedoScale.value;
    const numbers=inputs.map(i=>Number(i.value));
    panel.querySelector('.waterPause input').click();const paused=w.worldState.paused;
    panel.querySelector('[data-action=baseline]').click();await window.__captureFrame();const baseline=api.values;
    panel.querySelector('[data-action=reset]').click();await window.__captureFrame();const restored=api.values;
    const exportValue=JSON.parse(panel.querySelector('textarea').value);
    return {initial,changed,sigma,scatter,bottomScale,numbers,paused,baseline,restored,exportValue,
      inputCount:inputs.length,panelBounds:panel.getBoundingClientRect().toJSON(),
      mapPresent:!!document.querySelector('#map canvas'),titlePresent:!!document.querySelector('#title'),
      debugPresent:!!document.querySelector('#debug'),gpuError:w.renderer.getContext().getError()};
  });
  await page.screenshot({path:new URL(name+'-water-controls.png',dir).pathname});
  const correct=result.inputCount===7&&result.changed.extinction[1]===.195&&result.changed.backscatter[2]===.00019
    &&result.changed.bottomAlbedo===.18&&result.bottomScale===.6
    &&result.sigma[1]===.195&&result.paused&&JSON.stringify(result.initial)===JSON.stringify(result.restored)
    &&JSON.stringify(result.restored)===JSON.stringify(result.exportValue)&&result.mapPresent&&result.titlePresent&&result.debugPresent;
  if(!correct||result.gpuError)errors.push('Live water controls failed');
  rows.push({view:'water-controls',correct,...result});console.log(JSON.stringify(rows.at(-1)));
}
