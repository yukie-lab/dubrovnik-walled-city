import * as THREE from 'three';

// Storefronts keep one instanced draw. Rays from the actual eye intersect
// shelves and finite product solids in a shallow display case. Curved bottles,
// caps and labels therefore have their own silhouettes, normals and parallax.
export const SHOP_DISPLAY={halfWidth:.925,height:2.975,depth:1.18,rows:4,columns:7};
export const shopDisplayKind=seed=>Math.min(2,Math.floor(seed*3));

function labelAtlas() {
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;
  const ctx=canvas.getContext('2d');
  const labels=[['OLIVE OIL','EXTRA VIRGIN'],['HONEY','LOCAL HARVEST'],['WINE','DALMATIA'],['LAVENDER','HANDMADE'],
    ['OLIVES','IN BRINE'],['FIG JAM','SMALL BATCH'],['SEA SALT','ADRIATIC'],['ROSEMARY','DRIED HERBS']];
  for(let i=0;i<labels.length;i++) {
    const x=(i%4)*256,y=Math.floor(i/4)*256;
    ctx.fillStyle=i===2?'#e9d7ad':'#e6d9b7';ctx.fillRect(x,y,256,256);
    ctx.strokeStyle=i===2?'#693a37':'#4f6250';ctx.lineWidth=3;ctx.strokeRect(x+16,y+16,224,224);
    ctx.textAlign='center';ctx.fillStyle=ctx.strokeStyle;
    ctx.font='bold 23px Georgia';ctx.fillText(labels[i][0],x+128,y+142);
    ctx.font='12px Georgia';ctx.fillText(labels[i][1],x+128,y+170);
    // A botanical seal remains legible when the smaller text mipmaps away.
    ctx.beginPath();ctx.ellipse(x+128,y+73,24,29,0,0,Math.PI*2);ctx.stroke();
    ctx.beginPath();ctx.moveTo(x+122,y+92);ctx.lineTo(x+135,y+53);ctx.stroke();
    for(let j=0;j<3;j++) {
      ctx.beginPath();ctx.ellipse(x+125+j*3,y+80-j*9,9,3,-.55,0,Math.PI*2);ctx.fill();
    }
    ctx.fillRect(x+104,y+194,48,1);ctx.font='11px Georgia';ctx.fillText(i===0||i===2?'250 ml':'NET 180 g',x+128,y+216);
  }
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
  map.anisotropy=4;return map;
}

