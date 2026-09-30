import {woodStem,foliageLobe} from './woodland-shape.js';
import {growLeafCluster} from './woodland-leaves.js';

const TAU=Math.PI*2;
const mix=(a,b,t)=>a.map((v,k)=>v+(b[k]-v)*t);
const tint=(c,k)=>c.map(v=>v*k);

function stem(B,path,radii,color,sides,phase) {
  B.current.roots??=[];
  if(!B.current.roots.length)B.current.roots.push([...path[0]]);
  B.append(woodStem(path,radii,{sides,phase}),color);
}
function crown(B,at,radii,rnd,color,yaw=0) {
  growLeafCluster(B,at,radii,rnd,color,yaw);
}

// Keep each public height draw first: planting uses independent per-site RNG
// streams and its original species, root, height and options remain unchanged.
export function growPine(B,base,rnd,o={}) {
  const H=o.h??(7+rnd()*6),phase=rnd(),detail=o.detail??1,exposure=o.exposure??.5;
  B.begin(base,H,phase);B.current.kind='pine';
  const leanA=rnd()*TAU,lean=(o.lean??(.10+rnd()*.26))*(.7+exposure*.7);
  const clear=.56+rnd()*.13,twA=rnd()*TAU,twK=(.3+rnd()*.7)*lean;
  const r0=H*(.021+rnd()*.012),path=[],rad=[],segments=detail>.5 ? 7 : 5;
  for(let i=0;i<segments;i++) {
    const t=i/(segments-1),bend=lean*t*t*H*.55;
    // The growth function is zero at t=0, including its lateral twist.
    const twist=(Math.sin(t*2.6+twA)-Math.sin(twA))*twK*H*.09;
    path.push([base[0]+Math.cos(leanA)*bend+Math.cos(twA)*twist,
      base[1]+t*H*.92,base[2]+Math.sin(leanA)*bend+Math.sin(twA)*twist]);
    rad.push(r0*(1-t*.9));
  }
  const age=rnd(),bark=[.15-age*.052,.128-age*.046,.096-age*.036];
  stem(B,path,rad,bark,detail>.5 ? 6 : 5,phase);
  const n=(detail>.5 ? 6 : 4)+Math.floor(rnd()*3),windA=rnd()*TAU;
  const color=o.foliage??[.095,.16,.118];
  for(let k=0;k<n;k++) {
    // Distribute the existing branch budget through the live crown. Previously
    // almost equal branch lengths all ended in one narrow horizontal band.
    // Younger crowns taper upwards; older crowns retain a broader upper dome.
    const crownT=(k+rnd())/n,t=clear+(1-clear)*(.08+.83*crownT),u=t*(segments-1);
    const j=Math.min(segments-2,Math.floor(u)),from=mix(path[j],path[j+1],u-j);
    const a=leanA+k*2.3999632297+(rnd()-.5)*.8;
    const asym=.74+.4*(.5+.5*Math.cos(a-windA));
    const L=H*(.44-crownT*(.30-age*.14))*asym*(.8+rnd()*.33);
    const tip=[from[0]+Math.cos(a)*L,base[1]+H*(.67+crownT*(.26-age*.08)+age*.06+rnd()*.07),from[2]+Math.sin(a)*L];
    const middle=mix(from,tip,.55);middle[1]+=H*(.024+rnd()*.025);
    const branch=[from,middle,tip],radius=r0*(.28+rnd()*.15);
    stem(B,branch,[radius,radius*.58,Math.max(.009,radius*.14)],bark,4,phase+k*.2);
    const fs=H*(.145+rnd()*.045),leafColor=tint(color,.81+rnd()*.30);
    crown(B,tip,[fs,fs*(.38+rnd()*.22),fs*(.68+rnd()*.28)],rnd,leafColor,a);
    // A secondary twig grows from the actual primary branch. The detached
    // layers of foliage in the old generator are replaced by attached growth.
    if(detail>.5 || rnd()<.35) {
      const attach=mix(middle,tip,.24),a2=a+(rnd()<.5 ? -1 : 1)*(.65+rnd()*.7),len=L*(.25+rnd()*.16);
      const end=[attach[0]+Math.cos(a2)*len,attach[1]+H*(.014+rnd()*.036),attach[2]+Math.sin(a2)*len];
      stem(B,[attach,end],[radius*.45,.01],bark,4,phase+k*.3);
      crown(B,end,[fs*.76,fs*(.35+rnd()*.16),fs*.62],rnd,tint(leafColor,.92),a2);
    }
  }
  B.end();return H;
}

