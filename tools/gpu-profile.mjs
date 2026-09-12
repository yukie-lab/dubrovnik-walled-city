// Time whole render passes. Per-draw queries interrupt the Metal render pass
// and add large measurement overhead, so they cannot rank this scene's draws.
export async function profileGPU(page,baselineFrameMs) {
  return page.evaluate(async(baselineFrameMs)=>{
    const w=window.__world,renderer=w.renderer,gl=renderer.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if(!ext)return {supported:false};
    const original=renderer.render,queries=[];let recording=false;
    renderer.render=function(scene,camera) {
      if(!recording)return original.call(this,scene,camera);
      const name=scene===w.scene ? camera.layers.mask===1 ? 'main-with-shadows' : 'under-with-shadows' : 'post';
      const query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,query);
      const start=performance.now();
      try{return original.call(this,scene,camera);}
      finally{gl.endQuery(ext.TIME_ELAPSED_EXT);queries.push({name,query,cpuMs:performance.now()-start});}
    };
    try {
      recording=true;for(let i=0;i<5;i++)await window.__captureFrame();recording=false;
      for(let i=0;i<30 && queries.some(q=>!gl.getQueryParameter(q.query,gl.QUERY_RESULT_AVAILABLE));i++)await new Promise(requestAnimationFrame);
      if(gl.getParameter(ext.GPU_DISJOINT_EXT))return {supported:true,disjoint:true};
      // Browser protocol round trips can leave intervening animation frames.
      // Count rendered main passes, not the number of requested PNG captures.
      const frames=queries.filter(q=>q.name==='main-with-shadows').length;
      const rows=new Map();let unavailable=0;
      for(const q of queries) {
        if(!gl.getQueryParameter(q.query,gl.QUERY_RESULT_AVAILABLE)){unavailable++;continue;}
        const row=rows.get(q.name)||{name:q.name,gpuMs:0,cpuMs:0};
        row.gpuMs+=gl.getQueryParameter(q.query,gl.QUERY_RESULT)/1e6/frames;row.cpuMs+=q.cpuMs/frames;rows.set(q.name,row);
      }
      const passes=[...rows.values()],totalGPUms=passes.reduce((n,p)=>n+p.gpuMs,0);
      return {supported:true,frames,unavailable,baselineFrameMs,totalGPUms,
        usableForRanking:!unavailable && totalGPUms<baselineFrameMs*1.5,passes};
    } finally{recording=false;renderer.render=original;for(const q of queries)gl.deleteQuery(q.query);}
  },baselineFrameMs);
}