const SHAPES=/* glsl */`
  varying vec3 vDisplayRay; varying vec2 vDisplayPosition;
  varying float vDisplaySeed; varying float vDisplayKind;
  uniform sampler2D uProductLabels; uniform float uShopOpen;
  float displayHash(float n){return fract(sin(n*127.1)*43758.5453);}
  struct DisplayHit { float t; vec3 n; vec3 p; float part; float kind; float seed; };

  void displayCommit(float t,vec3 n,vec3 p,float part,float kind,float seed,inout DisplayHit hit) {
    if(t>.00001&&t<hit.t){hit.t=t;hit.n=n;hit.p=p;hit.part=part;hit.kind=kind;hit.seed=seed;}
  }
  // Slabs with explicit parallel-axis handling: the centred straight-on view
  // must not produce 0/0, NaN normals, or disappear at a shelf edge.
  bool displayBounds(vec3 ro,vec3 rd,vec3 lo,vec3 hi,out float nearT,out float farT,out vec3 norm) {
    nearT=-1e8;farT=1e8;norm=vec3(0.0);
    for(int axis=0;axis<3;axis++) {
      if(abs(rd[axis])<.000001) {if(ro[axis]<lo[axis]||ro[axis]>hi[axis])return false;}
      else {
        float a=(lo[axis]-ro[axis])/rd[axis],b=(hi[axis]-ro[axis])/rd[axis];
        float enter=min(a,b);
        if(enter>nearT){nearT=enter;norm=vec3(0.0);norm[axis]=rd[axis]>0.0?-1.0:1.0;}
        farT=min(farT,max(a,b));
      }
    }
    return farT>max(0.0,nearT);
  }
  void displayBox(vec3 ro,vec3 rd,vec3 centre,vec3 halfSize,float part,float kind,float seed,inout DisplayHit hit) {
    float a,b;vec3 n;
    if(displayBounds(ro,rd,centre-halfSize,centre+halfSize,a,b,n))displayCommit(a,n,ro+rd*a-centre,part,kind,seed,hit);
  }
  // A closed truncated cone: side normals follow its radius, and the end
  // discs give bottles and jar lids real top surfaces when viewed from above.
  void displayFrustum(vec3 ro,vec3 rd,float y,float h,float r0,float r1,float part,float kind,float seed,inout DisplayHit hit) {
    float slope=(r1-r0)/h,r=r0+slope*(ro.y-y);
    float A=dot(rd.xz,rd.xz)-slope*slope*rd.y*rd.y;
    float B=2.0*(dot(ro.xz,rd.xz)-r*slope*rd.y);
    float C=dot(ro.xz,ro.xz)-r*r,disc=B*B-4.0*A*C;
    if(disc>=0.0) {
      vec2 roots=abs(A)<.0000001?vec2(abs(B)>.0000001?-C/B:1e8):vec2((-B-sqrt(disc))/(2.0*A),(-B+sqrt(disc))/(2.0*A));
      for(int j=0;j<2;j++) {
        float t=roots[j];vec3 q=ro+rd*t;
        if(q.y>=y&&q.y<=y+h)displayCommit(t,normalize(vec3(q.x,-(r0+slope*(q.y-y))*slope,q.z)),q,part,kind,seed,hit);
      }
    }
    if(abs(rd.y)>.000001)for(int j=0;j<2;j++) {
      float yy=y+float(j)*h,t=(yy-ro.y)/rd.y,rr=j==0?r0:r1;vec3 q=ro+rd*t;
      if(dot(q.xz,q.xz)<=rr*rr)displayCommit(t,vec3(0,j==0?-1:1,0),q,part,kind,seed,hit);
    }
  }
  void displayEllipsoid(vec3 ro,vec3 rd,vec3 centre,vec3 radius,float bottom,float top,float side,float kind,float seed,inout DisplayHit hit) {
    vec3 q=(ro-centre)/radius,d=rd/radius;
    float a=dot(d,d),b=dot(q,d),c=dot(q,q)-1.,disc=b*b-a*c;
    if(disc<0.)return;
    vec2 roots=vec2(-b-sqrt(disc),-b+sqrt(disc))/a;
    for(int i=0;i<2;i++) {
      float t=roots[i];vec3 p=ro+rd*t;
      if(p.y>=bottom&&p.y<=top)displayCommit(t,side*normalize((p-centre)/(radius*radius)),p,4.,kind,seed,hit);
    }
  }
  void displayProduct(vec3 ro,vec3 rd,float kind,float seed,inout DisplayHit hit) {
    if(kind<.5) {
      // Olive oil: thick green glass, broad shoulders and a narrow screw cap.
      displayFrustum(ro,rd,.005,.235,.050,.053,2.,kind,seed,hit);
      displayFrustum(ro,rd,.240,.052,.053,.021,2.,kind,seed,hit);
      displayFrustum(ro,rd,.292,.065,.021,.021,2.,kind,seed,hit);
      displayFrustum(ro,rd,.357,.027,.024,.024,3.,kind,seed,hit);
    } else if(kind<1.5) {
      // Honey / preserves: rounded shoulders, a wide lid, a low paper label.
      displayFrustum(ro,rd,.004,.015,.050,.064,2.,kind,seed,hit);
      displayFrustum(ro,rd,.019,.166,.064,.064,2.,kind,seed,hit);
      displayFrustum(ro,rd,.185,.018,.064,.057,2.,kind,seed,hit);
      displayFrustum(ro,rd,.203,.028,.067,.067,3.,kind,seed,hit);
    } else if(kind<2.5) {
      // Wine: taller body, sloping shoulder, foil capsule and punt foot.
      displayFrustum(ro,rd,.004,.250,.047,.050,2.,kind,seed,hit);
      displayFrustum(ro,rd,.254,.064,.050,.018,2.,kind,seed,hit);
      displayFrustum(ro,rd,.318,.085,.018,.018,2.,kind,seed,hit);
      displayFrustum(ro,rd,.376,.036,.020,.020,3.,kind,seed,hit);
    } else if(kind<3.5) {
      // A smoothly rounded thrown body, narrow neck and a separate turned foot.
      displayFrustum(ro,rd,.003,.020,.033,.039,4.,kind,seed,hit);
      displayEllipsoid(ro,rd,vec3(0,.130,0),vec3(.083,.125,.083),.019,.243,1.,kind,seed,hit);
      displayFrustum(ro,rd,.243,.029,.0355,.031,4.,kind,seed,hit);
      displayFrustum(ro,rd,.272,.012,.037,.037,4.,kind,seed,hit);
    } else if(kind<4.5) {
      // Kraft-paper carton with folded seams, printed sleeve and tied cord.
      displayBox(ro,rd,vec3(0,.133,0),vec3(.063,.133,.044),5.,kind,seed,hit);
      displayBox(ro,rd,vec3(0,.273,0),vec3(.059,.008,.038),5.,kind,seed,hit);
    } else {
      // Open bowls have both outer and inner curved surfaces. Looking down
      // into one reveals a cavity instead of a painted black top disc.
      displayFrustum(ro,rd,.003,.012,.028,.029,4.,kind,seed,hit);
      displayEllipsoid(ro,rd,vec3(0,.150,0),vec3(.090,.140,.090),.015,.150,1.,kind,seed,hit);
      displayEllipsoid(ro,rd,vec3(0,.150,0),vec3(.083,.128,.083),.022,.150,-1.,kind,seed,hit);
      if(abs(rd.y)>.000001) {
        float t=(.150-ro.y)/rd.y;vec3 p=ro+rd*t;float r=length(p.xz);
        if(r>=.083&&r<=.090)displayCommit(t,vec3(0,1,0),p,4.,kind,seed,hit);
      }
    }
  }

  DisplayHit displayTrace(vec3 ro,vec3 rd) {
    DisplayHit hit;hit.t=1e7;hit.n=vec3(0,0,1);hit.p=vec3(0);hit.part=0.;hit.kind=0.;hit.seed=vDisplaySeed;
    // The five closed faces of the niche. The front is the aperture itself.
    displayBox(ro,rd,vec3(0,1.4875,-1.205),vec3(.925,1.4875,.025),0.,0.,vDisplaySeed,hit);
    for(int side=0;side<2;side++)displayBox(ro,rd,vec3(side==0?-.945:.945,1.4875,-.60),vec3(.02,1.4875,.60),0.,0.,vDisplaySeed,hit);
    displayBox(ro,rd,vec3(0,-.02,-.60),vec3(.925,.02,.60),1.,0.,vDisplaySeed,hit);
    displayBox(ro,rd,vec3(0,2.995,-.60),vec3(.925,.02,.60),0.,0.,vDisplaySeed,hit);
    for(int row=0;row<4;row++) {
      float shelfY=.79+float(row)*.50;
      displayBox(ro,rd,vec3(0,shelfY-.018,-.925),vec3(.86,.018,.24),1.,0.,vDisplaySeed,hit);
      // Small paper price cards occupy the timber lip, not the bottles.
      for(int tag=0;tag<3;tag++)displayBox(ro,rd,vec3(-.58+float(tag)*.55,shelfY-.018,-.681),vec3(.053,.014,.0015),6.,0.,float(tag)+float(row)*3.,hit);
      for(int col=0;col<7;col++) {
        float id=float(row)*17.+float(col)+vDisplaySeed*311.;
        float seed=displayHash(id+8.2);
        // Stock has deliberate families, modest height variation and a few
        // empty spaces, rather than unrelated colours in an exact grid.
        if(displayHash(id+71.)<.09)continue;
        float kind=vDisplayKind<.5?(col<3?0.:col<5?1.:4.):vDisplayKind<1.5?(row<2?2.:col<4?0.:1.):(col<5?(mod(float(col+row),3.)<1.?5.:3.):4.);
        float scale=.88+seed*.17;
        vec3 centre=vec3(-.72+float(col)*.24+(displayHash(id+3.)-.5)*.018,shelfY,-.89+(displayHash(id+14.)-.5)*.085);
        vec3 q=(ro-centre)/scale;
        float a,b;vec3 n;
        if(!displayBounds(q,rd/scale,vec3(-.091,0,-.091),vec3(.091,.42,.091),a,b,n)||a>hit.t)continue;
        // Ray parameter remains in world metres even when the product varies.
        displayProduct(q,rd/scale,kind,seed,hit);
      }
    }
    return hit;
  }

  vec3 displayLabel(vec2 uv,float id) {
    vec2 cell=vec2(mod(id,4.),floor(id/4.));
    // CanvasTexture is flipped on upload. Keep all samples inside their own
    // atlas cell, including the mip footprint around a label's paper edge.
    vec2 atlas=(cell+vec2(.025)+clamp(uv,0.,1.)*.95)/vec2(4.,2.);
    atlas.y=1.-atlas.y;return texture2D(uProductLabels,atlas).rgb;
  }
  vec3 displayColour(DisplayHit hit,vec3 rd,out float gloss) {
    vec3 p=hit.p,n=hit.n;float seed=hit.seed;gloss=0.;
    if(hit.part<.5) {
      float mottling=sin(p.x*21.+sin(p.y*17.))*sin(p.y*32.+p.z*13.);
      return vec3(.40,.345,.27)*(1.+.035*mottling);
    }
    if(hit.part<1.5) {
      float grain=sin(p.z*240.+p.y*160.+sin(p.x*8.+seed*4.)*.7);
      return vec3(.19,.095,.039)*(.94+.06*grain);
    }
    if(hit.part>5.5) {
      float ink=step(.82,fract(p.x*560.+seed))*step(abs(p.y),.006);
      return mix(vec3(.72,.64,.46),vec3(.10,.08,.05),ink*.85);
    }
    if(hit.part>4.5) {
      vec3 paper=vec3(.48,.30,.14)*(1.+.05*sin(p.x*640.)*sin(p.y*530.));
      if(p.z>.042&&abs(p.x)<.052&&abs(p.y)<.087)paper=displayLabel(vec2(p.x/.104+.5,.5-p.y/.174),seed>.5?3.:6.);
      if(abs(p.x)<.0018||abs(p.y+.074)<.0015)paper=vec3(.72,.60,.38);
      return paper;
    }
    if(hit.part>3.5) {
      gloss=.35;
      vec3 glaze=seed<.34?vec3(.065,.235,.215):seed<.67?vec3(.68,.60,.45):vec3(.12,.23,.34);
      float stripe=step(.78,fract(p.y*34.+seed*2.))*step(.07,p.y)*step(p.y,.215);
      glaze=mix(glaze,vec3(.73,.67,.51),stripe*.75);
      if(p.y>.278&&abs(n.y)>.5&&length(p.xz)<.032)glaze*=.07;
      return glaze*(.96+.04*sin(p.y*470.+p.x*23.));
    }
    if(hit.part>2.5) {
      gloss=.28;
      vec3 cap=hit.kind<.5?vec3(.23,.18,.055):hit.kind<1.5?vec3(.49,.30,.075):vec3(.16,.025,.022);
      return cap*(.80+.20*abs(sin(atan(p.x,p.z)*65.)));
    }
    gloss=.72;
    vec3 glass=hit.kind<.5?vec3(.055,.105,.019):hit.kind<1.5?vec3(.39,.16,.025):vec3(.037,.061,.022);
    // Absorption through a finite curved vessel: the thin silhouette is
    // lighter than the long central path through oil, preserves or wine.
    float thickness=sqrt(max(0.,1.-n.x*n.x));
    glass*=mix(1.7,.70,thickness);
    float low=hit.kind<.5?.065:hit.kind<1.5?.055:.080;
    float high=hit.kind<.5?.183:hit.kind<1.5?.153:.215;
    float angle=atan(p.x,p.z),id=hit.kind<.5?0.:hit.kind<1.5?(seed>.55?5.:1.):2.;
    if(abs(angle)<1.05&&p.y>low&&p.y<high&&abs(n.y)<.5) {
      glass=displayLabel(vec2(angle/2.1+.5,1.-(p.y-low)/(high-low)),id);gloss=.04;
    }
    return glass;
  }
`;