export function growCypress(B,base,rnd,o={}) {
  const H=o.h??(8+rnd()*7),phase=rnd(),W=H*(.055+rnd()*.030),lean=(rnd()-.5)*.05,angle=rnd()*TAU;
  B.begin(base,H,phase,.28);B.current.kind='cypress';
  const col=o.foliage??[.030,.058,.038];
  const center=[base[0]+Math.cos(angle)*lean*H*.5,base[1]+H*.555,base[2]+Math.sin(angle)*lean*H*.5];
  stem(B,[base,center],[H*.028,H*.012],[.095,.082,.060],6,phase);
  crown(B,center,[W,H*.445,W*(.76+rnd()*.18)],rnd,col,angle);
  if((o.detail??1)>.5)for(let i=0;i<4;i++) {
    const a=rnd()*TAU,t=.29+rnd()*.48;
    const attach=[center[0]+Math.cos(a)*W*.69,base[1]+H*t,center[2]+Math.sin(a)*W*.64];
    stem(B,[center,attach],[H*.006,H*.0015],[.095,.082,.06],4,phase+i*.2);
    crown(B,attach,
      [W*.29,H*(.085+rnd()*.035),W*.3],rnd,tint(col,.83+rnd()*.27),a);
  }
  B.end();return H;
}

export function growOlive(B,base,rnd,o={}) {
  const H=o.h??(3.2+rnd()*2.2),phase=rnd(),bark=[.13,.118,.09],col=o.foliage??[.105,.125,.078];
  B.begin(base,H,phase);B.current.kind='olive';
  const n=2+(rnd()<.4 ? 1 : 0);
  for(let i=0;i<n;i++) {
    const a=i/n*TAU+rnd()*.8,spread=.14+rnd()*.22;
    const fork=[base[0]+Math.cos(a)*H*spread,base[1]+H*(.43+rnd()*.13),base[2]+Math.sin(a)*H*spread];
    const elbow=mix(base,fork,.4);elbow[0]-=Math.sin(a)*H*.055;elbow[2]+=Math.cos(a)*H*.055;
    stem(B,[base,elbow,fork],[H*.054,H*.038,H*.019],bark,6,phase+i*.3);
    for(let k=0;k<3;k++) {
      const b=a+(k-1)*1.25+(rnd()-.5)*.5,length=H*(.15+rnd()*.19);
      const tip=[fork[0]+Math.cos(b)*length,base[1]+H*(.66+rnd()*.14),fork[2]+Math.sin(b)*length];
      stem(B,[fork,tip],[H*.019,H*.005],bark,4,phase+k*.3);
      crown(B,tip,[H*(.19+rnd()*.065),H*(.15+rnd()*.04),H*(.16+rnd()*.08)],rnd,tint(col,.8+rnd()*.35),b);
    }
  }
  B.end();return H;
}

export function growMaquis(B,base,rnd,o={}) {
  const H=o.h??(.65+rnd()*1.05),phase=rnd(),col=o.foliage??[.088,.100,.062];
  B.begin(base,H,phase,.7);B.current.kind='maquis';
  const n=3+Math.floor(rnd()*3);
  for(let k=0;k<n;k++) {
    const a=k/n*TAU+rnd()*.7,r=H*(.14+rnd()*.33);
    const at=[base[0]+Math.cos(a)*r,base[1]+H*(.4+rnd()*.27),base[2]+Math.sin(a)*r];
    stem(B,[base,at],[H*.03,H*.007],[.084,.069,.044],4,phase+k*.2);
    crown(B,at,[H*(.24+rnd()*.18),H*(.25+rnd()*.08),H*(.24+rnd()*.15)],rnd,tint(col,.78+rnd()*.4),a);
  }
  B.end();return H;
}
