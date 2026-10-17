// Hats, flour, tableware, vases and paintings use the same finite ray solids as
// the other storefronts. Product kinds 33–47 (three per trade) and material
// IDs 36–50 belong to these five trades.
//   kinds 33–35 hatter     36–38 miller     39–41 tableware
//         42–44 vases      45–47 gallery
//   parts 36 straw  37 hat band  38 felt  39 burlap  40 cord  41 kraft bag
//         42 bag flap  43 flour  44 porcelain  45 vase glaze  46 stem/leaf
//         47 petals  48 gilt frame  49 black frame  50 painted canvas
// Pale timber (14) and steel (10) are shared with the earlier trades.
export const CRAFT_SHAPES=/* glsl */`
  mat3 craftTilt(float a) {float cs=cos(a),sn=sin(a);return mat3(1,0,0,0,cs,sn,0,-sn,cs);}
  // A hollow ring whose axis is z: cup handles and amphora ears.
  void craftRing(vec3 ro,vec3 rd,vec3 centre,float outerR,float innerR,float depth,float part,float kind,float seed,inout DisplayHit hit) {
    vec3 q=ro-centre;float a=dot(rd.xy,rd.xy),b=dot(q.xy,rd.xy);
    if(a>.0000001)for(int j=0;j<2;j++) {
      float r=j==0?outerR:innerR,disc=b*b-a*(dot(q.xy,q.xy)-r*r);
      if(disc<0.)continue;
      vec2 roots=vec2(-b-sqrt(disc),-b+sqrt(disc))/a;
      for(int i=0;i<2;i++) {
        float t=roots[i];vec3 p=q+rd*t;
        if(abs(p.z)<=depth)displayCommit(t,normalize(vec3(p.xy,0.))*(j==0?1.:-1.),p+centre,part,kind,seed,hit);
      }
    }
    if(abs(rd.z)>.000001)for(int j=0;j<2;j++) {
      float z=j==0?-depth:depth,t=(z-q.z)/rd.z;vec3 p=q+rd*t;float r=length(p.xy);
      if(r>=innerR&&r<=outerR)displayCommit(t,vec3(0,0,j==0?-1.:1.),p+centre,part,kind,seed,hit);
    }
  }
  // A brimmed hat in its own frame (origin = underside of the brim). Straw
  // hats are broad and flat-topped; felt hats taper and carry a crown crease.
  void craftHat(vec3 ro,vec3 rd,vec3 c,float tilt,float straw,float kind,float seed,inout DisplayHit hit) {
    mat3 m=craftTilt(tilt);vec3 q=transpose(m)*(ro-c),d=transpose(m)*rd;DisplayHit h=hit;
    float brimR=straw>.5?.172:.158,crownR=straw>.5?.078:.074,crownH=straw>.5?.092:.112;
    float part=straw>.5?36.:38.;
    displayFrustum(q,d,0.,.014,brimR,brimR-.004,part,kind,seed,h);
    displayFrustum(q,d,.014,crownH,crownR,crownR*(straw>.5?.92:.84),part,kind,seed,h);
    displayFrustum(q,d,.020,.027,crownR+.003,crownR+.003,37.,kind,seed,h);
    if(h.t<hit.t){h.n=m*h.n;hit=h;}
  }
  // A flower on a stem: used by the bud vase and the wide bowl.
  void craftBlossom(vec3 ro,vec3 rd,vec3 c,float r,float seed,inout DisplayHit hit,float kind) {
    tradeEllipsoid(ro,rd,c,vec3(r,r*.78,r),47.,kind,seed,hit);
  }
  void craftPlateUpright(vec3 ro,vec3 rd,vec3 c,float tilt,float r0,float r1,float thick,float part,float kind,float seed,inout DisplayHit hit) {
    // A plate stands with its axis along z; swap y/z so the y-axis frustum
    // becomes a disc, then swap the hit back into plate coordinates.
    mat3 m=craftTilt(tilt);vec3 q=transpose(m)*(ro-c),d=transpose(m)*rd;DisplayHit h=hit;
    displayFrustum(q.xzy,d.xzy,-thick*.5,thick,r0,r1,part,kind,seed,h);
    if(h.t<hit.t){h.n=m*h.n.xzy;h.p=h.p.xzy;hit=h;}
  }
  // A picture frame: four bars around a recessed canvas, leaning back on the
  // shelf. Bar hits are bar-local; the canvas hit is canvas-local.
  void craftFrame(vec3 ro,vec3 rd,vec3 c,float tilt,vec2 canvas,float bar,float framePart,float kind,float seed,inout DisplayHit hit) {
    mat3 m=craftTilt(tilt);vec3 q=transpose(m)*(ro-c),d=transpose(m)*rd;DisplayHit h=hit;
    vec2 o=canvas+vec2(2.*bar);
    displayBox(q,d,vec3(0,o.y-bar,0),vec3(o.x,bar,.020),framePart,kind,seed,h);
    displayBox(q,d,vec3(0,-o.y+bar,0),vec3(o.x,bar,.020),framePart,kind,seed,h);
    displayBox(q,d,vec3(-o.x+bar,0,0),vec3(bar,canvas.y,.020),framePart,kind,seed,h);
    displayBox(q,d,vec3(o.x-bar,0,0),vec3(bar,canvas.y,.020),framePart,kind,seed,h);
    displayBox(q,d,vec3(0,0,-.004),vec3(canvas,.010),50.,kind,seed,h);
    if(h.t<hit.t){h.n=m*h.n;hit=h;}
  }
  void displayCraftProvision(vec3 ro,vec3 rd,float kind,float seed,inout DisplayHit hit) {
    if(kind<33.5) {
      // Straw hat propped on a block of the shelf.
      craftHat(ro,rd,vec3(0,.035,0),.18,1.,kind,seed,hit);
    } else if(kind<34.5) {
      craftHat(ro,rd,vec3(0,.030,0),.10,0.,kind,seed,hit);
    } else if(kind<35.5) {
      // A turned timber stand and head carrying a hat of either kind.
      displayFrustum(ro,rd,.003,.012,.072,.070,14.,kind,seed,hit);
      displayFrustum(ro,rd,.015,.165,.013,.011,14.,kind,seed,hit);
      tradeEllipsoid(ro,rd,vec3(0,.240,0),vec3(.060,.082,.066),14.,kind,seed,hit);
      craftHat(ro,rd,vec3(0,.265,0),.08,seed>.5?1.:0.,kind,seed,hit);
    } else if(kind<36.5) {
      // A tied sack: swollen body, gathered neck, cord and a printed label.
      tradeEllipsoid(ro,rd,vec3(0,.150,0),vec3(.118,.145,.088),39.,kind,seed,hit);
      displayFrustum(ro,rd,.262,.055,.052,.066,39.,kind,seed,hit);
      displayFrustum(ro,rd,.252,.014,.058,.058,40.,kind,seed,hit);
      tradeEllipsoid(ro,rd,vec3(0,.318,0),vec3(.064,.030,.052),39.,kind,seed,hit);
    } else if(kind<37.5) {
      // Two small kraft-paper bags with folded tops.
      displayBox(ro,rd,vec3(-.082,.115,0),vec3(.072,.115,.045),41.,kind,seed,hit);
      displayBox(ro,rd,vec3(-.082,.248,0),vec3(.074,.018,.047),42.,kind,seed,hit);
      displayBox(ro,rd,vec3(.082,.092,.004),vec3(.072,.092,.045),41.,kind,seed+.31,hit);
      displayBox(ro,rd,vec3(.082,.202,.004),vec3(.074,.018,.047),42.,kind,seed,hit);
    } else if(kind<38.5) {
      // A hooped timber measure heaped with flour, and a wooden scoop.
      displayFrustum(ro,rd,.003,.120,.105,.115,14.,kind,seed,hit);
      displayFrustum(ro,rd,.030,.010,.1075,.1075,10.,kind,seed,hit);
      displayFrustum(ro,rd,.090,.010,.1115,.1115,10.,kind,seed,hit);
      tradeEllipsoid(ro,rd,vec3(0,.120,0),vec3(.098,.062,.098),43.,kind,seed,hit);
      tradeTilted(ro,rd,vec3(.062,.175,.020),vec3(.011,.090,.011),-.55,14.,kind,seed,hit);
      tradeEllipsoid(ro,rd,vec3(.015,.132,.030),vec3(.034,.016,.030),14.,kind,seed,hit);
    } else if(kind<39.5) {
      // A stack of glazed plates; the top plate shows its painted well.
      for(int plate=0;plate<4;plate++)
        displayFrustum(ro,rd,.003+float(plate)*.028,.022,.098,.150,44.,kind,seed,hit);
    } else if(kind<40.5) {
      // A cup and saucer: the handle is a hollow ring.
      displayFrustum(ro,rd,.003,.016,.060,.108,44.,kind,seed,hit);
      displayFrustum(ro,rd,.019,.082,.040,.060,44.,kind,seed,hit);
      craftRing(ro,rd,vec3(.074,.064,0),.034,.019,.008,44.,kind,seed,hit);
    } else if(kind<41.5) {
      // A painted plate stood on a small wooden foot, leaning back.
      craftPlateUpright(ro,rd,vec3(0,.178,0),-.20,.130,.150,.030,44.,kind,seed,hit);
      displayBox(ro,rd,vec3(0,.011,.050),vec3(.070,.011,.022),14.,kind,seed,hit);
    } else if(kind<42.5) {
      // An amphora: foot, swollen belly, narrow neck, lip and two ears.
      displayFrustum(ro,rd,.003,.022,.035,.052,45.,kind,seed,hit);
      tradeEllipsoid(ro,rd,vec3(0,.160,0),vec3(.096,.130,.096),45.,kind,seed,hit);
      displayFrustum(ro,rd,.250,.090,.042,.030,45.,kind,seed,hit);
      displayFrustum(ro,rd,.338,.020,.036,.046,45.,kind,seed,hit);
      for(int side=0;side<2;side++)craftRing(ro,rd,vec3(side==0?-.066:.066,.280,0),.048,.030,.010,45.,kind,seed,hit);
    } else if(kind<43.5) {
      // A bud vase with one flower and a leaf.
      tradeEllipsoid(ro,rd,vec3(0,.082,0),vec3(.064,.082,.064),45.,kind,seed,hit);
      displayFrustum(ro,rd,.150,.185,.030,.020,45.,kind,seed,hit);
      displayFrustum(ro,rd,.335,.015,.020,.031,45.,kind,seed,hit);
      displayFrustum(ro,rd,.330,.078,.0045,.0045,46.,kind,seed,hit);
      tradeTilted(ro,rd,vec3(.030,.372,0),vec3(.034,.008,.011),.55,46.,kind,seed,hit);
      craftBlossom(ro,rd,vec3(0,.412,0),.034,seed,hit,kind);
    } else if(kind<44.5) {
      // A wide jar with a bunch of three flowers.
      displayFrustum(ro,rd,.003,.030,.060,.080,45.,kind,seed,hit);
      tradeEllipsoid(ro,rd,vec3(0,.095,0),vec3(.126,.090,.126),45.,kind,seed,hit);
      displayFrustum(ro,rd,.165,.025,.076,.092,45.,kind,seed,hit);
      tradeTilted(ro,rd,vec3(-.040,.250,0),vec3(.0045,.070,.0045),.35,46.,kind,seed,hit);
      tradeTilted(ro,rd,vec3(0,.262,0),vec3(.0045,.075,.0045),0.,46.,kind,seed,hit);
      tradeTilted(ro,rd,vec3(.040,.250,0),vec3(.0045,.070,.0045),-.35,46.,kind,seed,hit);
      craftBlossom(ro,rd,vec3(-.064,.330,0),.033,seed,hit,kind);
      craftBlossom(ro,rd,vec3(0,.347,0),.036,seed+.29,hit,kind);
      craftBlossom(ro,rd,vec3(.064,.330,0),.033,seed+.61,hit,kind);
    } else if(kind<45.5) {
      // A landscape in a gilt frame.
      craftFrame(ro,rd,vec3(0,.165,0),-.15,vec2(.150,.100),.030,48.,kind,seed,hit);
    } else if(kind<46.5) {
      // A still life in a black frame, portrait format.
      craftFrame(ro,rd,vec3(0,.215,0),-.15,vec2(.100,.150),.030,49.,kind,seed,hit);
    } else {
      // A small unframed canvas on a timber easel.
      tradeTilted(ro,rd,vec3(-.095,.215,0),vec3(.008,.215,.010),-.25,14.,kind,seed,hit);
      tradeTilted(ro,rd,vec3(.095,.215,0),vec3(.008,.215,.010),.25,14.,kind,seed,hit);
      displayBox(ro,rd,vec3(0,.120,.016),vec3(.125,.010,.028),14.,kind,seed,hit);
      displayBox(ro,rd,vec3(0,.255,.018),vec3(.108,.082,.012),50.,kind,seed,hit);
    }
  }
`;

