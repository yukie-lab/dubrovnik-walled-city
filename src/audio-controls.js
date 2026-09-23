// One user preference, shared by the title and walking controls. Construct the
// audio graph inside the first gesture; labels follow the actual context state.
export function makeAudioControls(audio,buttons) {
  buttons=buttons.filter(Boolean);
  function sync() {
    const state=audio.muted?'off':audio.ctx?.state==='running'?'playing':audio.ctx?'ready':'idle';
    for(const button of buttons) {
      button.textContent=state==='playing'?'SOUND ON':state==='off'?'SOUND OFF':state==='idle'?'SOUND START':'SOUND RETRY';
      button.dataset.audioState=state;
      button.setAttribute('aria-pressed',String(state==='playing'));
      button.setAttribute('aria-label',state==='playing'?'音を消す':state==='off'?'音を再生する':'音を開始・再開する');
      button.title=state==='playing'?'音を消す':'音を開始・再開する';
    }
  }
  audio.onStateChange=sync;sync();
  const isSoundControl=target=>buttons.some(button=>button.contains(target));
  function arm(event) {
    // The button owns pointer activation and Enter/Space. Movement keys must
    // still resume sound if keyboard focus remained on that same button.
    const activatesSoundControl=isSoundControl(event.target)&&
      (event.type!=='keydown'||event.code==='Enter'||event.code==='Space');
    if(audio.muted||activatesSoundControl)return;
    if(!audio.ctx||audio.ctx.state!=='running')audio.start();
  }
  for(const type of ['pointerdown','keydown','click'])addEventListener(type,arm,{capture:true});
  for(const button of buttons)button.addEventListener('click',event=>{
    event.stopPropagation();
    if(!audio.muted&&audio.ctx?.state==='running')audio.setMuted(true);
    else {audio.setMuted(false);audio.start();}
  });
  // Returning from a background tab, device interruption, or back/forward
  // cache retries an already requested sound. A denied resume leaves a clear
  // retry control and can still be unlocked by the next click or key press.
  const recover=()=>{
    if(document.visibilityState==='visible'&&audio.ctx&&!audio.muted&&audio.ctx.state!=='running')audio.start();
  };
  document.addEventListener('visibilitychange',recover);
  addEventListener('focus',recover);addEventListener('pageshow',recover);
  return {sync};
}
