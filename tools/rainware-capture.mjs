import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';

export async function rainwareChecks(page,{name,dir,rows,errors,args}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&x=-138&z=-1.2&time=7.9',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY && window.__captureFrame',{timeout:60000});
  const reference=new URL('../docs/september-rainware-views.json',import.meta.url);
  let stations;
  if(existsSync(reference))stations=JSON.parse(readFileSync(reference,'utf8'));
  else {
    stations=await page.evaluate(()=>{
      const w=window.__world,T=w.THREE,pipe=w.scene.getObjectByName('house.downpipe'),body=w.scene.getObjectByName('house.body');
      const candidates=[],ray=new T.Raycaster(),eye=new T.Vector3(),end=new T.Vector3();
      for(const [index,p] of pipe.userData.pipeRecords.entries()) {
        for(const distance of [1.15,1.65]) {
          const x=p.x+p.nx*distance+p.nz*.35,z=p.z+p.nz*distance-p.nx*.35;
          const g=w.plan.groundAt(x,z,w.plan.surfaceAt(x,z)),c=w.plan.collide(x,z,.20,g.y+1);
          if(Math.hypot(c.x-x,c.z-z)>.025 || Math.abs(g.y-p.supportHigh)>1.2)continue;
          eye.set(x,g.y+1.62,z);end.set(p.x,p.supportHigh+.6,p.z).sub(eye);
          ray.set(eye,end.clone().normalize());ray.near=.02;ray.far=end.length()-.08;
          if(ray.intersectObject(body,false).length)continue;
          candidates.push({id:`pipe-${index}`,x,z,gy:g.y,zone:g.zone,yaw:Math.atan2(x-p.x,z-p.z),
            pitch:Math.atan2(p.supportHigh+.6-g.y-1.62,Math.hypot(x-p.x,z-p.z)),fov:60,
            pipe:[p.x,p.y,p.z],sourceIndex:p.sourceIndex,supportRange:p.supportHigh-p.supportLow,relief:p.outerPlane-(p.sourceX*p.nx+p.sourceZ*p.nz-.09)});
          break;
        }
      }
      const out=[],used=new Set();
      for(const [tx,tz] of [[-98,-25],[-98,-55],[-140,-9],[-40,-27],[25,-42],[76,18],[104,50],[120,-30]]) {
        const s=candidates.filter(s=>!used.has(s.id)).sort((a,b)=>Math.hypot(a.pipe[0]-tx,a.pipe[2]-tz)-Math.hypot(b.pipe[0]-tx,b.pipe[2]-tz))[0];
        if(s){out.push(s);used.add(s.id);}
      }
      return out;
    });
    if(stations.length!==8)throw new Error('Eight accessible downpipe viewpoints are required');
    writeFileSync(reference,JSON.stringify(stations,null,2)+'\n');
  }
  const times=args.includes('--quick') ? [['am',7.9]] : [['am',7.9],['noon',12.87],['gold',19.3],['dusk',21.2]];
  for(const [time,hour] of times)for(const s of stations) {
    await page.evaluate(({s,hour})=>{
      const w=window.__world;
      Object.assign(w.player,{x:s.x,z:s.z,groundY:s.gy,smoothY:s.gy,zone:s.zone,yaw:s.yaw,pitch:s.pitch,vx:0,vz:0,bobAmp:0,frozen:true});
      w.camera.fov=s.fov;w.camera.updateProjectionMatrix();w.worldState.time=hour;w.instanceLOD.enabled=true;
    },{s,hour});
    let png;const hashes=[];
    for(let i=0;i<8;i++){png=Buffer.from((await page.evaluate(()=>window.__captureFrame())).split(',')[1],'base64');hashes.push(createHash('sha256').update(png).digest('hex'));}
    const stats=await page.evaluate(()=>({...window.__RENDER_STATS})),stem=`${name}-${s.id}-${time}`;
    writeFileSync(new URL(stem+'.png',dir),png);
    await page.evaluate(()=>{window.__world.instanceLOD.enabled=false;});
    let full;
    for(let i=0;i<5;i++)full=Buffer.from((await page.evaluate(()=>window.__captureFrame())).split(',')[1],'base64');
    const exact=png.equals(full),stable=new Set(hashes.slice(-4)).size===1;
    rows.push({view:stem,station:s,hour,exact,stable,...stats});
    console.log(`${stem}: calls=${stats.drawCalls} exact=${exact} stable=${stable}`);
    if(!exact || !stable || stats.drawCalls>200)errors.push(stem+': downpipe capture failed');
  }
}
