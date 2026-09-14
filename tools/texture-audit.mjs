import {writeFileSync} from 'node:fs';

export async function textureAudit(page,{name,dir,repeat=1}) {
  const report=await page.evaluate(async repeat=>{
    const {makeTextures}=await import('/src/tex.js'),iterations=[];
    for(let run=0;run<repeat;run++) {
    const start=performance.now(),tex=makeTextures(),maps={},buildMs=performance.now()-start;
    for(const [key,set] of Object.entries(tex))for(const [slot,t] of Object.entries(set))if(t?.isTexture && t.image?.getContext) {
      const c=t.image,pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      const hash=await crypto.subtle.digest('SHA-256',pixels);
      maps[`${key}.${slot}`]={width:c.width,height:c.height,hash:[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')};
      t.dispose();
    }
    iterations.push({buildMs,maps});
    }
    const differences=Object.keys(iterations[0].maps).filter(key=>iterations.some(r=>r.maps[key].hash!==iterations[0].maps[key].hash));
    return {...iterations[0],repeat:iterations.length,differences};
  },repeat);
  writeFileSync(new URL(name+'-textures.json',dir),JSON.stringify(report,null,2)+'\n');
  console.log(`Texture audit: ${Object.keys(report.maps).length} maps, build ${report.buildMs.toFixed(0)}ms, repeats=${report.repeat}, changed=${report.differences.join(',')||'none'}`);
}
