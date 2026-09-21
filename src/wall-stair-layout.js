import {hash2,lerp} from './util.js';

// The surveyed centreline and its endpoints stay fixed. The stone courses,
// masonry enclosure and walking surface consume this one derived layout.
export function wallStairLayout(st,{gates=[]}={}) {
  const entry=st.pts[0],gateDistance=Math.min(Infinity,...gates.map(g=>Math.hypot(g.x-entry[0],g.z-entry[1])));
  const traffic=Math.min(1,.48+.25*Math.min(1,st.w/2.3)+.27*Math.exp(-gateDistance/25));
  const innerHalf=st.enclosed?Math.min(st.w/2,.74):st.w/2;
  const layout={id:st.id,enclosed:!!st.enclosed,spiral:!!st.spiral,innerHalf,wallThickness:st.enclosed?.50:.26,
    headroom:2.16,traffic,segments:[],steps:[],length:0};
  for(let i=1;i<st.pts.length;i++) {
    const a=st.pts[i-1],b=st.pts[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]),dh=b[2]-a[2];
    if(length<.01||Math.abs(dh)<.16*1.2)continue;
    const n=Math.max(1,Math.round(Math.abs(dh)/.16)),seed=hash2(Math.round(a[0]*37),Math.round(a[1]*41));
    const partition=(amplitude,salt)=>{
      const weights=Array.from({length:n},(_,j)=>1+amplitude*(hash2((seed*1e6+j*137)|0,salt)*2-1));
      const total=weights.reduce((x,y)=>x+y,0),p=[0];for(const w of weights)p.push(p.at(-1)+w/total);p[n]=1;return p;
    };
    const horizontal=partition(.12,7919),vertical=partition(.095,104729);
    const left=[st.offAt(i-1,1,innerHalf),st.offAt(i,1,innerHalf)];
    const right=[st.offAt(i-1,-1,innerHalf),st.offAt(i,-1,innerHalf)];
    const at=(side,t)=>{const edge=side>0?left:right;return [lerp(edge[0][0],edge[1][0],t),lerp(edge[0][1],edge[1][1],t)];};
    const segment={index:i,a:a.slice(),b:b.slice(),length,n,seed,horizontal,vertical,left,right,
      s0:layout.length,railSign:st.segs.find(s=>s.i===i).railSign};
    layout.segments.push(segment);
    for(let j=0;j<=n;j++) {
      const center=horizontal[j],front=j?(.5*(horizontal[j-1]+center)):0;
      const back=j<n?Math.min(1,.5*(center+horizontal[j+1])+.025/length):1;
      // Turning landings share their mitred end line. Every course extends
      // under the next riser, so the rounded nose never opens a daylight gap.
      const corners=[at(1,front),at(-1,front),at(-1,back),at(1,back)];
      const stoneSeed=hash2(Math.round(a[0]*73)+j*59,Math.round(a[1]*71)+i*17);
      const endSink=(i===1&&j===0)||(i===st.pts.length-1&&j===n)?.012:0;
      const y=lerp(a[2],b[2],vertical[j])-endSink;
      const centerPoint=[lerp(a[0],b[0],(front+back)/2),lerp(a[1],b[1],(front+back)/2)];
      const depth=(back-front)*length;
      layout.steps.push({x:centerPoint[0],z:centerPoint[1],y,rotY:Math.atan2(b[0]-a[0],b[1]-a[1]),
        w:innerHalf*2,d:depth,tint:.96+(stoneSeed-.5)*.18,seg:i,step:j,of:n,
        wallStair:{id:st.id,enclosed:!!st.enclosed,traffic,seed:stoneSeed,corners,front,back,
          s:layout.length+center*length,rise:Math.abs(dh)*(vertical[j]-vertical[Math.max(0,j-1)]),
          wear:(.012+.022*traffic)*(.65+.60*stoneSeed),nose:.026+.018*stoneSeed,
          walkingLineM:(hash2(i*313,Math.round(seed*1e6))-.5)*.20,
          walkingHalfWidthM:.40+.07*traffic,depth:.58}});
    }
    layout.length+=length;
  }
  return layout;
}
