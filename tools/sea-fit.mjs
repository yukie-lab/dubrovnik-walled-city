import {readFileSync,writeFileSync} from 'node:fs';
import {regionColours} from './png-pixels.mjs';
import {seaCalibrationCapture} from './sea-calibration-capture.mjs';

// Calibration is an offline inspection tool. Only trial optical coefficients
// enter the browser; neither the photograph nor its pixels are served to it.
export async function seaFit(page,{name,dir,rows,errors,args}) {
  await seaCalibrationCapture(page,{name:name+'-seed',dir,rows,errors,args:args.filter(a=>a!=='--sea-diagnostics')});
  const config=JSON.parse(readFileSync('docs/sea-calibration.json','utf8'));
  const reference=JSON.parse(readFileSync('shots/rendercheck/sea-photo-reference.json','utf8')).regions;
  if(args.includes('--sea-fit-extinction')) {
    return fitTransport(page,{name,dir,rows,config,reference});
  }
  const base=[.001155,.00075,.00063],trace=[];
  async function evaluate(beta,label) {
    const data=await page.evaluate(async beta=>{
      window.__waterOptics.set({backscatter:beta});
      const png=await window.__captureFrame();
      return {png,gpuError:window.__world.renderer.getContext().getError(),calls:window.__RENDER_STATS.drawCalls};
    },beta);
    if(data.gpuError)throw new Error('Water fit GPU '+data.gpuError);
    const png=Buffer.from(data.png.split(',')[1],'base64'),regions=regionColours(png,config.renderRegions);
    let score=0;
    for(const [key,region]of Object.entries(regions)) {
      const ref=reference[key].reference.sRGB255;
      const weight=key==='shelf'?.7:1;
      score+=weight*region.rgb.reduce((s,v,k)=>s+(v-ref[k])**2,0)/3;
    }
    score=Math.sqrt(score/3.7);
    const result={iteration:trace.length,label,backscatter:beta.slice(),score,regions,calls:data.calls};trace.push(result);
    writeFileSync(new URL(name+'-fit-trace.json',dir),JSON.stringify(trace,null,2)+'\n');
    return {...result,png};
  }
  let best=await evaluate(base,'initial');
  const probes=[[0,0,0],[.05,.1,.2],[.005,.03,.05],[.01,.05,.4],[.01,.25,.5]];
  for(const factors of probes) {
    const trial=await evaluate(base.map((v,i)=>v*factors[i]),'coarse');
    if(trial.score<best.score)best=trial;
  }
  let span=1;
  for(let round=0;round<9;round++) {
    const start=best.score;
    for(let axis=0;axis<3;axis++)for(const direction of [-1,1]) {
      const beta=best.backscatter.slice();
      beta[axis]=Math.max(1e-7,Math.min(.004,beta[axis]+direction*base[axis]*span*.25));
      const trial=await evaluate(beta,`round${round}-band${axis}`);
      if(trial.score<best.score)best=trial;
    }
    writeFileSync(new URL(name+'-best.png',dir),best.png);
    console.log(JSON.stringify({round,score:best.score,backscatter:best.backscatter,improvement:start-best.score}));
    if(start-best.score<.15)span*=.45;
  }
  await page.evaluate(values=>window.__waterOptics.set(values),{backscatter:best.backscatter});
  const {png,...result}=best;
  writeFileSync(new URL(name+'-best.json',dir),JSON.stringify(result,null,2)+'\n');
  rows.push({view:'sea-fit',...result,evaluations:trace.length});
}

async function fitTransport(page,{name,dir,rows,config,reference}) {
  // A bounded effective-band search. A zero-scattering diagnosis is useful,
  // but not an admissible solution for liquid water. Hold the red attenuation
  // and all geometry fixed; constrain the change in short-path transmission.
  const bounds=[[.12,.22],[.025,.09],[.00002,.001155],[.00004,.00075],[.00008,.00063]];
  const trace=[];
  async function evaluate(vector,label) {
    const values={extinction:[1,vector[0],vector[1]],backscatter:vector.slice(2)};
    const data=await page.evaluate(async values=>{
      window.__waterOptics.set(values);
      return {png:await window.__captureFrame(),calls:window.__RENDER_STATS.drawCalls,
        gpuError:window.__world.renderer.getContext().getError()};
    },values);
    if(data.gpuError)throw new Error('Water fit GPU '+data.gpuError);
    const png=Buffer.from(data.png.split(',')[1],'base64'),regions=regionColours(png,config.renderRegions);
    let score=0;
    // Shelf geometry and shade cannot be registered exactly: keep its residual
    // visible, but never sacrifice all open-water regions to that one mismatch.
    for(const [key,region]of Object.entries(regions)) {
      const ref=reference[key].reference.sRGB255,weight=key==='shelf'?.7:1;
      score+=weight*region.rgb.reduce((sum,v,k)=>sum+(v-ref[k])**2,0)/3;
    }
    score=Math.sqrt(score/3.7);
    const entry={iteration:trace.length,label,vector:vector.slice(),...values,score,regions,calls:data.calls};
    trace.push(entry);writeFileSync(new URL(name+'-fit-trace.json',dir),JSON.stringify(trace,null,2)+'\n');
    return {...entry,png};
  }
  let best=await evaluate([.16,.03,.001155,.00075,.00063],'initial');
  for(const p of [[.16,.03,.00002,.00004,.00008],[.22,.09,.00002,.00004,.00008],
    [.20,.065,.00004,.00008,.00015],[.22,.09,.00004,.00008,.00025]]) {
    const trial=await evaluate(p,'coarse');if(trial.score<best.score)best=trial;
  }
  let span=.5;
  for(let round=0;round<8;round++) {
    const start=best.score;
    for(let axis=0;axis<5;axis++)for(const direction of [-1,1]) {
      const v=best.vector.slice(),[lo,hi]=bounds[axis];
      v[axis]=Math.max(lo,Math.min(hi,v[axis]+direction*(hi-lo)*span));
      if(v[axis]===best.vector[axis])continue;
      const trial=await evaluate(v,`round${round}-axis${axis}`);if(trial.score<best.score)best=trial;
    }
    writeFileSync(new URL(name+'-best.png',dir),best.png);
    const {png,...record}=best;writeFileSync(new URL(name+'-best.json',dir),JSON.stringify(record,null,2)+'\n');
    console.log(JSON.stringify({round,score:best.score,extinction:best.extinction,backscatter:best.backscatter,improvement:start-best.score}));
    if(start-best.score<.10)span*=.5;
  }
  rows.push({view:'sea-fit-transport',extinction:best.extinction,backscatter:best.backscatter,
    score:best.score,evaluations:trace.length});
}
