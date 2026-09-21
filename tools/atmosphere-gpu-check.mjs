import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {ATM,transmittance} from '../src/atmosphere-model.js';

export async function atmosphereGPUCheck(page,{name,dir}) {
  const result=await page.evaluate(()=>{
    const w=window.__world,rt=w.atmosphere.targets.trans;
    const data=new Float32Array(rt.width*rt.height*4);
    w.renderer.readRenderTargetPixels(rt,0,0,rt.width,rt.height,data);
    const rows=[];
    for(const y of [0,1,3,8,20,40,62])for(const x of [0,8,50,140,220,252]) {
      const at=(y*rt.width+x)*4;
      rows.push({x,y,value:Array.from(data.slice(at,at+3))});
    }
    return {rows,error:w.renderer.getContext().getError()};
  });
  assert.equal(result.error,0,'Read atmospheric GPU transport');
  let maxError=0;
  for(const row of result.rows) {
    const H=Math.sqrt(ATM.top**2-ATM.radius**2),rho=row.y/63*H;
    const r=Math.sqrt(rho*rho+ATM.radius**2),lo=ATM.top-r,hi=rho+H;
    const d=lo+row.x/255*(hi-lo),mu=d<1e-8?1:(ATM.top**2-r*r-d*d)/(2*r*d);
    const expected=transmittance(r-ATM.radius,Math.max(-1,Math.min(1,mu)),1536);
    row.reference=expected;row.error=Math.max(...row.value.map((v,i)=>Math.abs(v-expected[i])));
    maxError=Math.max(maxError,row.error);
    assert(row.value.every(Number.isFinite),'Finite GPU transmittance');
  }
  writeFileSync(new URL(name+'-atmosphere-gpu.json',dir),JSON.stringify({...result,maxError},null,2)+'\n');
  assert(maxError<.003,'GPU optical-depth integration versus independent high-precision CPU reference: '+maxError);
  console.log(JSON.stringify({atmosphericGPUQueries:result.rows.length,maxAbsoluteTransmittanceError:maxError}));
}
