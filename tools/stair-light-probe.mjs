import {writeFileSync} from 'node:fs';

// Compare the actual city shadow texture at visible stair surfaces with
// independent rays through the constructed enclosure. A blocked CPU ray is
// sufficient proof that no direct sunlight may reach that point.
export async function stairLightChecks(page,{name,dir,rows,errors}) {
  for(const time of [7.9,12.87]) {
    await page.goto('http://localhost:8765/?shot=1&hud=0&x=-102.5&z=-74.6&gy=20.7&yaw=1.346085&pitch=.045&fov=60&time='+time,{waitUntil:'domcontentloaded'});
    await page.waitForFunction('window.__READY&&window.__captureFrame',{timeout:60000});
    for(let i=0;i<5;i++)await page.evaluate(()=>window.__captureFrame());
    const result=await page.evaluate(()=>{
      const w=window.__world,{THREE:T,renderer,camera,scene}=w,sun=w.lighting.sun,wall=scene.getObjectByName('wall.curtain'),steps=scene.getObjectByName('steps');
      const enclosure=wall.geometry.clone();
      enclosure.setIndex(wall.geometry.userData.stairSolids.filter(s=>s.id==='mincetaShaft')
        .flatMap(s=>Array.from(wall.geometry.index.array.slice(s.from*3,s.to*3))));
      const shell=new T.Mesh(enclosure,new T.MeshBasicMaterial({side:T.DoubleSide}));
      const ray=new T.Raycaster(),lightRay=new T.Raycaster(),direction=sun.position.clone().sub(sun.target.position).normalize(),probes=[];
      for(let y=90;y<1000;y+=36)for(let x=150;x<1450;x+=36) {
        ray.setFromCamera(new T.Vector2((x+.5)/1600*2-1,1-(y+.5)/1000*2),camera);
        const hit=ray.intersectObjects([wall,steps],false)[0];if(!hit)continue;
        const g=hit.object.geometry,p=g.attributes.position,n=g.attributes.normal;
        const flag=hit.object===wall?g.attributes.aStairWall:g.attributes.aStair;
        if(!flag||flag.getX(hit.face.a)<.5)continue;
        const a=new T.Vector3().fromBufferAttribute(p,hit.face.a),b=new T.Vector3().fromBufferAttribute(p,hit.face.b),c=new T.Vector3().fromBufferAttribute(p,hit.face.c);
        const bary=new T.Triangle(a,b,c).getBarycoord(hit.point,new T.Vector3()),normal=new T.Vector3();
        for(const [i,k] of [[hit.face.a,bary.x],[hit.face.b,bary.y],[hit.face.c,bary.z]])normal.addScaledVector(new T.Vector3().fromBufferAttribute(n,i),k);
        lightRay.set(hit.point.clone().addScaledVector(normal,.008),direction);lightRay.near=.005;lightRay.far=50;
        const blocked=lightRay.intersectObject(shell,false).length>0;
        probes.push({pixel:[x,y],point:hit.point.toArray(),normal:normal.toArray(),tag:hit.object.name,blocked});
      }
      const count=probes.length,texture=fn=>{
        const data=new Float32Array(count*4);probes.forEach((p,i)=>data.set(fn(p),i*4));
        const tex=new T.DataTexture(data,count,1,T.RGBAFormat,T.FloatType);tex.needsUpdate=true;return tex;
      };
      const positions=texture(p=>[...p.point,1]),normals=texture(p=>[...p.normal,1]),pixels=texture(p=>[p.pixel[0]+.5,1000-p.pixel[1]-.5,0,1]);
      const local=renderer.properties.get(steps.material).uniforms;
      const mat=new T.RawShaderMaterial({glslVersion:T.GLSL3,depthTest:false,depthWrite:false,
        uniforms:{uPoint:{value:positions},uNormal:{value:normals},uPixel:{value:pixels},uShadow:{value:sun.shadow.map.depthTexture},
          uMatrix:{value:sun.shadow.matrix},uSize:{value:sun.shadow.mapSize},uBias:{value:sun.shadow.bias},uNormalBias:{value:sun.shadow.normalBias},uRadius:{value:sun.shadow.radius},
          uLocalDepth:{value:local.uStairDepth?.value||sun.shadow.map.depthTexture},uLocalMatrix:{value:local.uStairMatrix?.value||new T.Matrix4()},
          uLocalBias:{value:local.uStairDepthBias?.value||0},uLocalActive:{value:local.uStairRoom?.value||0},uLocalStrength:{value:local.uStairShadowStrength?.value||0}},
        vertexShader:'precision highp float; in vec3 position; in vec2 uv; out vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,1.0);}',
        fragmentShader:`precision highp float; precision highp int; precision highp sampler2DShadow;
          in vec2 vUv; out vec4 result; uniform sampler2D uPoint,uNormal,uPixel; uniform sampler2DShadow uShadow;
          uniform mat4 uMatrix,uLocalMatrix; uniform vec2 uSize; uniform float uBias,uNormalBias,uRadius,uLocalBias,uLocalActive,uLocalStrength;
          uniform sampler2DShadow uLocalDepth; vec2 probePixel;
          #define USE_SHADOWMAP
          #define SHADOWMAP_TYPE_PCF
          #include <common>
          ${T.ShaderChunk.shadowmap_pars_fragment.replaceAll('gl_FragCoord.xy','probePixel')}
          void main(){probePixel=texture(uPixel,vUv).xy;
            vec3 p=texture(uPoint,vUv).xyz+texture(uNormal,vUv).xyz*uNormalBias;
            float s=getShadow(uShadow,uSize,1.0,uBias,uRadius,uMatrix*vec4(p,1.0));
            vec4 lc=uLocalMatrix*vec4(texture(uPoint,vUv).xyz+texture(uNormal,vUv).xyz*.004,1.0);vec3 lp=lc.xyz/lc.w;
            float ls=1.0;if(uLocalActive>.5&&all(greaterThanEqual(lp,vec3(0)))&&all(lessThanEqual(lp,vec3(1))))
              ls=mix(1.0,texture(uLocalDepth,vec3(lp.xy,lp.z-uLocalBias)),uLocalStrength);
            result=vec4(s,min(s,ls),ls,1.0);}`});
      const target=new T.WebGLRenderTarget(count,1),probeScene=new T.Scene();probeScene.add(new T.Mesh(new T.PlaneGeometry(2,2),mat));
      const oldTarget=renderer.getRenderTarget();renderer.setRenderTarget(target);renderer.render(probeScene,new T.Camera());
      const gl=renderer.getContext(),program=[...renderer.properties.get(mat).programs.values()][0];
      if(!gl.getProgramParameter(program.program,gl.LINK_STATUS))throw new Error('Shadow probe shader did not link');
      const bytes=new Uint8Array(count*4);renderer.readRenderTargetPixels(target,0,0,count,1,bytes);renderer.setRenderTarget(oldTarget);
      probes.forEach((p,i)=>{p.cityShadow=bytes[i*4]/255;p.shadow=bytes[i*4+1]/255;p.localShadow=bytes[i*4+2]/255;});
      // A filtered shadow has partial visibility at a geometric edge. Classify
      // it separately from sunlight leaking into the occluded interior.
      for(const p of probes.filter(p=>p.blocked&&p.cityShadow>.1)) {
        const normal=new T.Vector3(...p.normal).normalize(),u=new T.Vector3(Math.abs(normal.y)>.95?1:0,Math.abs(normal.y)>.95?0:1,0).cross(normal).normalize();
        const v=new T.Vector3().crossVectors(normal,u);let open=0;
        for(let i=0;i<8;i++) {
          const a=i*Math.PI/4,origin=new T.Vector3(...p.point).addScaledVector(normal,.008)
            .addScaledVector(u,.02*Math.cos(a)).addScaledVector(v,.02*Math.sin(a));
          lightRay.set(origin,direction);if(!lightRay.intersectObject(shell,false).length)open++;
        }
        p.edgeWithin20mm=open>0;p.edgeOpenSamples=open;
      }
      const leaks=probes.filter(p=>p.blocked&&p.shadow>.1);
      const report={probes:count,enclosureBlocked:probes.filter(p=>p.blocked).length,leaks:leaks.length,cityLeaks:probes.filter(p=>p.blocked&&p.cityShadow>.1).length,
        interiorLeaks:leaks.filter(p=>!p.edgeWithin20mm).length,cityInteriorLeaks:probes.filter(p=>p.blocked&&p.cityShadow>.1&&!p.edgeWithin20mm).length,
        maxLeak:Math.max(0,...leaks.map(p=>p.shadow)),shadowTexelM:(sun.shadow.camera.right-sun.shadow.camera.left)/sun.shadow.mapSize.x,
        biasM:-sun.shadow.bias*(sun.shadow.camera.far-sun.shadow.camera.near),normalBiasM:sun.shadow.normalBias,points:probes};
      target.dispose();mat.dispose();positions.dispose();normals.dispose();pixels.dispose();enclosure.dispose();shell.material.dispose();
      return report;
    });
    writeFileSync(new URL(name+'-'+time+'-shadow-probes.json',dir),JSON.stringify(result,null,2)+'\n');
    const png=await page.evaluate(()=>window.__captureFrame());writeFileSync(new URL(name+'-'+time+'.png',dir),Buffer.from(png.split(',')[1],'base64'));
    const {points,...summary}=result;rows.push({view:'stair-light',time,...summary});console.log(JSON.stringify(rows.at(-1)));
  }
}
