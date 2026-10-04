// Books, hand-painted souvenirs and cheese use the same finite ray solids as
// the other storefronts. Material IDs 23–35 belong to these three trades.
export const CULTURE_FOOD_SHAPES=/* glsl */`
  void shopTrianglePrism(vec3 ro,vec3 rd,vec2 a,vec2 b,vec2 c,float depth,float part,float kind,float seed,inout DisplayHit hit) {
    float area=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    float nearT=-1e8,farT=1e8;vec3 normal=vec3(0);
    for(int face=0;face<5;face++) {
      vec3 n;float limit;
      if(face<3) {
        vec2 start=face==0?a:face==1?b:c,end=face==0?b:face==1?c:a;
        vec2 edge=end-start;n=normalize(vec3(edge.y,-edge.x,0.))*sign(area);limit=dot(n.xy,start);
      } else {n=vec3(0,0,face==3?-1.:1.);limit=depth;}
      float denom=dot(n,rd),distance=limit-dot(n,ro);
      if(abs(denom)<.000001){if(distance<0.)return;}
      else {
        float t=distance/denom;
        if(denom<0.){if(t>nearT){nearT=t;normal=n;}}else farT=min(farT,t);
      }
    }
    if(farT>max(0.,nearT))displayCommit(nearT,normal,ro+rd*nearT,part,kind,seed,hit);
  }
  void shopUprightBook(vec3 ro,vec3 rd,vec3 centre,float angle,float seed,inout DisplayHit hit) {
    float cs=cos(angle),sn=sin(angle),height=.26+fract(seed)*.073;
    mat3 turn=mat3(cs,sn,0,-sn,cs,0,0,0,1);
    vec3 q=transpose(turn)*(ro-centre),d=transpose(turn)*rd;DisplayHit h=hit;
    displayBox(q,d,vec3(0,height*.5,0),vec3(.020,height*.5-.006,.062),24.,25.,seed,h);
    for(int side=0;side<2;side++)displayBox(q,d,vec3(side==0?-.023:.023,height*.5,0),vec3(.003,height*.5,.070),23.,25.,seed,h);
    displayBox(q,d,vec3(0,height*.5,.066),vec3(.023,height*.5,.005),23.,25.,seed,h);
    // Keep the book-local point for the spine artwork; rotate only the normal.
    if(h.t<hit.t){h.n=turn*h.n;hit=h;}
  }
  void shopCheeseWedge(vec3 ro,vec3 rd,float seed,inout DisplayHit hit) {
    DisplayHit h=hit;
    shopTrianglePrism(ro.xzy-vec3(0,0,.077),rd.xzy,vec2(-.142,.066),vec2(.142,.066),vec2(-.082,-.092),.053,32.,31.,seed,h);
    if(h.t<hit.t) {
      h.n=h.n.xzy;h.p=(h.p+vec3(0,0,.077)).xzy;
      if(h.n.z<-.1&&abs(h.n.y)<.5)h.part=33.;
      bool opening=false;
      if(h.n.z>.9)for(int hole=0;hole<3;hole++) {
        vec2 centre=hole==0?vec2(-.075,.080):hole==1?vec2(.016,.057):vec2(.087,.096);
        float radius=hole==0?.015:hole==1?.018:.012;
        if(length(h.p.xy-centre)<radius)opening=true;
      }
      if(!opening)hit=h;
    }
    // Shallow, concave eyes in the cut face, including their inward normals.
    for(int hole=0;hole<3;hole++) {
      vec3 c=hole==0?vec3(-.075,.080,.066):hole==1?vec3(.016,.057,.066):vec3(.087,.096,.066);
      float radius=hole==0?.015:hole==1?.018:.012;vec3 r=vec3(radius,radius,.010);
      vec3 q=(ro-c)/r,d=rd/r;float a=dot(d,d),b=dot(q,d),disc=b*b-a*(dot(q,q)-1.);
      if(disc<0.)continue;
      vec2 roots=vec2(-b-sqrt(disc),-b+sqrt(disc))/a;
      for(int i=0;i<2;i++) {
        float t=roots[i];vec3 p=ro+rd*t;
        if(p.z<=.066001)displayCommit(t,-normalize((p-c)/(r*r)),p,32.,31.,seed,hit);
      }
    }
  }
  void displayCultureFood(vec3 ro,vec3 rd,float kind,float seed,inout DisplayHit hit) {
    if(kind<25.5) {
      for(int book=0;book<3;book++)shopUprightBook(ro,rd,vec3((float(book)-1.)*.061,.002,0),book==2?-.025:0.,seed+float(book)*.27,hit);
    } else if(kind<26.5) {
      for(int book=0;book<3;book++) {
        float y=.024+float(book)*.052,x=(float(book)-1.)*.006,s=seed+float(book)*.27;
        displayBox(ro,rd,vec3(x,y,0),vec3(.121,.018,.069),24.,kind,s,hit);
        for(int side=0;side<2;side++)displayBox(ro,rd,vec3(x,y+(side==0?-.021:.021),0),vec3(.128,.003,.079),23.,kind,s,hit);
        displayBox(ro,rd,vec3(x,y,.074),vec3(.128,.023,.006),23.,kind,s,hit);
      }
    } else if(kind<27.5) {
      // A painted folk doll on a turned base: separate skirt, bodice, hands,
      // apron, hair and face, rather than a label on a generic cylinder.
      displayFrustum(ro,rd,.002,.022,.073,.073,14.,kind,seed,hit);
      displayFrustum(ro,rd,.024,.131,.060,.027,25.,kind,seed,hit);
      displayFrustum(ro,rd,.155,.065,.027,.032,25.,kind,seed,hit);
      displayFrustum(ro,rd,.148,.012,.033,.033,35.,kind,seed,hit);
      for(int side=0;side<2;side++) {
        float signX=side==0?-1.:1.;
        tradeTilted(ro,rd,vec3(signX*.037,.176,0),vec3(.013,.050,.014),signX*.28,28.,kind,seed,hit);
        tradeEllipsoid(ro,rd,vec3(signX*.050,.135,.004),vec3(.011,.014,.012),26.,kind,seed,hit);
      }
      tradeEllipsoid(ro,rd,vec3(0,.091,.043),vec3(.032,.054,.012),28.,kind,seed,hit);
      displayFrustum(ro,rd,.214,.017,.012,.012,26.,kind,seed,hit);
      tradeEllipsoid(ro,rd,vec3(0,.259,0),vec3(.034,.037,.031),26.,kind,seed,hit);
      tradeEllipsoid(ro,rd,vec3(0,.268,-.013),vec3(.036,.031,.024),27.,kind,seed,hit);
      tradeEllipsoid(ro,rd,vec3(0,.291,-.025),vec3(.020,.018,.017),27.,kind,seed,hit);
      for(int eye=0;eye<2;eye++)tradeEllipsoid(ro,rd,vec3(eye==0?-.010:.010,.265,.029),vec3(.003,.003,.002),27.,kind,seed,hit);
      tradeEllipsoid(ro,rd,vec3(0,.253,.031),vec3(.004,.005,.004),26.,kind,seed,hit);
    } else if(kind<28.5) {
      // A limestone house souvenir with a solid terracotta roof and chimney.
      displayBox(ro,rd,vec3(0,.009,0),vec3(.088,.009,.076),14.,kind,seed,hit);
      displayBox(ro,rd,vec3(0,.074,0),vec3(.064,.056,.052),29.,kind,seed,hit);
      shopTrianglePrism(ro,rd,vec2(-.079,.130),vec2(.079,.130),vec2(0,.197),.065,30.,kind,seed,hit);
      displayBox(ro,rd,vec3(.039,.180,-.022),vec3(.009,.032,.009),29.,kind,seed,hit);
      displayBox(ro,rd,vec3(0,.044,.054),vec3(.012,.026,.003),27.,kind,seed,hit);
      for(int side=0;side<2;side++) {
        float x=side==0?-.041:.041;
        displayBox(ro,rd,vec3(x,.098,.054),vec3(.011,.013,.003),27.,kind,seed,hit);
        for(int shutter=0;shutter<2;shutter++)displayBox(ro,rd,vec3(x+(shutter==0?-.016:.016),.098,.055),vec3(.004,.014,.003),25.,kind,seed,hit);
      }
    } else if(kind<29.5) {
      displayBox(ro,rd,vec3(0,.008,0),vec3(.147,.008,.067),14.,kind,seed,hit);
      tradeEllipsoid(ro,rd,vec3(0,.048,0),vec3(.142,.032,.044),14.,kind,seed,hit);
      displayBox(ro,rd,vec3(0,.155,0),vec3(.004,.112,.004),14.,kind,seed,hit);
      shopTrianglePrism(ro,rd,vec2(.009,.091),vec2(.122,.091),vec2(.009,.258),.003,31.,kind,seed,hit);
      shopTrianglePrism(ro,rd,vec2(-.110,.086),vec2(-.010,.086),vec2(-.010,.224),.003,31.,kind,seed,hit);
    } else {
      displayFrustum(ro,rd,.002,.018,.161,.161,14.,kind,seed,hit);
      if(kind<30.5) {
        displayFrustum(ro,rd,.021,.110,.126,.126,33.,kind,seed,hit);
        displayFrustum(ro,rd,.131,.002,.117,.117,32.,kind,seed,hit);
        displayFrustum(ro,rd,.133,.001,.053,.053,34.,kind,seed,hit);
      } else if(kind<31.5)shopCheeseWedge(ro,rd,seed,hit);
      else for(int wheel=0;wheel<3;wheel++) {
        vec3 q=ro-vec3((float(wheel)-1.)*.013,0,0);
        displayFrustum(q,rd,.021+float(wheel)*.051,.049,.073,.073,34.,kind,seed+float(wheel)*.21,hit);
      }
    }
  }
`;