export const CRAFT_COLOURS=/* glsl */`
  float craftHash(float n) {return fract(sin(n*12.9898)*43758.5453);}
  // exp(-x²) without pow(): GLSL leaves pow() undefined for a negative base.
  float craftGauss(float x) {return exp(-x*x);}
  float craftBand(float r,float centre,float halfWidth) {return 1.-smoothstep(0.,.005,abs(r-centre)-halfWidth);}
  vec3 craftFill(vec3 col,vec3 ink,float sdf) {return mix(col,ink,1.-smoothstep(-.012,.012,sdf));}
  // Paintings are analytic: q is in canvas-height units, ar the aspect ratio.
  vec3 craftLandscape(vec2 q,float ar,float seed) {
    float hor=-.18+.08*sin(seed*6.2832);
    vec3 col=mix(vec3(.90,.72,.44),vec3(.28,.49,.78),smoothstep(hor,1.,q.y));
    vec2 sunP=vec2(ar*.42,hor+.36);
    float sun=1.-smoothstep(.10,.18,length(q-sunP));
    col=mix(col,vec3(1.,.93,.66),sun*.9);
    float ridge=hor+.34*craftGauss((q.x+ar*.62)/.55)+.04*sin(q.x*9.);
    col=craftFill(col,vec3(.33,.29,.34),max(q.y-ridge,hor-q.y));
    if(q.y<hor) {
      float d=hor-q.y;
      col=mix(vec3(.17,.44,.60),vec3(.035,.15,.29),smoothstep(0.,.9,d));
      float glint=craftGauss((q.x-sunP.x)/(.07+.35*d))*(.45+.55*sin(d*70.));
      col+=vec3(.55,.40,.18)*glint*.5;
    }
    // A walled harbour town: stone blocks under terracotta roofs.
    float cx=floor(q.x*7.),h=.09+.13*craftHash(cx*3.7+seed*17.);
    float town=max(max(q.x+.05,-(q.x-ar*.95)),max(hor-.03-q.y,q.y-hor-h));
    if(q.x>-.05&&q.x<ar*.95&&q.y>hor-.03&&q.y<hor+h) {
      vec3 wall=vec3(.82,.74,.57)*(.9+.2*craftHash(cx+4.));
      float roof=step(hor+h-.055,q.y);
      col=craftFill(col,mix(wall,vec3(.58,.19,.10)*(.85+.3*craftHash(cx+9.)),roof),town);
      if(roof<.5&&fract(q.x*7.)>.38&&fract(q.x*7.)<.6&&fract(q.y*13.)>.4)col*=.55;
    }
    return col;
  }
  vec3 craftStill(vec2 q,float ar,float seed) {
    vec3 col=mix(vec3(.19,.13,.09),vec3(.06,.045,.04),smoothstep(-.5,1.,q.y));
    if(q.y<-.56)col=vec3(.31,.20,.10)*(.9+.1*sin(q.x*34.));
    // A blue jug with a pale highlight and a loose bunch of flowers.
    float jug=length((q-vec2(0,-.30))/vec2(.32,.30));
    float neck=max(abs(q.x)-.11,max(-.02-q.y,q.y-.24));
    vec3 blue=vec3(.09,.22,.40)*(.75+.5*smoothstep(.2,-.8,q.x/.32));
    col=craftFill(col,blue,min(jug-1.,neck)*.3);
    col=craftFill(col,vec3(.65,.75,.82),length((q-vec2(-.13,-.22))/vec2(.06,.12))-1.);
    for(int i=0;i<5;i++) {
      vec2 f=vec2(sin(float(i)*2.4)*.36,.36+cos(float(i)*1.7)*.17);
      vec3 petal=mod(float(i),2.)<1.?vec3(.62,.10,.08):vec3(.82,.62,.18);
      col=craftFill(col,petal,length(q-f)-.13);
      col=craftFill(col,vec3(.25,.10,.04),length(q-f)-.035);
    }
    col=craftFill(col,vec3(.80,.40,.06),length(q-vec2(-.50,-.60))-.15);
    col=craftFill(col,vec3(.82,.70,.20),length((q-vec2(.50,-.62))/vec2(.17,.12))-1.);
    return col;
  }
  vec3 craftSunset(vec2 q,float ar,float seed) {
    float hor=-.12;
    vec3 col=mix(vec3(.95,.55,.22),vec3(.24,.28,.55),smoothstep(hor,1.,q.y));
    float sun=1.-smoothstep(.12,.20,length(q-vec2(.0,hor+.10)));
    col=mix(col,vec3(1.,.82,.45),sun);
    col=craftFill(col,vec3(.20,.16,.20),max(q.y-(hor+.14*craftGauss((q.x-ar*.55)/.35)),hor-q.y));
    if(q.y<hor) {
      float d=hor-q.y;
      col=mix(vec3(.36,.30,.38),vec3(.06,.10,.22),smoothstep(0.,1.,d));
      col+=vec3(.7,.38,.12)*craftGauss(q.x/(.05+.4*d))*(.4+.6*sin(d*80.))*.6;
    }
    return col;
  }
  vec3 craftProvisionColour(DisplayHit hit,out float gloss) {
    vec3 p=hit.p,n=hit.n;float seed=fract(hit.seed);gloss=0.;
    float part=hit.part;
    if(part<36.5) {
      // Straw plait: concentric on the brim and crown top, banded on the sides.
      float weave=abs(n.y)>.5?sin(length(p.xz)*620.):sin(p.y*520.+atan(p.x,p.z)*40.);
      vec3 straw=vec3(.66,.54,.30)*(.90+.08*weave+.04*sin(p.x*190.)*sin(p.z*170.));
      return straw*mix(.92,1.,smoothstep(.0,.03,p.y));
    }
    if(part<37.5) {
      gloss=.18;
      vec3 band=seed<.34?vec3(.025,.025,.03):seed<.67?vec3(.06,.10,.20):vec3(.28,.05,.05);
      return band*(.9+.1*sin(p.y*900.));
    }
    if(part<38.5) {
      gloss=.04;
      vec3 felt=seed<.34?vec3(.19,.17,.15):seed<.67?vec3(.075,.095,.16):vec3(.17,.10,.055);
      // A pinch crease runs front to back along the crown top.
      float crease=(n.y>.5&&p.y>.1)?1.-smoothstep(.006,.020,abs(p.x)):0.;
      return felt*(1.-.45*crease)*(.94+.06*sin(p.x*800.)*sin(p.z*760.));
    }
    if(part<39.5) {
      float weave=sin(p.x*420.+p.y*30.)*sin(p.y*400.-p.x*20.);
      vec3 burlap=vec3(.56,.43,.25)*(.88+.12*weave);
      float label=(n.z>.4&&abs(p.x)<.072&&abs(p.y-.150)<.066&&p.y<.25)?1.:0.;
      if(label>.5)return displayLabel(vec2(p.x/.144+.5,.5-(p.y-.150)/.132),22.+floor(seed*3.));
      float seam=step(.96,fract(p.x*9.))*step(p.y,.12);
      return burlap*(1.-.25*seam)*mix(.82,1.,smoothstep(.0,.08,p.y));
    }
    if(part<40.5)return vec3(.33,.25,.14)*(.9+.1*sin(p.x*600.+p.z*500.));
    if(part<41.5) {
      vec3 kraft=vec3(.58,.43,.24)*(1.+.045*sin(p.x*520.)*sin(p.y*430.));
      if(n.z>.8&&p.z>.04&&abs(p.x)<.058&&abs(p.y)<.07)
        return displayLabel(vec2(p.x/.116+.5,.5-p.y/.14),22.+floor(fract(seed*5.)*3.));
      return kraft*mix(.80,1.,smoothstep(.0,.06,hit.p.y+.12));
    }
    if(part<42.5)return vec3(.50,.37,.20)*(1.+.05*sin(p.x*560.));
    if(part<43.5)return vec3(.87,.85,.79)*(1.+.035*sin(p.x*900.)*sin(p.z*780.));
    if(part<44.5) {
      gloss=.58;
      vec3 white=vec3(.80,.81,.77),blue=vec3(.05,.15,.38);
      float k=hit.kind;
      if(k<39.5) {
        float r=length(p.xz),a=atan(p.z,p.x);
        float rim=craftBand(r,.141,.004)+craftBand(r,.118,.002);
        float rose=1.-smoothstep(.0,.008,r-(.045+.014*sin(a*6.)));
        float edge=(n.y<.5)?step(.017,mod(p.y-.003,.028)):0.;
        return mix(white,blue,clamp(((n.y>.5)?rim+rose:0.)+edge,0.,1.));
      }
      if(k<40.5) {
        float r=length(p.xz);
        if(n.y>.5&&p.y>.09&&r<.053)return vec3(.07,.035,.02);
        float saucerRim=(p.y<.02&&n.y>.5)?craftBand(r,.088,.004):0.;
        float band=(p.y>.04&&p.y<.09)?step(.5,fract(atan(p.z,p.x)*3.8))*step(.045,p.y)*step(p.y,.058):0.;
        float lip=step(.085,p.y)*step(p.y,.0995);
        return mix(white,blue,clamp(saucerRim+band+lip,0.,1.));
      }
      // Painted standing plate: rim rings and a six-petal flower, plate-local.
      if(p.z<.003)return white*.85;
      float r=length(p.xy),a=atan(p.y,p.x);
      float rim=craftBand(r,.128,.005)+craftBand(r,.110,.002);
      float petals=1.-smoothstep(.0,.006,r-(.040+.026*pow(abs(sin(a*3.)),1.5)));
      float heart=1.-smoothstep(.0,.004,r-.012);
      vec3 c=mix(white,blue,clamp(rim+petals,0.,1.));
      return mix(c,vec3(.80,.55,.10),heart);
    }
    if(part<45.5) {
      gloss=.50;
      float s=fract(seed*7.31+hit.kind*.37);
      vec3 glaze;
      if(s<.34) {
        glaze=vec3(.04,.14,.30);
        glaze=mix(glaze,vec3(.55,.62,.68),step(.82,fract(p.y*20.))*.7);
      } else if(s<.67) {
        glaze=vec3(.50,.21,.10)*(.95+.05*sin(p.y*220.));
        glaze=mix(glaze,vec3(.16,.07,.04),step(.9,fract(p.y*14.+.4))*.8);
      } else {
        glaze=vec3(.78,.76,.68);
        glaze=mix(glaze,vec3(.06,.17,.36),step(.74,fract(p.y*17.)));
      }
      // The open mouth is dark.
      float mouth=hit.kind<42.5?.030:hit.kind<43.5?.020:.074;
      float mouthY=hit.kind<42.5?.358:hit.kind<43.5?.350:.190;
      if(n.y>.5&&p.y>mouthY-.004&&length(p.xz)<mouth)glaze=vec3(.015,.012,.010);
      return glaze*mix(.85,1.,smoothstep(.0,.06,p.y));
    }
    if(part<46.5)return vec3(.06,.17,.04)*(.9+.1*sin(p.y*300.));
    if(part<47.5) {
      float s=fract(seed*5.+hit.kind*.13);
      vec3 petal=s<.25?vec3(.58,.06,.07):s<.5?vec3(.80,.58,.08):s<.75?vec3(.82,.60,.62):vec3(.28,.10,.40);
      if(n.y>.8)petal=mix(petal,vec3(.30,.18,.03),.55);
      return petal*(.85+.15*sin(atan(p.x,p.z)*14.));
    }
    if(part<48.5) {
      gloss=.45;
      vec3 gilt=vec3(.66,.47,.13)*(.88+.12*sin(p.x*170.+p.y*170.));
      return mix(gilt,vec3(.86,.68,.28),smoothstep(.9,1.,abs(sin(p.x*60.))*abs(sin(p.y*60.)))*.5);
    }
    if(part<49.5) {gloss=.34;return vec3(.025,.02,.018)*(1.+.3*sin(p.x*300.));}
    // Painted canvas: front face only; the edges are bare canvas.
    gloss=.06;
    if(n.z<.5)return vec3(.74,.69,.57);
    float k=hit.kind;
    vec2 hs=k<45.5?vec2(.150,.100):k<46.5?vec2(.100,.150):vec2(.108,.082);
    vec2 q=p.xy/hs.y;float ar=hs.x/hs.y;
    vec3 col=k<45.5?craftLandscape(q,ar,seed):k<46.5?craftStill(q,ar,seed):craftSunset(q,ar,seed);
    return col*(.95+.05*sin(p.x*900.)*sin(p.y*850.));
  }
`;
