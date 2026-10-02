import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pngPixels} from './png-pixels.mjs';

const linear=Float64Array.from({length:256},(_,v)=>v<=10?v/255/12.92:((v/255+.055)/1.055)**2.4);
function compare(a,b) {
  const A=pngPixels(a),B=pngPixels(b);
  if(A.width!==B.width||A.height!==B.height)throw new Error('Different comparison image dimensions');
  let changed=0,maxRGB=0,squared=0,sum=0;const region={pixels:0,beforeY:0,afterY:0,changed:0};
  for(let i=0;i<A.width*A.height;i++) {
    const x=i%A.width,y=Math.floor(i/A.width),ao=i*A.channels,bo=i*B.channels;
    const ay=linear[A.pixels[ao]]*.2126+linear[A.pixels[ao+1]]*.7152+linear[A.pixels[ao+2]]*.0722;
    const by=linear[B.pixels[bo]]*.2126+linear[B.pixels[bo+1]]*.7152+linear[B.pixels[bo+2]]*.0722;
    let delta=0;for(let k=0;k<3;k++)delta=Math.max(delta,Math.abs(A.pixels[ao+k]-B.pixels[bo+k]));
    changed+=delta>0;maxRGB=Math.max(maxRGB,delta);sum+=by-ay;squared+=(by-ay)**2;
    // This fixed image region is only a display statistic. It is not a
    // geometry mask or a claim that every included pixel belongs to a tread.
    if(x>=A.width*.25&&x<A.width*.85&&y>=A.height*.65) {
      region.pixels++;region.beforeY+=ay;region.afterY+=by;region.changed+=delta>0;
    }
  }
  region.beforeY/=region.pixels;region.afterY/=region.pixels;
  return {pixels:A.width*A.height,changed,maxRGB,meanDeltaY:sum/(A.width*A.height),rmsY:Math.sqrt(squared/(A.width*A.height)),lowerRegion:region};
}

