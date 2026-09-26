import {writeFileSync} from 'node:fs';

// Diagnose the exposure meter against actual sky/source visibility at the
// stone surface. This changes neither the light sources nor the exposure.
export async function stairIlluminanceProbe(page,{name,dir,rows,errors,args}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&time=22.5',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
  const stations=await page.evaluate(()=>window.__world.plan.WALL_STAIRS.flatMap(st=>{
    const lengths=st.pts.slice(1).map((b,i)=>Math.hypot(b[0]-st.pts[i][0],b[1]-st.pts[i][1]));
    return [.2,.4,.8].map(f=>{
      let distance=lengths.reduce((a,b)=>a+b,0)*f,i=0;
      while(distance>lengths[i]&&i<lengths.length-1)distance-=lengths[i++];
      const a=st.pts[i],b=st.pts[i+1],t=distance/lengths[i];
      return {id:st.id,f,x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,gy:a[2]+(b[2]-a[2])*t,
        yaw:Math.atan2(a[0]-b[0],a[1]-b[1])};
    });
  }));
  const times=args.includes('--meter-times')?args[args.indexOf('--meter-times')+1].split(',').map(Number):[12.87,22.5];
  for(const time of times)for(const s of stations) {
    const result=await page.evaluate(async({s,time})=>{
      const w=window.__world,T=w.THREE,p=w.player,g=w.plan.walkingGroundAt(s.x,s.z,s.gy);
      Object.assign(p,{x:s.x,z:s.z,groundY:g.y,smoothY:g.y,zone:g.zone,stair:g.stair??null,
        stairLift:null,stairBlend:g.stair?1:0,yaw:s.yaw,pitch:.045,vx:0,vz:0,bobAmp:0,frozen:true});
      w.worldState.time=time;w.camera.fov=60;w.camera.updateProjectionMatrix();
      // Restore culled faces before the independent geometry rays. Otherwise
      // the inspection would mistake an offscreen occluder for open sky.
      w.instanceLOD.enabled=false;
      do{await window.__captureFrame();}while(w.lighting.environment.pending);
      const meshes=[];
      for(const root of w.solids)root.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh)meshes.push(o);});
      const origin=new T.Vector3(s.x,g.y+.06,s.z),ray=new T.Raycaster(),direction=new T.Vector3();
      ray.near=.005;ray.far=1000;
      const visible=dir=>{ray.set(origin,dir);return ray.intersectObjects(meshes,false).length===0;};
      let skyOpen=0;const samples=64;
      for(let i=0;i<samples;i++) {
        const r=Math.sqrt((i+.5)/samples),a=i*2.399963229728653;
        direction.set(r*Math.cos(a),Math.sqrt(1-r*r),r*Math.sin(a));
        if(visible(direction))skyOpen++;
      }
      const sun=w.sunState,l=w.lighting.state,lum=c=>c.r*.2126+c.g*.7152+c.b*.0722;
      const directSun=sun.sunIntensity*Math.max(0,sun.dir.y),directMoon=sun.moonIntensity*Math.max(0,sun.moonDir.y);
      const sunVisible=sun.dir.y>0&&visible(sun.dir),moonVisible=sun.moonDir.y>0&&visible(sun.moonDir);
      const sky=lum(w.atmosphere.radiometry.skyIrradiance),local=l.localIlluminance;
      const unoccluded=sky+directSun+directMoon,occluded=sky*skyOpen/samples+(sunVisible?directSun:0)+(moonVisible?directMoon:0);
      w.instanceLOD.enabled=true;await window.__captureFrame();
      return {id:s.id,f:s.f,time,ground:g.y,skyVisibility:skyOpen/samples,sunVisible,moonVisible,
        skyLux:sky*5000,directSunLux:directSun*5000,directMoonLux:directMoon*5000,localLux:local*5000,
        globalLux:unoccluded*5000,directAndSkyLux:occluded*5000,meterLux:l.meterIlluminance*5000,
        exposure:l.exposure,globalToDirectSkyStops:occluded+local>0?Math.log2((unoccluded+local)/(occluded+local)):null,
        gpuError:w.renderer.getContext().getError()};
    },{s,time});
    rows.push({view:'stair-illuminance',...result});console.log(JSON.stringify(result));
    if(result.gpuError)errors.push('Illuminance probe GPU error');
  }
  writeFileSync(new URL(name+'-meter.json',dir),JSON.stringify(rows,null,2)+'\n');
}
