// Ties, jewellery and candles use the same finite ray solids as the other
// storefronts. Product kinds 48–56 (three per trade) and material IDs 51–62
// belong to these three trades; the helpers below are shared with
// shop-gelato-music-nautical.js.
//   kinds 48 rolled ties in a tray   49 shirt and knotted tie   50 gift box
//         51 neck form + necklace    52 ring riser              53 earring card
//         54 tapers in a block       55 dipped pairs on a rod   56 pillars
//   parts 51 tie silk (blade-local)  52 rolled tie (roll-local) 53 shirt cotton
//         54 gift-box card  55 satin  56 velvet  57 gold  58 filigree gold
//         59 coral  60 gem  61 wax  62 wick
// The tie shop's rail of hanging ties is a fixture of its niche (tieRail).
export const TIES_JEWELS_CANDLES_SHAPES=/* glsl */`
  mat3 wareTurn(float a) {float cs=cos(a),sn=sin(a);return mat3(cs,0,-sn,0,1,0,sn,0,cs);}
  // A closed cylinder or frustum on the z axis (r0 at z0, r1 at z0+len) or on
  // the x axis. The hit point stays local to the centre c.
  void wareAlongZ(vec3 ro,vec3 rd,vec3 c,float z0,float len,float r0,float r1,float part,float kind,float seed,inout DisplayHit hit) {
    DisplayHit h=hit;
    displayFrustum((ro-c).xzy,rd.xzy,z0,len,r0,r1,part,kind,seed,h);
    if(h.t<hit.t){h.n=h.n.xzy;h.p=h.p.xzy;hit=h;}
  }
  void wareAlongX(vec3 ro,vec3 rd,vec3 c,float x0,float len,float r0,float r1,float part,float kind,float seed,inout DisplayHit hit) {
    DisplayHit h=hit;
    displayFrustum((ro-c).yxz,rd.yxz,x0,len,r0,r1,part,kind,seed,h);
    if(h.t<hit.t){h.n=h.n.yxz;h.p=h.p.yxz;hit=h;}
  }
  // A flat convex outline of up to five corners (anticlockwise in xy) with
  // thickness 2*depth along z: tie blades, knots and collar points.
  void warePrism(vec3 ro,vec3 rd,vec2 a,vec2 b,vec2 c,vec2 d,vec2 e,int corners,float depth,float part,float kind,float seed,inout DisplayHit hit) {
    float nearT=-1e8,farT=1e8;vec3 normal=vec3(0,0,1);
    for(int face=0;face<7;face++) {
      vec3 n;float limit;
      if(face<5) {
        if(face>=corners)continue;
        vec2 s=face==0?a:face==1?b:face==2?c:face==3?d:e;
        vec2 f=face+1==corners?a:face==0?b:face==1?c:face==2?d:e;
        vec2 edge=f-s;n=normalize(vec3(edge.y,-edge.x,0.));limit=dot(n.xy,s);
      } else {n=vec3(0,0,face==5?-1.:1.);limit=depth;}
      float denom=dot(n,rd),distance=limit-dot(n,ro);
      if(abs(denom)<.000001){if(distance<0.)return;}
      else {
        float t=distance/denom;
        if(denom<0.){if(t>nearT){nearT=t;normal=n;}}else farT=min(farT,t);
      }
    }
    if(farT>max(0.,nearT))displayCommit(nearT,normal,ro+rd*nearT,part,kind,seed,hit);
  }
  // A tie's wide blade hanging from y=0 (anticlockwise outline, blade-local).
  void wareTieBlade(vec3 ro,vec3 rd,float top,float wide,float len,float point,float depth,float part,float kind,float seed,inout DisplayHit hit) {
    warePrism(ro,rd,vec2(-top,0),vec2(-wide,-len),vec2(0,-len-point),vec2(wide,-len),vec2(top,0),5,depth,part,kind,seed,hit);
  }
  // The tie shop's niche: a brass rail on two wall brackets near the top of
  // the arch, with nine ties folded over it, wide blades to the street.
  void tieRail(vec3 ro,vec3 rd,float shopSeed,inout DisplayHit hit) {
    float a,b;vec3 n;
    if(!displayBounds(ro,rd,vec3(-.79,1.98,-1.19),vec3(.79,2.60,-.93),a,b,n)||a>hit.t)return;
    const float railY=2.555,railZ=-.968;
    wareAlongX(ro,rd,vec3(0,railY,railZ),-.76,1.52,.0085,.0085,63.,63.,shopSeed,hit);
    for(int side=0;side<2;side++)
      displayBox(ro,rd,vec3(side==0?-.70:.70,railY,(railZ-1.18)*.5),vec3(.010,.012,(railZ+1.18)*.5),63.,63.,shopSeed,hit);
    // Only the ties near where the ray crosses the blade plane can be hit.
    float centre=abs(rd.z)>.0001?(ro.x+rd.x*(railZ+.013-ro.z)/rd.z+.64)/.16:4.;
    int first=int(clamp(floor(centre+.5)-1.,0.,8.));
    for(int k=0;k<3;k++) {
      int tie=first+k;
      if(tie>8)continue;
      float seed=displayHash(float(tie)*7.3+shopSeed*131.);
      vec3 c=vec3(-.64+float(tie)*.16+(seed-.5)*.02,railY,railZ+.013);
      mat3 m=wareTurn((displayHash(seed*17.)-.5)*.30);
      vec3 q=transpose(m)*(ro-c),d=transpose(m)*rd;DisplayHit h=hit;
      wareTieBlade(q,d,.018,.042,.455+seed*.03,.032,.0022,51.,48.,seed,h);
      wareAlongX(q,d,vec3(0,0,-.013),-.019,.038,.0112,.0112,51.,48.,seed,h);
      if(h.t<hit.t){h.n=m*h.n;hit=h;}
    }
  }
  void displayTiesJewelsCandles(vec3 ro,vec3 rd,float kind,float seed,inout DisplayHit hit) {
    if(kind<48.5) {
      // Three rolled ties in a shallow timber tray, rolled ends to the street.
      displayBox(ro,rd,vec3(0,.006,0),vec3(.112,.006,.050),14.,kind,seed,hit);
      displayBox(ro,rd,vec3(0,.012,.046),vec3(.112,.012,.004),14.,kind,seed,hit);
      displayBox(ro,rd,vec3(0,.030,-.046),vec3(.112,.030,.004),14.,kind,seed,hit);
      for(int side=0;side<2;side++)displayBox(ro,rd,vec3(side==0?-.108:.108,.022,0),vec3(.004,.022,.050),14.,kind,seed,hit);
      for(int roll=0;roll<3;roll++)
        wareAlongZ(ro,rd,vec3((float(roll)-1.)*.070,.044,-.002),-.036,.072,.032,.032,52.,kind,seed+float(roll)*.31,hit);
    } else if(kind<49.5) {
      // A folded shirt leaning back on a block, a knotted tie under its collar.
      mat3 m=craftTilt(-.26);vec3 c=vec3(0,.142,-.010);
      vec3 q=transpose(m)*(ro-c),d=transpose(m)*rd;DisplayHit h=hit;
      displayBox(q,d,vec3(0),vec3(.105,.135,.016),53.,kind,seed,h);
      wareAlongZ(q,d,vec3(0,.100,0),.010,.020,.040,.040,53.,kind+.1,seed,h);
      warePrism(q-vec3(-.026,.083,.031),d,vec2(-.012,.016),vec2(-.036,-.028),vec2(.006,-.010),vec2(0),vec2(0),3,.002,53.,kind,seed,h);
      warePrism(q-vec3(.026,.083,.031),d,vec2(.012,.016),vec2(-.006,-.010),vec2(.036,-.028),vec2(0),vec2(0),3,.002,53.,kind,seed,h);
      wareTieBlade(q-vec3(0,.074,.0205),d,.011,.030,.150,.022,.0025,51.,kind,seed+.5,h);
      warePrism(q-vec3(0,.086,.033),d,vec2(-.017,.012),vec2(-.010,-.016),vec2(.010,-.016),vec2(.017,.012),vec2(0),4,.006,51.,kind,seed+.5,h);
      if(h.t<hit.t){h.n=m*h.n;hit=h;}
      displayBox(ro,rd,vec3(0,.040,-.034),vec3(.050,.040,.022),14.,kind,seed,hit);
    } else if(kind<50.5) {
      // An open gift box tipped towards the street: card shell, satin bed and
      // a folded tie, its point resting at the bottom.
      mat3 m=craftTilt(-.42);vec3 c=vec3(0,.092,0);
      vec3 q=transpose(m)*(ro-c),d=transpose(m)*rd;DisplayHit h=hit;
      displayBox(q,d,vec3(0,0,-.012),vec3(.078,.098,.004),54.,kind,seed,h);
      for(int side=0;side<2;side++) {
        displayBox(q,d,vec3(0,side==0?-.094:.094,.004),vec3(.078,.004,.016),54.,kind,seed,h);
        displayBox(q,d,vec3(side==0?-.074:.074,0,.004),vec3(.004,.090,.016),54.,kind,seed,h);
      }
      displayBox(q,d,vec3(0,0,-.005),vec3(.070,.090,.003),55.,kind,seed,h);
      wareTieBlade(q-vec3(0,.084,.0005),d,.024,.032,.128,.030,.0025,51.,kind,seed+.37,h);
      if(h.t<hit.t){h.n=m*h.n;hit=h;}
      displayBox(ro,rd,vec3(0,.030,-.062),vec3(.050,.030,.016),14.,kind,seed,hit);
    } else if(kind<51.5) {
      // A velvet neck form with a coral necklace or a gold chain and puca
      // pendant laid around the base of its neck.
      displayBox(ro,rd,vec3(0,.008,0),vec3(.070,.008,.042),56.,kind,seed,hit);
      tradeEllipsoid(ro,rd,vec3(0,.112,0),vec3(.092,.100,.040),56.,kind,seed,hit);
      displayFrustum(ro,rd,.170,.125,.027,.021,56.,kind,seed,hit);
      float a,b;vec3 n;
      if(displayBounds(ro,rd,vec3(-.060,.080,0.),vec3(.060,.195,.066),a,b,n)&&a<hit.t) {
        bool coral=fract(seed*5.3)<.5;
        float r=coral?.0068:.0040;
        for(int i=0;i<13;i++) {
          float phi=(float(i)-6.)/6.*1.40;
          vec2 xy=vec2(sin(phi)*.046,.178-cos(phi)*.058);
          vec2 chest=(xy-vec2(0,.112))/vec2(.092,.100);
          tradeEllipsoid(ro,rd,vec3(xy,.040*sqrt(max(1.-dot(chest,chest),0.))+r*.8),vec3(r),coral?59.:57.,kind,seed+float(i)*.071,hit);
        }
        if(!coral) {
          tradeEllipsoid(ro,rd,vec3(0,.111,.046),vec3(.0030,.0055,.0030),57.,kind,seed,hit);
          tradeEllipsoid(ro,rd,vec3(0,.097,.050),vec3(.0105),58.,kind,seed,hit);
        }
      }
    } else if(kind<52.5) {
      // A stepped velvet riser: rings stand in slits, each crowned by a stone.
      for(int step=0;step<3;step++) {
        float h=.022+float(step)*.026,z=.036-float(step)*.036;
        displayBox(ro,rd,vec3(0,h*.5,z),vec3(.085,h*.5,.018),56.,kind,seed,hit);
        for(int ring=0;ring<2;ring++) {
          float s=seed+float(step*2+ring)*.13;
          vec3 c=vec3((float(ring)-.5)*.070+(float(step)-1.)*.012,h+.0075,z+.004);
          craftRing(ro,rd,c,.0105,.0086,.0026,57.,kind,s,hit);
          tradeEllipsoid(ro,rd,c+vec3(0,.0118,0),vec3(.0050,.0044,.0042),60.,kind,s,hit);
        }
      }
    } else if(kind<53.5) {
      // A velvet card on an easel: Dubrovnik filigree buttons (puce) worn as
      // earrings, and a pair of coral drops below them.
      mat3 m=craftTilt(-.30);vec3 c=vec3(0,.106,0);
      vec3 q=transpose(m)*(ro-c),d=transpose(m)*rd;DisplayHit h=hit;
      displayBox(q,d,vec3(0),vec3(.068,.098,.006),56.,kind,seed,h);
      for(int side=0;side<2;side++) {
        float x=side==0?-.032:.032;
        craftRing(q,d,vec3(x,.060,.0075),.0062,.0048,.0012,57.,kind,seed,h);
        tradeEllipsoid(q,d,vec3(x,.040,.0185),vec3(.0125),58.,kind,seed,h);
        tradeEllipsoid(q,d,vec3(x,.021,.0140),vec3(.0042,.0058,.0042),57.,kind,seed,h);
        tradeEllipsoid(q,d,vec3(x,-.028,.0090),vec3(.0032),57.,kind,seed,h);
        tradeEllipsoid(q,d,vec3(x,-.046,.0125),vec3(.0072,.0110,.0072),59.,kind,seed+float(side)*.3,h);
      }
      if(h.t<hit.t){h.n=m*h.n;hit=h;}
      displayBox(ro,rd,vec3(0,.045,-.040),vec3(.012,.045,.012),14.,kind,seed,hit);
    } else if(kind<54.5) {
      // Church tapers standing in a timber block.
      displayBox(ro,rd,vec3(0,.017,0),vec3(.088,.017,.030),14.,kind,seed,hit);
      for(int i=0;i<4;i++) {
        vec3 q=ro-vec3((float(i)-1.5)*.044,0,0);
        float h=.255+displayHash(seed*41.+float(i))*.075;
        displayFrustum(q,rd,.030,h,.0115,.0098,61.,kind,seed,hit);
        displayFrustum(q,rd,.030+h,.012,.0098,.0035,61.,kind,seed,hit);
        displayFrustum(q,rd,.038+h,.016,.0011,.0009,62.,kind,seed,hit);
      }
    } else if(kind<55.5) {
      // Hand-dipped tapers hung in pairs over a rod by their shared wick.
      for(int side=0;side<2;side++)displayBox(ro,rd,vec3(side==0?-.138:.138,.185,-.020),vec3(.008,.185,.008),14.,kind,seed,hit);
      displayBox(ro,rd,vec3(0,.006,-.020),vec3(.150,.006,.040),14.,kind,seed,hit);
      wareAlongX(ro,rd,vec3(0,.350,-.020),-.146,.292,.0055,.0055,14.,kind,seed,hit);
      for(int pair=0;pair<3;pair++) {
        float s=seed+float(pair)*.23;
        for(int j=0;j<2;j++) {
          vec3 q=ro-vec3((float(pair)-1.)*.084+(j==0?-.011:.011),0,-.020+(j==0?.012:-.012));
          displayFrustum(q,rd,.105,.225,.0122,.0085,61.,kind,s,hit);
          tradeEllipsoid(q,rd,vec3(0,.105,0),vec3(.0122,.010,.0122),61.,kind,s,hit);
          displayFrustum(q,rd,.330,.022,.0010,.0010,62.,kind,s,hit);
        }
      }
    } else {
      // Pillar candles: rolled beeswax showing its honeycomb, moulded ivory,
      // and one wrapped in a printed paper band. kind+0.1*i names each one.
      for(int i=0;i<3;i++) {
        float x=i==0?-.084:i==1?0.:.080,r=i==0?.036:i==1?.046:.034,h=i==0?.120:i==1?.185:.090;
        vec3 q=ro-vec3(x,0,i==1?-.012:.010);
        float k=56.+float(i)*.1;
        displayFrustum(q,rd,.002,h,r,r,61.,k,seed,hit);
        displayFrustum(q,rd,.002+h,.014,.0016,.0013,62.,k,seed,hit);
      }
    }
  }
`;

