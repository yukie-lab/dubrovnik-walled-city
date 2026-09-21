import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

// A depth sampler must be valid even before anyone visits its room. Compare
// the same faraway view before and after visiting the enclosure, in one page.
export async function stairShadowInitCheck(page,{name,dir,rows,errors}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&x=165.7021&z=37.9257&gy=7.8073&yaw=-.3283&pitch=.045&fov=60&time=12.87',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY && window.__captureFrame',{timeout:60000});
  const snapshot=await page.evaluate(()=>{
    const p=window.__world.player,keys=['x','z','groundY','smoothY','zone','yaw','pitch','vx','vz','bobAmp','frozen'];
    return Object.fromEntries(keys.map(k=>[k,p[k]]));
  });
  const capture=async phase=>{
    let png;for(let i=0;i<12;i++)png=await page.evaluate(()=>window.__captureFrame());
    const gpu=await page.evaluate(()=>{
      const {renderer,scene}=window.__world,gl=renderer.getContext(),glErrors=[];
      for(let i=0;i<16;i++){const e=gl.getError();if(e===gl.NO_ERROR)break;glErrors.push(e);}
      const m=scene.getObjectByName('steps').material,u=renderer.properties.get(m).uniforms;
      const texture=u.uStairDepth.value,properties=renderer.properties.get(texture);
      return {glErrors,depthAllocated:!!properties.__webglTexture,room:u.uStairRoom.value};
    });
    const buffer=Buffer.from(png.split(',')[1],'base64');writeFileSync(new URL(name+'-'+phase+'.png',dir),buffer);
    return {phase,...gpu,sha256:createHash('sha256').update(buffer).digest('hex')};
  };
  const cold=await capture('cold');
  await page.evaluate(()=>{
    const p=window.__world.player;Object.assign(p,{x:-102.5,z:-74.6,groundY:20.7,smoothY:20.7,yaw:1.346085,pitch:.045,frozen:true});
  });
  const near=await capture('near');
  await page.evaluate(s=>Object.assign(window.__world.player,s),snapshot);
  const warm=await capture('warm'),row={view:'stair-shadow-initialization',cold,near,warm,identicalFarView:cold.sha256===warm.sha256};
  rows.push(row);console.log(JSON.stringify(row));
  if(!row.identicalFarView||[cold,near,warm].some(r=>r.glErrors.length||!r.depthAllocated))errors.push('An unvisited enclosure changes distant rendering');
}
