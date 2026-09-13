import * as THREE from 'three';

// One differentiable deformation field per tree. Attached components sample
// the same world point and phase, so their junctions cannot drift apart.
export const woodlandWindGLSL=`
uniform float uTreeT;
uniform float uTreeW;
attribute vec4 aTree;
vec3 woodlandPose(vec3 p, out mat3 jacobian) {
  float height=1.0/aTree.y;
  float raw=(p.y-aTree.x)*aTree.y;
  float h=clamp(raw,0.0,1.3);
  float ph=aTree.z*6.28318530718;
  float s=sin(uTreeT*.85+ph)*.65+sin(uTreeT*1.93+ph*2.7)*.35;
  float c=cos(uTreeT*.71+ph*1.4)*.7+cos(uTreeT*2.21+ph*.6)*.3;
  float k=uTreeW*aTree.w*.085;
  vec3 direction=vec3(s,-(abs(s)+abs(c))*.06,c*.8);
  float amplitude=k*height*h*h;
  float derivative=(raw>0.0 && raw<1.3) ? k*2.0*h : 0.0;
  jacobian=mat3(vec3(1,0,0),vec3(0,1,0)+direction*derivative,vec3(0,0,1));
  return p+direction*amplitude;
}
vec3 woodlandNormal(vec3 n,mat3 j) {
  return normalize(mat3(cross(j[1],j[2]),cross(j[2],j[0]),cross(j[0],j[1]))*n);
}
vec3 woodlandInstanceNormal(vec3 n,mat4 matrix,mat3 j) {
  mat3 m=mat3(matrix);
  n/=vec3(dot(m[0],m[0]),dot(m[1],m[1]),dot(m[2],m[2]));
  return woodlandNormal(m*n,j);
}
`;

export function patchWoodlandWind(mat,{wind=.1,time=null,depth=false,instanced=false}={}) {
  const uT=time||{value:0},uW=typeof wind==='object' ? wind : {value:wind},previous=mat.onBeforeCompile;
  mat.onBeforeCompile=(sh,renderer)=>{
    previous?.(sh,renderer);sh.uniforms.uTreeT=uT;sh.uniforms.uTreeW=uW;
    sh.vertexShader=sh.vertexShader.replace('#include <common>',`#include <common>\n${woodlandWindGLSL}`)
      .replace('#include <begin_vertex>',`mat3 woodlandJ;vec3 transformed=woodlandPose(position,woodlandJ);`);
    if(!depth)sh.vertexShader=sh.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
      mat3 woodlandNormalJ;woodlandPose(position,woodlandNormalJ);
      objectNormal=woodlandNormal(objectNormal,woodlandNormalJ);`);
    if(instanced) {
      sh.vertexShader=sh.vertexShader.replace('woodlandPose(position,woodlandJ)','woodlandPose((instanceMatrix*vec4(position,1.0)).xyz,woodlandJ)')
        .replace('#include <project_vertex>',`vec4 mvPosition=modelViewMatrix*vec4(transformed,1.0);
          gl_Position=projectionMatrix*mvPosition;`)
        .replace('#include <worldpos_vertex>',`vec4 worldPosition=modelMatrix*vec4(transformed,1.0);`);
      if(!depth)sh.vertexShader=sh.vertexShader.replace('woodlandPose(position,woodlandNormalJ)',
        'woodlandPose((instanceMatrix*vec4(position,1.0)).xyz,woodlandNormalJ)')
        .replace('objectNormal=woodlandNormal(objectNormal,woodlandNormalJ);',
          'objectNormal=woodlandInstanceNormal(objectNormal,instanceMatrix,woodlandNormalJ);')
        .replace('#include <defaultnormal_vertex>',`vec3 transformedNormal=normalMatrix*objectNormal;
          #ifdef FLIP_SIDED
            transformedNormal=-transformedNormal;
          #endif`);
    }
  };
  mat.customProgramCacheKey=()=>`woodland-wind-2-${depth}-${instanced}`;
  mat.userData.treeTime=uT;mat.userData.treeWind=uW;mat.userData.treeInstanced=instanced;return mat;
}

export function woodlandDepthMaterial(mat) {
  return patchWoodlandWind(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking}),
    {wind:mat.userData.treeWind,time:mat.userData.treeTime,depth:true,instanced:mat.userData.treeInstanced});
}

export function woodlandWindMargin(height,wind,strength=1) {
  // The exact h clamp and maximum magnitudes in woodlandPose. Include the
  // vertical shortening and Float32 world-coordinate roundoff.
  return height*wind*strength*.085*1.3**2*Math.hypot(1,.12,.8)+.002;
}
