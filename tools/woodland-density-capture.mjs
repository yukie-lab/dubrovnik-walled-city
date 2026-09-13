import {readFileSync,writeFileSync} from 'node:fs';

// Density changes are intentionally measured separately from the exact
// visible-plus-shadow culling comparison. Full vegetation is the reference.
export async function woodlandDensityChecks(page,{name,dir,rows,errors}) {
  await page.goto('http://localhost:8765/?shot=1&hud=0&x=58&z=-88&gy=24&yaw=-2.303&pitch=-.02&fov=54&time=7.9',{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.__READY && window.__captureFrame',{timeout:60000});
  const targets=JSON.parse(readFileSync(new URL('../docs/september-tree-views.json',import.meta.url),'utf8'));
  const stations=await page.evaluate(targets=>{
    const out=[{id:'roofs',x:58,z:-88,gy:24,yaw:-2.303,pitch:-.02}];
    for(const t of targets.filter(t=>['aleppoPine','cypress'].includes(t.species)))for(const f of [1.8,4]) {
      const [tx,ty,tz]=t.base,d=t.height*f,x=tx+d*.3,z=tz+d*.95,gy=window.__world.plan.outsideHeight(x,z);
      out.push({id:`${t.species}-${f}`,x,z,gy,yaw:Math.atan2(x-tx,z-tz),pitch:Math.atan2(ty+t.height*.52-gy-1.62,Math.hypot(x-tx,z-tz))});
    }
    const t=targets[0];
    for(let i=0;i<8;i++) {
      const d=t.height*4+i*.12,x=t.base[0]+d*.3,z=t.base[2]+d*.95,gy=window.__world.plan.outsideHeight(x,z);
      out.push({id:`motion-${i}`,x,z,gy,yaw:Math.atan2(x-t.base[0],z-t.base[2]),pitch:Math.atan2(t.base[1]+t.height*.52-gy-1.62,Math.hypot(x-t.base[0],z-t.base[2]))});
    }
    return out;
  },targets);
  for(const s of stations) {
    await page.evaluate(s=>{
      const w=window.__world,p=w.player;
      Object.assign(p,{x:s.x,z:s.z,groundY:s.gy,smoothY:s.gy,zone:'outside',yaw:s.yaw,pitch:s.pitch,vx:0,vz:0,bobAmp:0,frozen:true});
      w.camera.fov=54;w.camera.updateProjectionMatrix();w.worldState.time=7.9;w.instanceLOD.enabled=true;
    },s);
    const images={},stats={};
    for(const [mode,enabled] of [['source',false],['density',true],['restored',false]]) {
      await page.evaluate(v=>{window.__world.instanceLOD.vegetationDetailEnabled=v;},enabled);
      for(let f=0;f<4;f++)images[mode]=await page.evaluate(()=>window.__captureFrame());
      stats[mode]=await page.evaluate(()=>({...window.__RENDER_STATS,leafBatches:window.__world.instanceLOD.batches.filter(b=>'pixelArea' in b)
        .map(b=>({count:b.mesh.count,capacity:b.capacity,detail:[...b.detail],pixelArea:b.pixelArea}))}));
      if(mode!=='restored')writeFileSync(new URL(`${name}-${s.id}-${mode}.png`,dir),Buffer.from(images[mode].split(',')[1],'base64'));
    }
    const difference=await page.evaluate(async({a,b})=>{
      const pixels=async src=>{const image=new Image();image.src=src;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
        const ctx=c.getContext('2d');ctx.drawImage(image,0,0);return {width:c.width,height:c.height,data:ctx.getImageData(0,0,c.width,c.height).data};};
      const A=await pixels(a),B=await pixels(b),scales=[];
      for(const scale of [1,4,16]) {
        let sum=0,bias=0,max=0,n=0;
        for(let y=0;y<A.height;y+=scale)for(let x=0;x<A.width;x+=scale) {
          const d=[0,0,0];let m=0;
          for(let yy=y;yy<Math.min(A.height,y+scale);yy++)for(let xx=x;xx<Math.min(A.width,x+scale);xx++) {
            const o=(yy*A.width+xx)*4;for(let k=0;k<3;k++)d[k]+=(B.data[o+k]-A.data[o+k])/255;m++;
          }
          const delta=d.map(v=>v/m),error=Math.max(...delta.map(Math.abs));sum+=error;max=Math.max(max,error);bias+=delta[0]*.2126+delta[1]*.7152+delta[2]*.0722;n++;
        }
        scales.push({scale,meanAbsoluteRGB:sum/n,meanLumaBias:bias/n,maxAbsoluteRGB:max});
      }
      return scales;
    },{a:images.source,b:images.density});
    const exactRestoration=images.source===images.restored;
    rows.push({view:s.id,station:s,stats,difference,exactRestoration});
    console.log(`DENSITY ${s.id}: ${stats.source.instances} → ${stats.density.instances}, restored=${exactRestoration}, ${JSON.stringify(difference)}`);
    if(!exactRestoration)errors.push(`${s.id}: full vegetation did not restore exactly`);
  }
  await page.evaluate(()=>{window.__world.instanceLOD.vegetationDetailEnabled=true;});
}
