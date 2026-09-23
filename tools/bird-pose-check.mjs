import {writeFileSync} from 'node:fs';

export async function birdPoseCheck(page,{name,dir,rows,errors}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&time=12.87&x=0&z=103&gy=16&yaw=3.1416',
    {waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
  const result=await page.evaluate(async()=>{
    const w=window.__world,T=w.THREE,bird=w.scene.getObjectByName('life.bird');
    const {birdPoseGLSL}=await import('/src/bird-pose.js');
    const {makeGroundSupport}=await import('/src/support.js');
    w.instanceLOD.enabled=false;w.instanceLOD.restoreActors();
    for(const b of w.instanceLOD.batches)b.restore();
    const surfaces=new T.Group();
    for(const name of ['ground.near','ground.paving','ground.stradun','wall.curtain','steps','house.roof','house.ridgeTile']) {
      const source=w.scene.getObjectByName(name),m=new T.Mesh(source.geometry);
      m.matrixAutoUpdate=false;m.matrix.copy(source.matrixWorld);m.name='ground.paving';surfaces.add(m);
    }
    const support=makeGroundSupport(surfaces),g=bird.geometry,p=g.attributes.position,feet=new Map();
    const head=g.attributes.aHead;if(!head)throw new Error('Bird head weights were lost during geometry merge');
    let low=Infinity;for(let i=0;i<p.count;i++)low=Math.min(low,p.getY(i));
    for(let i=0;i<p.count;i++)if(p.getY(i)<low+1e-5) {
      const v=[p.getX(i),p.getY(i),p.getZ(i)];feet.set(v.join(','),v);
    }
    const P=[...feet.values()].flat(),gl=document.createElement('canvas').getContext('webgl2');
    const compile=(kind,source)=>{
      const s=gl.createShader(kind);gl.shaderSource(s,source);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;
    };
    const vertex=compile(gl.VERTEX_SHADER,`#version 300 es
      precision highp float;in vec3 position;uniform mat4 uWorld;
      ${birdPoseGLSL.replace('attribute float aHead,aPh2;','uniform float aHead,aPh2;')}
      out vec3 sole;
      void main(){sole=(uWorld*vec4(birdPose(position),1.0)).xyz;gl_Position=vec4(sole,1.0);}`);
    const fragment=compile(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;out vec4 c;void main(){c=vec4(0.);}');
    const program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);
    gl.transformFeedbackVaryings(program,['sole'],gl.INTERLEAVED_ATTRIBS);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);gl.bindVertexArray(gl.createVertexArray());
    const input=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,input);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(P),gl.STATIC_DRAW);
    const attribute=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(attribute,3,gl.FLOAT,false,0,0);
    const out=gl.createBuffer(),feedback=gl.createTransformFeedback(),data=new Float32Array(P.length);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,out);
    gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,data.byteLength,gl.STREAM_READ);gl.enable(gl.RASTERIZER_DISCARD);
    const matrix=new T.Matrix4(),away=new T.Vector3(1500,300,1500),sun=w.sunState,failures=[];
    const timeLocation=gl.getUniformLocation(program,'uT'),phaseLocation=gl.getUniformLocation(program,'aPh2');
    const matrixLocation=gl.getUniformLocation(program,'uWorld');
    let samples=0,missing=0,maxFloat=0,maxSink=0;
    for(let time=0;time<=120;time+=5) {
      w.life.update(time,sun,away,w.camera);gl.uniform1f(timeLocation,time);
      for(let id=0;id<bird.count;id++) {
        bird.getMatrixAt(id,matrix);matrix.premultiply(bird.matrixWorld);
        gl.uniformMatrix4fv(matrixLocation,false,matrix.elements);gl.uniform1f(phaseLocation,g.attributes.aPh2.getX(id));
        gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,feet.size);gl.endTransformFeedback();
        gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,data);
        let closest=Infinity;
        for(let k=0;k<data.length;k+=3) {
          const y=support.height(data[k],data[k+2],matrix.elements[13]+.6);
          if(y===null){missing++;continue;}
          closest=Math.min(closest,data[k+1]-y);
        }
        samples++;maxFloat=Math.max(maxFloat,closest);maxSink=Math.max(maxSink,-closest);
        if(Math.abs(closest)>.002)failures.push({id,time,closest});
      }
    }
    return {birds:bird.count,samples,feet:feet.size,headVertices:[...head.array].filter(v=>v>0).length,
      missing,maxFloat,maxSink,failures,gpuError:gl.getError()};
  });
  writeFileSync(new URL(name+'-bird-poses.json',dir),JSON.stringify(result,null,2)+'\n');
  rows.push({view:'bird-poses',...result});console.log(JSON.stringify(rows.at(-1)));
  if(result.missing||result.failures.length||result.gpuError)errors.push('Bird posed soles lack actual support');
}
