// Exact visible detailed-water mask, read before bloom/tone/output transforms.
// Colour differences between diagnostics are not a valid mask: postprocessing
// spreads their response onto the sky and other objects, especially at night.
export async function captureWaterMask(page) {
  return page.evaluate(async()=>{
    const w=window.__world,R=w.renderer,T=w.THREE,m=w.scene.getObjectByName('sea.surface').material;
    const original=m.fragmentShader,render=R.render.bind(R),debug=m.uniforms.uDebug.value;
    const marker='  bool ok =';
    if(original.split(marker).length!==2)throw new Error('Water mask shader interface changed');
    m.fragmentShader=original.replace(marker,'  gl_FragColor=vec4(-1.0,2.0,-1.0,1.0);return;\n'+marker);m.needsUpdate=true;
    let mask;
    R.render=(s,c)=>{
      render(s,c);const rt=R.getRenderTarget();
      if(s!==w.scene||c.layers.mask!==1||!rt||rt.width!==1200||rt.height!==800)return;
      const half=rt.texture.type===T.HalfFloatType;
      const pixels=half?new Uint16Array(rt.width*rt.height*4):new Float32Array(rt.width*rt.height*4);
      R.readRenderTargetPixels(rt,0,0,rt.width,rt.height,pixels);
      mask=new Uint8ClampedArray(pixels.length);
      for(let y=0;y<800;y++)for(let x=0;x<1200;x++) {
        const src=((799-y)*1200+x)*4,dst=(y*1200+x)*4;
        const scale=w.radianceStorage?.scale.value??1;
        const r=(half?T.DataUtils.fromHalfFloat(pixels[src]):pixels[src])/scale;
        const g=(half?T.DataUtils.fromHalfFloat(pixels[src+1]):pixels[src+1])/scale;
        const b=(half?T.DataUtils.fromHalfFloat(pixels[src+2]):pixels[src+2])/scale;
        mask[dst]=mask[dst+1]=mask[dst+2]=r===-1&&g===2&&b===-1?255:0;mask[dst+3]=255;
      }
    };
    try {await window.__captureFrame();}
    finally {R.render=render;m.fragmentShader=original;m.uniforms.uDebug.value=debug;m.needsUpdate=true;}
    if(!mask)throw new Error('Water mask target not rendered');
    const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;
    canvas.getContext('2d').putImageData(new ImageData(mask,1200,800),0,0);
    return canvas.toDataURL('image/png');
  });
}
