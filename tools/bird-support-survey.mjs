import {writeFileSync} from 'node:fs';

export async function birdSupportSurvey(page,{name,dir,rows,errors}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&x=0&z=103&gy=16&yaw=3.1416&pitch=-.14&time=12.87',
    {waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
  const result=await page.evaluate(async()=>{
    const w=window.__world,T=w.THREE,bird=w.scene.getObjectByName('life.bird');
    w.instanceLOD.enabled=false;for(const b of w.instanceLOD.batches)b.restore();
    await window.__captureFrame();
    const floors=[];
    w.scene.traverse(o=>{if(o.isMesh&&['house.roof','house.ridgeTile','wall.curtain','ground.paving',
      'ground.stradun','ground.near','steps'].includes(o.name))floors.push(o);});
    const ray=new T.Raycaster(),matrix=new T.Matrix4(),p=new T.Vector3(),v=new T.Vector3(),n=new T.Vector3(0,-1,0);
    const positions=bird.geometry.attributes.position,phase=bird.geometry.attributes.aPh2;
    const low=Math.min(...positions.array.filter((_,i)=>i%3===1)),footPoints=new Map();
    for(let i=0;i<positions.count;i++)if(positions.getY(i)<low+1e-5) {
      const v=new T.Vector3().fromBufferAttribute(positions,i);footPoints.set(v.toArray().join(','),v);
    }
    const feet=[...footPoints.values()];
    const observations=[];
    for(let i=0;i<bird.count;i++) {
      bird.getMatrixAt(i,matrix);matrix.premultiply(bird.matrixWorld);
      const yy=Math.sin(40*.29+phase.getX(i)*11)*.62,cy=Math.cos(yy),sy=Math.sin(yy);
      const contacts=[];
      for(const foot of feet) {
        v.copy(foot);const x=v.x,z=v.z;v.x=cy*x+sy*z;v.z=-sy*x+cy*z;v.applyMatrix4(matrix);
        ray.set(p.copy(v).addScaledVector(n,-.6),n);ray.far=500;
        const hit=ray.intersectObjects(floors,false)[0];
        if(hit)contacts.push({distance:v.y-hit.point.y,object:hit.object.name,point:hit.point.toArray()});
      }
      const base=new T.Vector3().setFromMatrixPosition(matrix).toArray();
      observations.push({id:i,base,feet:feet.length,contacts,
        closest:contacts.length?Math.min(...contacts.map(c=>c.distance)):null,
        lowest:contacts.length?Math.max(...contacts.map(c=>c.distance)):null});
    }
    return {observations,gpuError:w.renderer.getContext().getError()};
  });
  const bad=result.observations.filter(o=>o.closest===null||Math.abs(o.closest)>.02);
  const row={view:'bird-support',count:result.observations.length,bad:bad.length,
    maxFloat:Math.max(0,...result.observations.map(o=>o.closest??0)),
    maxSink:Math.max(0,...result.observations.map(o=>-(o.closest??0))),gpuError:result.gpuError};
  rows.push(row);writeFileSync(new URL(name+'-bird-support.json',dir),JSON.stringify({...result,...row},null,2)+'\n');
  console.log(JSON.stringify(row));
  if(result.gpuError)errors.push('Bird support survey GPU error');
}
