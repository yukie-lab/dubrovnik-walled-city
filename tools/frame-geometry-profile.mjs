import {writeFileSync} from 'node:fs';

// Count actual submitted geometry by pass without interrupting Metal with a
// GPU query for every draw. These are workload counts, not GPU timing claims.
export async function frameGeometryProfile(page,{name,dir,rows,errors}) {
  for(const [view,query] of [
    ['roofs','x=58&z=-88&yaw=-2.303&pitch=-.02&gy=24&fov=54'],
    ['street','x=-138&z=-1.2&yaw=-1.62&pitch=.015&fov=52'],
  ]) {
    await page.goto('http://localhost:8765/?shot=1&hud=0&time=12.87&'+query,{waitUntil:'domcontentloaded'});
    await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
    const result=await page.evaluate(async()=>{
      const w=window.__world,r=w.renderer;
      do{await window.__captureFrame();}while(w.lighting.environment.pending);
      const draw=r.renderBufferDirect,draws=[];
      r.renderBufferDirect=function(camera,scene,geometry,material,object,group) {
        const before={...r.info.render};
        const value=draw.call(this,camera,scene,geometry,material,object,group);
        const calls=r.info.render.calls-before.calls;
        if(calls)draws.push({
          pass:scene===null?'shadow':scene===w.scene?(camera.layers.mask===1?'main':'underwater'):'auxiliary',
          name:object.name||object.type,material:material.type,calls,
          triangles:r.info.render.triangles-before.triangles,
          instances:object.isInstancedMesh?object.count:1,
          capacity:object.instanceMatrix?.count||1,
          indexCount:geometry.index?.count||geometry.attributes.position?.count||0,
          drawRange:{...geometry.drawRange},
        });
        return value;
      };
      try {
        await window.__captureFrame();
        const masonry=[],stone=w.scene.getObjectByName('wall.curtain')?.material.map;
        w.scene.traverse(o=>{
          if(o.isMesh&&[o.material].flat().some(m=>m.map===stone))masonry.push({
            name:o.name||o.type,instances:o.isInstancedMesh?o.instanceMatrix.count:1,
            vertices:o.geometry.attributes.position.count,materials:[o.material].flat().map(m=>m.uuid),
          });
        });
        return {draws,masonry,stats:{...window.__RENDER_STATS},gpuError:r.getContext().getError()};
      } finally {r.renderBufferDirect=draw;}
    });
    const totals={};
    for(const d of result.draws){const t=totals[d.pass]??={calls:0,triangles:0};t.calls+=d.calls;t.triangles+=d.triangles;}
    const sum=result.draws.reduce((s,d)=>s+d.triangles,0);
    const row={view,...result,totals};rows.push(row);
    writeFileSync(new URL(name+'-'+view+'-geometry.json',dir),JSON.stringify(row,null,2)+'\n');
    console.log(JSON.stringify({view,totals,triangles:sum,reported:result.stats.triangles,
      largest:[...result.draws].sort((a,b)=>b.triangles-a.triangles).slice(0,12),gpuError:result.gpuError}));
    if(sum!==result.stats.triangles||result.gpuError)errors.push(view+': geometry accounting mismatch');
  }
}
