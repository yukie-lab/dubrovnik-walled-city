// Additional merchandise uses the same finite, local-space ray intersections
// as the original trades; handles, heels and fruit retain depth from the side.
export const BOUTIQUE_FRUIT_SHAPES=/* glsl */`
  void boutiqueCounter(vec3 ro,vec3 rd,float kind,float seed,inout DisplayHit hit) {
    vec3 c=vec3(.079,.115,0),r=vec3(.048,.052,.047);
    vec3 innerC=vec3(.075,.132,0),innerR=vec3(.036,.048,.035);
    // Outer leather minus an inner ellipsoid: the foot opening is hollow.
    for(int surface=0;surface<2;surface++) {
      vec3 centre=surface==0?c:innerC,radius=surface==0?r:innerR;
      vec3 q=(ro-centre)/radius,d=rd/radius;
      float a=dot(d,d),b=dot(q,d),disc=b*b-a*(dot(q,q)-1.);
      if(disc<0.)continue;
      vec2 roots=vec2(-b-sqrt(disc),-b+sqrt(disc))/a;
      for(int i=0;i<2;i++) {
        float t=roots[i];vec3 p=ro+rd*t;
        bool insideOuter=dot((p-c)/r,(p-c)/r)<=1.00001;
        bool insideInner=dot((p-innerC)/innerR,(p-innerC)/innerR)<.99999;
        if(p.y<.080||p.y>.150||(surface==0?insideInner:!insideOuter))continue;
        vec3 n=normalize((p-centre)/(radius*radius))*(surface==0?1.:-1.);
        displayCommit(t,n,p,surface==0?17.:18.,kind,seed,hit);
      }
    }
    if(abs(rd.y)>.000001) {
      float t=(.150-ro.y)/rd.y;vec3 p=ro+rd*t;
      if(dot((p-c)/r,(p-c)/r)<=1.&&dot((p-innerC)/innerR,(p-innerC)/innerR)>=1.)
        displayCommit(t,vec3(0,1,0),p,17.,kind,seed,hit);
    }
  }
  void boutiqueBag(vec3 ro,vec3 rd,float kind,float seed,inout DisplayHit hit) {
    // A tapered leather case with planar front/back and bevelled top edges.
    float nearT=-1e8,farT=1e8;vec3 normal=vec3(0);
    for(int face=0;face<6;face++) {
      vec3 n;float limit;
      if(face<2){n=vec3(face==0?-1.:1.,.11,0);limit=.139;}
      else if(face<4){n=vec3(0,face==2?-1.:1.,0);limit=face==2?-.010:.228;}
      else {n=vec3(0,.025,face==4?-1.:1.);limit=.060;}
      float denom=dot(n,rd),distance=limit-dot(n,ro);
      if(abs(denom)<.000001){if(distance<0.)return;}
      else {
        float t=distance/denom;
        if(denom<0.){if(t>nearT){nearT=t;normal=normalize(n);}}
        else farT=min(farT,t);
      }
    }
    if(farT>max(0.,nearT))displayCommit(nearT,normal,ro+rd*nearT,17.,kind,seed,hit);
  }
  void boutiqueHandle(vec3 ro,vec3 rd,vec3 centre,float kind,float seed,inout DisplayHit hit) {
    DisplayHit h=hit;
    tradeRing(ro,rd,centre,.073,.060,.009,kind,seed,h);
    if(h.t<hit.t){h.part=17.;hit=h;}
  }
  void marketFruit(vec3 ro,vec3 rd,vec3 centre,float kind,float seed,inout DisplayHit hit) {
    vec3 q=ro-centre;DisplayHit h=hit;
    if(kind<20.5) {
      // Two lobes and the stem dimple distinguish apples from citrus spheres.
      tradeEllipsoid(q,rd,vec3(-.016,.047,0),vec3(.036,.043,.042),20.,kind,seed,h);
      tradeEllipsoid(q,rd,vec3(.016,.047,0),vec3(.036,.043,.042),20.,kind,seed,h);
    } else if(kind<21.5)tradeEllipsoid(q,rd,vec3(0,.049,0),vec3(.047,.047,.047),20.,kind,seed,h);
    else if(kind<22.5) {
      tradeEllipsoid(q,rd,vec3(0,.047,0),vec3(.044,.045,.041),20.,kind,seed,h);
      tradeEllipsoid(q,rd,vec3(.006,.083,0),vec3(.026,.043,.027),20.,kind,seed,h);
    } else {
      tradeEllipsoid(q,rd,vec3(0,.050,0),vec3(.058,.044,.041),20.,kind,seed,h);
      tradeEllipsoid(q,rd,vec3(-.055,.050,0),vec3(.013,.012,.012),20.,kind,seed,h);
      tradeEllipsoid(q,rd,vec3(.055,.050,0),vec3(.013,.012,.012),20.,kind,seed,h);
    }
    float top=kind>21.5&&kind<22.5?.122:kind<20.5?.085:.092;
    if(kind<22.5) {
      displayBox(q,rd,vec3(.005,top+.006,0),vec3(.003,.011,.003),21.,kind,seed,h);
      tradeTilted(q,rd,vec3(.020,top+.007,0),vec3(.018,.004,.009),.35,22.,kind,seed,h);
    }
    // h.p deliberately stays fruit-local for skin pores and colouring.
    if(h.t<hit.t)hit=h;
  }
  void displayBoutiqueFruit(vec3 ro,vec3 rd,float kind,float seed,inout DisplayHit hit) {
    if(kind<18.5) {
      // A pump's thin sole bridges the toe and raised rear, with a separate
      // narrow heel and a hollow counter instead of a recoloured men's shoe.
      tradeEllipsoid(ro,rd,vec3(-.085,.017,0),vec3(.073,.013,.050),18.,kind,seed,hit);
      tradeTilted(ro,rd,vec3(-.006,.046,0),vec3(.084,.009,.042),.37,18.,kind,seed,hit);
      tradeEllipsoid(ro,rd,vec3(.079,.078,0),vec3(.048,.009,.040),18.,kind,seed,hit);
      displayBox(ro,rd,vec3(.101,.037,0),vec3(.009,.037,.018),17.,kind,seed,hit);
      tradeEllipsoid(ro,rd,vec3(-.087,.033,0),vec3(.072,.032,.050),17.,kind,seed,hit);
      for(int side=0;side<2;side++)tradeTilted(ro,rd,vec3(-.003,.071,side==0?-.041:.041),vec3(.086,.016,.008),.37,17.,kind,seed,hit);
      boutiqueCounter(ro,rd,kind,seed,hit);
    } else if(kind<19.5) {
      boutiqueBag(ro,rd,kind,seed,hit);
      boutiqueHandle(ro,rd,vec3(0,.253,-.048),kind,seed,hit);
      boutiqueHandle(ro,rd,vec3(0,.253,.048),kind,seed,hit);
      displayBox(ro,rd,vec3(0,.187,.058),vec3(.101,.038,.005),17.,kind,seed,hit);
      displayBox(ro,rd,vec3(0,.149,.066),vec3(.014,.012,.004),19.,kind,seed,hit);
      for(int side=0;side<2;side++) {
        float x=side==0?-.066:.066;
        displayBox(ro,rd,vec3(x,.218,.063),vec3(.009,.011,.004),19.,kind,seed,hit);
        tradeEllipsoid(ro,rd,vec3(side==0?-.106:.106,.008,0),vec3(.009,.008,.027),19.,kind,seed,hit);
      }
    } else {
      // Slatted produce crates: fruit sits on the base, with gaps between the
      // rails so the contents remain visible from normal street eye height.
      displayBox(ro,rd,vec3(0,.008,0),vec3(.172,.008,.147),14.,kind,seed,hit);
      for(int side=0;side<2;side++) {
        float x=side==0?-.166:.166;
        displayBox(ro,rd,vec3(x,.056,0),vec3(.007,.043,.147),14.,kind,seed,hit);
        for(int rail=0;rail<2;rail++)displayBox(ro,rd,vec3(0,.027+float(rail)*.040,side==0?-.140:.140),vec3(.166,.011,.007),14.,kind,seed,hit);
      }
      if(kind>22.5&&kind<23.5) {
        // Two tapered bunches with individual grapes and visible stems.
        for(int bunch=0;bunch<2;bunch++)for(int grape=0;grape<10;grape++) {
          float level=floor(float(grape)/3.),angle=float(grape)*2.39996;
          float spread=.040*(1.-level*.20);
          vec3 c=vec3((float(bunch)-.5)*.145+cos(angle)*spread,.047+level*.031,sin(angle)*spread);
          tradeEllipsoid(ro,rd,c,vec3(.027,.028,.027),20.,kind,seed+float(bunch)*.33,hit);
        }
        for(int bunch=0;bunch<2;bunch++)displayBox(ro,rd,vec3((float(bunch)-.5)*.145,.173,0),vec3(.003,.020,.003),21.,kind,seed,hit);
      } else for(int fruit=0;fruit<6;fruit++) {
        float row=floor(float(fruit)/3.),col=mod(float(fruit),3.);
        vec3 centre=vec3((col-1.)*(kind>23.5?.090:.105),.019,(row-.5)*.109);
        marketFruit(ro,rd,centre,kind,seed+float(fruit)*.11,hit);
      }
    }
  }
`;