export const TIES_JEWELS_CANDLES_COLOURS=/* glsl */`
  // Silk for every tie: regimental stripes, the red-and-white Croatian
  // chequer (šahovnica), pin dots or plain twill. q is in metres on the cloth.
  vec3 waresSilk(vec2 q,float seed) {
    float s=fract(seed*7.13),pattern=fract(seed*3.71);
    vec3 base=s<.25?vec3(.30,.030,.050):s<.5?vec3(.045,.070,.19):s<.75?vec3(.050,.15,.090):vec3(.36,.22,.050);
    if(pattern<.30) {
      float d=fract((q.x+q.y)*38.);
      vec3 stripe=fract(seed*11.3)<.5?vec3(.60,.47,.16):vec3(.55,.055,.065);
      base=mix(base,stripe,step(.70,d)*step(d,.90));
      base=mix(base,vec3(.80,.78,.70),step(.93,d)*step(d,.97));
    } else if(pattern<.48) {
      vec2 cell=floor(q*85.);
      base=mod(cell.x+cell.y,2.)<1.?vec3(.62,.045,.055):vec3(.82,.80,.76);
    } else if(pattern<.75) {
      vec2 g=fract(q*105.)-.5;
      base=mix(base,vec3(.78,.72,.52),1.-smoothstep(.12,.20,length(g)));
    }
    return base*(.93+.07*sin((q.x-q.y)*1800.));
  }
  vec3 jewelVelvet(vec3 p,vec3 n) {
    return vec3(.030,.036,.072)*(.94+.06*sin(p.x*820.+p.z*90.)*sin(p.y*760.));
  }
  vec3 tiesJewelsCandlesColour(DisplayHit hit,out float gloss) {
    vec3 p=hit.p,n=hit.n;float seed=fract(hit.seed);gloss=0.;
    float part=hit.part;
    if(part<51.5) {gloss=.42;return waresSilk(p.xy,hit.seed);}
    if(part<52.5) {
      gloss=.38;
      vec3 silk=waresSilk(vec2(p.z,atan(p.y,p.x)*.032),hit.seed);
      if(n.z>.5) {
        // The rolled end: a tight spiral of cloth edges around a dark core.
        float r=length(p.xy),turn=r/.0027-atan(p.y,p.x)/6.2832+seed*3.;
        float seam=smoothstep(.0,.22,fract(turn))*smoothstep(1.,.78,fract(turn));
        vec3 edge=silk*(.55+.45*seam);
        return r<.0055?vec3(.020,.015,.012):edge;
      }
      // The point of the tie closes the roll on top.
      float angle=atan(p.y,p.x),tip=1.5+abs(p.z)*15.;
      if(abs(angle-tip)<.05)silk*=.45;
      return silk;
    }
    if(part<53.5) {
      gloss=.06;
      vec3 cloth=seed<.4?vec3(.84,.84,.81):seed<.7?vec3(.64,.73,.84):vec3(.86,.72,.72);
      if(fract(seed*9.1)<.35)cloth=mix(cloth,vec3(.30,.40,.62),step(.82,fract(p.x*90.)));
      // The collar (tagged kind+0.1) is open: its inside falls into shadow
      // towards the bottom of the opening.
      if(fract(hit.kind)>.05&&n.z>.5&&length(p.xy)<.030)cloth*=mix(.42,.14,smoothstep(-.030,.030,-p.y));
      return cloth*(.95+.05*sin(p.x*1300.)*sin(p.y*1250.));
    }
    if(part<54.5) {
      gloss=.20;
      // Card covered in dark paper; the street-facing edges are gilt.
      vec3 card=seed<.5?vec3(.040,.055,.12):vec3(.23,.035,.050);
      return n.z>.5?vec3(.58,.44,.18):card*(.95+.05*sin(p.x*1500.));
    }
    if(part<55.5) {gloss=.30;return vec3(.86,.82,.72)*(.94+.06*sin(p.y*260.+p.x*40.));}
    if(part<56.5)return jewelVelvet(p,n);
    if(part<57.5) {
      gloss=.86;
      return vec3(.80,.57,.21)*(.92+.08*sin(dot(p,vec3(900.,700.,800.))));
    }
    if(part<58.5) {
      // A filigree puca: rings of gold wire, six-lobed rosettes and granules
      // over the dark, open interior of the hollow bead.
      gloss=.80;
      float lat=acos(clamp(n.y,-1.,1.)),lon=atan(n.x,n.z);
      float lobes=.5+.5*cos(lon*6.);
      float ring=abs(fract(lat*2.9)-.5);
      float wire=1.-smoothstep(.05,.10,ring);
      wire=max(wire,1.-smoothstep(.06,.12,abs(fract(lat*2.9+lobes*.45)-.5)));
      float granule=1.-smoothstep(.16,.24,length(vec2(fract(lon*.955)-.5,fract(lat*2.9+.5)-.5)));
      return mix(vec3(.075,.045,.015),vec3(.86,.63,.25),max(wire,granule));
    }
    if(part<59.5) {
      gloss=.50;
      return mix(vec3(.66,.10,.075),vec3(.78,.24,.18),.5+.5*sin(dot(p,vec3(420.,380.,510.))+seed*9.));
    }
    if(part<60.5) {
      gloss=.95;
      float s=fract(seed*7.7);
      vec3 stone=s<.3?vec3(.48,.020,.055):s<.6?vec3(.025,.065,.36):s<.8?vec3(.020,.30,.12):vec3(.80,.82,.85);
      float facet=fract(sin(dot(floor(n*4.),vec3(12.9898,78.233,37.719)))*43758.5453);
      return stone*(.55+.9*facet);
    }
    if(part<61.5) {
      gloss=.22;
      float k=hit.kind;
      vec3 wax=vec3(.86,.84,.77);
      if(k>54.5&&k<55.5) {
        float s=fract(seed*5.7);
        wax=s<.40?vec3(.84,.81,.72):s<.70?vec3(.76,.50,.16):vec3(.46,.040,.045);
      } else if(k>55.5) {
        float type=floor(fract(k)*10.+.5);
        if(type<.5) {
          // A sheet of beeswax rolled up: the honeycomb print shows all round.
          vec2 cell=vec2(atan(p.x,p.z)*.036*58.,p.y*58.);
          vec2 hex=abs(fract(vec2(cell.x+.5*mod(floor(cell.y),2.),cell.y))-.5);
          wax=vec3(.74,.48,.15)*(.86+.14*smoothstep(.30,.45,max(hex.x,hex.y)));
          if(n.y>.5)wax*=.92+.08*sin(length(p.xz)*1400.);
        } else {
          wax=type<1.5?vec3(.86,.82,.70):vec3(.84,.80,.71);
          if(type<1.5&&p.y>.070&&p.y<.135&&abs(n.y)<.5) {
            float angle=atan(p.x,p.z);
            if(abs(angle)<1.15){gloss=.05;return displayLabel(vec2(angle/2.3+.5,1.-(p.y-.070)/.065),25.);}
          }
        }
      }
      // Wax is faintly translucent: thin rims and tips glow a little.
      return wax*(1.+.10*(1.-abs(n.y)));
    }
    // Unburnt cotton wick.
    gloss=.05;return vec3(.80,.76,.66);
  }
`;
