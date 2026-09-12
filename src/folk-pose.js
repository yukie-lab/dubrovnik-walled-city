// Position and its Jacobian travel through one pose function. The colour pass
// uses the inverse-transpose normal; the shadow pass uses the identical point.
// No joint is drawn by a separate mesh and no inverse smoothstep is undefined.
export const folkPoseGLSL=/* glsl */`
  uniform float uT;
  attribute float aLimb, aWalk;
  attribute vec4 aGait;
  #define aPh aGait.x
  #define aCad aGait.y
  #define aSit aGait.z
  #define aPose aGait.w
  struct FolkPose { vec3 p; mat3 j; };
  vec2 folkSmooth(float lo,float hi,float y) {
    float t=clamp((y-lo)/(hi-lo),0.,1.);
    return vec2(t*t*(3.-2.*t),6.*t*(1.-t)/(hi-lo));
  }
  mat3 folkRX(float a) {
    float c=cos(a),s=sin(a);return mat3(1.,0.,0.,0.,c,s,0.,-s,c);
  }
  void folkRotate(inout FolkPose f,float y,float a) {
    mat3 r=folkRX(a);f.p.y-=y;f.p=r*f.p;f.p.y+=y;f.j=r*f.j;
  }
  void folkField(inout FolkPose f,vec3 offset,vec2 blend) {
    vec3 dy=vec3(f.j[0].y,f.j[1].y,f.j[2].y);
    f.p+=offset*blend.x;f.j+=outerProduct(offset,dy*blend.y);
  }
  vec2 folkLegAngles(float side,float ph,float pose) {
    float hip=sin(ph)*aWalk*side*.40;
    if(pose==3.)hip+=side*.10*(1.-aWalk);
    return vec2(hip,max(0.,-sin(ph)*side)*.62*aWalk);
  }
  float folkSole(float side,float ph,float pose) {
    vec2 a=folkLegAngles(side,ph,pose);
    vec3 p=vec3(0.,-.45,.039);p=folkRX(a.y)*p;p.y-=.45;
    p=folkRX(a.x)*p;p.y+=.90;
    // Exact support of the shoe's elliptical sole under the two rotations.
    return p.y-abs(sin(a.x+a.y))*.122;
  }
  FolkPose folkBlend(FolkPose a,FolkPose b,vec2 blend) {
    return FolkPose(mix(a.p,b.p,blend.x),a.j*(1.-blend.x)+b.j*blend.x
      +outerProduct(b.p-a.p,vec3(0.,blend.y,0.)));
  }
  FolkPose folkSeated(vec3 p) {
    FolkPose body=FolkPose(p-vec3(0.,.40,0.),mat3(1.));
    if(abs(aLimb)>.5 && abs(aLimb)<1.5) {
      // A connected thigh / shin chain. Stair seating uses the same .30 m
      // sole height and .45 m forward support tested by the placement path.
      mat3 r=folkRX(-1.68145354797);
      vec3 knee=r*vec3(0.,-.45,0.)+vec3(0.,.50,0.);
      float sole=aSit>1.5 ? .30 : 0.;
      mat3 lower=mat3(1.,0.,0.,0.,(knee.y-sole)/.45,0.,0.,0.,1.);
      FolkPose shin=FolkPose(lower*p+vec3(0.,sole,knee.z),lower);
      FolkPose thigh=FolkPose(r*(p-vec3(0.,.90,0.))+vec3(0.,.50,0.),r);
      FolkPose leg=folkBlend(shin,thigh,folkSmooth(.27,.63,p.y));
      return folkBlend(leg,body,folkSmooth(.70,1.13,p.y));
    }
    if(abs(aLimb)>1.5) {
      vec2 t=folkSmooth(1.00,1.62,p.y);t=vec2(1.-t.x,-t.y);
      folkField(body,vec3(0.,.04,aSit>1.5 ? .20 : .26),t);
    }
    return body;
  }
  FolkPose folkPose(vec3 point) {
    float ph=aPh+uT*aCad,pose=floor(aPose+.5),stand=1.-aWalk;
    FolkPose f=FolkPose(point,mat3(1.));
    if(aSit>.5)f=folkSeated(point);
    else {
      if(abs(aLimb)>.5) {
        float side=sign(aLimb);
        if(abs(aLimb)<1.5) {
          vec2 a=folkLegAngles(side,ph,pose);
          // Blend the lower leg rotation through the joint, preserving the
          // continuous skin rather than pulling separate boxes apart.
          FolkPose lower=f;folkRotate(lower,.45,a.y);
          vec2 t=folkSmooth(.36,.54,point.y);t=vec2(1.-t.x,-t.y);
          f=folkBlend(f,lower,t);folkRotate(f,.90,a.x);
        } else {
          float a=sin(ph)*aWalk*side*.30+sin(uT*.42+aPh+side)*.04*stand;
          folkRotate(f,1.62,a);
          vec2 elbow=folkSmooth(1.00,1.34,point.y);elbow=vec2(1.-elbow.x,-elbow.y);
          vec3 offset=vec3(0.);
          if(pose==1. && side>0.)offset=vec3(-.098,.075,-.030)*stand;
          if(pose==2. && side<0.)offset=vec3(.115,.185,.085)*stand;
          f.p+=offset*elbow.x;f.j+=outerProduct(offset,vec3(0.,elbow.y,0.));
        }
      }
      f.p.y-=min(folkSole(-1.,ph,pose),folkSole(1.,ph,pose));
      if(pose==3.)folkField(f,vec3(.024*stand,0.,0.),folkSmooth(.55,1.20,f.p.y));
    }
    float breathe=sin(uT*.55+aPh)*.006*stand;
    folkField(f,vec3(0.,-breathe,0.),folkSmooth(.9,1.7,f.p.y));
    f.p.x+=sin(uT*.8+aPh)*.004*stand;
    return f;
  }
  vec3 folkNormal(mat3 j,vec3 n) {
    return normalize(cross(j[1],j[2])*n.x+cross(j[2],j[0])*n.y+cross(j[0],j[1])*n.z);
  }
`;

export function patchFolkPose(material,time,{accessory=false}={}) {
  material.onBeforeCompile=sh=>{
    sh.uniforms.uT=time;
    sh.vertexShader=sh.vertexShader.replace('#include <common>',`#include <common>\n${folkPoseGLSL}
      ${accessory ? 'attribute float aKind, aHas;' : ''}`)
      .replace('void main() {',`void main() {
        FolkPose posedFolk=folkPose(position);`)
      .replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
        objectNormal=folkNormal(posedFolk.j,normal);`)
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        transformed=posedFolk.p;
        ${accessory ? 'if(abs(aKind-aHas)>.5)transformed=vec3(0.);' : ''}`);
  };
  material.customProgramCacheKey=()=>`folkContinuousPose|${accessory ? 'accessory' : 'body'}`;
}
