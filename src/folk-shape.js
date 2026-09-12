import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Continuous cross sections, with actual closed ends. Dimensions use the
// existing 1.92 m rig: ankle .06, knee .45, hip .90, shoulder 1.62.
// All residents share five geometries; shape and clothing remain instanced.
function loft(profile,limb=0,segments=12,shade=()=>1,point=null,{bottom=true,top=true}={}) {
  const p=[],color=[],ix=[],uv=[],rings=profile.length;
  for(let j=0;j<rings;j++)for(let i=0;i<segments;i++) {
    const a=i/segments*Math.PI*2,[y,x,z,rx,rz]=profile[j];
    const v=point ? point(j,a) : [x+Math.sin(a)*rx,y,z+Math.cos(a)*rz];
    p.push(...v);uv.push(i/segments,j/(rings-1));
    const s=shade(j,a,v);color.push(s,s,s);
  }
  for(let j=0;j<rings-1;j++)for(let i=0;i<segments;i++) {
    const a=j*segments+i,b=j*segments+(i+1)%segments,c=a+segments,d=b+segments;
    ix.push(a,b,c,b,d,c);
  }
  for(const end of [0,rings-1]) {
    if(end ? !top : !bottom)continue;
    const center=[0,0,0];for(let i=0;i<segments;i++)for(let k=0;k<3;k++)center[k]+=p[(end*segments+i)*3+k]/segments;
    const ci=p.length/3;p.push(...center);uv.push(.5,end ? 1 : 0);color.push(1,1,1);
    for(let i=0;i<segments;i++) {
      const a=end*segments+i,b=end*segments+(i+1)%segments;
      if(end)ix.push(ci,a,b);else ix.push(ci,b,a);
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  g.setAttribute('color',new THREE.Float32BufferAttribute(color,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setAttribute('aLimb',new THREE.Float32BufferAttribute(new Float32Array(p.length/3).fill(limb),1));
  g.setIndex(ix);g.computeVertexNormals();return g;
}
function ellipsoid(rx,ry,rz,x,y,z,limb=0,tone=1) {
  const g=new THREE.SphereGeometry(1,6,4);g.scale(rx,ry,rz);g.translate(x,y,z);
  const count=g.attributes.position.count;
  g.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(count*3).fill(tone),3));
  g.setAttribute('aLimb',new THREE.Float32BufferAttribute(new Float32Array(count).fill(limb),1));return g;
}
function merged(parts) {
  let from=0;const solids=parts.map(g=>{const to=from+g.index.count/3,range={from,to};from=to;return range;});
  const g=mergeGeometries(parts);g.userData.closedParts=solids;
  for(const part of parts)part.dispose();g.computeBoundingBox();g.computeBoundingSphere();return g;
}

function trousers() {
  const sides=[],segments=12;
  for(const side of [-1,1]) {
    const x=side*.091;
    const profile=[
      [.045,x,0,.046,.056],[.083,x,0,.051,.066],
      [.215,x,-.008,.052,.063],[.347,x,-.007,.056,.066],
      [.416,x,0,.060,.067],[.450,x,.005,.062,.070],
      [.485,x,.005,.063,.073],[.608,x,0,.069,.079],
      [.772,x,-.003,.079,.087],[.860,x,-.006,.075,.087],
      [.900,x,-.006,.070,.081],
    ];
    sides.push(loft(profile,-side,segments,(j,a)=>.92+.06*Math.pow(Math.cos(a*2),2),null,{top:false}));
  }
  const g=mergeGeometries(sides),p=[...g.attributes.position.array],ix=[...g.index.array];
  const color=[...g.attributes.color.array],uv=[...g.attributes.uv.array],limbs=[...g.attributes.aLimb.array];
  const add=(x,y,z,limb=0)=>{
    const i=p.length/3;p.push(x,y,z);color.push(1,1,1);uv.push(x+.5,y);limbs.push(limb);return i;
  };
  const left=i=>10*segments+i,right=i=>sides[0].attributes.position.count+10*segments+i;
  const front=add(0,.900,.075),back=add(0,.900,-.087);
  // The hip continues directly from the OUTSIDE halves of the leg rings.
  // Only the space between the legs has a downward-facing crotch surface;
  // there is no horizontal shelf around the outside of either thigh.
  let loop=[front,...Array.from({length:7},(_,i)=>right(i)),back,
    ...Array.from({length:7},(_,i)=>left((6+i)%segments))];
  const angles=loop.map(i=>Math.atan2(p[i*3]/.171,(p[i*3+2]+.006)/.106));
  for(const [y,cz,rx,rz] of [[.985,-.007,.178,.115],[1.099,-.002,.175,.110],[1.141,-.001,.171,.106]]) {
    const next=angles.map(a=>add(Math.sin(a)*rx,y,cz+Math.cos(a)*rz));
    for(let i=0;i<loop.length;i++) {
      const j=(i+1)%loop.length,a=loop[i],b=loop[j],c=next[i],d=next[j];
      ix.push(a,b,c,b,d,c);
    }
    loop=next;
  }
  const top=add(0,1.141,-.001);
  for(let i=0;i<loop.length;i++)ix.push(top,loop[i],loop[(i+1)%loop.length]);
  const crotch=[front,...Array.from({length:7},(_,i)=>left(i)),back,
    ...Array.from({length:7},(_,i)=>right((6+i)%segments))];
  const outline=crotch.map(i=>new THREE.Vector2(p[i*3],p[i*3+2]));
  for(const face of THREE.ShapeUtils.triangulateShape(outline,[])) {
    const [a,b,c]=face.map(i=>crotch[i]);
    const ny=(p[b*3+2]-p[a*3+2])*(p[c*3]-p[a*3])-(p[b*3]-p[a*3])*(p[c*3+2]-p[a*3+2]);
    if(ny<0)ix.push(a,b,c);else ix.push(a,c,b);
  }
  for(const [name,array,size] of [['position',p,3],['color',color,3],['uv',uv,2],['aLimb',limbs,1]])
    g.setAttribute(name,new THREE.Float32BufferAttribute(array,size));
  g.setIndex(ix);g.computeVertexNormals();sides.forEach(g=>g.dispose());return g;
}

const HEAD=[
  [1.699,0,.023,.022,.028],[1.718,0,.020,.050,.057],
  [1.752,0,.006,.070,.078],[1.788,0,0,.080,.088],
  [1.828,0,-.003,.082,.089],[1.866,0,-.007,.077,.081],
  [1.898,0,-.010,.056,.058],[1.918,0,-.010,.017,.019],
  [1.921,0,-.010,.002,.003],
];
function headAt(y) {
  for(let i=1;i<HEAD.length;i++)if(y<=HEAD[i][0]) {
    const a=HEAD[i-1],b=HEAD[i],t=THREE.MathUtils.clamp((y-a[0])/(b[0]-a[0]),0,1);
    return a.map((v,k)=>THREE.MathUtils.lerp(v,b[k],t));
  }
  return HEAD.at(-1);
}

export function makeFolkGeometry() {
  const torso=loft([
    [1.102,0,0,.169,.107],[1.119,0,0,.178,.114],
    [1.215,0,-.006,.172,.104],[1.355,0,-.005,.185,.115],
    [1.488,0,-.008,.211,.122],[1.563,0,-.010,.224,.112],
    [1.605,0,-.006,.194,.099],[1.651,0,0,.082,.067],
    [1.665,0,0,.067,.058],
  ],0,16,(j,a)=>j===0||j===8 ? .84 : .97+.03*Math.sin(a*3+j*.7));

  const arms=[],legs=[trousers()],sleeves=[];
  for(const side of [-1,1]) {
    const x=side*.213;
    sleeves.push(loft([
      [1.395,x,-.006,.054,.055],[1.414,x,-.006,.058,.056],
      [1.571,x,-.004,.068,.062],[1.628,x,-.004,.047,.046],
    ],side*2,10,j=>j===0 ? .84 : 1));
    arms.push(loft([
      [.928,x,.012,.023,.016],[.950,x,.014,.031,.023],
      [1.013,x,.008,.029,.026],[1.054,x,0,.028,.028],
      [1.150,x,-.009,.038,.039],[1.252,x,-.014,.041,.044],
      [1.301,x,-.011,.038,.041],[1.365,x,-.008,.045,.047],
      [1.583,x,-.004,.062,.057],
      [1.624,x,-.004,.044,.044],
    ],side*2,10));
    const lx=side*.091;
    // Rounded shoe toe and heel; the whole sole perimeter is exactly y=0.
    legs.push(loft([
      [0,lx,.039,.058,.122],[.013,lx,.039,.061,.124],
      [.035,lx,.035,.060,.119],[.059,lx,.009,.052,.077],
      [.091,lx,-.008,.045,.052],
    ],-side,12,()=>.30));
  }

  const head=loft(HEAD,0,12,(j,a)=>j===1&&Math.cos(a)>.7 ? .94 : 1);
  const neck=loft([[1.624,0,0,.056,.052],[1.674,0,0,.054,.051],[1.736,0,-.003,.050,.049]],0,10);
  const nose=loft([
    [1.767,0,.094,.011,.010],[1.783,0,.106,.014,.016],
    [1.803,0,.096,.009,.012],[1.817,0,.087,.005,.005],
  ],0,6);
  const ears=[-1,1].map(s=>ellipsoid(.011,.025,.014,s*.082,1.793,-.005));
  const eyes=[-1,1].map(s=>ellipsoid(.010,.0038,.003,s*.031,1.816,.083,0,.38));

  // A cap that follows the same skull sections at its irregular hairline.
  // The nape is lower than the forehead. The bottom is closed behind the head.
  const hair=loft(Array.from({length:6},()=>[0,0,0,0,0]),0,12,(j,a)=>.94+.06*Math.cos(a*3+j),
    (j,a)=>{
      const base=1.813+.047*Math.cos(a)+.004*Math.sin(a*3);
      const y=THREE.MathUtils.lerp(base,1.921,j/5),[,x,z,rx,rz]=headAt(y);
      return [x+Math.sin(a)*(rx+.004),y+.004,z+Math.cos(a)*(rz+.004)];
    });
  return {torso:merged([torso,...sleeves]),arms:merged(arms),legs:merged(legs),
    head:merged([head,neck,nose,...ears,...eyes]),hair:merged([hair])};
}
