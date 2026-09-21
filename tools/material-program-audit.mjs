import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';

// Check programs actually acquired by the renderer, not just whether invoking
// onBeforeCompile manually produces plausible shader text.
export async function materialProgramAudit(page,{name,dir,strict=false}) {
  const result=await page.evaluate(()=>{
    const {THREE:T,scene,renderer,camera}=window.__world,gl=renderer.getContext(),seen=new Map();
    scene.traverse(object=>{
      if(!object.isMesh)return;
      for(const material of Array.isArray(object.material)?object.material:[object.material]) {
        if(!seen.has(material))seen.set(material,[]);seen.get(material).push(object.name);
      }
    });
    const rows=[];
    for(const [material,tags] of seen) {
      const type=material.isMeshPhysicalMaterial?'physical':material.isMeshStandardMaterial?'standard':material.isMeshBasicMaterial?'basic':null;
      if(!type)continue;
      const lib=T.ShaderLib[type],shader={vertexShader:lib.vertexShader,fragmentShader:lib.fragmentShader,uniforms:T.UniformsUtils.clone(lib.uniforms),defines:{...material.defines}};
      material.onBeforeCompile(shader,renderer);
      const properties=renderer.properties.get(material),programs=[...(properties.programs?.values()||[])];
      rows.push({tags,type,key:material.customProgramCacheKey(),expected:shader.vertexShader+'\n'+shader.fragmentShader,
        programs:programs.map(program=>{
          const vertex=gl.getShaderSource(program.vertexShader),fragment=gl.getShaderSource(program.fragmentShader);
          if(!vertex||!fragment)throw new Error('Compiled shader source unavailable for '+tags.join(','));
          return {id:program.id,actual:vertex+'\n'+fragment};
        })});
    }
    const ray=new T.Raycaster(),probes=[],terrain=['ground.far','ground.near'].map(tag=>scene.getObjectByName(tag));
    for(const [x,y] of [[80,180],[160,210],[230,240],[320,280],[400,330],[540,360],[650,410]]) {
      ray.setFromCamera(new T.Vector2(x/1600*2-1,1-y/1000*2),camera);
      const hit=ray.intersectObjects(terrain,false)[0];
      if(!hit)continue;
      const object=hit.object,g=object.geometry,p=hit.point.clone().applyMatrix4(object.matrixWorld.clone().invert()),
        a=new T.Vector3().fromBufferAttribute(g.attributes.position,hit.face.a),b=new T.Vector3().fromBufferAttribute(g.attributes.position,hit.face.b),c=new T.Vector3().fromBufferAttribute(g.attributes.position,hit.face.c),
        bary=new T.Triangle(a,b,c).getBarycoord(p,new T.Vector3());
      const color=new T.Vector3();for(const [id,weight] of [[hit.face.a,bary.x],[hit.face.b,bary.y],[hit.face.c,bary.z]])color.addScaledVector(new T.Vector3().fromBufferAttribute(g.attributes.color,id),weight);
      probes.push({pixel:[x,y],tag:object.name,point:hit.point.toArray(),color:color.toArray(),distance:hit.distance});
    }
    return {rows,probes};
  });
  const hash=s=>createHash('sha256').update(s).digest('hex'),owners=new Map();
  const markers=['vWPos','vScrub','vMacroPos','vSkyV','vSkyI','vWetP','uFogFar','aLeafGrowth','aUvOff','aPhase','aFreq','aWindowSeed','vWindowP','aRunoffTraits','uRunoffAtlas','stainVisibility','vStair','vStairWall','uStairMap','uStairNormal','vStairCoord','uStairDepth'];
  const rows=result.rows.map(row=>{
    const expectedHash=hash(row.expected),programs=row.programs.map(p=>{
      if(!owners.has(p.id))owners.set(p.id,[]);owners.get(p.id).push({tags:row.tags,expectedHash});
      return {id:p.id,actualHash:hash(p.actual),missingMarkers:markers.filter(m=>new RegExp('\\b'+m+'\\b').test(row.expected)&&!new RegExp('\\b'+m+'\\b').test(p.actual))};
    });
    return {tags:row.tags,type:row.type,keyHash:hash(row.key),expectedHash,programs};
  });
  const collisions=[...owners].filter(([,owners])=>new Set(owners.map(o=>o.expectedHash)).size>1).map(([program,owners])=>({program,owners}));
  const report={rows,probes:result.probes,collisions};
  writeFileSync(new URL(name+'-programs.json',dir),JSON.stringify(report,null,2)+'\n');
  const missing=rows.filter(r=>r.programs.some(p=>p.missingMarkers.length));
  console.log(JSON.stringify({materialPrograms:rows.filter(r=>r.programs.length).length,collisions,missing,terrainProbes:result.probes.length}));
  if(strict&&(collisions.length||missing.length))throw new Error('Compiled material programs do not match their intended shader patches');
}
