import {writeFileSync} from 'node:fs';

// Temporary material ablations in the browser identify the rendering path.
// Nothing is written back to the scene sources or its lighting model.
export async function stepStudy(page,{name,dir,rows,errors,args=[]}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&x=-98.4&z=-30&yaw=-.12&pitch=.18&fov=44&time=12.87',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY && window.__captureFrame',{timeout:60000});
  const probes=await page.evaluate(()=>{
    const w=window.__world,T=w.THREE,step=w.scene.getObjectByName('steps'),casters=[];
    w.scene.traverse(m=>{if(m.isMesh && m.castShadow && m!==step)casters.push(m);});
    const ray=new T.Raycaster(),direction=w.lighting.sun.position.clone().sub(w.lighting.sun.target.position).normalize();
    return [[534,652],[742,652],[570,850],[720,584]].map(([px,py])=>{
      ray.setFromCamera(new T.Vector2(px/800-1,1-py/500),w.camera);ray.far=1000;
      const floor=ray.intersectObject(step,false)[0];if(!floor)return {pixel:[px,py],floor:null};
      ray.set(floor.point.clone().addScaledVector(direction,.003),direction);ray.far=100;
      const hits=ray.intersectObjects(casters,false).slice(0,4).map(h=>({tag:h.object.name,instance:h.instanceId,face:h.faceIndex,distance:h.distance}));
      return {pixel:[px,py],point:floor.point.toArray(),hits};
    });
  });
  rows.push({view:'shadow-probes',probes});console.log(JSON.stringify(probes));
  for(const mode of (args.includes('--probe-only') ? [] : ['original','flat-normal','no-step-cast','no-step-receive','plain-material'])) {
    const count=await page.evaluate(mode=>{
      const w=window.__world,m=w.scene.getObjectByName('steps');
      if(!window.__stepStudy)window.__stepStudy={material:m.material,normal:m.material.normalScale.clone(),cast:m.castShadow,receive:m.receiveShadow};
      const s=window.__stepStudy;m.material=s.material;m.material.normalScale.copy(s.normal);m.castShadow=s.cast;m.receiveShadow=s.receive;
      if(mode==='flat-normal')m.material.normalScale.set(0,0);
      if(mode==='no-step-cast')m.castShadow=false;
      if(mode==='no-step-receive')m.receiveShadow=false;
      if(mode==='plain-material')m.material=new w.THREE.MeshStandardMaterial({color:0xbfb3a0,roughness:.8});
      return w.counts.steps;
    },mode);
    let png;for(let i=0;i<8;i++)png=await page.evaluate(()=>window.__captureFrame());
    const stem=`${name}-${mode}.png`;writeFileSync(new URL(stem,dir),Buffer.from(png.split(',')[1],'base64'));
    rows.push({view:mode,steps:count,capture:stem});console.log('STEP STUDY',mode,count);
    if(errors.length)throw new Error(errors.join('\n'));
  }
}
