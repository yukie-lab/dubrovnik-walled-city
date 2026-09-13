import {writeFileSync} from 'node:fs';

export async function woodlandChecks(page,{name,dir,rows,errors}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&x=58&z=-88&gy=24&yaw=-2.303&time=7.9',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY && window.__captureFrame',{timeout:60000});
  if(errors.length)throw new Error(errors.join('\n'));
  const report=await page.evaluate(async()=>{
    const {woodlandWindGLSL,woodlandWindMargin}=await import('/src/woodland-wind.js');
    const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2');
    if(!gl)throw new Error('WebGL2 is required');
    const shader=(type,code)=>{
      const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;
    };
    const v=shader(gl.VERTEX_SHADER,`#version 300 es
      precision highp float;in vec3 position,normal;
      ${woodlandWindGLSL.replaceAll('attribute ','in ')}
      out vec3 feedbackP,feedbackN;out float feedbackDet,feedbackError;
      void main(){
        mat3 j;feedbackP=woodlandPose(position,j);feedbackN=woodlandNormal(normal,j);feedbackDet=determinant(j);
        vec3 t=normalize(cross(abs(normal.y)<.9 ? vec3(0,1,0) : vec3(1,0,0),normal));
        vec3 u=cross(normal,t);float e=.03;mat3 unused;
        vec3 dt=woodlandPose(position+t*e,unused)-woodlandPose(position-t*e,unused);
        vec3 du=woodlandPose(position+u*e,unused)-woodlandPose(position-u*e,unused);
        feedbackError=length(normalize(cross(dt,du))-feedbackN);gl_Position=vec4(feedbackP,1);
      }`);
    const f=shader(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;out vec4 c;void main(){c=vec4(0);}');
    const pr=gl.createProgram();gl.attachShader(pr,v);gl.attachShader(pr,f);
    gl.transformFeedbackVaryings(pr,['feedbackP','feedbackN','feedbackDet','feedbackError'],gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(pr);if(!gl.getProgramParameter(pr,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(pr));gl.useProgram(pr);
    const results=[],batches=[];window.__world.scene.traverse(m=>{if(m.name==='surround.pine')batches.push(m);});
    let vertices=0;
    for(let batch=0;batch<batches.length;batch++) {
      const mesh=batches[batch],g=mesh.geometry,count=g.attributes.position.count;
      if(!mesh.customDepthMaterial)throw new Error('Missing moving tree depth material');
      if(mesh.customDepthMaterial.userData.treeTime!==mesh.material.userData.treeTime ||
        mesh.customDepthMaterial.userData.treeWind!==mesh.material.userData.treeWind)throw new Error('Color and depth wind must share uniforms');
      const vao=gl.createVertexArray();gl.bindVertexArray(vao);const buffers=[];
      for(const key of ['position','normal','aTree']) {
        const a=g.attributes[key],location=gl.getAttribLocation(pr,key),b=gl.createBuffer();buffers.push(b);
        gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,a.array,gl.STATIC_DRAW);
        gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,a.itemSize,gl.FLOAT,false,0,0);
      }
      const buffer=gl.createBuffer(),feedback=gl.createTransformFeedback(),data=new Float32Array(count*8);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,buffer);
      gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,data.byteLength,gl.STREAM_READ);gl.enable(gl.RASTERIZER_DISCARD);
      for(const wind of [0,mesh.material.userData.treeWind.value])for(const time of [0,1.7,4.3,8.9]) {
        gl.uniform1f(gl.getUniformLocation(pr,'uTreeW'),wind);gl.uniform1f(gl.getUniformLocation(pr,'uTreeT'),time);
        gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,count);gl.endTransformFeedback();
        gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,data);
        let minDet=Infinity,maxError=0,badNormals=0,badBounds=0,maxRootMotion=0;
        const p=g.attributes.position,a=g.attributes.aTree;
        for(let i=0;i<count;i++) {
          const k=i*8,length=Math.hypot(data[k+3],data[k+4],data[k+5]);
          const move=Math.hypot(data[k]-p.getX(i),data[k+1]-p.getY(i),data[k+2]-p.getZ(i));
          if(!Number.isFinite(length)||Math.abs(length-1)>.002)badNormals++;
          if(move>woodlandWindMargin(1/a.getY(i),wind,a.getW(i)))badBounds++;
          if(p.getY(i)<=a.getX(i))maxRootMotion=Math.max(maxRootMotion,move);
          minDet=Math.min(minDet,data[k+6]);maxError=Math.max(maxError,data[k+7]);
        }
        results.push({batch,wind,time,vertices:count,minDet,maxError,badNormals,badBounds,maxRootMotion});
      }
      vertices+=count;gl.disable(gl.RASTERIZER_DISCARD);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);
      for(const b of buffers)gl.deleteBuffer(b);gl.deleteBuffer(buffer);gl.deleteTransformFeedback(feedback);gl.deleteVertexArray(vao);
    }
    gl.deleteProgram(pr);gl.deleteShader(v);gl.deleteShader(f);
    return {results,vertices};
  });
  writeFileSync(new URL(name+'-wind.json',dir),JSON.stringify(report,null,2)+'\n');
  const bad=report.results.filter(r=>r.minDet<=0 || r.maxError>.015 || r.badNormals || r.badBounds || r.maxRootMotion>0);
  rows.push({view:'woodland-wind',cases:report.results.length,vertices:report.vertices,
    minDet:Math.min(...report.results.map(r=>r.minDet)),maxNormalError:Math.max(...report.results.map(r=>r.maxError)),bad});
  console.log(JSON.stringify(rows.at(-1)));if(bad.length)errors.push('Tree wind differential, roots or animated bounds failed');
}
