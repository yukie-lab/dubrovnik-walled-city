import {writeFileSync,readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

// Run through the approved rendercheck launcher. Test the real player and
// render loop, then sample every wall segment at the same geographic stations.
export async function walkChecks(page,{name,dir,rows,errors,args}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&x=-138&z=-1.2&yaw=-1.57&pitch=0.015&time=7.9&fov=54',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY && window.__captureFrame',{timeout:60000});
  let stations=await page.evaluate(()=>{
    const {plan}=window.__world,points=[];
    for(let i=1;i<plan.wallPts.length;i++) {
      const a=plan.wallPts[i-1],b=plan.wallPts[i],x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
      const hint=(a[2]+b[2])/2,g=plan.groundAt(x,z,hint);
      points.push({id:`wall${String(i).padStart(2,'0')}`,x,z,gy:g.y,zone:g.zone,yaw:Math.atan2(x,z),pitch:-.10});
    }
    const summit=plan.WALL_STAIRS.find(s=>s.id==='mincetaTop').pts.at(-1);
    const g=plan.groundAt(-117,-84.5,summit[2]);
    points.push({id:'minceta',x:-117,z:-84.5,gy:g.y,zone:g.zone,yaw:-2.36,pitch:-.12});
    for(const [id,x,z,yaw,pitch] of [
      ['alley-mouth',-98.4,-3,0,.08],['alley-up',-98.4,-22,0,.18],
      ['alley-back',-98.4,-22,Math.PI,-.10],['alley-sill',-98.4,-22,Math.PI/2,.35],
      ['alley-feet',-98.4,-30,-.12,-.72],['alley-cables',-98.4,-22,0,.85],
      ['stradun-reverse',-82,-1,Math.PI/2,.01],['luza-side',148,10,Math.PI,-.08],
    ]) {
      const g=plan.groundAt(x,z,plan.surfaceAt(x,z));
      points.push({id,x,z,gy:g.y,zone:g.zone,yaw,pitch});
    }
    return points;
  });
  if(args.includes('--doors')) {
    const study=args.includes('--door-study');
    const reference=new URL(study ? 'door-study-stations.json' : 'door-stations.json',dir);
    if(existsSync(reference))stations=JSON.parse(readFileSync(reference,'utf8'));
    else {
      await page.evaluate(()=>{window.__world.instanceLOD.enabled=false;});
      for(let i=0;i<2;i++)await page.evaluate(()=>window.__captureFrame());
      stations=await page.evaluate(study=>{
        const w=window.__world,T=w.THREE,out=[],used=new Set(),m=new T.Matrix4(),p=new T.Vector3(),q=new T.Quaternion(),scale=new T.Vector3();
        const solid=[];w.scene.traverse(o=>{if(o.isMesh && (o.name==='house.body' || o.name.startsWith('monument.')))solid.push(o);});
        const ray=new T.Raycaster();
        for(const type of ['frameRect','frameArch']) {
          const mesh=w.scene.getObjectByName('door.'+type),candidates=[];
          for(let i=0;i<mesh.count;i++) {
            mesh.getMatrixAt(i,m);m.decompose(p,q,scale);
            const n=new T.Vector3(0,0,1).applyQuaternion(q),distance=study ? 2.9*scale.y : type==='frameArch' ? 3.7 : 1.6;
            const side=study ? .85*scale.y : 0;
            const x=p.x+n.x*distance+n.z*side,z=p.z+n.z*distance-n.x*side,g=w.plan.groundAt(x,z,p.y);
            const c=w.plan.collide(x,z,.35,g.y+1);
            if(Math.hypot(c.x-x,c.z-z)>.05)continue;
            const targetY=p.y+(study && type==='frameArch' ? 1.5 : 1.1)*scale.y;
            if(study) {
              const eye=new T.Vector3(x,g.y+1.62,z),end=new T.Vector3(p.x+n.x*.2,targetY,p.z+n.z*.2),delta=end.sub(eye);
              ray.set(eye,delta.clone().normalize());ray.near=.05;ray.far=delta.length();
              if(ray.intersectObjects(solid,false).length)continue;
            }
            candidates.push({id:`door-${type}-${i}`,x,z,gy:g.y,zone:g.zone,yaw:Math.atan2(x-p.x,z-p.z),
              pitch:Math.atan2(targetY-g.y-1.62,Math.hypot(distance,side)),fov:study ? 65 : type==='frameArch' ? 60 : 72,target:[p.x,p.y,p.z],nx:n.x,nz:n.z});
          }
          for(const [x,z] of [[-98,-22],[-130,-10],[-18,-36],[56,-72],[84,18],[140,4]]) {
            const d=candidates.filter(d=>!used.has(d.id)).sort((a,b)=>Math.hypot(a.target[0]-x,a.target[2]-z)-Math.hypot(b.target[0]-x,b.target[2]-z))[0];
            if(d){out.push(d);used.add(d.id);}
          }
        }
        return out;
      },study);
      writeFileSync(reference,JSON.stringify(stations,null,2)+'\n');
    }
  }
  if(args.includes('--tree-views')) {
    const targets=JSON.parse(readFileSync(new URL('../docs/september-tree-views.json',import.meta.url),'utf8'));
    stations=await page.evaluate(targets=>targets.flatMap(t=>[1.8,4].map(distance=>{
      const [tx,ty,tz]=t.base,d=Math.max(t.height*distance,3.2),x=tx+d*.3,z=tz+d*.95;
      const gy=window.__world.plan.outsideHeight(x,z);
      return {id:`tree-${t.species}-${distance}`,x,z,gy,zone:'outside',yaw:Math.atan2(x-tx,z-tz),
        pitch:Math.atan2(ty+t.height*.52-gy-1.62,Math.hypot(x-tx,z-tz)),fov:54};
    })),targets);
  }
  if(args.includes('--stations'))stations=stations.filter(s=>s.id.includes(args[args.indexOf('--stations')+1]));
  // Measure CPU visibility work with a changing camera. A stationary capture
  // skips that work, so its FPS is not an adequate movement benchmark.
  await page.evaluate(()=>{
    const lod=window.__world.instanceLOD,original=lod.update.bind(lod);
    window.__lodTimes=[];
    lod.update=(...a)=>{const t=performance.now();original(...a);window.__lodTimes.push(performance.now()-t);};
  });
  for(const mode of (args.includes('--no-motion') ? [] : ['off','on'])) {
    await page.evaluate(mode=>{
      const w=window.__world,p=w.player,g=w.plan.groundAt(-138,-1.2,2);
      Object.assign(p,{x:-138,z:-1.2,groundY:g.y,smoothY:g.y,zone:g.zone,yaw:-Math.PI/2,pitch:.015,vx:0,vz:0,bobAmp:0,frozen:false});
      w.instanceLOD.occlusionEnabled=mode==='on';
      window.__lodTimes.length=0;
    },mode);
    await page.keyboard.down('KeyW');
    const motion=await page.evaluate(async()=>{
      const ticks=[],start=performance.now();let last=start;
      while(performance.now()-start<7000) {
        const now=await new Promise(requestAnimationFrame);
        if(now-start>=1000)ticks.push(now-last);last=now;
      }
      const p=window.__world.player,sorted=[...ticks].sort((a,b)=>a-b);
      const cpu=window.__lodTimes.slice(40).sort((a,b)=>a-b);
      return {fps:ticks.length*1000/ticks.reduce((a,b)=>a+b,0),p95ms:sorted[Math.floor(sorted.length*.95)],
        lodMs:cpu.reduce((a,b)=>a+b,0)/cpu.length,lodP95ms:cpu[Math.floor(cpu.length*.95)],
        x:p.x,z:p.z,gy:p.groundY,...window.__RENDER_STATS};
    });
    await page.keyboard.up('KeyW');
    await page.evaluate(()=>{window.__world.player.frozen=true;});
    rows.push({view:`moving-stradun-${mode}`,motion});
    console.log(`MOVING occlusion ${mode}: ${motion.fps.toFixed(1)}fps p95 ${motion.p95ms.toFixed(1)}ms, LOD ${motion.lodMs.toFixed(2)}ms, x=${motion.x.toFixed(2)}`);
    if(motion.x< -135 || motion.drawCalls>200)errors.push(`Movement/budget failed: ${mode}`);
  }
  await page.evaluate(()=>{window.__world.instanceLOD.occlusionEnabled=true;});
  if(args.includes('--motion-only'))return;
  const times=args.includes('--quick') ? [['am',7.9]] : [['am',7.9],['noon',12.87],['gold',19.3],['dusk',21.2]];
  for(const [time,hour] of times)for(const s of stations) {
    await page.evaluate(({s,hour})=>{
      const w=window.__world,p=w.player;
      Object.assign(p,{x:s.x,z:s.z,groundY:s.gy,smoothY:s.gy,zone:s.zone,yaw:s.yaw,pitch:s.pitch,vx:0,vz:0,bobAmp:0,frozen:true});
      w.camera.fov=s.fov||54;w.camera.updateProjectionMatrix();
      w.worldState.time=hour;w.instanceLOD.enabled=true;
    },{s,hour});
    const stem=`${name}-${s.id}-${time}`,hashes=[];
    let png;
    for(let i=0;i<10;i++) {
      png=Buffer.from((await page.evaluate(()=>window.__captureFrame())).split(',')[1],'base64');
      hashes.push(createHash('sha256').update(png).digest('hex'));
    }
    writeFileSync(new URL(stem+'.png',dir),png);
    const stats=await page.evaluate(()=>({...window.__RENDER_STATS}));
    await page.evaluate(()=>{window.__world.instanceLOD.enabled=false;});
    let full;
    for(let i=0;i<5;i++)full=Buffer.from((await page.evaluate(()=>window.__captureFrame())).split(',')[1],'base64');
    const exact=png.equals(full),stable=new Set(hashes.slice(-4)).size===1;
    let difference=null;
    if(!exact) {
      const fullPath=new URL(stem+'-full.png',dir);writeFileSync(fullPath,full);
      difference=spawnSync(process.execPath,[new URL('./_imgdiff.mjs',import.meta.url).pathname,
        fullPath.pathname,new URL(stem+'.png',dir).pathname],{encoding:'utf8'}).stdout.split('\n')[0];
    }
    rows.push({view:stem,station:s,hour,exact,stable,hashes,difference,...stats});
    console.log(`${stem}: calls=${stats.drawCalls} instances=${stats.instances} exact=${exact} stable=${stable}${difference ? ' '+difference : ''}`);
    if(!exact || !stable || stats.drawCalls>200)errors.push(`${stem}: movement station check failed`);
  }
}
