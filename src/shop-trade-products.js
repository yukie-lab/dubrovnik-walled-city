import {BOUTIQUE_FRUIT_SHAPES,BOUTIQUE_FRUIT_COLOURS} from './shop-boutique-fruit.js';
import {CULTURE_FOOD_SHAPES,CULTURE_FOOD_COLOURS} from './shop-books-souvenirs-cheese.js';

// Analytic solids for the sign-led trades. Coordinates are metres in a
// product's local frame; each surface retains its own normal and material.
export const TRADE_SHAPES=/* glsl */`
  void tradeEllipsoid(vec3 ro,vec3 rd,vec3 c,vec3 r,float part,float kind,float seed,inout DisplayHit hit) {
    vec3 q=(ro-c)/r,d=rd/r;float a=dot(d,d),b=dot(q,d),disc=b*b-a*(dot(q,q)-1.);
    if(disc<0.)return;
    vec2 roots=vec2(-b-sqrt(disc),-b+sqrt(disc))/a;
    for(int i=0;i<2;i++) {
      float t=roots[i];vec3 p=ro+rd*t;
      displayCommit(t,normalize((p-c)/(r*r)),p,part,kind,seed,hit);
    }
  }
  // An actual hollow ring, including its inner wall and both faces. Used by
  // key bows and scissor handles so the background is visible through them.
  void tradeRing(vec3 ro,vec3 rd,vec3 centre,float outerR,float innerR,float depth,float kind,float seed,inout DisplayHit hit) {
    vec3 q=ro-centre;float a=dot(rd.xy,rd.xy),b=dot(q.xy,rd.xy);
    if(a>.0000001)for(int j=0;j<2;j++) {
      float r=j==0?outerR:innerR,disc=b*b-a*(dot(q.xy,q.xy)-r*r);
      if(disc<0.)continue;
      vec2 roots=vec2(-b-sqrt(disc),-b+sqrt(disc))/a;
      for(int i=0;i<2;i++) {
        float t=roots[i];vec3 p=q+rd*t;
        if(abs(p.z)<=depth)displayCommit(t,normalize(vec3(p.xy,0.))*(j==0?1.:-1.),p+centre,10.,kind,seed,hit);
      }
    }
    if(abs(rd.z)>.000001)for(int j=0;j<2;j++) {
      float z=j==0?-depth:depth,t=(z-q.z)/rd.z;vec3 p=q+rd*t;float r=length(p.xy);
      if(r>=innerR&&r<=outerR)displayCommit(t,vec3(0,0,j==0?-1.:1.),p+centre,10.,kind,seed,hit);
    }
  }
  // Rotate a slim solid in the display plane, then rotate its hit normal and
  // point back. A scissor blade or fish fin is not a flat texture silhouette.
  void tradeTilted(vec3 ro,vec3 rd,vec3 c,vec3 r,float angle,float part,float kind,float seed,inout DisplayHit hit) {
    float cs=cos(angle),sn=sin(angle);mat3 m=mat3(cs,sn,0,-sn,cs,0,0,0,1);
    DisplayHit h=hit;
    tradeEllipsoid(transpose(m)*(ro-c),transpose(m)*rd,vec3(0),r,part,kind,seed,h);
    if(h.t<hit.t){h.n=m*h.n;h.p=c+m*h.p;hit=h;}
  }
  ${BOUTIQUE_FRUIT_SHAPES}
  ${CULTURE_FOOD_SHAPES}
  void displayTradeProduct(vec3 ro,vec3 rd,float kind,float seed,inout DisplayHit hit) {
    if(kind>24.5){displayCultureFood(ro,rd,kind,seed,hit);return;}
    if(kind>17.5){displayBoutiqueFruit(ro,rd,kind,seed,hit);return;}
    if(kind<7.5) {
      // Baked loaves: a domed round loaf or a longer scored country loaf.
      vec3 radius=kind<6.5?vec3(.127,.092,.09):vec3(.146,.063,.068);
      tradeEllipsoid(ro,rd,vec3(0,radius.y+.003,0),radius,7.,kind,seed,hit);
    } else if(kind<8.5) {
      displayFrustum(ro,rd,.004,.016,.077,.077,14.,kind,seed,hit);
      displayFrustum(ro,rd,.020,.190,.061,.061,9.,kind,seed,hit);
      displayFrustum(ro,rd,.210,.016,.077,.077,14.,kind,seed,hit);
      displayFrustum(ro,rd,.226,.012,.019,.019,14.,kind,seed,hit);
    } else if(kind<9.5) {
      // Folded cloth stacked with offset edges, rounded folds and woven hems.
      for(int layer=0;layer<3;layer++) {
        float y=.032+float(layer)*.061,x=(float(layer)-1.)*.007;
        displayBox(ro,rd,vec3(x,y,-.014),vec3(.134,.027,.071),8.,kind,seed+float(layer)*.21,hit);
        tradeEllipsoid(ro,rd,vec3(x,y,.057),vec3(.134,.027,.024),8.,kind,seed+float(layer)*.21,hit);
      }
    } else if(kind<10.5) {
      // Whole fish on ice: silver belly, tapered body, a forked tail, dorsal
      // fin and a separate near-side eye and gill, all with real thickness.
      tradeEllipsoid(ro,rd,vec3(-.026,.055,0),vec3(.123,.049,.048),11.,kind,seed,hit);
      tradeTilted(ro,rd,vec3(.121,.075,0),vec3(.058,.014,.016),.58,11.,kind,seed,hit);
      tradeTilted(ro,rd,vec3(.121,.031,0),vec3(.058,.014,.016),-.58,11.,kind,seed,hit);
      tradeTilted(ro,rd,vec3(-.005,.108,0),vec3(.052,.019,.009),.18,11.,kind,seed,hit);
      tradeEllipsoid(ro,rd,vec3(-.113,.066,.032),vec3(.005,.005,.004),10.,kind,seed,hit);
    } else if(kind<11.5) {
      // Low leather shoes have a separate sole, rounded toe, continuous vamp
      // and raised heel. The collar is shaded as a recessed dark opening.
      tradeEllipsoid(ro,rd,vec3(0,.018,0),vec3(.143,.018,.064),12.,kind,seed,hit);
      tradeEllipsoid(ro,rd,vec3(-.068,.057,.002),vec3(.075,.041,.063),12.,kind,seed,hit);
      tradeEllipsoid(ro,rd,vec3(.012,.083,0),vec3(.094,.061,.060),12.,kind,seed,hit);
      tradeEllipsoid(ro,rd,vec3(.088,.083,0),vec3(.045,.066,.056),12.,kind,seed,hit);
      tradeEllipsoid(ro,rd,vec3(.064,.143,0),vec3(.035,.006,.038),12.,kind,seed,hit);
    } else if(kind<12.5) {
      // A timber stand and pin hold the keys above the shelf.
      displayBox(ro,rd,vec3(0,.008,-.021),vec3(.061,.008,.044),14.,kind,seed,hit);
      displayBox(ro,rd,vec3(0,.144,-.047),vec3(.010,.136,.013),14.,kind,seed,hit);
      displayBox(ro,rd,vec3(0,.279,-.018),vec3(.005,.005,.030),10.,kind,seed,hit);
      tradeRing(ro,rd,vec3(0,.256,0),.048,.029,.010,kind,seed,hit);
      displayBox(ro,rd,vec3(0,.132,0),vec3(.009,.083,.009),10.,kind,seed,hit);
      displayBox(ro,rd,vec3(.023,.063,0),vec3(.024,.014,.010),10.,kind,seed,hit);
      displayBox(ro,rd,vec3(.019,.100,0),vec3(.020,.009,.010),10.,kind,seed,hit);
    } else if(kind<13.5) {
      tradeRing(ro,rd,vec3(0,.181,-.006),.060,.041,.015,kind,seed,hit);
      displayBox(ro,rd,vec3(0,.079,0),vec3(.077,.075,.040),10.,kind,seed,hit);
    } else if(kind<14.5) {
      displayBox(ro,rd,vec3(0,.136,0),vec3(.128,.023,.009),13.,kind,seed,hit);
      for(int tooth=0;tooth<12;tooth++)displayBox(ro,rd,vec3(-.116+float(tooth)*.021,.057,0),vec3(.005,.057,.008),13.,kind,seed,hit);
    } else if(kind<15.5) {
      tradeEllipsoid(ro,rd,vec3(0,.207,0),vec3(.063,.091,.023),14.,kind,seed,hit);
      displayFrustum(ro,rd,.005,.137,.014,.022,14.,kind,seed,hit);
      for(int tooth=0;tooth<5;tooth++) {
        float x=-.040+float(tooth)*.020;
        displayBox(ro,rd,vec3(x,.207,.039),vec3(.005,.052,.023),13.,kind,seed,hit);
      }
    } else if(kind<16.5) {
      // Amber apothecary / grooming bottles, cream paper and cork stoppers.
      displayFrustum(ro,rd,.004,.186,.055,.056,16.,kind,seed,hit);
      displayFrustum(ro,rd,.190,.034,.056,.025,16.,kind,seed,hit);
      displayFrustum(ro,rd,.224,.040,.025,.025,16.,kind,seed,hit);
      displayFrustum(ro,rd,.264,.031,.026,.027,14.,kind,seed,hit);
    } else {
      tradeRing(ro,rd,vec3(-.046,.051,0),.038,.026,.010,kind,seed,hit);
      tradeRing(ro,rd,vec3(.046,.051,.005),.038,.026,.010,kind,seed,hit);
      tradeTilted(ro,rd,vec3(.031,.210,0),vec3(.011,.139,.006),-.438,10.,kind,seed,hit);
      tradeTilted(ro,rd,vec3(-.031,.210,.008),vec3(.011,.139,.006),.438,10.,kind,seed,hit);
      tradeEllipsoid(ro,rd,vec3(0,.144,.018),vec3(.012,.012,.006),10.,kind,seed,hit);
    }
  }
`;

