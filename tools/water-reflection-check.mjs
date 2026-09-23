import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';

// Independent reference: sample the full GGX NDF, evaluate the Cook–Torrance
// BRDF/PDF ratio. The production shader instead samples visible normals.
function reference(noV,alpha,count=262144) {
  const view=[Math.sqrt(1-noV*noV),0,noV],a2=alpha*alpha;
  const lambda=c=>.5*(Math.sqrt(1+a2*(1-c*c)/(c*c))-1);
  const lv=lambda(noV);let sum=0;
  for(let i=0;i<count;i++) {
    const u=(i+.5)/count,phi=i*2.399963229728653;
    const z=Math.sqrt((1-u)/(1+(a2-1)*u)),r=Math.sqrt(1-z*z),x=Math.cos(phi)*r;
    const voH=view[0]*x+noV*z,noL=2*voH*z-noV;
    if(voH<=0||noL<=0)continue;
    const fresnel=.0204+.9796*(1-voH)**5,g=1/(1+lv+lambda(noL));
    sum+=fresnel*g*voH/(noV*z);
  }
  return sum/count;
}
export async function waterReflectionCheck(page,{name,dir,rows,errors}) {
  if(!await page.evaluate(()=>Boolean(window.__READY&&window.__world))) {
    await page.goto('http://localhost:8765/?shot=1&hud=0&time=12.87',{waitUntil:'domcontentloaded'});
    await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:120000});
  }
  const queries=[];
  for(const alpha of [.09,.17,.3,.42,.62])for(const cosine of [.005,.02,.05,.1,.2,.4,.7,1])queries.push({alpha,cosine});
  const actual=await page.evaluate(async queries=>{
    const {WATER_REFLECTION_GLSL}=await import('/src/water-reflection.js');
    const w=window.__world,R=w.renderer,T=w.THREE;
    const data=new Float32Array(queries.length*4);
    queries.forEach((q,i)=>{data[i*4]=q.alpha;data[i*4+1]=q.cosine;});
    const texture=new T.DataTexture(data,queries.length,1,T.RGBAFormat,T.FloatType);texture.needsUpdate=true;
    const material=new T.ShaderMaterial({uniforms:{uQuery:{value:texture}},
      vertexShader:'void main(){gl_Position=vec4(position.xy,0,1);}',
      fragmentShader:`uniform sampler2D uQuery;
        vec3 atSkyRadiance(vec3 direction){return vec3(1.0);}
        ${WATER_REFLECTION_GLSL}
        void main(){vec2 q=texelFetch(uQuery,ivec2(int(gl_FragCoord.x),0),0).rg;
          gl_FragColor=waterSkyReflection(vec3(sqrt(1.0-q.y*q.y),q.y,0),vec3(0,1,0),q.x,.0204);}`});
    const scene=new T.Scene(),mesh=new T.Mesh(new T.PlaneGeometry(2,2),material);scene.add(mesh);
    const target=new T.WebGLRenderTarget(queries.length,1,{type:T.FloatType,depthBuffer:false});
    const previous=R.getRenderTarget(),autoClear=R.autoClear;
    R.autoClear=true;R.setRenderTarget(target);R.render(scene,new T.Camera());
    const output=new Float32Array(queries.length*4);R.readRenderTargetPixels(target,0,0,queries.length,1,output);
    R.setRenderTarget(previous);R.autoClear=autoClear;
    const result={values:queries.map((_,i)=>Array.from(output.slice(i*4,i*4+4))),gpuError:R.getContext().getError()};
    mesh.geometry.dispose();material.dispose();texture.dispose();target.dispose();return result;
  },queries);
  writeFileSync(new URL(name+'-reflection-raw.json',dir),JSON.stringify(actual,null,2)+'\n');
  let maximumError=0,meanError=0;
  for(let i=0;i<queries.length;i++) {
    const q=queries[i],rgba=actual.values[i];q.gpu=rgba[3];q.reference=reference(q.cosine,q.alpha);
    q.error=Math.abs(q.gpu-q.reference);maximumError=Math.max(maximumError,q.error);meanError+=q.error;
    assert(rgba.every(v=>Number.isFinite(v)&&v>=0&&v<=1),'Finite, energy-bounded unit-environment reflection');
    assert(Math.max(...rgba)-Math.min(...rgba)<1e-6,'Unit sky integrates to the Fresnel energy complement');
  }
  meanError/=queries.length;
  const result={queries,maximumError,meanError,gpuError:actual.gpuError};
  writeFileSync(new URL(name+'-reflection-integral.json',dir),JSON.stringify(result,null,2)+'\n');
  rows.push({view:'water-reflection-integral',queries:queries.length,maximumError,meanError,gpuError:actual.gpuError});
  console.log(JSON.stringify(rows.at(-1)));
  if(actual.gpuError||maximumError>.035||meanError>.008)errors.push('Water reflection quadrature outside integration tolerance');
}