export function makeShopDisplay(shops,shopOpen) {
  const {halfWidth,height}=SHOP_DISPLAY;
  const geometry=new THREE.PlaneGeometry(halfWidth*2,height);geometry.translate(0,height/2,.016);
  geometry.setAttribute('aDisplaySeed',new THREE.InstancedBufferAttribute(Float32Array.from(shops,s=>s.seed),1));
  geometry.setAttribute('aDisplayKind',new THREE.InstancedBufferAttribute(Float32Array.from(shops,s=>shopDisplayKind(s.seed)),1));
  const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,envMapIntensity:.22});
  const labels=labelAtlas();
  material.onBeforeCompile=sh=>{
    sh.uniforms.uShopOpen=shopOpen;sh.uniforms.uProductLabels={value:labels};
    sh.vertexShader=sh.vertexShader.replace('#include <common>',`#include <common>
      attribute float aDisplaySeed;attribute float aDisplayKind;
      varying vec3 vDisplayRay;varying vec2 vDisplayPosition;varying float vDisplaySeed;varying float vDisplayKind;`)
      .replace('#include <project_vertex>',`#include <project_vertex>
        mat4 displayMatrix=modelMatrix*instanceMatrix;
        vec3 displayView=(displayMatrix*vec4(transformed,1.)).xyz-cameraPosition;
        vDisplayRay=transpose(mat3(displayMatrix))*displayView;
        vDisplayPosition=position.xy;vDisplaySeed=aDisplaySeed;vDisplayKind=aDisplayKind;`);
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>',`#include <common>\n${SHAPES}`)
      .replace('#include <map_fragment>',`
        if(vDisplayPosition.y>2.05&&length(vec2(vDisplayPosition.x,vDisplayPosition.y-2.05))>.925)discard;
        vec3 displayRd=normalize(vDisplayRay),displayRo=vec3(vDisplayPosition,0.);
        DisplayHit displayHit=displayTrace(displayRo,displayRd);
        float displayGloss;vec3 displayAlbedo=displayColour(displayHit,displayRd,displayGloss);
        vec3 displayNormal=normalize(displayHit.n);
        vec3 displayLight=normalize(vec3(-.36,.74,.82));
        float displayDiffuse=.22+.78*max(0.,dot(displayNormal,displayLight));
        vec3 displayPoint=displayRo+displayRd*displayHit.t;
        float displayDepth=clamp(-displayPoint.z/1.18,0.,1.);
        float displayOcclusion=mix(1.,.58,displayDepth);
        // Creases where products meet timber, with shelf overhang shadow on
        // the rear wall. No black outline is drawn around the product itself.
        if(displayHit.part>=2.&&displayHit.part<=5.)displayOcclusion*=mix(.72,1.,smoothstep(0.,.035,displayHit.p.y));
        if(displayHit.part<.5&&displayPoint.y>.79)displayOcclusion*=mix(.60,1.,smoothstep(0.,.065,mod(displayPoint.y-.79,.5)));
        vec3 displayLit=displayAlbedo*displayDiffuse*displayOcclusion;
        vec3 displayHalf=normalize(displayLight-displayRd);
        float displayHighlight=pow(max(0.,dot(displayNormal,displayHalf)),mix(24.,110.,displayGloss))*displayGloss;
        float displayEdge=pow(1.-max(0.,dot(displayNormal,-displayRd)),4.)*displayGloss;
        displayLit+=vec3(.42,.37,.28)*(displayHighlight*.70+displayEdge*.075);
        diffuseColor.rgb*=displayLit;`)
      .replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
        reflectedLight.directDiffuse*=.05;reflectedLight.directSpecular*=.05;
        reflectedLight.indirectDiffuse+=displayLit*vec3(.0062,.0042,.0020)*uShopOpen*mix(1.,.42,displayDepth);
        reflectedLight.indirectDiffuse*=mix(.45,1.,uShopOpen);`);
  };
  material.customProgramCacheKey=()=> 'solid-shop-display-v1';
  const mesh=new THREE.InstancedMesh(geometry,material,shops.length);
  mesh.userData.displays=shops.map(s=>({x:s.x,y:s.y,z:s.z,rotY:s.rotY,seed:s.seed,kind:shopDisplayKind(s.seed)}));
  return mesh;
}
