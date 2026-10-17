// Gelato, folk instruments and ship's chandlery use the same finite ray
// solids as the other storefronts. Product kinds 57–65 (three per trade) and
// material IDs 63–77 belong to these three trades.
//   kinds 57 fruit gelato pan   58 cream gelato pan   59 rack of wafer cones
//         60 lijerica and bow   61 tamburica          62 lectern, music, frula
//         63 rope hank          64 ship's lantern     65 ship's bell
//   parts 63 brass  64 gelato  65 red fruit  66 mint leaf, pistachio
//         67 lemon, mango  68 blueberry, chocolate, vanilla  69 wafer
//         70 soundboard and carved body  71 varnished neck, bow stick, frula
//         72 ebony  73 strings, bow hair  74 music paper  75 rope
//         76 lantern lens  77 bell bronze
// Instruments, the lectern and the rope hank lean back in their own frame;
// their hit points stay in that frame so strings, frets and staves follow it.
export const GELATO_MUSIC_NAUTICAL_SHAPES=/* glsl */`
  // A box whose hit point stays in the caller's frame (displayBox makes it
  // relative to the box centre).
  void wareBlock(vec3 ro,vec3 rd,vec3 c,vec3 r,float part,float kind,float seed,inout DisplayHit hit) {
    float a,b;vec3 n;
    if(displayBounds(ro,rd,c-r,c+r,a,b,n))displayCommit(a,n,ro+rd*a,part,kind,seed,hit);
  }
  float gelatoFlavour(float seed) {return floor(fract(seed*3.7)*4.);}
  // Height of the heaped gelato at (x,z) inside its pan.
  float gelatoTop(vec2 xz,float heap) {
    vec2 u=vec2(xz.x/.079,(xz.y+.004)/.150);
    return .090+heap*sqrt(max(1.-dot(u,u),0.));
  }
  // A steel pan heaped above its rim, combed into waves with a spatula,
  // garnished for its flavour and labelled by a card on a pin.
  void gelatoPan(vec3 ro,vec3 rd,float kind,float seed,inout DisplayHit hit) {
    displayBox(ro,rd,vec3(0,.045,0),vec3(.088,.045,.170),10.,kind,seed,hit);
    wareBlock(ro,rd,vec3(0,.0915,0),vec3(.083,.0015,.165),64.,kind,seed,hit);
    float heap=.056+fract(seed*5.1)*.018;
    DisplayHit h=hit;
    tradeEllipsoid(ro,rd,vec3(0,.090,-.004),vec3(.079,heap,.150),64.,kind,seed,h);
    if(h.t<hit.t) {
      // Spatula strokes: ridges across the pan, bent a little along it.
      vec3 p=h.p;
      float wave=p.z*72.+1.7*sin(p.x*46.+seed*9.)+seed*20.;
      h.n=normalize(h.n+vec3(.16*sin(p.z*41.+p.x*29.),0,.42*sin(wave)));
      hit=h;
    }
    float f=gelatoFlavour(seed);
    vec2 a=vec2(-.026,-.040),b=vec2(.024,.035),e=vec2(.030,-.058),g=vec2(-.022,.050);
    if(kind<57.5) {
      if(f<.5) {
        // Jagoda: whole strawberries.
        tradeEllipsoid(ro,rd,vec3(a.x,gelatoTop(a,heap)+.004,a.y),vec3(.015,.016,.014),65.,kind,seed,hit);
        tradeEllipsoid(ro,rd,vec3(b.x,gelatoTop(b,heap)+.003,b.y),vec3(.014,.015,.013),65.,kind,seed,hit);
      } else if(f<1.5) {
        // Limun: a slice of lemon standing in the gelato and a mint leaf.
        wareAlongZ(ro,rd,vec3(-.010,gelatoTop(vec2(-.010,0),heap)+.004,0),-.0025,.005,.023,.023,67.,kind,seed,hit);
        tradeEllipsoid(ro,rd,vec3(e.x,gelatoTop(e,heap)+.001,e.y),vec3(.014,.0035,.008),66.,kind,seed,hit);
      } else if(f<2.5) {
        // Šumsko voće: blueberries and raspberries.
        for(int i=0;i<4;i++) {
          vec2 at=i==0?a:i==1?b:i==2?e:g;float r=i<2?.0075:.0090;
          tradeEllipsoid(ro,rd,vec3(at.x,gelatoTop(at,heap)+r*.4,at.y),vec3(r,i<2?r:r*1.12,r),i<2?68.:65.,kind,seed,hit);
        }
      } else {
        // Mango: diced fruit.
        for(int i=0;i<3;i++) {
          vec2 at=i==0?a:i==1?b:e;
          wareBlock(ro,rd,vec3(at.x,gelatoTop(at,heap)+.003,at.y),vec3(.0085),67.,kind,seed,hit);
        }
      }
    } else {
      if(f<.5) {
        // Pistacija: shelled kernels.
        for(int i=0;i<4;i++) {
          vec2 at=i==0?a:i==1?b:i==2?e:g;
          tradeEllipsoid(ro,rd,vec3(at.x,gelatoTop(at,heap)+.0015,at.y),vec3(.0068,.0042,.0046),66.,kind,seed,hit);
        }
      } else if(f<1.5) {
        // Čokolada: two chocolate curls.
        wareAlongX(ro,rd,vec3(a.x,gelatoTop(a,heap)+.003,a.y),-.017,.034,.0048,.0048,68.,kind,seed,hit);
        wareAlongZ(ro,rd,vec3(b.x,gelatoTop(b,heap)+.003,b.y),-.017,.034,.0048,.0048,68.,kind,seed,hit);
      } else if(f<2.5) {
        // Stracciatella: a square of dark chocolate pushed in on edge.
        wareBlock(ro,rd,vec3(.012,gelatoTop(vec2(.012,0),heap)+.008,0),vec3(.017,.015,.0018),68.,kind,seed,hit);
      } else {
        // Vanilija: a vanilla pod laid across the top.
        tradeTilted(ro,rd,vec3(.004,gelatoTop(vec2(.004,.010),heap)-.001,.010),vec3(.0038,.040,.0034),1.5708,68.,kind,seed,hit);
      }
    }
    float cx=fract(seed*13.)<.5?-.040:.040,base=gelatoTop(vec2(cx,.085),heap)-.008;
    displayFrustum(ro-vec3(cx,0,.085),rd,base,.178-base,.0012,.0012,10.,kind,seed,hit);
    displayBox(ro,rd,vec3(cx,.190,.085),vec3(.030,.012,.0012),6.,kind,seed,hit);
  }
  // A lijerica, the pear-shaped three-stringed fiddle of Dubrovnik, leaning
  // on a block, its short bow laid on the shelf in front.
  void wareLijerica(vec3 ro,vec3 rd,float kind,float seed,inout DisplayHit hit) {
    mat3 m=craftTilt(-.17);vec3 c=vec3(0,.004,-.010);
    vec3 q=transpose(m)*(ro-c),d=transpose(m)*rd;DisplayHit h=hit;
    tradeEllipsoid(q,d,vec3(0,.108,0),vec3(.074,.106,.030),70.,kind,seed,h);
    tradeEllipsoid(q,d,vec3(0,.185,0),vec3(.050,.120,.028),70.,kind,seed,h);
    wareBlock(q,d,vec3(0,.322,-.004),vec3(.017,.040,.015),71.,kind,seed,h);
    wareBlock(q,d,vec3(0,.390,-.006),vec3(.028,.030,.011),71.,kind,seed,h);
    tradeEllipsoid(q,d,vec3(0,.420,-.006),vec3(.028,.016,.011),71.,kind,seed,h);
    for(int peg=0;peg<3;peg++)
      tradeEllipsoid(q,d,vec3(peg==2?0.:peg==0?-.013:.013,peg==2?.378:.404,.0055),vec3(.0040,.0040,.0040),72.,kind,seed,h);
    wareBlock(q,d,vec3(0,.034,.022),vec3(.010,.020,.004),72.,kind,seed,h);
    wareBlock(q,d,vec3(0,.120,.0315),vec3(.020,.0065,.0020),14.,kind,seed,h);
    if(h.t<hit.t){h.n=m*h.n;hit=h;}
    displayBox(ro,rd,vec3(0,.060,-.072),vec3(.040,.060,.014),14.,kind,seed,hit);
    tradeTilted(ro,rd,vec3(.010,.0046,.112),vec3(.0042,.200,.0042),1.5708,71.,kind+.2,seed,hit);
    tradeTilted(ro,rd,vec3(.010,.0019,.121),vec3(.0016,.186,.0016),1.5708,73.,kind,seed,hit);
  }
  // A tamburica: pear body, fretted ebony fingerboard, brass tuners.
  void wareTamburica(vec3 ro,vec3 rd,float kind,float seed,inout DisplayHit hit) {
    mat3 m=craftTilt(-.22);vec3 c=vec3(0,.004,-.010);
    vec3 q=transpose(m)*(ro-c),d=transpose(m)*rd;DisplayHit h=hit;
    tradeEllipsoid(q,d,vec3(0,.098,0),vec3(.086,.094,.034),70.,kind,seed,h);
    tradeEllipsoid(q,d,vec3(0,.165,0),vec3(.060,.088,.031),70.,kind,seed,h);
    wareBlock(q,d,vec3(0,.345,-.006),vec3(.016,.105,.012),71.,kind,seed,h);
    wareBlock(q,d,vec3(0,.336,.0085),vec3(.0155,.116,.0025),72.,kind,seed,h);
    wareBlock(q,d,vec3(0,.4525,.0085),vec3(.016,.0015,.0040),14.,kind,seed,h);
    wareBlock(q,d,vec3(0,.483,-.004),vec3(.022,.029,.0075),71.,kind,seed,h);
    for(int i=0;i<4;i++)
      tradeEllipsoid(q,d,vec3(i<2?-.030:.030,mod(float(i),2.)<.5?.470:.494,-.004),vec3(.0075,.0045,.0045),63.,kind,seed,h);
    wareBlock(q,d,vec3(0,.085,.0355),vec3(.026,.0035,.0020),14.,kind,seed,h);
    wareBlock(q,d,vec3(0,.016,.017),vec3(.012,.008,.003),63.,kind,seed,h);
    if(h.t<hit.t){h.n=m*h.n;hit=h;}
    displayBox(ro,rd,vec3(0,.060,-.080),vec3(.045,.060,.014),14.,kind,seed,hit);
  }
  // A tabletop lectern with an open book of music and a frula (shepherd's
  // flute) on the shelf in front.
  void wareLectern(vec3 ro,vec3 rd,float kind,float seed,inout DisplayHit hit) {
    displayBox(ro,rd,vec3(0,.006,-.012),vec3(.120,.006,.058),14.,kind,seed,hit);
    displayBox(ro,rd,vec3(0,.072,-.030),vec3(.010,.066,.006),14.,kind,seed,hit);
    mat3 m=craftTilt(-.50);vec3 c=vec3(0,.150,-.030);
    vec3 q=transpose(m)*(ro-c),d=transpose(m)*rd;DisplayHit h=hit;
    wareBlock(q,d,vec3(0),vec3(.150,.105,.005),14.,kind,seed,h);
    wareBlock(q,d,vec3(0,-.101,.014),vec3(.150,.006,.010),14.,kind,seed,h);
    for(int page=0;page<2;page++)
      wareBlock(q,d,vec3(page==0?-.072:.072,.004,.0068),vec3(.0705,.099,.0016),74.,kind,seed,h);
    if(h.t<hit.t){h.n=m*h.n;hit=h;}
    wareAlongX(ro,rd,vec3(-.010,.0085,.092),-.105,.210,.0085,.0078,71.,kind,seed,hit);
  }
  // A hank of manila rope stood on edge against a block, seized in three places.
  void wareRopeHank(vec3 ro,vec3 rd,float kind,float seed,inout DisplayHit hit) {
    displayBox(ro,rd,vec3(0,.045,-.047),vec3(.035,.045,.012),14.,kind,seed,hit);
    mat3 m=craftTilt(-.10);vec3 c=vec3(0,.106,-.010);
    vec3 q=transpose(m)*(ro-c),d=transpose(m)*rd;DisplayHit h=hit;
    craftRing(q,d,vec3(0),.104,.056,.022,75.,kind,seed,h);
    // The flat-sided ring is shaded as the round bundle of turns it stands for.
    if(h.t<hit.t){vec2 core=normalize(h.p.xy)*.080;h.n=m*normalize(vec3(h.p.xy-core,h.p.z));hit=h;}
  }
  // A brass ship's lantern: base, ribbed lens behind four guards, hood,
  // chimney cap and carrying ring.
  void wareLantern(vec3 ro,vec3 rd,float kind,float seed,inout DisplayHit hit) {
    displayFrustum(ro,rd,.000,.026,.054,.050,63.,kind,seed,hit);
    displayFrustum(ro,rd,.026,.012,.046,.046,63.,kind,seed,hit);
    displayFrustum(ro,rd,.038,.110,.040,.040,76.,kind,seed,hit);
    for(int i=0;i<4;i++) {
      float a=.7854+float(i)*1.5708;
      displayFrustum(ro-vec3(.047*sin(a),0,.047*cos(a)),rd,.038,.110,.0032,.0032,63.,kind,seed,hit);
    }
    displayFrustum(ro,rd,.148,.012,.050,.050,63.,kind,seed,hit);
    displayFrustum(ro,rd,.160,.044,.050,.024,63.,kind,seed,hit);
    displayFrustum(ro,rd,.204,.034,.015,.015,63.,kind,seed,hit);
    displayFrustum(ro,rd,.238,.012,.026,.022,63.,kind,seed,hit);
    craftRing(ro,rd,vec3(0,.270,0),.021,.016,.0026,63.,kind,seed,hit);
  }
  // A bronze ship's bell hung from a brass arm on a timber post, its clapper
  // rope ending in a knot.
  void wareBell(vec3 ro,vec3 rd,float kind,float seed,inout DisplayHit hit) {
    displayBox(ro,rd,vec3(-.030,.010,-.010),vec3(.110,.010,.050),14.,kind,seed,hit);
    displayBox(ro,rd,vec3(-.112,.170,-.030),vec3(.013,.150,.013),14.,kind,seed,hit);
    wareAlongX(ro,rd,vec3(0,.306,-.030),-.114,.124,.0065,.0065,63.,kind,seed,hit);
    displayBox(ro,rd,vec3(0,.290,-.030),vec3(.0055,.012,.0055),63.,kind,seed,hit);
    vec3 o=ro-vec3(0,0,-.030);
    displayFrustum(o,rd,.262,.016,.031,.012,77.,kind,seed,hit);
    displayFrustum(o,rd,.200,.062,.040,.031,77.,kind,seed,hit);
    displayFrustum(o,rd,.158,.042,.058,.040,77.,kind,seed,hit);
    displayFrustum(o,rd,.150,.008,.060,.058,77.,kind,seed,hit);
    displayFrustum(o,rd,.068,.090,.0042,.0042,75.,kind,seed,hit);
    tradeEllipsoid(o,rd,vec3(0,.064,0),vec3(.011,.013,.011),75.,kind,seed,hit);
  }
  void displayGelatoMusicNautical(vec3 ro,vec3 rd,float kind,float seed,inout DisplayHit hit) {
    if(kind<58.5)gelatoPan(ro,rd,kind,seed,hit);
    else if(kind<59.5) {
      // A steel rack of wafer cones, points down through its top plate.
      displayBox(ro,rd,vec3(0,.004,0),vec3(.100,.004,.036),10.,kind,seed,hit);
      displayBox(ro,rd,vec3(0,.084,0),vec3(.100,.003,.034),10.,kind,seed,hit);
      for(int side=0;side<2;side++)displayBox(ro,rd,vec3(side==0?-.096:.096,.044,0),vec3(.004,.040,.032),10.,kind,seed,hit);
      for(int i=0;i<3;i++)
        displayFrustum(ro-vec3((float(i)-1.)*.064,0,0),rd,.020,.130,.0035,.0235,69.,kind,seed+float(i)*.17,hit);
    }
    else if(kind<60.5)wareLijerica(ro,rd,kind,seed,hit);
    else if(kind<61.5)wareTamburica(ro,rd,kind,seed,hit);
    else if(kind<62.5)wareLectern(ro,rd,kind,seed,hit);
    else if(kind<63.5)wareRopeHank(ro,rd,kind,seed,hit);
    else if(kind<64.5)wareLantern(ro,rd,kind,seed,hit);
    else wareBell(ro,rd,kind,seed,hit);
  }
`;