export const CULTURE_FOOD_COLOURS=/* glsl */`
  vec3 cultureFoodColour(DisplayHit hit,out float gloss) {
    vec3 p=hit.p,n=hit.n;float seed=fract(hit.seed);gloss=0.;
    if(hit.part<23.5) {
      vec3 cover=seed<.25?vec3(.075,.17,.24):seed<.50?vec3(.16,.25,.13):seed<.75?vec3(.33,.077,.055):vec3(.39,.26,.12);
      float bands=hit.kind<25.5?step(.118,abs(p.y))*step(abs(p.y),.126):step(.098,abs(p.x))*step(abs(p.x),.104);
      cover=mix(cover,vec3(.69,.48,.18),bands*.9);
      if(p.z>.003&&abs(n.z)>.8) {
        if(hit.kind<25.5&&abs(p.x)<.017&&abs(p.y)<.093) {
          vec2 uv=vec2(.5-p.y/.22,.5+p.x/.063);
          cover=displayLabel(uv,16.+floor(seed*6.));
        } else if(hit.kind>25.5&&abs(p.x)<.085&&abs(p.y)<.015)
          cover=displayLabel(vec2(p.x/.19+.5,.5-p.y/.055),16.+floor(seed*6.));
      }
      return cover;
    }
    if(hit.part<24.5)return vec3(.77,.70,.53)*(.94+.06*sin((hit.kind<25.5?p.x:p.y)*1800.));
    if(hit.part<25.5) {
      gloss=.22;vec3 dye=seed<.5?vec3(.41,.055,.059):vec3(.054,.17,.26);
      if(hit.kind<27.5&&p.y>.035&&p.y<.135)dye*=.89+.11*sin(atan(p.x,p.z)*22.);
      return dye;
    }
    if(hit.part<26.5) {
      gloss=.12;vec3 skin=vec3(.65,.41,.25);
      if(p.z>.027&&p.y>.242&&p.y<.246&&abs(p.x)<.008)skin=vec3(.40,.08,.06);
      return skin;
    }
    if(hit.part<27.5){gloss=.18;return vec3(.044,.028,.018);}
    if(hit.part<28.5){gloss=.18;return vec3(.78,.71,.55)*(1.+.04*sin(p.y*720.));}
    if(hit.part<29.5)return vec3(.62,.56,.43)*(1.+.045*sin(p.x*420.)*sin(p.y*310.));
    if(hit.part<30.5)return vec3(.49,.19,.09)*(.92+.08*sin(p.z*490.));
    if(hit.part<31.5) {
      float seam=step(.965,fract(p.y*63.));
      return mix(vec3(.79,.73,.57),vec3(.45,.34,.20),seam*.45);
    }
    if(hit.part<32.5) {
      gloss=.09;vec3 paste=vec3(.82,.62,.22);
      if(hit.kind>30.5&&hit.kind<31.5&&p.z<.064)paste*=.55+.45*clamp((p.z-.056)/.010,0.,1.);
      return paste*(1.+.025*sin(p.x*390.)*sin(p.y*530.));
    }
    if(hit.part<33.5){gloss=.15;return vec3(.55,.29,.057)*(1.+.06*sin(p.y*710.+p.x*29.));}
    if(hit.part<34.5) {
      if(hit.kind<30.5) {
        float ring=step(.041,length(p.xz))*step(length(p.xz),.047);
        return mix(vec3(.79,.71,.49),vec3(.30,.23,.074),ring);
      }
      gloss=.08;return vec3(.78,.75,.64)*(1.+.04*sin(p.x*720.)*sin(p.z*580.));
    }
    gloss=.55;return vec3(.59,.37,.10);
  }
`;
