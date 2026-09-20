import {readFileSync,writeFileSync} from 'node:fs';

export async function stainBlendChecks(page,{name,dir,rows,errors}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&time=12.87',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY && window.__captureFrame',{timeout:60000});
  const legacy=readFileSync(new URL('./fixtures/multiply-decal-before-sept24.txt',import.meta.url),'utf8');
  const report=await page.evaluate(async legacy=>{
    const {THREE:T}=window.__world,{multiplyStain}=await import('/src/surface-stain.js');
    const old=new Function('THREE',legacy+';return multiplyDecal;')(T);
    const renderer=new T.WebGLRenderer({antialias:false}),scene=new T.Scene();
    renderer.setSize(16,16);renderer.outputColorSpace=T.LinearSRGBColorSpace;
    renderer.setClearColor(new T.Color(.65,.5,.35),1);
    const target=new T.WebGLRenderTarget(16,16),camera=new T.OrthographicCamera(-1,1,1,-1,.1,1000);
    renderer.setRenderTarget(target);
    const geometry=new T.PlaneGeometry(2,2),mesh=new T.Mesh(geometry);
    scene.add(mesh);const result=[],pixel=()=>{const p=new Uint8Array(4);renderer.readRenderTargetPixels(target,8,8,1,1,p);return [...p];};
    mesh.visible=false;renderer.render(scene,camera);const background=pixel();mesh.visible=true;
    for(const fogType of ['none','linear','exp2'])for(const distance of [3,200,500])for(const alpha of [0,.5,1]) {
      scene.fog=fogType==='exp2'?new T.FogExp2(new T.Color(.6,.5,.4),.004):
        fogType==='linear'?new T.Fog(new T.Color(.6,.5,.4),20,600):null;
      mesh.position.z=-distance;
      const transmittance=fogType==='exp2'?Math.exp(-(.004**2)*distance**2):fogType==='none'?1:(()=>{
        const t=Math.max(0,Math.min(1,(distance-20)/580));return 1-t*t*(3-2*t);})();
      for(const [kind,patch] of [['before',old],['after',multiplyStain]]) {
        const texture=new T.DataTexture(new Uint8Array([255,255,255,Math.round(alpha*255)]),1,1);texture.needsUpdate=true;
        const material=patch(new T.MeshBasicMaterial({map:texture,color:new T.Color(.25,.2,.15),transparent:true,depthWrite:false}));
        mesh.material=material;renderer.render(scene,camera);const rgba=pixel();
        const expected=background.slice(0,3).map((c,i)=>Math.round(c*(1-(1-[.25,.2,.15][i])*Math.round(alpha*255)/255*transmittance)));
        result.push({kind,fogType,distance,alpha,rgba,expected,
          identityError:Math.max(...rgba.map((c,i)=>Math.abs(c-background[i]))),
          coefficientError:Math.max(...expected.map((c,i)=>Math.abs(c-rgba[i])))});
        material.dispose();texture.dispose();
      }
    }
    geometry.dispose();target.dispose();renderer.dispose();renderer.forceContextLoss();
    return {background,rows:result};
  },legacy);
  const after=report.rows.filter(r=>r.kind==='after'),transparent=after.filter(r=>r.alpha===0);
  const summary={view:'stain-blend',cases:report.rows.length,
    oldTransparentChanged:report.rows.filter(r=>r.kind==='before'&&r.alpha===0&&r.identityError>0).length,
    transparentChanged:transparent.filter(r=>r.identityError>0).length,
    maxCoefficientError:Math.max(...after.map(r=>r.coefficientError))};
  if(summary.transparentChanged||summary.maxCoefficientError>1)errors.push('Stain blend failed: '+JSON.stringify(summary));
  writeFileSync(new URL(name+'-stain-blend.json',dir),JSON.stringify(report,null,2)+'\n');
  rows.push(summary);console.log(JSON.stringify(summary));
}
