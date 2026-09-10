import puppeteer from 'puppeteer-core';
import { mkdirSync,writeFileSync } from 'node:fs';
const name = process.argv[2] || 'plants';
const browser = await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless:'new',args:['--headless=new','--use-angle=metal','--window-size=1640,1060']});
const dir = new URL('../shots/plants/',import.meta.url); mkdirSync(dir,{recursive:true});
const errors=[];
try {
  const page=await browser.newPage();
  await page.setViewport({width:1600,height:1000,deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://localhost:8765/?shot=1&hud=0&x=-98.4&z=-30&yaw=-.12&pitch=.18&fov=44&time=12.87');
  await page.waitForFunction('window.__READY && window.__captureFrame',{timeout:60000});
  for (const mode of ['normal','receive-off','oriented-bias','stable-filter']) {
    await page.evaluate(mode=>{
      const w=window.__world,m=w.scene.getObjectByName('life.foliage');
      m.receiveShadow=mode!=='receive-off';
      if(mode==='oriented-bias') {
        const before=m.material.onBeforeCompile,key=m.material.customProgramCacheKey();
        m.material.onBeforeCompile=(sh,r)=>{
          before(sh,r);
          const chunk=w.THREE.ShaderChunk.shadowmap_vertex.replace(
            'shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias',
            'shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias * ( (directionalShadowMatrix[ i ] * vec4(shadowWorldNormal,0.0)).z > 0.0 ? -1.0 : 1.0 )');
          sh.vertexShader=sh.vertexShader.replace('#include <shadowmap_vertex>',chunk);
        };
        m.material.customProgramCacheKey=()=>key+'|oriented-leaf-shadow';
        m.material.needsUpdate=true;
      }
      if(mode==='stable-filter') {
        const before=m.material.onBeforeCompile,key=m.material.customProgramCacheKey();
        m.material.onBeforeCompile=(sh,r)=>{
          before(sh,r);
          const chunk=w.THREE.ShaderChunk.shadowmap_pars_fragment.replace(
            /float phi = interleavedGradientNoise\( gl_FragCoord.xy \) \* PI2;[\s\S]*?\) \* 0\.2;/,
            `shadow = 0.0;
              for(int tap=0;tap<16;tap++) shadow += texture(shadowMap,
                vec3(shadowCoord.xy + vogelDiskSample(tap,16,0.4) * radius,shadowCoord.z));
              shadow *= 0.0625;`);
          sh.fragmentShader=sh.fragmentShader.replace('#include <shadowmap_pars_fragment>',chunk);
        };
        m.material.customProgramCacheKey=()=>key+'|stable-small-shadow';
        m.material.needsUpdate=true;
      }
    },mode);
    let png;
    for(let i=0;i<8;i++)png=await page.evaluate(()=>window.__captureFrame());
    writeFileSync(new URL(`${name}-${mode}.png`,dir),Buffer.from(png.split(',')[1],'base64'));
    console.log(mode,await page.evaluate(()=>({...window.__RENDER_STATS})));
  }
}finally{await browser.close();}
if(errors.length)throw new Error(errors.join('\n'));
