import {writeFileSync} from 'node:fs';

export async function radianceStorageCheck(page,{name,dir,rows,errors}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&time=22.5',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
  const result=await page.evaluate(async()=>{
    const w=window.__world,T=w.THREE,r=w.renderer;
    const {FullScreenQuad}=await import('three/addons/postprocessing/Pass.js');
    const {ShaderPass}=await import('three/addons/postprocessing/ShaderPass.js');
    const {MesopicShader}=await import('/src/mesopic.js');
    const {patchRadianceStorage,RadianceOutputPass}=await import('/src/radiance-storage.js');
    const levels=[1e-12,1e-10,1e-9,1e-8,1e-7,1e-6,1e-5,1e-4,.001,.01,.1,1,4];
    const colours=[[1,1,1],[1,.2,.05],[.1,1,.2],[.05,.2,1]],width=levels.length,height=colours.length;
    const data=new Float32Array(colours.flatMap(c=>levels.flatMap(v=>[...c.map(k=>k*v),1])));
    const texture=new T.DataTexture(data,width,height,T.RGBAFormat,T.FloatType);texture.needsUpdate=true;
    const unit={value:1},material=new T.ShaderMaterial({toneMapped:false,depthWrite:false,depthTest:false,
      uniforms:{tSource:{value:texture}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader:'varying vec2 vUv;uniform sampler2D tSource;void main(){gl_FragColor=texture2D(tSource,vUv);if(vUv.x<.5)return;}'
    });
    patchRadianceStorage(material,unit);
    const quad=new FullScreenQuad(material),mesopic=new ShaderPass(MesopicShader),output=new RadianceOutputPass(unit);
    mesopic.uniforms.uRadianceScale=unit;
    const oldExposure=r.toneMappingExposure,oldTarget=r.getRenderTarget(),transfer=[];
    const run=(type,scale)=>{
      unit.value=scale;
      const scene=new T.WebGLRenderTarget(width,height,{type,depthBuffer:false}),observer=scene.clone();
      const display=new T.WebGLRenderTarget(width,height,{type:T.UnsignedByteType,depthBuffer:false});
      r.setRenderTarget(scene);quad.render(r);mesopic.render(r,observer,scene);output.render(r,display,observer);
      const pixels=new Uint8Array(width*height*4);r.readRenderTargetPixels(display,0,0,width,height,pixels);
      [scene,observer,display].forEach(t=>t.dispose());return pixels;
    };
    for(const exposure of [.6,30,4500,12000]) {
      r.toneMappingExposure=exposure;const reference=run(T.FloatType,1);
      for(const scale of [1,32,512,4096,8192]) {
        const actual=run(T.HalfFloatType,scale);let maxError=0,sum=0,count=0;
        for(let i=0;i<actual.length;i++)if(i%4!==3){const error=Math.abs(actual[i]-reference[i]);maxError=Math.max(maxError,error);sum+=error;count++;}
        transfer.push({exposure,scale,maxByteError:maxError,meanByteError:sum/count});
      }
    }
    r.toneMappingExposure=oldExposure;r.setRenderTarget(oldTarget);
    texture.dispose();material.dispose();quad.dispose();mesopic.dispose();output.dispose();
    const environments=[];
    for(const time of [12.87,19.85,20.65,22.5]) {
      w.worldState.time=time;do{await window.__captureFrame();}while(w.lighting.environment.pending);
      const environment=w.lighting.environment,actual=environment.target;
      // An independently executed native PMREM in Float32, with physical units
      // throughout. The production schedule/half-float path is not reused.
      const native=new T.PMREMGenerator(r),allocate=native._allocateTargets;
      native._allocateTargets=function(){const rt=allocate.call(this);rt.texture.type=T.FloatType;
        this._pingPongRenderTarget.texture.type=T.FloatType;return rt;};
      const envScale=w.lighting.envUniforms.uEnvScale,storedScale=envScale.value;envScale.value=1;
      let reference;
      try{reference=native.fromScene(environment.scene,.04,.1,100,{size:128});}
      finally{envScale.value=storedScale;}
      const a=new Uint16Array(actual.width*actual.height*4),b=new Float32Array(a.length);
      r.readRenderTargetPixels(actual,0,0,actual.width,actual.height,a);
      r.readRenderTargetPixels(reference,0,0,reference.width,reference.height,b);
      let error2=0,ref2=0,erased=0,nonfinite=0;
      for(let i=0;i<a.length;i++)if(i%4!==3){
        const observed=T.DataUtils.fromHalfFloat(a[i])/environment.scale,expected=b[i];
        if(!Number.isFinite(observed)||!Number.isFinite(expected))nonfinite++;
        error2+=(observed-expected)**2;ref2+=expected**2;if(observed===0&&expected>1e-12)erased++;
      }
      environments.push({time,scale:environment.scale,relativeRms:Math.sqrt(error2/ref2),erased,nonfinite});
      reference.dispose();native.dispose();
    }
    return {transfer,environments,gpuError:r.getContext().getError()};
  });
  rows.push({view:'radiance-storage',...result});console.log(JSON.stringify(result));
  writeFileSync(new URL(name+'-radiance.json',dir),JSON.stringify(result,null,2)+'\n');
  if(result.gpuError||result.environments.some(x=>x.erased||x.nonfinite||x.relativeRms>.01))
    errors.push('Radiance environment differs from independent Float32 reference');
  if(result.transfer.some(x=>x.scale>=4096&&x.maxByteError>1))
    errors.push('Stored radiance or absolute-luminance observer response changes display colour');
}
