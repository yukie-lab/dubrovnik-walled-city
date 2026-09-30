import {writeFileSync} from 'node:fs';

// Execute the production leaf material and compare its shading normal against
// independently intersected finite faces, including both sides and oblique views.
export async function foliageNormalGPUCheck(page,{name,dir,rows,errors}) {
  const result=await page.evaluate(()=>{
    const w=window.__world,T=w.THREE,r=w.renderer,source=w.scene.getObjectByName('surround.foliage');
    const geometry=new T.BufferGeometry();
    for(const key of ['position','normal','color'])geometry.setAttribute(key,source.geometry.attributes[key].clone());
    geometry.setIndex(source.geometry.index.clone());
    geometry.setAttribute('aTree',new T.InstancedBufferAttribute(new Float32Array([0,.1,.37,1]),4));
    geometry.setAttribute('aNeedle',new T.InstancedBufferAttribute(new Float32Array([0]),1));
    geometry.setAttribute('aLeafGrowth',new T.InstancedBufferAttribute(new Float32Array([0,0]),2));
    const morph=new T.DataTexture(new Float32Array([1,0,0,0]),1,1,T.RGBAFormat,T.FloatType);morph.needsUpdate=true;
    const material=source.material.clone();
    material.onBeforeCompile=(shader,renderer)=>{
      source.material.onBeforeCompile(shader,renderer);
      shader.uniforms.uTreeW={value:0};shader.uniforms.uTreeT={value:0};
      shader.uniforms.uLeafMorph={value:morph};shader.uniforms.uLeafMorphSize={value:new T.Vector2(1,1)};
      shader.uniforms.uRadianceScale={value:1};
      if(!shader.fragmentShader.includes('#include <opaque_fragment>'))throw new Error('Leaf normal output hook missing');
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',
        'gl_FragColor=vec4(normal*.5+.5,1.0);return;');
    };
    material.customProgramCacheKey=()=>source.material.customProgramCacheKey()+'|normal-inspection';
    const scene=new T.Scene(),mesh=new T.InstancedMesh(geometry,material,1);scene.add(mesh);
    const camera=new T.OrthographicCamera(-.26,.26,.26,-.26,.1,10);camera.position.z=2;camera.updateMatrixWorld(true);
    const size=192,target=new T.WebGLRenderTarget(size,size,{type:T.FloatType}),pixels=new Float32Array(size*size*4);
    const oldTarget=r.getRenderTarget(),clearColor=r.getClearColor(new T.Color()),alpha=r.getClearAlpha();
    const matrix=new T.Matrix4(),rotation=new T.Quaternion(),normalMatrix=new T.Matrix3(),ray=new T.Raycaster();
    const cases=[];
    try {
      r.setClearColor(0x000000,0);
      for(const flat of [false,source.material.flatShading])for(const angle of [0,.6,-.8,Math.PI-.5,Math.PI]) {
        material.flatShading=flat;material.needsUpdate=true;
        rotation.setFromEuler(new T.Euler(.2,angle,.37));matrix.compose(new T.Vector3(),rotation,new T.Vector3(.30,.40,.18));
        mesh.setMatrixAt(0,matrix);mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.updateMatrixWorld(true);
        normalMatrix.getNormalMatrix(new T.Matrix4().multiplyMatrices(camera.matrixWorldInverse,matrix));
        r.setRenderTarget(target);r.clear();r.render(scene,camera);r.readRenderTargetPixels(target,0,0,size,size,pixels);
        let samples=0,inward=0,maxVectorError=0,sumSquared=0;
        for(let y=2;y<size-2;y+=3)for(let x=2;x<size-2;x+=3) {
          const offset=(y*size+x)*4;if(pixels[offset+3]<.5)continue;
          ray.setFromCamera(new T.Vector2((x+.5)/size*2-1,(y+.5)/size*2-1),camera);
          const hit=ray.intersectObject(mesh,false)[0];if(!hit)continue;
          const local=hit.point.clone().applyMatrix4(matrix.clone().invert());
          const face=hit.face,vertices=[face.a,face.b,face.c].map(i=>new T.Vector3().fromBufferAttribute(geometry.attributes.position,i));
          const bary=new T.Triangle(...vertices).getBarycoord(local,new T.Vector3());
          if(Math.min(bary.x,bary.y,bary.z)<.03)continue; // Exclude edge rasterization ownership.
          const expected=face.normal.clone().applyMatrix3(normalMatrix).normalize();
          const actual=new T.Vector3(...pixels.subarray(offset,offset+3)).multiplyScalar(2).subScalar(1).normalize();
          const error=actual.distanceTo(expected);maxVectorError=Math.max(maxVectorError,error);sumSquared+=error*error;
          samples++;if(actual.dot(expected)<0)inward++;
        }
        cases.push({flat,angle,samples,inward,maxVectorError,rmsVectorError:Math.sqrt(sumSquared/samples)});
      }
      const production=[];w.scene.traverse(o=>{if(o.name==='surround.foliage')production.push({instances:o.instanceMatrix.count,flat:o.material.flatShading});});
      return {production,cases,gpuError:r.getContext().getError()};
    } finally {
      r.setRenderTarget(oldTarget);r.setClearColor(clearColor,alpha);geometry.dispose();material.dispose();morph.dispose();target.dispose();mesh.dispose();
    }
  });
  rows.push({view:'foliage-normal-gpu',...result});console.log(JSON.stringify(result));
  writeFileSync(new URL(name+'-normal-gpu.json',dir),JSON.stringify(result,null,2)+'\n');
  if(result.gpuError||result.production.some(p=>!p.flat)||result.cases.filter(c=>c.flat).some(c=>c.samples<100||c.inward||c.maxVectorError>.002))
    errors.push('Production leaf shading differs from the actual finite face normal');
}
