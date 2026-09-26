import {writeFileSync} from 'node:fs';

// Hash physical Float32 diagnostics before storage quantization, bloom or
// display encoding. This distinguishes an optical change from a precision fix.
export async function seaPrecisionProbe(page,{name,dir,rows,errors}) {
  await page.setViewport({width:1200,height:800,deviceScaleFactor:1});
  await page.goto('http://localhost:8765/?shot=1&hud=0&time=12.87',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
  const poses=[['parapet',{position:[0,17.62,103],yaw:Math.PI,pitch:-.14,fov:52}],
    ['shelf',{position:[190,5.62,42],target:[183,-.5,34],fov:54}]];
  for(const [view,pose]of poses)for(const time of [12.87,19.3,19.85,22.5]) {
    const result=await page.evaluate(async({pose,time})=>{
      const w=window.__world,T=w.THREE,r=w.renderer,p=w.player;
      p.pose=c=>{c.position.fromArray(pose.position);c.up.set(0,1,0);
        if(pose.target)c.lookAt(...pose.target);else c.rotation.set(pose.pitch,pose.yaw,0);c.updateMatrixWorld();};
      p.groundY=p.smoothY=pose.position[1]-1.62;p.zone='wall';p.frozen=true;
      w.camera.fov=pose.fov;w.camera.updateProjectionMatrix();w.worldState.time=time;
      let frames=0;do{await window.__captureFrame();frames++;}while(frames<14||w.lighting.environment.pending);
      const rt=new T.WebGLRenderTarget(1200,800,{type:T.FloatType}),oldTarget=r.getRenderTarget();
      const material=w.scene.getObjectByName('sea.surface').material,original=material.fragmentShader,debug=material.uniforms.uDebug.value;
      const scale=w.radianceStorage?.scale.value??1,n=rt.width*rt.height,data=new Float32Array(n*4),mask=new Uint8Array(n),diagnostics=[];
      const read=()=>{r.setRenderTarget(rt);r.clear();r.render(w.scene,w.camera);r.readRenderTargetPixels(rt,0,0,rt.width,rt.height,data);};
      try {
        const marker='  bool ok =';
        if(original.split(marker).length!==2)throw new Error('Water mask interface changed');
        material.fragmentShader=original.replace(marker,'  gl_FragColor=vec4(-1.0,2.0,-1.0,1.0);return;\n'+marker);material.needsUpdate=true;
        read();let count=0;
        for(let i=0;i<n;i++)if(data[i*4]===-scale&&data[i*4+1]===2*scale&&data[i*4+2]===-scale){mask[i]=1;count++;}
        material.fragmentShader=original;material.needsUpdate=true;
        if(!count)throw new Error('Empty physical water mask');
        for(const mode of [2,3,4,5,8,12]) {
          material.uniforms.uDebug.value=mode;read();
          const values=new Float32Array(count*3);let at=0,maximum=0,nonfinite=0;
          for(let i=0;i<n;i++)if(mask[i])for(let c=0;c<3;c++){
            const value=data[i*4+c]/scale;values[at++]=value;maximum=Math.max(maximum,value);nonfinite+=!Number.isFinite(value);
          }
          // Digest only after the render target has been restored: await must
          // never leave the application's next animation frame in this target.
          r.setRenderTarget(oldTarget);
          const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',values))].map(v=>v.toString(16).padStart(2,'0')).join('');
          diagnostics.push({mode,pixels:count,hash,maximum,nonfinite});
        }
      }finally{material.fragmentShader=original;material.uniforms.uDebug.value=debug;material.needsUpdate=true;r.setRenderTarget(oldTarget);rt.dispose();}
      return {time,storageScale:scale,diagnostics,gpuError:r.getContext().getError()};
    },{pose,time});
    rows.push({view:'sea-transport-'+view,...result});console.log(JSON.stringify(rows.at(-1)));
    if(result.gpuError||result.diagnostics.some(x=>x.nonfinite))errors.push('Invalid physical water diagnostic');
  }
  writeFileSync(new URL(name+'-transport.json',dir),JSON.stringify(rows,null,2)+'\n');
}