// Inserted after label sampling so paper sleeves can share the label atlas.
export const TRADE_COLOURS=/* glsl */`
  ${BOUTIQUE_FRUIT_COLOURS}
  ${CULTURE_FOOD_COLOURS}
  vec3 tradeColour(DisplayHit hit,out float gloss) {
    vec3 p=hit.p,n=hit.n;float seed=hit.seed;gloss=0.;
    if(hit.part>22.5)return cultureFoodColour(hit,gloss);
    if(hit.part>16.5)return boutiqueFruitColour(hit,gloss);
    if(hit.part<7.5) {
      float crust=.90+.10*sin(p.x*273.+sin(p.y*93.))*sin(p.z*212.);
      float cut=1.-smoothstep(.014,.028,abs(fract((p.x+p.y*.45)*16.+.5)-.5));
      cut*=smoothstep(.07,.14,p.y);
      return mix(vec3(.54,.245,.063)*crust,vec3(.84,.64,.35),cut*.78);
    }
    if(hit.part<9.5) {
      float s=fract(seed);vec3 dye=s<.25?vec3(.50,.18,.14):s<.5?vec3(.14,.27,.35):s<.75?vec3(.68,.60,.44):vec3(.21,.33,.25);
      if(hit.part<8.5) {
        float weave=sin(p.x*1100.)*sin(p.y*1100.);
        float seam=step(.92,fract(p.x*100.))*step(.021,abs(p.y));
        return dye*(.94+.06*weave)+vec3(.14)*seam;
      }
      return dye*(.84+.16*sin(p.y*1700.));
    }
    if(hit.part<10.5) {
      gloss=.75;
      if(hit.kind>9.5&&hit.kind<10.5)return vec3(.008,.012,.016);
      vec3 metal=hit.kind<16.?vec3(.52,.34,.095):vec3(.51,.55,.54);
      if(hit.kind>12.5&&hit.kind<13.5&&p.z>.038&&abs(p.x)<.013&&p.y<.007)metal*=.08;
      return metal;
    }
    if(hit.part<11.5) {
      gloss=.62;
      float back=smoothstep(.042,.094,p.y);
      vec3 silver=mix(vec3(.59,.66,.65),vec3(.085,.23,.27),back);
      float scales=sin(p.x*380.+sin(p.y*270.))*sin(p.y*270.);
      silver*=.93+.07*scales;
      float gill=1.-smoothstep(.002,.006,abs(p.x+.083+(p.y-.06)*.3));
      if(p.z>.023&&p.y>.025&&p.y<.09)silver*=1.-gill*.65;
      return silver;
    }
    if(hit.part<12.5) {
      gloss=.18;vec3 leather=seed<.5?vec3(.18,.061,.021):vec3(.045,.033,.026);
      if(p.y<.036||(p.y>.14&&p.x>.028))leather*=.24;
      float stitch=step(.85,fract(p.x*190.))*step(abs(p.y-.042),.003);
      float laces=step(.86,fract((p.x+p.y*.16)*65.))*step(-.027,p.x)*step(p.x,.034)*step(.088,p.y)*step(.026,p.z);
      return mix(leather,vec3(.56,.41,.23),max(stitch*.7,laces));
    }
    if(hit.part<13.5) {gloss=.16;return vec3(.105,.060,.022)*(1.+.17*sin(p.x*170.));}
    if(hit.part<14.5)return vec3(.46,.27,.10)*(1.+.08*sin(p.y*290.+p.x*47.));
    if(hit.part<15.5) {gloss=.23;return vec3(.60,.71,.72)*(1.+.10*sin(p.x*440.)*sin(p.z*390.));}
    gloss=.55;
    float angle=atan(p.x,p.z);
    if(abs(angle)<1.12&&p.y>.051&&p.y<.158&&abs(n.y)<.5) {
      gloss=.03;return displayLabel(vec2(angle/2.24+.5,1.-(p.y-.051)/.107),vDisplayKind>6.5?9.:seed<.5?8.:10.);
    }
    return vec3(.23,.093,.016)*(1.3-.6*abs(n.z));
  }
`;
