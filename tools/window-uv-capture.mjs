import {writeFileSync} from 'node:fs';

// Run the vertex programs actually compiled for the visible window materials
// on an isolated WebGL2 context. Transform feedback checks every source window,
// including the anisotropic scales that view/occlusion LOD currently omits.
export async function windowUVChecks(page,{name,dir,rows,errors}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&x=-149.1&z=-17.317453&yaw=-1.5707963&pitch=.26&gy=5.3&fov=50&time=12.87',
    {waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY && window.__captureFrame',{timeout:60000});
  for(let i=0;i<3;i++)await page.evaluate(()=>window.__captureFrame());
  const report=await page.evaluate(()=>{
    const {THREE:T,scene,renderer,instanceLOD}=window.__world,sourceGL=renderer.getContext();
    const results=[];
    for(const [name,coverU,coverV] of [['window.frame',.9,.9],['window.sash',.9,3.2]]) {
      const mesh=scene.getObjectByName(name),g=mesh.geometry,batch=instanceLOD.batches.find(b=>b.mesh===mesh);
      const source=attribute=>batch.streams.find(s=>s.attribute===attribute)?.source||attribute.array;
      const program=[...renderer.properties.get(mesh.material).programs.values()][0];
      const code=sourceGL.getShaderSource(program.vertexShader);
      const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2');
      const shader=(type,text)=>{const s=gl.createShader(type);gl.shaderSource(s,text);gl.compileShader(s);
        if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
      const vs=shader(gl.VERTEX_SHADER,code),fs=shader(gl.FRAGMENT_SHADER,
        '#version 300 es\nprecision highp float;out vec4 c;void main(){c=vec4(0);}');
      const p=gl.createProgram();gl.attachShader(p,vs);gl.attachShader(p,fs);
      gl.transformFeedbackVaryings(p,['vMapUv','vNormalMapUv'],gl.INTERLEAVED_ATTRIBS);
      gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
      gl.useProgram(p);const vao=gl.createVertexArray();gl.bindVertexArray(vao);const buffers=[];
      for(let i=0;i<gl.getProgramParameter(p,gl.ACTIVE_ATTRIBUTES);i++) {
        const a=gl.getActiveAttrib(p,i),attribute=a.name==='instanceMatrix'?mesh.instanceMatrix:
          a.name==='instanceColor'?mesh.instanceColor:g.attributes[a.name];
        if(!attribute)throw new Error('Unbound active attribute '+a.name);
        const columns=a.type===gl.FLOAT_MAT4?4:1,size=attribute.itemSize/columns,location=gl.getAttribLocation(p,a.name);
        const buffer=gl.createBuffer();buffers.push(buffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
        gl.bufferData(gl.ARRAY_BUFFER,source(attribute),gl.STATIC_DRAW);
        for(let c=0;c<columns;c++) {
          gl.enableVertexAttribArray(location+c);gl.vertexAttribPointer(location+c,size,gl.FLOAT,false,attribute.itemSize*4,c*size*4);
          gl.vertexAttribDivisor(location+c,attribute.isInstancedBufferAttribute?1:0);
        }
      }
      for(const key of ['modelMatrix','modelViewMatrix','projectionMatrix','viewMatrix'])
        gl.uniformMatrix4fv(gl.getUniformLocation(p,key),false,new T.Matrix4().elements);
      for(const key of ['normalMatrix','mapTransform','normalMapTransform'])
        gl.uniformMatrix3fv(gl.getUniformLocation(p,key),false,new T.Matrix3().elements);
      const vertices=g.attributes.position.count,instances=batch.capacity,data=new Float32Array(vertices*instances*4);
      const out=gl.createBuffer(),tf=gl.createTransformFeedback();gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,tf);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,out);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,data.byteLength,gl.STREAM_READ);
      gl.enable(gl.RASTERIZER_DISCARD);gl.beginTransformFeedback(gl.POINTS);
      gl.drawArraysInstanced(gl.POINTS,0,vertices,instances);gl.endTransformFeedback();
      gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,data);
      if(gl.getError()!==gl.NO_ERROR)throw new Error('Window transform feedback GL error');
      let maxMetricErrorM=0,maxMapNormalDifference=0,nonFinite=0,minV=Infinity,maxV=-Infinity,minPlankMargin=Infinity;
      const matrix=new T.Matrix4(),points=[new T.Vector3(),new T.Vector3(),new T.Vector3()],matrices=source(mesh.instanceMatrix);
      for(let i=0;i<instances;i++) {
        matrix.fromArray(matrices,i*16);
        for(let j=0;j<vertices;j+=3) {
          for(let k=0;k<3;k++) {
            const id=(i*vertices+j+k)*4,u=data[id],v=data[id+1];
            if(!Number.isFinite(u+v+data[id+2]+data[id+3]))nonFinite++;
            maxMapNormalDifference=Math.max(maxMapNormalDifference,Math.abs(u-data[id+2]),Math.abs(v-data[id+3]));
            minV=Math.min(minV,v);maxV=Math.max(maxV,v);const cell=u*6-Math.floor(u*6);
            minPlankMargin=Math.min(minPlankMargin,cell,1-cell);
            points[k].fromBufferAttribute(g.attributes.position,j+k).applyMatrix4(matrix);
          }
          for(let k=0;k<3;k++) {
            const a=(i*vertices+j+k)*4,b=(i*vertices+j+(k+1)%3)*4;
            const metres=Math.hypot((data[a]-data[b])*coverU,(data[a+1]-data[b+1])*coverV);
            maxMetricErrorM=Math.max(maxMetricErrorM,Math.abs(metres-points[k].distanceTo(points[(k+1)%3])));
          }
        }
      }
      results.push({name,instances,vertices:vertices*instances,triangles:vertices*instances/3,maxMetricErrorM,
        maxMapNormalDifference,nonFinite,minV,maxV,minPlankMargin});
      gl.disable(gl.RASTERIZER_DISCARD);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);
      buffers.forEach(b=>gl.deleteBuffer(b));gl.deleteBuffer(out);gl.deleteTransformFeedback(tf);gl.deleteVertexArray(vao);
      gl.deleteProgram(p);gl.deleteShader(vs);gl.deleteShader(fs);gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    return results;
  });
  writeFileSync(new URL(name+'-window-uv.json',dir),JSON.stringify(report,null,2)+'\n');
  rows.push(...report.map(r=>({view:'window-uv',...r})));report.forEach(r=>console.log(JSON.stringify(r)));
  if(report.some(r=>r.maxMetricErrorM>.00001||r.maxMapNormalDifference>1e-6||r.nonFinite||
    r.name==='window.sash'&&(r.minV<.0749||r.maxV>.9251||r.minPlankMargin<.014)))errors.push('Window metric UV or atlas boundary failed');
}
