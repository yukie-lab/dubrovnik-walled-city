import {readFileSync,writeFileSync} from 'node:fs';

// Fixed-view, pre-tonemap component metrology. Instrumentation is confined to
// the inspection browser; no sea-specific grading is added to the application.
export async function seaGlareCapture(page,{name,dir,rows,errors,args}) {
  const option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
  const photo=JSON.parse(readFileSync('docs/sea-calibration.json','utf8')).pose;
  const shelf=JSON.parse(readFileSync('docs/sea-clarity.json','utf8')).pose;
  const poses=[
    ...[['am',7.9],['noon',12.87],['gold',19.3],['sunset',19.85],['night',22.5]].map(([phase,time])=>
      ['parapet-'+phase,{position:[0,17.62,103],yaw:Math.PI,pitch:-.14,fov:52,time}]),
    ['harbour-noon',{position:[190,5.62,42],target:[183,-.5,34],fov:54,time:12.87}],
    ['limestone-noon',shelf],['photo',photo],
  ].filter(([id])=>!args.includes('--glare-view')||id.includes(option('--glare-view')));
  await page.setViewport({width:1200,height:800,deviceScaleFactor:1});
  await page.goto('http://localhost:8765/?shot=1&hud=0&time=12.87',{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:120000});
  if(args.includes('--sea-glare-prototype'))await page.evaluate(async path=>{
    const {applySeaGlarePrototype}=await import('/'+path);
    applySeaGlarePrototype(window.__world);
  },option('--sea-glare-prototype'));
  await page.evaluate(()=>{
    const w=window.__world,R=w.renderer,T=w.THREE,m=w.scene.getObjectByName('sea.surface').material;
    const original=m.fragmentShader,render=R.render.bind(R);
    m.uniforms.uGlareProbe={value:0};
    const marker='  bool ok =';
    if(original.split(marker).length!==2)throw new Error('Missing sea probe interface');
    m.fragmentShader='uniform float uGlareProbe;\n'+original.replace(marker,`
      if(uGlareProbe>.5) {
        vec3 air=atAerial(vec3(0.0),rayW*camD,cameraPosition);
        vec3 airT=atAerial(vec3(1.0),rayW*camD,cameraPosition)-air;
        float uncovered=1.0-foam*.82;
        if(uGlareProbe<1.5) col=atAerial((water*(1.0-F)+glit)*uncovered+foamCol*foam*.82,rayW*camD,cameraPosition);
        else if(uGlareProbe<2.5) col=atAerial(mix(water,refl,F)*uncovered+foamCol*foam*.82,rayW*camD,cameraPosition);
        else if(uGlareProbe<3.5) col=atAerial(mix(water,refl,F)+glit,rayW*camD,cameraPosition);
        else if(uGlareProbe<4.5) {gl_FragColor=vec4(dot(V,N),reflect(-V,N).y,F,foam);return;}
        else if(uGlareProbe<5.5) {
          const vec3 Y=vec3(.2126,.7152,.0722);
          gl_FragColor=vec4(dot(refl*F*uncovered*airT,Y),dot(glit*uncovered*airT,Y),dot(foamCol*foam*.82*airT,Y),1.0);return;
        } else {gl_FragColor=vec4(-1.0,2.0,-1.0,1.0);return;}
      }
      bool ok =`);
    m.needsUpdate=true;
    R.render=(s,c)=>{
      render(s,c);const rt=R.getRenderTarget();
      if(!w.__glareRead||s!==w.scene||c.layers.mask!==1||!rt||rt.width!==1200||rt.height!==800)return;
      const half=rt.texture.type===T.HalfFloatType;
      const input=half?new Uint16Array(1200*800*4):new Float32Array(1200*800*4);
      R.readRenderTargetPixels(rt,0,0,1200,800,input);
      const output=new Float32Array(input.length);
      for(let y=0;y<800;y++)for(let x=0;x<1200*4;x++) {
        const value=input[(799-y)*1200*4+x];output[y*1200*4+x]=half?T.DataUtils.fromHalfFloat(value):value;
      }
      w.__glarePixels=output;w.__glareRead=false;
    };
    w.__glareFrames={};
    w.__glareShot=async(mode,key)=>{
      m.uniforms.uGlareProbe.value=mode;w.__glareRead=true;
      const png=await window.__captureFrame();
      w.__glareFrames[key]={raw:w.__glarePixels};
      const im=new Image();im.src=png;await im.decode();
      const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;
      const context=canvas.getContext('2d');context.drawImage(im,0,0);
      w.__glareFrames[key].display=context.getImageData(0,0,1200,800).data;
      return png;
    };
    w.__glareRestore=()=>{R.render=render;m.fragmentShader=original;m.needsUpdate=true;};
  });
  for(const [id,pose] of poses) {
    await page.evaluate(async pose=>{
      const w=window.__world,p=w.player;
      w.__glareFrames={};w.scene.getObjectByName('sea.surface').material.uniforms.uGlareProbe.value=0;
      p.pose=c=>{c.position.fromArray(pose.position);c.up.set(0,1,0);
        if(pose.target)c.lookAt(...pose.target);else c.rotation.set(pose.pitch,pose.yaw,0);c.updateMatrixWorld();};
      p.groundY=p.smoothY=pose.position[1]-1.62;p.zone='wall';p.frozen=true;
      w.camera.fov=pose.fov;w.camera.updateProjectionMatrix();w.worldState.time=pose.time;
      let count=0;do{await window.__captureFrame();count++;}while((count<14||w.lighting.environment.pending)&&count<40);
    },pose);
    for(const [mode,key] of ['normal','noSky','noGlitter','noFoam','geometry','components','mask'].entries()) {
      const png=await page.evaluate(({mode,key})=>window.__world.__glareShot(mode,key),{mode,key});
      if(mode<4)writeFileSync(new URL(`${name}-${id}-${key}.png`,dir),Buffer.from(png.split(',')[1],'base64'));
    }
    const result=await page.evaluate(()=>{
      const w=window.__world,f=w.__glareFrames;
      const bright=(p,i)=>Math.min(p[i],p[i+1],p[i+2])>=160&&Math.max(p[i],p[i+1],p[i+2])-Math.min(p[i],p[i+1],p[i+2])<=45;
      let water=0,white=0,back=0,below=0;const components=[0,0,0],all=[0,0,0];
      const without={noSky:0,noGlitter:0,noFoam:0},removed={noSky:0,noGlitter:0,noFoam:0};
      for(let i=0;i<f.mask.raw.length;i+=4) {
        if(f.mask.raw[i]!==-1||f.mask.raw[i+1]!==2)continue;
        water++;const isWhite=bright(f.normal.display,i);
        for(let k=0;k<3;k++)all[k]+=f.components.raw[i+k];
        if(isWhite) {white++;back+=f.geometry.raw[i]<=0;below+=f.geometry.raw[i+1]<=0;
          for(let k=0;k<3;k++)components[k]+=f.components.raw[i+k];}
        for(const key of Object.keys(without)) {const yes=bright(f[key].display,i);without[key]+=yes;removed[key]+=isWhite&&!yes;}
      }
      const sum=components.reduce((a,b)=>a+b,0);
      return {waterPixels:water,whitePixels:white,whitePercent:100*white/water,
        whiteBackfacingPercent:100*back/Math.max(1,white),whiteBelowHorizonReflectionPercent:100*below/Math.max(1,white),
        whiteRadianceShare:{sky:components[0]/sum,glitter:components[1]/sum,foam:components[2]/sum},
        meanComponentRadiance:all.map(x=>x/water),withoutWhitePixels:without,removedWhitePixels:removed,
        exposure:w.renderer.toneMappingExposure,...window.__RENDER_STATS,gpuError:w.renderer.getContext().getError()};
    });
    rows.push({view:'sea-glare',id,pose,...result});console.log(JSON.stringify(rows.at(-1)));
    if(result.gpuError)errors.push('Sea glare GPU error');
  }
  await page.evaluate(()=>window.__world.__glareRestore());
  writeFileSync(new URL(name+'-glare.json',dir),JSON.stringify({
    whiteDefinition:'sRGB min channel >= 160 and max-min <= 45; exact pre-tonemap water-only mask',rows:rows.filter(r=>r.view==='sea-glare')},null,2)+'\n');
}
