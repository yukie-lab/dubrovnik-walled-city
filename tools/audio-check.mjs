import {writeFileSync} from 'node:fs';

// Real WebAudio graph and trusted mouse/key input. Browser output remains
// muted by headless Chrome; the analyser measures the final destination signal.
export async function audioCheck(page,{name,dir,rows,errors,args}) {
  await page.evaluateOnNewDocument(()=>{
    const connect=AudioNode.prototype.connect;
    AudioNode.prototype.connect=function(destination,...rest) {
      if(destination===this.context.destination)window.__audioOutput=this;
      return connect.call(this,destination,...rest);
    };
  });
  await page.goto('http://localhost:8765/?flow=0',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__audio',{timeout:120000});
  async function sample(stage) {
    const result=await page.evaluate(async()=>{
      const a=window.__audio;
      if(a.ctx&&(!window.__audioMeter||window.__audioMeter.context!==a.ctx)) {
        const meter=a.ctx.createAnalyser();meter.fftSize=4096;
        window.__audioOutput.connect(meter);window.__audioMeter=meter;
      }
      const meter=window.__audioMeter,data=new Float32Array(4096);let peak=0,sum=0,n=0;
      // Let the analyser's previous 4096-sample window leave the buffer after
      // muting. Suspended contexts retain that buffer; it is not live output.
      await new Promise(r=>setTimeout(r,200));
      const time=a.ctx?.currentTime;
      for(let k=0;k<16;k++) {
        await new Promise(r=>setTimeout(r,50));meter?.getFloatTimeDomainData(data);
        for(const x of data){sum+=x*x;peak=Math.max(peak,Math.abs(x));n++;}
      }
      const buttons=[...document.querySelectorAll('#btnSound, #btnSoundWalk')].map(b=>({
        id:b.id,text:b.textContent,visible:(()=>{const r=b.getBoundingClientRect();
          return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})(),
        state:b.dataset.audioState,pressed:b.getAttribute('aria-pressed')}));
      const advancedSeconds=a.ctx?a.ctx.currentTime-time:0;
      return {context:a.ctx?.state??null,muted:a.muted,masterGain:a.master?.gain.value,
        audioError:a.error?.name??null,
        advancedSeconds,rms:advancedSeconds>0?Math.sqrt(sum/n):0,bufferedRms:Math.sqrt(sum/n),peak,buttons,
        footsteps:window.__audioFootsteps??0,
        titleHidden:document.getElementById('title').classList.contains('hidden'),
        gains:Object.fromEntries(['seaLow','seaWash','wind','windHigh','crowd','crowdHi','fount'].map(k=>[k,a[k]?.gain.value])),
        bootError:document.getElementById('bootErr').textContent};
    });
    const record={view:'audio',stage,...result};rows.push(record);console.log(JSON.stringify(record));return record;
  }
  await sample('before-interaction');
  await page.screenshot({path:new URL(name+'-audio-title.png',dir).pathname});
  await page.click('#btnSound');
  await sample('title-sound-click');
  if(await page.evaluate(()=>window.__audio.ctx?.state!=='running'))await page.click('#btnSound');
  await page.click('#btnSound');
  await sample('title-muted');
  await page.click('#btnStart');
  await page.waitForFunction("document.getElementById('title').classList.contains('hidden')",{timeout:30000});
  await page.evaluate(()=>document.exitPointerLock?.());
  await sample('entered-while-muted');
  if(await page.evaluate(()=>window.__audio.muted||window.__audio.ctx?.state!=='running')) {
    if(await page.$('#btnSoundWalk'))await page.click('#btnSoundWalk');
    else await page.evaluate(()=>document.getElementById('btnSound').click());
  }
  await sample('walking-sound-on');
  await page.screenshot({path:new URL(name+'-audio-walking.png',dir).pathname});
  await page.evaluate(()=>{
    const player=window.__world.player,step=player.onStep;window.__audioFootsteps=0;
    player.onStep=(...args)=>{window.__audioFootsteps++;step(...args);};
  });
  await page.keyboard.down('KeyW');
  await sample('walking-forward');
  await page.keyboard.up('KeyW');
  await page.evaluate(async()=>window.__audio.ctx.suspend());
  await sample('browser-suspended');
  await page.keyboard.press('KeyW');
  await sample('gesture-resumed');
  await page.evaluate(async()=>{
    const c=window.__audio.ctx;await c.suspend();window.__nativeResume=c.resume.bind(c);
    c.resume=()=>Promise.reject(new DOMException('Inspection: resume denied','NotAllowedError'));
  });
  await page.keyboard.press('KeyN');
  await sample('resume-rejected');
  await page.evaluate(()=>{window.__audio.ctx.resume=window.__nativeResume;});
  await page.keyboard.press('KeyN');
  await sample('retry-after-rejection');
  await page.evaluate(async()=>window.__audio.ctx.close());
  await page.keyboard.press('KeyW');
  await sample('closed-context-recovery');
  if(await page.$('#btnSoundWalk')) {
    await page.click('#btnSoundWalk');
    await page.keyboard.down('Shift');await page.keyboard.press('Digit1');await page.keyboard.up('Shift');
    await sample('muted-automatic-route');
    await page.focus('#btnSoundWalk');
    await page.keyboard.press('Space');
    await sample('keyboard-sound-on');
    await page.keyboard.press('Enter');
    await sample('keyboard-sound-off');
  }
  // The usual entry path must work without touching a sound button first.
  await page.goto('http://localhost:8765/?flow=0',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__audio',{timeout:120000});
  await page.click('#btnStart');
  await sample('default-entry-descent');
  await page.waitForFunction("document.getElementById('title').classList.contains('hidden')",{timeout:30000});
  await page.evaluate(()=>document.exitPointerLock?.());
  await sample('default-entry-arrived');
  writeFileSync(new URL(name+'-audio.json',dir),JSON.stringify(rows.filter(r=>r.view==='audio'),null,2)+'\n');
  if(args.includes('--audio-strict')) {
    const get=stage=>rows.find(r=>r.stage===stage),audible=stage=>{const r=get(stage);return r.context==='running'&&r.rms>1e-5;};
    for(const stage of ['title-sound-click','walking-sound-on','walking-forward','gesture-resumed','retry-after-rejection','closed-context-recovery','keyboard-sound-on','default-entry-descent','default-entry-arrived'])
      if(!audible(stage))errors.push('No audio output at '+stage);
    for(const stage of ['title-muted','entered-while-muted','muted-automatic-route','keyboard-sound-off'])if(get(stage)?.rms>1e-6||!get(stage)?.muted)errors.push('Mute lost at '+stage);
    if(!get('walking-sound-on').buttons.some(b=>b.visible))errors.push('No visible sound control after entry');
    if(get('walking-forward').footsteps<1)errors.push('No real walking footsteps');
    if(get('resume-rejected').bootError)errors.push('Resume rejection reached fatal loading overlay');
    if(get('resume-rejected').audioError!=='NotAllowedError')errors.push('Resume rejection was not exercised');
    if(get('resume-rejected').buttons.some(b=>b.text==='SOUND ON'))errors.push('Sound displayed as playing while suspended');
  }
}
