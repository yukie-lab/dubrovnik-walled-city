import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pngPixels} from './png-pixels.mjs';
import {captureWaterMask} from './water-mask.mjs';

function difference(a,b,mask=null) {
  const A=pngPixels(a),B=pngPixels(b),M=mask?pngPixels(mask):null;let pixels=0,changed=0,maxRGB=0;
  if(A.width!==B.width||A.height!==B.height)throw new Error('Lamp comparison dimensions differ');
  if(M&&(M.width!==A.width||M.height!==A.height))throw new Error('Lamp water mask dimensions differ');
  for(let i=0;i<A.width*A.height;i++) {
    if(M&&M.pixels[i*M.channels]!==255)continue;
    pixels++;
    let delta=0;for(let k=0;k<3;k++)delta=Math.max(delta,Math.abs(A.pixels[i*A.channels+k]-B.pixels[i*B.channels+k]));
    changed+=delta>0;maxRGB=Math.max(maxRGB,delta);
  }
  return {pixels,changed,maxRGB};
}

export async function lampEmitterStudy(page,{name,dir,rows,errors,args}) {
  const baseline=execFileSync('git',['show','beeb1fa:src/life.js'],{encoding:'utf8'}),before=new Map();
  const sourceHashes={before:createHash('sha256').update(baseline).digest('hex'),
    after:createHash('sha256').update(readFileSync('src/life.js')).digest('hex')};
  const hidpi=args.includes('--lamp-hidpi'),water=args.includes('--lamp-water');let mode='before';
  if(hidpi)await page.setViewport({width:1280,height:800,deviceScaleFactor:2});
  const handler=request=>mode==='before'&&new URL(request.url()).pathname==='/src/life.js'
    ?request.respond({status:200,contentType:'text/javascript',body:baseline}):request.continue();
  await page.setCacheEnabled(false);await page.setRequestInterception(true);page.on('request',handler);
  const canonical=[];
  for(const raw of readFileSync('tools/campaign.txt','utf8').split('\n')) {
    const m=raw.replace(/\s+#.*$/,'').trim().match(/^view\s+(\S+)\s+(.+)$/);if(!m)continue;
    const [x,z,yaw,pitch,extra='']=m[2].split(':');
    const params=Object.fromEntries(new URLSearchParams(`x=${x}&z=${z}&yaw=${yaw}&pitch=${pitch}${extra}`));
    for(const time of [7.9,12.87,19.3,21.2])canonical.push({id:m[1],canonical:true,time,
      ...Object.fromEntries(Object.entries(params).map(([k,v])=>[k,+v]))});
  }
  try {
    for(mode of ['before','after']) {
      await page.goto('http://localhost:8765/?shot=1&hud=0&time=12.87',{waitUntil:'domcontentloaded'});
      await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:120000});
      const setup=await page.evaluate(({canonical,hidpi})=>{
        const w=window.__world,T=w.THREE,g=w.scene.getObjectByName('life.lampGlass');
        const batch=w.instanceLOD.batches.find(b=>b.mesh===g);
        const matrices=batch?batch.streams.find(s=>s.attribute===g.instanceMatrix).source:g.instanceMatrix.array;
        g.geometry.computeBoundingBox();const centre=g.geometry.boundingBox.getCenter(new T.Vector3()),matrix=new T.Matrix4();
        const fixtures=Array.from({length:matrices.length/16},(_,id)=>{
          matrix.fromArray(matrices,id*16);
          return {id,emitter:centre.clone().applyMatrix4(matrix).toArray(),outward:[matrix.elements[8],matrix.elements[10]]};
        });
        const stations=hidpi?[]:[...canonical];
        for(const target of [[-138,-1.2],[-98.4,-30],[152,10]]) {
          const fixture=fixtures.slice().sort((a,b)=>Math.hypot(a.emitter[0]-target[0],a.emitter[2]-target[1])-Math.hypot(b.emitter[0]-target[0],b.emitter[2]-target[1]))[0];
          const [ex,ey,ez]=fixture.emitter,[nx,nz]=fixture.outward;
          const x=ex+nx*2.7+nz*1.5,z=ez+nz*2.7-nx*1.5,ground=w.plan.groundAt(x,z,ey).y;
          for(const time of [12.87,19.3,21.2,22.5])stations.push({id:'lamp-'+fixture.id,time,x,z,gy:ground,
            yaw:Math.atan2(x-ex,z-ez),pitch:Math.atan2(ey-.8-ground-1.62,Math.hypot(x-ex,z-ez)),fov:60});
        }
        if(!hidpi)for(const st of w.plan.WALL_STAIRS) {
          const lengths=st.pts.slice(1).map((b,i)=>Math.hypot(b[0]-st.pts[i][0],b[1]-st.pts[i][1]));
          let d=lengths.reduce((a,b)=>a+b,0)*.4,i=0;while(d>lengths[i]&&i<lengths.length-1)d-=lengths[i++];
          const a=st.pts[i],b=st.pts[i+1],t=d/lengths[i];
          stations.push({id:st.id,stair:true,time:22.5,x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,
            gy:a[2]+(b[2]-a[2])*t,yaw:Math.atan2(a[0]-b[0],a[1]-b[1]),pitch:.045,fov:60});
        }
        window.__lampFixtureCentres=fixtures.map(f=>f.emitter);return {stations,fixtures:fixtures.length};
      },{canonical,hidpi});
      if(setup.stations.length!==(hidpi?12:50))throw new Error('Lamp station inventory changed');
      if(water)setup.stations=setup.stations.filter(s=>s.canonical&&s.time===21.2&&['v3_roofs','v4_srd','v5_sea','v8_luza'].includes(s.id));
      for(const s of setup.stations) {
        const result=await page.evaluate(async s=>{
          const w=window.__world,p=w.player,T=w.THREE;
          p.teleport(s.x,s.z,s.yaw,s.pitch);
          const g=s.stair?w.plan.walkingGroundAt(s.x,s.z,s.gy):p.floorAt(s.x,s.z,s.gy??500);
          Object.assign(p,{x:s.x,z:s.z,groundY:g.y,smoothY:g.y,zone:g.zone,stair:g.stair??null,
            stairLift:null,stairBlend:g.stair?1:0,yaw:s.yaw,pitch:s.pitch,vx:0,vz:0,bobAmp:0,frozen:true});
          w.worldState.time=s.time;w.camera.fov=s.fov||54;w.camera.updateProjectionMatrix();
          let count=0;do{await window.__captureFrame();count++;}while((count<4||w.lighting.environment.pending)&&count<50);
          if(w.lighting.environment.pending)throw new Error('Lamp environment not ready');
          const png=await window.__captureFrame(),again=await window.__captureFrame(),l=w.lighting.state,lights=[];
          w.scene.traverse(o=>{if(o.isPointLight){const position=o.getWorldPosition(new T.Vector3());
            lights.push({intensity:o.intensity,position:position.toArray(),error:Math.min(...window.__lampFixtureCentres.map(e=>position.distanceTo(new T.Vector3(...e))))});}});
          return {png,stable:png===again,stats:{...window.__RENDER_STATS},gpuError:w.renderer.getContext().getError(),
            exposure:l.exposure,localIlluminance:l.localIlluminance,meterIlluminance:l.meterIlluminance,
            camera:w.camera.position.toArray(),groundY:g.y,zone:g.zone,lights};
        },s);
        const {png,...data}=result,buffer=Buffer.from(png.split(',')[1],'base64'),key=s.id+'-'+s.time;
        const hash=createHash('sha256').update(buffer).digest('hex');
        writeFileSync(new URL(`${name}-${key}-${mode}.png`,dir),buffer);
        const mask=water?Buffer.from((await captureWaterMask(page)).split(',')[1],'base64'):null;
        if(mask)writeFileSync(new URL(`${name}-${key}-${mode}-water.png`,dir),mask);
        if(mode==='before')before.set(key,{buffer,hash,data,mask});
        else {
          const previous=before.get(key),exact=hash===previous.hash;
          const sameCounts=['drawCalls','triangles','instances'].every(k=>data.stats[k]===previous.data.stats[k]);
          const samePose=data.groundY===previous.data.groundY&&data.zone===previous.data.zone&&data.camera.every((v,i)=>v===previous.data.camera[i]);
          const sameIntensities=data.lights.every((v,i)=>v.intensity===previous.data.lights[i].intensity);
          rows.push({view:'lamp-emitter',sourceHashes,station:s,fixtures:setup.fixtures,...data,hash,before:{hash:previous.hash,...previous.data},
            exact,sameCounts,samePose,sameIntensities,difference:difference(previous.buffer,buffer),
            water:mask?{sameMask:mask.equals(previous.mask),difference:difference(previous.buffer,buffer,mask)}:null});
          console.log(`${key}: exact=${exact} counts=${sameCounts} exposure=${previous.data.exposure.toFixed(3)}→${data.exposure.toFixed(3)}`);
          if(!sameCounts||!samePose||!sameIntensities||data.lights.some(l=>l.intensity>0&&l.error>2e-5))errors.push('Lamp geometry/slot mismatch: '+key);
          if(s.time<=19.3&&!exact)errors.push('Inactive daylight lamps changed an image: '+key);
        }
        if(!data.stable||data.gpuError||data.stats.drawCalls>200||data.stats.dpr!==(hidpi?1.6:1)||
          ![data.exposure,data.localIlluminance,data.meterIlluminance,...data.camera,data.groundY].every(Number.isFinite))errors.push('Lamp rendering failure: '+key+'/'+mode);
      }
    }
  } finally {page.off('request',handler);await page.setRequestInterception(false);await page.setCacheEnabled(true);}
}
