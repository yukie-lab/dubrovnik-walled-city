import {writeFileSync} from 'node:fs';

export async function textureAudit(page,{name,dir}) {
  const report=await page.evaluate(async()=>{
    const {makeTextures}=await import('/src/tex.js'),start=performance.now(),tex=makeTextures(),maps={};
    const buildMs=performance.now()-start;
    for(const [key,set] of Object.entries(tex))for(const [slot,t] of Object.entries(set))if(t?.isTexture && t.image?.getContext) {
      const c=t.image,pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      const hash=await crypto.subtle.digest('SHA-256',pixels);
      maps[`${key}.${slot}`]={width:c.width,height:c.height,hash:[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')};
      t.dispose();
    }
    return {buildMs,maps};
  });
  writeFileSync(new URL(name+'-textures.json',dir),JSON.stringify(report,null,2)+'\n');
  console.log(`Texture audit: ${Object.keys(report.maps).length} maps, build ${report.buildMs.toFixed(0)}ms`);
}