export async function stairSkyStudy(page,{name,dir,rows,errors,args}) {
  const baseline=execFileSync('git',['show','80ed2ca:src/wall-stair-light.js'],{encoding:'utf8'});
  const sourceHashes={before:createHash('sha256').update(baseline).digest('hex'),
    after:createHash('sha256').update(readFileSync('src/wall-stair-light.js')).digest('hex')};
  let mode='before';const before=new Map(),hidpi=args.includes('--stair-sky-hidpi');
  if(hidpi)await page.setViewport({width:1280,height:800,deviceScaleFactor:2});
  const handler=request=>mode==='before'&&new URL(request.url()).pathname==='/src/wall-stair-light.js'
    ? request.respond({status:200,contentType:'text/javascript',body:baseline}):request.continue();
  await page.setCacheEnabled(false);await page.setRequestInterception(true);page.on('request',handler);
  const canonical=[];
  for(const raw of readFileSync('tools/campaign.txt','utf8').split('\n')) {
    const m=raw.replace(/\s+#.*$/,'').trim().match(/^view\s+(\S+)\s+(.+)$/);if(!m)continue;
    const [x,z,yaw,pitch,extra='']=m[2].split(':');
    const params=Object.fromEntries(new URLSearchParams(`x=${x}&z=${z}&yaw=${yaw}&pitch=${pitch}${extra}`));
    for(const time of [7.9,12.87,19.3,21.2])canonical.push({id:m[1],time,canonical:true,
      ...Object.fromEntries(Object.entries(params).map(([k,v])=>[k,+v]))});
  }
  try {
    for(mode of ['before','after']) {
      await page.goto('http://localhost:8765/?shot=1&hud=0&time=7.9',{waitUntil:'domcontentloaded'});
      await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:180000});
      const stations=await page.evaluate(({canonical,hidpi})=>{
        const w=window.__world,out=hidpi?[]:[...canonical];
        for(const st of w.plan.WALL_STAIRS) {
          if(hidpi&&!st.enclosed)continue;
          const lengths=st.pts.slice(1).map((b,i)=>Math.hypot(b[0]-st.pts[i][0],b[1]-st.pts[i][1]));
          const total=lengths.reduce((a,b)=>a+b,0);
          const times=st.enclosed ? (hidpi?[12.87,21.2,22.5]:[7.9,12.87,19.3,21.2,22.5]) : [12.87,22.5];
          for(const f of st.enclosed?[.05,.2,.4,.6,.8,.95]:[.4])for(const time of times) {
            let distance=total*f,i=0;while(distance>lengths[i]&&i<lengths.length-1)distance-=lengths[i++];
            const a=st.pts[i],b=st.pts[i+1],t=distance/lengths[i];
            out.push({id:`${st.id}-${f}`,stairId:st.id,enclosed:st.enclosed,f,time,
              x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,gy:a[2]+(b[2]-a[2])*t,
              yaw:Math.atan2(a[0]-b[0],a[1]-b[1]),pitch:.045,fov:60});
          }
        }
        return out;
      },{canonical,hidpi});
      if(stations.length!==(hidpi?18:72))throw new Error('Stair sky station inventory changed');
      for(const s of stations) {
        const result=await page.evaluate(async s=>{
          const w=window.__world,p=w.player;
          let g;if(s.canonical){p.teleport(s.x,s.z,s.yaw,s.pitch);g=p.floorAt(s.x,s.z,s.gy??500);}
          else g=w.plan.walkingGroundAt(s.x,s.z,s.gy);
          Object.assign(p,{x:s.x,z:s.z,groundY:g.y,smoothY:g.y,zone:g.zone,stair:g.stair??null,
            stairLift:null,stairBlend:g.stair?1:0,yaw:s.yaw,pitch:s.pitch,vx:0,vz:0,bobAmp:0,frozen:true});
          w.worldState.time=s.time;w.camera.fov=s.fov||54;w.camera.updateProjectionMatrix();
          let count=0;do{await window.__captureFrame();count++;}while((count<4||w.lighting.environment.pending)&&count<50);
          if(w.lighting.environment.pending)throw new Error('Stair sky study lighting not ready');
          const png=await window.__captureFrame(),again=await window.__captureFrame(),l=w.lighting.state;
          return {png,stable:png===again,stats:{...window.__RENDER_STATS},gpuError:w.renderer.getContext().getError(),
            exposure:l.exposure,meterIlluminance:l.meterIlluminance,localIlluminance:l.localIlluminance,
            groundY:g.y,zone:g.zone,camera:w.camera.position.toArray()};
        },s);
        const {png,...data}=result,buffer=Buffer.from(png.split(',')[1],'base64'),key=`${s.id}-${s.time}`;
        const hash=createHash('sha256').update(buffer).digest('hex');
        writeFileSync(new URL(`${name}-${key}-${mode}.png`,dir),buffer);
        if(mode==='before')before.set(key,{hash,data,buffer});
        else {
          const reference=before.get(key),sameCounts=['drawCalls','triangles','instances'].every(k=>reference.data.stats[k]===data.stats[k]);
          const sameLighting=['exposure','meterIlluminance','localIlluminance'].every(k=>reference.data[k]===data[k]);
          const samePose=reference.data.groundY===data.groundY&&reference.data.zone===data.zone
            &&reference.data.camera.every((v,i)=>v===data.camera[i]);
          const difference=compare(reference.buffer,buffer);
          rows.push({view:'stair-sky',sourceHashes,station:s,...data,hash,before:{hash:reference.hash,...reference.data},
            exact:hash===reference.hash,sameCounts,sameLighting,samePose,difference});
          console.log(`${key}: exact=${hash===reference.hash} counts=${sameCounts} lighting=${sameLighting} changed=${difference.changed} maxRGB=${difference.maxRGB}`);
          if(!sameCounts||!sameLighting||!samePose||!reference.data.stable||reference.data.gpuError)errors.push(`Stair sky reference/count/lighting/pose failure: ${key}`);
        }
        const finite=[data.exposure,data.meterIlluminance,data.localIlluminance,data.groundY,
          ...data.camera,...['drawCalls','triangles','instances','dpr'].map(k=>data.stats[k])].every(Number.isFinite);
        if(!finite||!data.stable||data.gpuError||data.stats.drawCalls>200||data.stats.dpr!==(hidpi?1.6:1))errors.push(`Stair sky stability/GPU/budget failure: ${key}/${mode}`);
      }
    }
  } finally {page.off('request',handler);await page.setRequestInterception(false);await page.setCacheEnabled(true);}
}