export const GELATO_MUSIC_NAUTICAL_COLOURS=/* glsl */`
  float waresHash3(vec3 p) {return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}
  // Strings over the soundboard, neck and head, in the instrument's frame.
  float instrumentStrings(vec3 p,float kind) {
    float x=abs(p.x);
    if(kind<60.5) {
      if(p.y<.040||p.y>.405)return 0.;
      return 1.-smoothstep(.0004,.0009,min(x,abs(x-.0075)));
    }
    if(p.y<.016||p.y>.476)return 0.;
    return 1.-smoothstep(.0003,.0008,min(abs(x-.0035),abs(x-.0105)));
  }
  vec3 instrumentString(float kind) {return kind<60.5?vec3(.78,.72,.56):vec3(.72,.72,.70);}
  vec3 gelatoMusicNauticalColour(DisplayHit hit,out float gloss) {
    vec3 p=hit.p,n=hit.n;float seed=fract(hit.seed),part=hit.part,kind=hit.kind;gloss=0.;
    bool cream=kind>57.5;float f=gelatoFlavour(seed);
    if(part<63.5) {
      gloss=.80;
      float tarnish=.5+.5*sin(dot(p,vec3(310.,270.,350.))+seed*7.);
      return mix(vec3(.72,.50,.16),vec3(.45,.31,.10),.28*tarnish);
    }
    if(part<64.5) {
      gloss=.22;
      vec3 c=cream?(f<.5?vec3(.66,.73,.44):f<1.5?vec3(.30,.15,.08):f<2.5?vec3(.92,.90,.83):vec3(.95,.87,.62))
                  :(f<.5?vec3(.84,.40,.45):f<1.5?vec3(.95,.89,.58):f<2.5?vec3(.55,.27,.45):vec3(.97,.66,.27));
      c*=.95+.05*sin(p.x*310.+sin(p.z*210.)*2.);
      float grain=waresHash3(floor(p*420.));
      if(!cream&&(f<.5||(f>1.5&&f<2.5))) {
        // A ribbon of fruit sauce folded through the strawberry and forest fruit.
        float ribbon=smoothstep(.86,.97,sin(p.x*95.+sin(p.z*70.+seed*5.)*3.))*smoothstep(.15,.55,sin(p.z*38.+p.x*21.+seed*11.));
        c=mix(c,f<.5?vec3(.62,.07,.11):vec3(.30,.06,.22),ribbon*.8);
      }
      if(cream&&f>1.5&&f<2.5&&grain>.86)c=vec3(.14,.07,.035);
      if(cream&&f<.5&&grain>.90)c=vec3(.42,.52,.18);
      if(cream&&f>2.5&&grain>.93)c=vec3(.10,.07,.05);
      if(cream&&f>.5&&f<1.5)gloss=.32;
      return c;
    }
    if(part<65.5) {
      gloss=.50;
      if(f<.5) {
        // Strawberry flecked with seeds.
        vec3 berry=vec3(.74,.06,.08);
        float seeds=step(.83,waresHash3(floor(n*14.)));
        return mix(berry,vec3(.88,.74,.30),seeds*.8);
      }
      // Raspberry drupelets.
      float bump=sin(n.x*38.)*sin(n.y*38.)*sin(n.z*38.);
      return vec3(.68,.10,.20)*(.78+.22*bump);
    }
    if(part<66.5) {
      gloss=.18;
      if(!cream)return vec3(.18,.40,.13)*(.85+.15*step(abs(p.z+.058),.0012));
      // Pistachio kernels: green with patches of purple-brown skin.
      float skin=waresHash3(floor(n*5.)+seed*7.);
      return skin>.6?vec3(.36,.20,.16):vec3(.50,.60,.24);
    }
    if(part<67.5) {
      gloss=.45;
      if(f>2.5)return vec3(.96,.58,.12)*(.92+.08*sin(p.y*800.+p.x*300.));
      // A lemon slice: rind, pith and ten segments.
      if(abs(n.z)<.5)return vec3(.92,.78,.16);
      float r=length(p.xy);
      if(r>.0205)return vec3(.92,.78,.16);
      if(r>.0185)return vec3(.93,.91,.80);
      float membrane=abs(fract(atan(p.y,p.x)*1.5915)-.5);
      return membrane>.44||r<.0025?vec3(.93,.91,.80):vec3(.96,.88,.44);
    }
    if(part<68.5) {
      if(!cream){gloss=.25;return mix(vec3(.10,.11,.24),vec3(.34,.36,.48),.35*smoothstep(.2,.9,n.y));}
      gloss=.45;
      if(f>2.5)return vec3(.09,.05,.03)*(.85+.15*sin(p.x*900.));
      return vec3(.17,.085,.040)*(.90+.10*sin((p.x+p.z)*900.));
    }
    if(part<69.5) {
      // A wafer cone: a pressed diamond grid, a dark open mouth, and some
      // rims dipped in chocolate.
      gloss=.10;
      float angle=atan(p.x,p.z);
      vec2 w=vec2(angle*.018,p.y);
      float grid=min(abs(fract((w.x+w.y)*95.)-.5),abs(fract((w.x-w.y)*95.)-.5));
      vec3 wafer=mix(vec3(.52,.31,.11),vec3(.80,.56,.27),smoothstep(.05,.18,grid));
      if(n.y>.5) {
        float r=length(p.xz);
        return r<.0195?vec3(.24,.13,.05)*(.55+.45*r/.0195):vec3(.74,.50,.24);
      }
      if(fract(seed*4.1)<.35&&p.y>.128){gloss=.35;return vec3(.17,.085,.040);}
      return wafer;
    }
    if(part<70.5) {
      gloss=.45;
      bool lijerica=kind<60.5;
      if(n.z<.42) {
        // The carved sides and back under a darker varnish.
        vec3 body=lijerica?vec3(.30,.13,.05):vec3(.09,.045,.025);
        return body*(.85+.15*sin(p.y*420.+sin(p.x*170.)*2.));
      }
      if(n.z<.50)return lijerica?vec3(.10,.05,.02):vec3(.80,.72,.52);
      vec3 top=(lijerica?vec3(.58,.33,.13):vec3(.74,.52,.25))*(.93+.07*sin(p.x*1100.+sin(p.y*40.)*2.5));
      if(lijerica) {
        // Two D-shaped sound holes, flat sides to the centre line.
        vec2 v=vec2(abs(p.x)-.019,(p.y-.152)/1.5);
        if(v.x>0.&&length(v)<.0115)top=vec3(.035,.022,.014);
      } else {
        // Round sound hole in a rosette of alternating inlay.
        float r=length(p.xy-vec2(0,.172));
        if(r<.020)top=vec3(.03,.02,.012);
        else if(r<.027){gloss=.50;top=mix(vec3(.16,.08,.04),vec3(.86,.78,.58),step(.5,fract(atan(p.y-.172,p.x)*3.8197)));}
      }
      return mix(top,instrumentString(kind),instrumentStrings(p,kind));
    }
    if(part<71.5) {
      gloss=.45;
      if(kind>61.5) {
        // A frula: plum wood, burnt bands near both ends, six finger holes.
        vec3 wood=vec3(.50,.25,.11)*(.92+.08*sin(p.x*160.+sin(p.y*900.)));
        if(abs(abs(p.x)-.080)<.012&&abs(n.x)<.5)wood=mix(wood,vec3(.12,.06,.03),step(.5,fract((p.x+atan(p.y,p.z)*.008)*140.))*.85);
        for(int i=0;i<6;i++)if(n.y>.6&&length(vec2(p.x+.045-float(i)*.018,p.z))<.0028)wood=vec3(.04,.025,.015);
        if(p.x<-.103&&abs(n.x)>.5)wood=vec3(.10,.05,.02);
        return wood;
      }
      if(fract(kind)>.15)return vec3(.24,.09,.035)*(.90+.10*sin(p.x*800.));
      vec3 wood=(kind<60.5?vec3(.34,.15,.06):vec3(.30,.13,.05))*(.90+.10*sin(p.y*500.+sin(p.x*300.)));
      if(n.z>.5)wood=mix(wood,instrumentString(kind),instrumentStrings(p,kind));
      return wood;
    }
    if(part<72.5) {
      gloss=.55;
      vec3 ebony=vec3(.035,.027,.022)*(.90+.10*sin(p.y*900.));
      if(kind>60.5&&kind<61.5&&n.z>.5&&abs(p.x)<.0156&&p.y>.215&&p.y<.4525) {
        // Tamburica frets for a 0.3675 m string, pearl dots at 5, 7, 9, 12.
        float u=-12.*log2(max(1.-(.4525-p.y)/.3675,.05));
        float fret=floor(u+.5),fy=.4525-.3675*(1.-exp2(-fret/12.));
        if(fret>.5&&abs(p.y-fy)<.0007){gloss=.80;ebony=vec3(.66,.66,.62);}
        float below=floor(u),y0=.4525-.3675*(1.-exp2(-below/12.)),y1=.4525-.3675*(1.-exp2(-(below+1.)/12.));
        bool marked=abs(below-4.)<.5||abs(below-6.)<.5||abs(below-8.)<.5||abs(below-11.)<.5;
        if(marked&&length(vec2(p.x,p.y-(y0+y1)*.5))<.0022)ebony=vec3(.86,.85,.80);
        ebony=mix(ebony,instrumentString(kind),instrumentStrings(p,kind));
      }
      return ebony;
    }
    if(part<73.5){gloss=.25;return vec3(.86,.83,.74);}
    if(part<74.5) {
      // An open book of music: staves, note heads with stems, bar lines and
      // a title; the gutter darkens where the pages curve into the binding.
      gloss=.04;
      float side=p.x<0.?-1.:1.;
      vec2 u=vec2(p.x-side*.072,p.y-.004);
      vec3 paper=vec3(.86,.82,.69)*(.97+.03*sin(p.x*700.+p.y*90.));
      paper*=mix(.74,1.,smoothstep(0.,.010,abs(p.x)));
      if(n.z<.5)return paper*.92;
      float ink=0.;
      if(side<0.&&u.y>.083&&u.y<.091&&abs(u.x)<.036)ink=.85*step(.35,fract(u.x*170.));
      float top=.078-u.y,k=floor(top/.024),w=top-k*.024;
      if(k>=0.&&k<6.5&&abs(u.x)<.058&&w<.0135) {
        float line=abs(fract(w/.003+.5)-.5)*.003;
        ink=max(ink,.50*(1.-smoothstep(.0003,.0008,line)));
        float cell=floor((u.x+.058)/.0116),x0=-.058+(cell+.5)*.0116;
        float y0=floor(displayHash(cell*3.17+k*13.7+seed*29.+side*5.)*9.)*.0015;
        ink=max(ink,1.-smoothstep(.0018,.0024,length(vec2(u.x-x0,(w-y0)*1.35))));
        if(abs(u.x-x0-.0019)<.0004&&w>y0-.010&&w<y0)ink=max(ink,.9);
        if(mod(cell,4.)<.5&&abs(u.x-x0+.0058)<.0004)ink=max(ink,.7);
      }
      return mix(paper,vec3(.08,.07,.06),ink);
    }
    if(part<75.5) {
      gloss=.05;
      if(kind>64.5) {
        // White cotton bell rope, its plait spiralling down.
        float plait=fract(atan(p.x,p.z)*.477+p.y*160.);
        return vec3(.84,.81,.72)*(.80+.20*smoothstep(.1,.4,abs(plait-.5)));
      }
      // The hank: turns side by side round the bundle, each laid in three
      // strands, seized at both sides and the top with tarred marline.
      float r=length(p.xy),psi=atan(p.z,r-.080),theta=atan(p.y,p.x);
      float seizing=min(min(abs(theta),3.1416-abs(theta)),abs(theta-1.5708))*.080;
      if(seizing<.008)return vec3(.20,.14,.075)*(.72+.28*smoothstep(.1,.4,abs(fract(theta*50.)-.5)));
      float turn=fract(psi*2.6),strand=fract(theta*19.+psi*2.1);
      float shade=(.38+.62*smoothstep(0.,.22,turn)*smoothstep(1.,.78,turn))*(.78+.22*smoothstep(.08,.30,abs(strand-.5)));
      return vec3(.50,.37,.20)*shade;
    }
    if(part<76.5) {
      // Port red, starboard green or clear masthead glass, moulded in
      // Fresnel prisms above and below a central belt.
      gloss=.92;
      float s=fract(seed*6.1),y=(p.y-.093)/.055;
      vec3 glass=s<.34?vec3(.60,.05,.035):s<.67?vec3(.035,.42,.16):vec3(.62,.66,.62);
      return glass*(abs(y)<.18?1.25:.70+.45*smoothstep(.15,.9,fract(abs(y)*4.)));
    }
    // Polished bell bronze: a dark mouth and an engraved band on the waist.
    gloss=.85;
    vec3 bronze=vec3(.58,.38,.14)*(.92+.08*sin(dot(p,vec3(500.,430.,470.))));
    if(n.y<-.5&&length(p.xz)<.052)return vec3(.05,.035,.02);
    if(p.y>.222&&p.y<.242&&abs(n.y)<.7) {
      float angle=atan(p.x,p.z);
      float line=step(abs(p.y-.2235),.0008)+step(abs(p.y-.2405),.0008);
      float letters=step(.55,fract(angle*9.))*step(.4,fract(angle*31.))*step(abs(p.y-.232),.004);
      bronze=mix(bronze,vec3(.12,.07,.03),clamp(line+letters,0.,1.)*.85);
    }
    return bronze;
  }
`;
