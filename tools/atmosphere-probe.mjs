import {writeFileSync} from 'node:fs';
export async function atmosphereProbe(page,{name,dir,rows,errors,args}) {
  page.on('console',m=>{if(m.type()==='warn')console.log('GPU warning:',m.text().slice(0,2400));});
  await page.evaluateOnNewDocument(()=>{
    window.__glTrace=[];
    for(const key of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced','readPixels','texImage2D','texStorage2D','generateMipmap']) {
      const proto=WebGL2RenderingContext.prototype,original=proto[key];
      proto[key]=function(...a){const result=original.apply(this,a),error=this.getError();
        if(error&&window.__glTrace.length<20)window.__glTrace.push({key,error,stack:new Error().stack});return result;};
    }
  });
  const base='http://localhost:8765/index.html?shot=1&hud=0&x=0&z=103&gy=16&yaw=3.1416&pitch=-.14&fov=52';
  const index=args.indexOf('--time'),time=index>=0?Number(args[index+1]):21.2;
  await page.goto(base+'&time='+time,{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
  for(let i=0;i<6;i++)await page.evaluate(()=>window.__captureFrame());
  const data=await page.evaluate(()=>{
    const w=window.__world,a=w.atmosphere,r=w.renderer,result={};
    for(const [name,rt]of Object.entries(a.targets)) {
      const p=new Float32Array(rt.width*rt.height*4);r.readRenderTargetPixels(rt,0,0,rt.width,rt.height,p);
      let min=Infinity,max=-Infinity,nan=0;for(let i=0;i<p.length;i++){if(i%4===3)continue;if(!Number.isFinite(p[i]))nan++;else {min=Math.min(min,p[i]);max=Math.max(max,p[i]);}}
      const samples=[0,Math.floor(rt.width/2),rt.width*(rt.height-1)+Math.floor(rt.width/2)].map(i=>Array.from(p.slice(i*4,i*4+4)));
      result[name]={min,max,nan,samples};
    }
    return {LUT:result,glTrace:window.__glTrace,sun:w.sunState,light:w.lighting.state,stats:window.__RENDER_STATS,
      keyLight:{intensity:w.lighting.sun.intensity,colour:w.lighting.sun.color,position:w.lighting.sun.position},
      camera:w.camera.position,exposure:r.toneMappingExposure};
  });
  rows.push(data);console.log(JSON.stringify({...data,glTrace:data.glTrace.slice(0,1)},null,2));
  const png=await page.evaluate(()=>window.__captureFrame());
  writeFileSync(new URL(name+'-probe.png',dir),Buffer.from(png.split(',')[1],'base64'));
  if(data.glTrace.length)errors.push('Atmosphere GPU errors: '+JSON.stringify(data.glTrace.slice(0,1)));
}
