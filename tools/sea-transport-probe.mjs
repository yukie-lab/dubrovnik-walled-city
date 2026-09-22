import {readFileSync,writeFileSync} from 'node:fs';
import {seaCalibrationCapture} from './sea-calibration-capture.mjs';

// Read component radiance before the common observer/tone/output transforms.
// This instrumentation exists only in the inspection browser, never the app.
export async function seaTransportProbe(page,{name,dir,rows,errors,args}) {
  await seaCalibrationCapture(page,{name:name+'-seed',dir,rows,errors,args});
  const config=JSON.parse(readFileSync('docs/sea-calibration.json','utf8'));
  if(args.includes('--sea-values')) {
    const values=JSON.parse(readFileSync(args[args.indexOf('--sea-values')+1],'utf8'));
    await page.evaluate(values=>window.__waterOptics.set(values),values);
  }
  await page.evaluate(polygons=>{
    const w=window.__world,R=w.renderer,T=w.THREE,m=w.scene.getObjectByName('sea.surface').material;
    const original=m.fragmentShader;
    m.uniforms.uSeaProbe={value:0};
    m.fragmentShader='uniform float uSeaProbe;\n'+original.replace('  bool ok =',`
      if(uSeaProbe>.5) {
        vec3 component=vec3(0.0),air=atAerial(vec3(0.0),rayW*camD,cameraPosition);
        float uncovered=1.0-foam*.82;
        if(uSeaProbe<1.5) component=bottomCol*T*(1.0-F)*uncovered;
        else if(uSeaProbe<2.5) component=scat*(1.0-F)*uncovered;
        else if(uSeaProbe<3.5) component=sss*(1.0-F)*uncovered;
        else if(uSeaProbe<4.5) component=refl*F*uncovered;
        else if(uSeaProbe<5.5) component=glit*uncovered;
        else if(uSeaProbe<6.5) component=foamCol*foam*.82;
        if(uSeaProbe<6.5) col=atAerial(component,rayW*camD,cameraPosition)-air;
        else if(uSeaProbe<7.5) col=air;
        else if(uSeaProbe<8.5) col=T;
        else if(uSeaProbe<9.5) col=vec3(F);
        else col=bottomCol;
        gl_FragColor=vec4(col,1.0);return;
      }
      bool ok =`);
    m.needsUpdate=true;
    const render=R.render.bind(R);
    function inside(x,y,p) {
      let hit=false;
      for(let i=0,j=p.length-1;i<p.length;j=i++) {
        const a=p[i],b=p[j];
        if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;
      }
      return hit;
    }
    const indices=Object.fromEntries(Object.entries(polygons).map(([key,p])=>{
      const out=[];
      for(let y=0;y<800;y++)for(let x=0;x<1200;x++)if(inside(x+.5,y+.5,p))out.push(((799-y)*1200+x)*4);
      return [key,out];
    }));
    R.render=(s,c)=>{
      render(s,c);
      const rt=R.getRenderTarget();
      if(s!==w.scene||c.layers.mask!==1||!rt||rt.width!==1200||rt.height!==800)return;
      const half=rt.texture.type===T.HalfFloatType;
      const pixels=half?new Uint16Array(rt.width*rt.height*4):new Float32Array(rt.width*rt.height*4);
      R.readRenderTargetPixels(rt,0,0,rt.width,rt.height,pixels);
      w.__seaProbe=Object.fromEntries(Object.entries(indices).map(([key,index])=>{
        const sum=[0,0,0];
        for(const i of index)for(let k=0;k<3;k++)sum[k]+=half?T.DataUtils.fromHalfFloat(pixels[i+k]):pixels[i+k];
        return [key,sum.map(v=>v/index.length)];
      }));
    };
    w.__restoreSeaProbe=()=>{R.render=render;m.fragmentShader=original;m.needsUpdate=true;};
  },config.renderRegions);
  const labels=['total','bottom','volumeScattering','crest','skyReflection','glitter','foam','aerialPerspective','transmission','fresnel','bottomIncident'];
  const result={};
  for(let mode=0;mode<labels.length;mode++) {
    const row=await page.evaluate(async mode=>{
      const w=window.__world;w.scene.getObjectByName('sea.surface').material.uniforms.uSeaProbe.value=mode;
      const png=await window.__captureFrame();
      return {png,regions:w.__seaProbe,exposure:w.renderer.toneMappingExposure,gpuError:w.renderer.getContext().getError()};
    },mode);
    if(row.gpuError)throw new Error('Sea radiance probe GPU '+row.gpuError);
    const {png,...record}=row;result[labels[mode]]=record;
    writeFileSync(new URL(name+'-'+labels[mode]+'.png',dir),Buffer.from(png.split(',')[1],'base64'));
  }
  await page.evaluate(()=>window.__world.__restoreSeaProbe());
  writeFileSync(new URL(name+'-radiance.json',dir),JSON.stringify(result,null,2)+'\n');
  rows.push({view:'sea-radiance-probe',...result});console.log(JSON.stringify(result));
}
