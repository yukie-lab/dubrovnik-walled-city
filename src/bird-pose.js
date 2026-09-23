import {chainMaterialShader} from './material-patch.js';

export const birdPoseGLSL=/* glsl */`
  uniform float uT;
  attribute float aHead,aPh2;
  vec3 birdTurn(vec3 p){
    float yaw=sin(uT*.29+aPh2*11.0)*.62;
    float cy=cos(yaw),sy=sin(yaw);
    p.xz=mat2(cy,-sy,sy,cy)*p.xz;return p;
  }
  vec3 birdPose(vec3 p){
    float peck=smoothstep(.55,1.0,sin(uT*2.35+aPh2*6.28));
    p.y-=aHead*peck*.062;p.z+=aHead*peck*.034;
    return birdTurn(p);
  }
`;

export function patchBirdPose(material,time) {
  return chainMaterialShader(material,'perchedBird-v1',shader=>{
    shader.uniforms.uT=time;
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\n'+birdPoseGLSL)
      .replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed=birdPose(transformed);')
      .replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nobjectNormal=birdTurn(objectNormal);');
  });
}
