import {writeFileSync} from 'node:fs';

export async function woodlandInstanceChecks(page,{name,dir,rows,errors}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&x=58&z=-88&gy=24&yaw=-2.303&time=7.9',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY && window.__captureFrame',{timeout:60000});
  const all=[];
  for(const detail of [true,false]) {
    await page.evaluate(detail=>{window.__world.instanceLOD.vegetationDetailEnabled=detail;},detail);
    for(let i=0;i<3;i++)await page.evaluate(()=>window.__captureFrame());
    const report=await page.evaluate(async()=>{
      const {woodlandWindGLSL,woodlandWindMargin}=await import('/src/woodland-wind.js');
      const {woodlandMorphGLSL}=await import('/src/woodland-morph.js');
      const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2'),T=window.__world.THREE;
      const shader=(type,code)=>{const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);
        if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
      const vs=shader(gl.VERTEX_SHADER,`#version 300 es
        precision highp float;in vec3 position,normal;in mat4 instanceMatrix;in mat3 referenceNormalMatrix;
        ${woodlandWindGLSL.replaceAll('attribute ','in ')}
        ${woodlandMorphGLSL.replaceAll('attribute ','in ').replaceAll('texture2D(','texture(')}
        out vec3 feedbackP,feedbackN;out float feedbackDet,feedbackError,feedbackMatrixError;
        void main(){
          vec3 p=(instanceMatrix*vec4(woodlandLeafPosition(position),1.0)).xyz;mat3 j;
          feedbackP=woodlandPose(p,j);feedbackN=woodlandInstanceNormal(normal,instanceMatrix,j);feedbackDet=determinant(j);
          vec3 refN=normalize(referenceNormalMatrix*normal);
          feedbackMatrixError=length(feedbackN-woodlandNormal(refN,j));
          vec3 t=normalize(cross(abs(refN.y)<.9 ? vec3(0,1,0) : vec3(1,0,0),refN));
          vec3 u=cross(refN,t);float e=.03;mat3 unused;
          vec3 dt=woodlandPose(p+t*e,unused)-woodlandPose(p-t*e,unused);
          vec3 du=woodlandPose(p+u*e,unused)-woodlandPose(p-u*e,unused);
          feedbackError=length(normalize(cross(dt,du))-feedbackN);gl_Position=vec4(feedbackP,1);
        }`);
      const fs=shader(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;out vec4 c;void main(){c=vec4(0);}');
      const pr=gl.createProgram();gl.attachShader(pr,vs);gl.attachShader(pr,fs);
      gl.transformFeedbackVaryings(pr,['feedbackP','feedbackN','feedbackDet','feedbackError','feedbackMatrixError'],gl.INTERLEAVED_ATTRIBS);
      gl.linkProgram(pr);if(!gl.getProgramParameter(pr,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(pr));gl.useProgram(pr);
      const meshes=[];window.__world.scene.traverse(m=>{if(m.name==='surround.foliage')meshes.push(m);});const results=[];
      for(let batch=0;batch<meshes.length;batch++) {
        const mesh=meshes[batch],g=mesh.geometry,sample=Math.min(256,mesh.count),count=g.attributes.position.count;
        const morph=mesh.userData.leafMorph||{width:1,height:1,data:new Float32Array([1,0,0,0])};
        if(mesh.userData.leafMorph && mesh.customDepthMaterial.userData.leafMorph!==mesh.userData.leafMorph)throw new Error('Leaf growth differs in the shadow pass');
        if(mesh.customDepthMaterial.userData.treeTime!==mesh.material.userData.treeTime ||
          mesh.customDepthMaterial.userData.treeWind!==mesh.material.userData.treeWind)throw new Error('Instanced leaf color and depth must share the wind');
        const matrices=new Float32Array(sample*16),normals=new Float32Array(sample*9),traits=new Float32Array(sample*4);
        const growth=new Float32Array(sample*2);
        const m=new T.Matrix4(),n=new T.Matrix3();
        for(let i=0;i<sample;i++) {
          const id=Math.floor(i*mesh.count/sample);mesh.getMatrixAt(id,m);matrices.set(m.elements,i*16);
          normals.set(n.getNormalMatrix(m).elements,i*9);traits.set(g.attributes.aTree.array.subarray(id*4,id*4+4),i*4);
          if(g.attributes.aLeafGrowth)growth.set(g.attributes.aLeafGrowth.array.subarray(id*2,id*2+2),i*2);
        }
        const vao=gl.createVertexArray();gl.bindVertexArray(vao);const buffers=[];
        for(const [key,array,size,columns,divisor] of [
          ['position',g.attributes.position.array,3,1,0],['normal',g.attributes.normal.array,3,1,0],
          ['instanceMatrix',matrices,4,4,1],['referenceNormalMatrix',normals,3,3,1],['aTree',traits,4,1,1],
          ['aLeafGrowth',growth,2,1,1],
        ]) {
          const location=gl.getAttribLocation(pr,key),b=gl.createBuffer();buffers.push(b);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,array,gl.STATIC_DRAW);
          for(let c=0;c<columns;c++){gl.enableVertexAttribArray(location+c);gl.vertexAttribPointer(location+c,size,gl.FLOAT,false,size*columns*4,c*size*4);gl.vertexAttribDivisor(location+c,divisor);}
        }
        const data=new Float32Array(sample*count*9),out=gl.createBuffer(),feedback=gl.createTransformFeedback();
        const texture=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,morph.width,morph.height,0,gl.RGBA,gl.FLOAT,morph.data);
        gl.uniform1i(gl.getUniformLocation(pr,'uLeafMorph'),0);gl.uniform2f(gl.getUniformLocation(pr,'uLeafMorphSize'),morph.width,morph.height);
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,out);
        gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,data.byteLength,gl.STREAM_READ);gl.enable(gl.RASTERIZER_DISCARD);
        for(const wind of [0,mesh.material.userData.treeWind.value])for(const time of [0,1.7,4.3,8.9]) {
          gl.uniform1f(gl.getUniformLocation(pr,'uTreeT'),time);gl.uniform1f(gl.getUniformLocation(pr,'uTreeW'),wind);
          gl.beginTransformFeedback(gl.POINTS);gl.drawArraysInstanced(gl.POINTS,0,count,sample);gl.endTransformFeedback();
          gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,data);
          let minDet=Infinity,maxError=0,maxMatrixError=0,badNormals=0,badBounds=0,maxBaseError=0;const p=new T.Vector3();
          for(let i=0;i<sample;i++) {
            m.fromArray(matrices,i*16);
            const id=growth[i*2],ordinal=growth[i*2+1],stride=morph.data[id*4],fraction=morph.data[id*4+1];
            const scale=Math.sqrt(stride*(1+fraction*(1-2*(Math.floor(ordinal/stride)%2))));
            for(let v=0;v<count;v++) {
              const k=(i*count+v)*9;p.fromBufferAttribute(g.attributes.position,v);p.y+=.5;p.multiplyScalar(scale);p.y-=.5;p.applyMatrix4(m);
              const distance=Math.hypot(data[k]-p.x,data[k+1]-p.y,data[k+2]-p.z),length=Math.hypot(data[k+3],data[k+4],data[k+5]);
              if(!Number.isFinite(length)||Math.abs(length-1)>.002)badNormals++;
              if(distance>woodlandWindMargin(1/traits[i*4+1],wind,traits[i*4+3]))badBounds++;
              if(wind===0)maxBaseError=Math.max(maxBaseError,distance);
              minDet=Math.min(minDet,data[k+6]);maxError=Math.max(maxError,data[k+7]);maxMatrixError=Math.max(maxMatrixError,data[k+8]);
            }
          }
          results.push({batch,sample,vertices:sample*count,wind,time,minDet,maxError,maxMatrixError,maxBaseError,badNormals,badBounds});
        }
        gl.disable(gl.RASTERIZER_DISCARD);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);
        for(const b of buffers)gl.deleteBuffer(b);gl.deleteTexture(texture);gl.deleteBuffer(out);gl.deleteTransformFeedback(feedback);gl.deleteVertexArray(vao);
      }
      gl.deleteProgram(pr);gl.deleteShader(vs);gl.deleteShader(fs);return results;
    });
    all.push(...report.map(r=>({...r,detail})));
  }
  writeFileSync(new URL(name+'-leaf-wind.json',dir),JSON.stringify(all,null,2)+'\n');
  const bad=all.filter(r=>r.minDet<=0 || r.maxError>.015 || r.maxMatrixError>.001 || r.maxBaseError>.0002 || r.badNormals || r.badBounds);
  rows.push({view:'leaf-wind',cases:all.length,vertices:all.reduce((n,r)=>n+r.vertices,0),
    minDet:Math.min(...all.map(r=>r.minDet)),maxNormalError:Math.max(...all.map(r=>r.maxError)),
    maxMatrixError:Math.max(...all.map(r=>r.maxMatrixError)),maxBaseError:Math.max(...all.map(r=>r.maxBaseError)),bad});
  console.log(JSON.stringify(rows.at(-1)));if(bad.length)errors.push('Instanced leaf wind, normals or bounds failed');
}
