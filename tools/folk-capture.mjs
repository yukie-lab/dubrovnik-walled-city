import {writeFileSync} from 'node:fs';

// Transform feedback runs the actual production pose and source geometry.
// Compare its normal with independent finite differences of the same surface,
// inspect joint Jacobians, sole supports and the conservative actor bounds.
export async function folkChecks(page,{name,dir,rows,errors}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&x=-138&z=-1.2&yaw=-1.62&time=12.87',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY && window.__captureFrame',{timeout:60000});
  if(errors.length)throw new Error(errors.join('\n'));
  const report=await page.evaluate(async()=>{
    const {folkPoseGLSL}=await import('/src/folk-pose.js');
    const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2');
    if(!gl)throw new Error('Transform feedback requires WebGL2');
    const shader=(type,code)=>{const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
    const v=shader(gl.VERTEX_SHADER,`#version 300 es
      precision highp float;
      in vec3 position,normal;
      ${folkPoseGLSL.replaceAll('attribute ','in ')}
      out vec3 feedbackP,feedbackN;out float feedbackDet,feedbackError;
      void main() {
        FolkPose f=folkPose(position);feedbackP=f.p;feedbackN=folkNormal(f.j,normal);feedbackDet=determinant(f.j);
        vec3 t=normalize(cross(abs(normal.y)<.9 ? vec3(0.,1.,0.) : vec3(1.,0.,0.),normal));
        vec3 u=cross(normal,t);float e=.0002;
        vec3 dt=folkPose(position+t*e).p-folkPose(position-t*e).p;
        vec3 du=folkPose(position+u*e).p-folkPose(position-u*e).p;
        feedbackError=length(normalize(cross(dt,du))-feedbackN);
        gl_Position=vec4(f.p,1.);
      }`);
    const f=shader(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;out vec4 c;void main(){c=vec4(0.);}');
    const program=gl.createProgram();gl.attachShader(program,v);gl.attachShader(program,f);
    gl.transformFeedbackVaryings(program,['feedbackP','feedbackN','feedbackDet','feedbackError'],gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);gl.uniform1f(gl.getUniformLocation(program,'uT'),0);
    const walk=gl.getAttribLocation(program,'aWalk'),gait=gl.getAttribLocation(program,'aGait');
    const results=[],poses=[];
    for(const amount of [.1,.5,1])for(let i=0;i<16;i++)poses.push({id:`walk-${amount}-${i}`,walk:amount,phase:i*Math.PI/8,sit:0,pose:0});
    for(let i=0;i<4;i++)poses.push({id:`stand-${i}`,walk:0,phase:1.7,sit:0,pose:i});
    for(const sit of [1,2])poses.push({id:`sit-${sit}`,walk:0,phase:.4,sit,pose:0});
    const tags=['life.folkTorso','life.folkArms','life.folkLegs','life.folkHead','life.folkHair'];
    for(const tag of tags) {
      const g=window.__world.scene.getObjectByName(tag).geometry,count=g.attributes.position.count;
      const vao=gl.createVertexArray();gl.bindVertexArray(vao);const buffers=[];
      for(const key of ['position','normal','aLimb']) {
        const attribute=g.attributes[key],location=gl.getAttribLocation(program,key),buffer=gl.createBuffer();buffers.push(buffer);
        gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,attribute.array,gl.STATIC_DRAW);
        gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,attribute.itemSize,gl.FLOAT,false,0,0);
      }
      const output=gl.createBuffer(),feedback=gl.createTransformFeedback(),data=new Float32Array(count*8);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);
      gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,data.byteLength,gl.STREAM_READ);
      gl.enable(gl.RASTERIZER_DISCARD);
      for(const pose of poses) {
        gl.vertexAttrib1f(walk,pose.walk);gl.vertexAttrib4f(gait,pose.phase,0,pose.sit,pose.pose);
        gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,count);gl.endTransformFeedback();
        gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,data);
        let minY=Infinity,minDet=Infinity,maxError=0,maxRadius=0,badNormals=0,minDetVertex=null;
        for(let i=0;i<count;i++) {
          const k=i*8,y=data[k+1],length=Math.hypot(data[k+3],data[k+4],data[k+5]);
          minY=Math.min(minY,y);
          if(data[k+6]<minDet){minDet=data[k+6];minDetVertex=[i,g.attributes.position.getX(i),g.attributes.position.getY(i),g.attributes.position.getZ(i),g.attributes.aLimb.getX(i)];}
          maxError=Math.max(maxError,data[k+7]);
          maxRadius=Math.max(maxRadius,Math.hypot(data[k],y-.98,data[k+2]));
          if(!Number.isFinite(length)||Math.abs(length-1)>.002)badNormals++;
        }
        results.push({tag,pose:pose.id,minY,minDet,minDetVertex,maxError,maxRadius,badNormals});
      }
      gl.disable(gl.RASTERIZER_DISCARD);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);
      for(const b of buffers)gl.deleteBuffer(b);gl.deleteBuffer(output);gl.deleteTransformFeedback(feedback);gl.deleteVertexArray(vao);
    }
    gl.deleteProgram(program);gl.deleteShader(v);gl.deleteShader(f);
    const seated=window.__world.life.folk.reduce((r,f)=>(r[f.sit||0]=(r[f.sit||0]||0)+1,r),{});
    return {results,seated};
  });
  writeFileSync(new URL(name+'-pose.json',dir),JSON.stringify(report,null,2)+'\n');
  const bad=report.results.filter(r=>r.minDet<=0 || r.maxError>.04 || r.maxRadius>1.65 || r.badNormals
    || (r.tag==='life.folkLegs' && (r.minY<-.003 || (!r.pose.startsWith('sit') && r.minY>.003))));
  rows.push({view:'folk-pose',cases:report.results.length,seated:report.seated,
    minDet:Math.min(...report.results.map(r=>r.minDet)),maxNormalError:Math.max(...report.results.map(r=>r.maxError)),bad});
  console.log(JSON.stringify(rows.at(-1)));
  if(bad.length)errors.push(`Pose differential / support / bounds failed in ${bad.length} cases`);
}
