import {writeFileSync} from 'node:fs';

export async function folkSoleChecks(page,{name,dir,rows,errors}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&time=12.87&x=-138&z=-1.2&yaw=-1.62',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:90000});
  const result=await page.evaluate(async()=>{
    const w=window.__world,T=w.THREE;
    const {folkPoseGLSL}=await import('/src/folk-pose.js');
    const {makeGroundSupport}=await import('/src/support.js');
    // LOD compacts the real merged index buffers. A city-wide floor survey
    // must restore those solids before reading them, including offscreen steps.
    w.instanceLOD.enabled=false;w.instanceLOD.restoreActors();
    for(const batch of w.instanceLOD.batches)batch.restore();
    const surfaces=new T.Group();
    for(const name of ['ground.near','ground.stradun','ground.paving','wall.curtain','steps']) {
      const source=w.scene.getObjectByName(name),m=new T.Mesh(source.geometry);
      m.matrixAutoUpdate=false;m.matrix.copy(source.matrixWorld);m.name='ground.paving';surfaces.add(m);
    }
    const support=makeGroundSupport(surfaces),g=w.scene.getObjectByName('life.folkLegs').geometry;
    const P=[],limbs=[];
    for(let i=0;i<g.attributes.position.count;i++)if(g.attributes.position.getY(i)<.014) {
      P.push(g.attributes.position.getX(i),g.attributes.position.getY(i),g.attributes.position.getZ(i));
      limbs.push(g.attributes.aLimb.getX(i));
    }
    const gl=document.createElement('canvas').getContext('webgl2');
    const shader=(type,source)=>{
      const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;
    };
    const vertex=shader(gl.VERTEX_SHADER,`#version 300 es
      precision highp float;in vec3 position;uniform mat4 uWorld;
      ${folkPoseGLSL.replaceAll('attribute ','in ')}
      out vec3 worldSole;
      void main(){worldSole=(uWorld*vec4(folkPose(position).p,1.0)).xyz;gl_Position=vec4(worldSole,1.0);}`);
    const fragment=shader(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;out vec4 c;void main(){c=vec4(0.);}');
    const program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);
    gl.transformFeedbackVaryings(program,['worldSole'],gl.INTERLEAVED_ATTRIBS);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);gl.bindVertexArray(gl.createVertexArray());
    for(const [key,data,size]of [['position',P,3],['aLimb',limbs,1]]) {
      gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);
      const loc=gl.getAttribLocation(program,key);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,0,0);
    }
    const walk=gl.getAttribLocation(program,'aWalk'),gait=gl.getAttribLocation(program,'aGait');
    const feedback=gl.createTransformFeedback(),out=gl.createBuffer(),data=new Float32Array(P.length);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,out);
    gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,data.byteLength,gl.STREAM_READ);gl.enable(gl.RASTERIZER_DISCARD);
    const mat=new T.Matrix4(),cases=new Map();let samples=0,missing=0,maxGap=0,maxSink=0;
    const legs=w.scene.getObjectByName('life.folkLegs'),sun=w.sunState;
    for(let time=0;time<=120;time+=5) {
      w.life.update(time,sun,null,null);gl.uniform1f(gl.getUniformLocation(program,'uT'),time);
      for(let id=0;id<w.life.folk.length;id++) {
        const f=w.life.folk[id];if(f.sit||f.curS===0)continue;
        legs.getMatrixAt(id,mat);gl.uniformMatrix4fv(gl.getUniformLocation(program,'uWorld'),false,mat.elements);
        gl.vertexAttrib1f(walk,f.curW);gl.vertexAttrib4f(gait,f._ph,f._cad,0,f._pose);
        gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,limbs.length);gl.endTransformFeedback();
        gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,data);
        let minGap=Infinity,hit=null;
        for(let k=0;k<data.length;k+=3) {
          const ground=support.sample(data[k],data[k+2],f.curY+.55);
          if(!ground){missing++;continue;}
          const gap=data[k+1]-ground.y;
          if(gap<minGap){minGap=gap;hit={vertex:k/3,sole:[data[k],data[k+1],data[k+2]],ground:ground.y};}
        }
        samples++;
        maxGap=Math.max(maxGap,minGap);maxSink=Math.min(maxSink,minGap);
        if(Math.abs(minGap)<=.02)continue;
        let row=cases.get(id);
        if(!row){row={id,walking:!!f.walk,maxFloat:0,maxSink:0,samples:0,example:null};cases.set(id,row);}
        row.samples++;row.maxFloat=Math.max(row.maxFloat,minGap);row.maxSink=Math.min(row.maxSink,minGap);
        if(!row.example||Math.abs(minGap)>Math.abs(row.example.gap))row.example={time,x:f.curX,y:f.curY,z:f.curZ,gap:minGap,...hit,
          matrix:mat.elements.slice(),pose:f._pose,phase:f._ph,cadence:f._cad,walk:f.curW,soles:Array.from(data)};
      }
    }
    const residents=[...cases.values()].sort((a,b)=>Math.max(b.maxFloat,-b.maxSink)-Math.max(a.maxFloat,-a.maxSink));
    return {population:w.life.folk.length,samples,soleVertices:limbs.length,missing,maxGap,maxSink,gpuError:gl.getError(),
      affected:residents.length,walkingAffected:residents.filter(f=>f.walking).length,residents};
  });
  writeFileSync(new URL(name+'-sole.json',dir),JSON.stringify(result,null,2)+'\n');
  rows.push({view:'folk-soles',...result,residents:result.residents.slice(0,12).map(r=>({...r,example:{...r.example,soles:undefined,matrix:undefined}}))});
  console.log(JSON.stringify(rows.at(-1)));
  if(result.gpuError)errors.push('Sole transform feedback failed: '+result.gpuError);
  if(result.missing||result.maxGap>.002||result.maxSink<-.002)
    errors.push(`Posed soles need support: missing=${result.missing}, float=${result.maxGap}, sink=${result.maxSink}`);
}
