import {writeFileSync} from 'node:fs';

export async function shaderTransitionCheck(page,{name,dir,rows,errors}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&x=0&z=103&gy=16&yaw=3.14159265&pitch=-.14&fov=52&time=19.3',
    {waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
  const result=await page.evaluate(async()=>{
    const w=window.__world,r=w.renderer,draw=r.renderBufferDirect,events=[],snapshots=[];
    do{await window.__captureFrame();}while(w.lighting.environment.pending);
    const known=new Set(r.info.programs.map(p=>p.id));
    r.renderBufferDirect=function(camera,scene,geometry,material,object,group) {
      const value=draw.call(this,camera,scene,geometry,material,object,group);
      const fresh=r.info.programs.filter(p=>!known.has(p.id));
      for(const p of fresh) {
        known.add(p.id);events.push({time:w.worldState.time,object:object.name||object.type,
          shadow:scene===null,material:material.type,side:material.side,
          id:p.id,key:p.cacheKey,vertex:r.getContext().getShaderSource(p.vertexShader),
          fragment:r.getContext().getShaderSource(p.fragmentShader)});
      }
      return value;
    };
    try {
      for(const time of [19.3,19.59,19.61,19.85,20.59,20.6105,20.65,22.5,19.3]) {
        w.worldState.time=time;
        do{await window.__captureFrame();}while(w.lighting.environment.pending);
        snapshots.push({time,programs:r.info.programs.length,calls:window.__RENDER_STATS.drawCalls});
      }
      return {events,snapshots,gpuError:r.getContext().getError()};
    } finally {r.renderBufferDirect=draw;}
  });
  writeFileSync(new URL(name+'-shader-transition.json',dir),JSON.stringify(result,null,2)+'\n');
  const row={view:'shader-transition',snapshots:result.snapshots,
    events:result.events.map(({vertex,fragment,key,...e})=>e),gpuError:result.gpuError};
  rows.push(row);console.log(JSON.stringify(row));
  if(result.events.length||result.gpuError)errors.push('Unexpected shader compilation after startup');
}
