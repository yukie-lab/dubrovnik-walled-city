import {writeFileSync} from 'node:fs';

// Compare identical physical scene radiance in float32 and float16 targets.
// No material, source, exposure or tone-curve changes between the two renders.
export async function nightPrecisionCheck(page,{name,dir,rows,errors,args}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&time=22.5', {waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
  const result=await page.evaluate(async()=>{
    const w=window.__world,T=w.THREE,r=w.renderer;
    const {RadianceOutputPass}=await import('/src/radiance-storage.js');
    const stations=w.plan.WALL_STAIRS.map(st=>{
      const lengths=st.pts.slice(1).map((b,i)=>Math.hypot(b[0]-st.pts[i][0],b[1]-st.pts[i][1]));
      let distance=lengths.reduce((a,b)=>a+b,0)*.4,i=0;
      while(distance>lengths[i]&&i<lengths.length-1)distance-=lengths[i++];
      const a=st.pts[i],b=st.pts[i+1],t=distance/lengths[i];
      return {id:st.id,x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,gy:a[2]+(b[2]-a[2])*t,
        yaw:Math.atan2(a[0]-b[0],a[1]-b[1])};
    });
    const width=640,height=400,n=width*height;
    const targets=[T.HalfFloatType,T.FloatType].map(type=>new T.WebGLRenderTarget(width,height,{type}));
    const arrays=[new Uint16Array(n*4),new Float32Array(n*4)],out=[];
    for(const s of stations) {
      const g=w.plan.walkingGroundAt(s.x,s.z,s.gy),p=w.player;
      Object.assign(p,{x:s.x,z:s.z,groundY:g.y,smoothY:g.y,zone:g.zone,stair:g.stair??null,
        stairLift:null,stairBlend:g.stair?1:0,yaw:s.yaw,pitch:.045,vx:0,vz:0,bobAmp:0,frozen:true});
      w.camera.fov=60;w.camera.updateProjectionMatrix();
      do{await window.__captureFrame();}while(w.lighting.environment.pending);
      const oldTarget=r.getRenderTarget();
      for(let k=0;k<2;k++) {
        r.setRenderTarget(targets[k]);r.clear();r.render(w.scene,w.camera);
        r.readRenderTargetPixels(targets[k],0,0,width,height,arrays[k]);
      }
      const scale=w.radianceStorage?.scale??{value:1};
      const metrics={all:{pixels:0,erased:0,halfZero:0,floatZero:0,floatY:0,halfY:0,squaredError:0,squaredReference:0},
        treadRegion:{pixels:0,erased:0,halfZero:0,floatZero:0,floatY:0,halfY:0,squaredError:0,squaredReference:0}};
      for(let i=0;i<n;i++) {
        const a=arrays[0],b=arrays[1],j=i*4;
        const hy=(T.DataUtils.fromHalfFloat(a[j])*.2126+T.DataUtils.fromHalfFloat(a[j+1])*.7152+T.DataUtils.fromHalfFloat(a[j+2])*.0722)/scale.value;
        const fy=(b[j]*.2126+b[j+1]*.7152+b[j+2]*.0722)/scale.value;
        for(const [key,m]of Object.entries(metrics)) {
          if(key==='treadRegion'&&(i%width<width*.25||i%width>=width*.85||Math.floor(i/width)>height*.35))continue;
          m.pixels++;m.erased+=hy===0&&fy>1e-12;m.halfZero+=hy===0;m.floatZero+=fy===0;m.floatY+=fy;m.halfY+=hy;
          m.squaredError+=(hy-fy)**2;m.squaredReference+=fy**2;
        }
      }
      for(const m of Object.values(metrics)){
        m.floatY/=m.pixels;m.halfY/=m.pixels;m.relativeRms=Math.sqrt(m.squaredError/m.squaredReference);
        delete m.squaredError;delete m.squaredReference;
      }
      const row={id:s.id,exposure:w.lighting.state.exposure,storageScale:scale.value,metrics,gpuError:r.getContext().getError()};
      if(s.id==='mincetaShaft'||s.id==='ploceStair') {
        row.images=[];
        const output=new RadianceOutputPass(scale);output.renderToScreen=true;
        for(let k=0;k<2;k++) {output.render(r,null,targets[k]);row.images.push(r.domElement.toDataURL('image/png'));}
        output.dispose();
      }
      r.setRenderTarget(oldTarget);out.push(row);
    }
    targets.forEach(t=>t.dispose());return out;
  });
  for(const row of result) {
    row.images?.forEach((png,k)=>writeFileSync(new URL(`${name}-${row.id}-${k?'float32':'float16'}.png`,dir),Buffer.from(png.split(',')[1],'base64')));
    delete row.images;rows.push({view:'night-precision',...row});console.log(JSON.stringify(row));
    if(row.gpuError)errors.push('Night precision render error');
    if(args.includes('--precision-strict')&&(row.metrics.all.erased||row.metrics.all.relativeRms>.001))
      errors.push('Night radiance was lost in '+row.id);
  }
  writeFileSync(new URL(name+'-precision.json',dir),JSON.stringify(result,null,2)+'\n');
}