export const BOUTIQUE_FRUIT_COLOURS=/* glsl */`
  vec3 boutiqueFruitColour(DisplayHit hit,out float gloss) {
    vec3 p=hit.p;float seed=fract(hit.seed);gloss=0.;
    if(hit.part<17.5) {
      gloss=.34;
      vec3 leather=seed<.28?vec3(.065,.043,.042):seed<.56?vec3(.32,.046,.072):seed<.80?vec3(.46,.23,.10):vec3(.62,.48,.35);
      float grain=sin(p.x*1270.+sin(p.y*970.))*sin(p.z*930.+p.y*630.);
      leather*=.97+.03*grain;
      if(hit.kind>18.5) {
        float edge=max(step(.116,abs(p.x)),step(abs(p.y-.024),.002));
        float stitch=edge*step(.72,fract((p.y+p.x)*190.))*step(.044,abs(p.z));
        leather=mix(leather,vec3(.68,.51,.32),stitch*.5);
      }
      return leather;
    }
    if(hit.part<18.5) {gloss=.08;return vec3(.42,.25,.13);}
    if(hit.part<19.5) {gloss=.78;return vec3(.62,.40,.12);}
    if(hit.part<20.5) {
      gloss=hit.kind<21.5?.24:.15;
      vec3 skin;
      if(hit.kind<20.5)skin=mix(vec3(.44,.035,.026),vec3(.69,.18,.046),.5+.5*sin(p.x*47.+seed*8.));
      else if(hit.kind<21.5)skin=vec3(.83,.29,.022);
      else if(hit.kind<22.5)skin=mix(vec3(.32,.42,.055),vec3(.65,.57,.10),seed);
      else if(hit.kind<23.5)skin=seed<.6?vec3(.17,.051,.22):vec3(.33,.44,.08);
      else skin=vec3(.83,.65,.045);
      float pores=sin(p.x*810.+seed*5.)*sin(p.y*930.+p.z*370.);
      return skin*(.95+.05*pores);
    }
    if(hit.part<21.5)return vec3(.18,.10,.025);
    return vec3(.085,.25,.038);
  }
`;
