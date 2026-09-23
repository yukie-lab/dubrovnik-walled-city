import {writeFileSync} from 'node:fs';

// Read the actual material patch and atlas through WebGL. Translate a whole
// 4.2m field by the former repeat length; a repeated wall correlates at one.
export async function masonryRepeatCheck(page,{name,dir,rows,errors}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&time=12.87', {waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
  const result=await page.evaluate(async()=>{
    const {THREE:T,renderer,scene}=window.__world;
    const material=scene.getObjectByName('wall.curtain').material;
    const shader={...T.ShaderLib.standard,uniforms:T.UniformsUtils.clone(T.ShaderLib.standard.uniforms)};
    material.onBeforeCompile(shader,renderer);
    const chart=shader.fragmentShader.match(/float msHash[\s\S]*?return c;\s*}\s*/)?.[0];
    if(!chart)throw new Error('The live wall does not contain the new masonry chart');
    const {masonryTextures,masonryFinishes}=await import('/src/masonry.js');
    const original=masonryTextures(masonryFinishes.fortStone),size=768;
    const target=new T.WebGLRenderTarget(size,size,{depthBuffer:false}),before=renderer.getRenderTarget();
    const camera=new T.OrthographicCamera(-1,1,1,-1,0,2);camera.position.z=1;
    const probe=new T.Scene(),geometry=new T.PlaneGeometry(2,2);
    const data=[];
    try {
      for(const [mode,map] of [['original',original.map],['individual',material.map]]) {
        const uniforms={map:{value:map},offset:{value:new T.Vector2()}};
        const testMaterial=new T.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,toneMapped:false,
          vertexShader:'varying vec2 vUV;void main(){vUV=uv;gl_Position=vec4(position.xy,0.,1.);}',
          fragmentShader:`uniform sampler2D map;uniform vec2 offset;varying vec2 vUV;
            ${mode==='individual'?chart:''}
            void main(){vec2 p=vUV*4.2+offset;
            ${mode==='individual'?'MsChart c=msChart(p);gl_FragColor=textureGrad(map,c.uv,c.dx,c.dy);gl_FragColor.rgb*=c.quarry;':
              'gl_FragColor=texture2D(map,p/4.2);'}}`});
        const mesh=new T.Mesh(geometry,testMaterial);probe.add(mesh);const fields=[];
        for(const shift of [[0,0],[4.2,0],[0,4.2]]) {
          uniforms.offset.value.set(...shift);renderer.setRenderTarget(target);renderer.render(probe,camera);
          const rgba=new Uint8Array(size*size*4);renderer.readRenderTargetPixels(target,0,0,size,size,rgba);fields.push(rgba);
        }
        const base=fields[0],pairs=fields.slice(1).map((next,j)=>{
          let sx=0,sy=0,sxx=0,syy=0,sxy=0,abs=0,same=0;
          const n=size*size;
          for(let i=0;i<n;i++) {
            const o=i*4,x=.2126*base[o]+.7152*base[o+1]+.0722*base[o+2],
              y=.2126*next[o]+.7152*next[o+1]+.0722*next[o+2];
            sx+=x;sy+=y;sxx+=x*x;syy+=y*y;sxy+=x*y;abs+=Math.abs(x-y);
            if(base[o]===next[o]&&base[o+1]===next[o+1]&&base[o+2]===next[o+2])same++;
          }
          return {shift:j?'vertical':'horizontal',correlation:(sxy-sx*sy/n)/Math.sqrt((sxx-sx*sx/n)*(syy-sy*sy/n)),
            meanDifference:abs/n/255,identicalFraction:same/n,mean:sx/n/255};
        });
        data.push({mode,pairs});probe.remove(mesh);testMaterial.dispose();
      }
    }finally {
      renderer.setRenderTarget(before);geometry.dispose();target.dispose();
      original.map.dispose();original.normalMap.dispose();original.roughnessMap.dispose();
    }
    return {size,units:'linear reflectance',data,gpuError:renderer.getContext().getError()};
  });
  writeFileSync(new URL(name+'-masonry-repeat.json',dir),JSON.stringify(result,null,2)+'\n');
  rows.push({view:'masonry-repeat',...result});console.log(JSON.stringify(rows.at(-1)));
  if(result.gpuError||result.data[0].pairs.some(p=>p.correlation<.999)||
    result.data[1].pairs.some(p=>Math.abs(p.correlation)>.25))errors.push('The wall still repeats at 4.2m');
}
