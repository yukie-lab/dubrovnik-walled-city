import { ATM } from './atmosphere-model.js';
// A three-band observer approximation. Rod/cone mixing depends on absolute
// scene luminance, before exposure and display encoding. RGB alone cannot
// recover a unique spectrum or an exact scotopic response (metamerism).
export const MesopicShader={
  uniforms:{tDiffuse:{value:null}},
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:/* glsl */`
    varying vec2 vUv;uniform sampler2D tDiffuse;
    void main(){
      vec4 c=texture2D(tDiffuse,vUv);
      float Y=max(0.0,dot(c.rgb,vec3(.2126,.7152,.0722)));
      float cd=Y*${ATM.luxPerUnit.toFixed(1)};
      float cones=smoothstep(log(.005),log(5.0),log(max(cd,1e-8)));
      // A normalized short-wavelength-sensitive rod proxy: red surfaces lose
      // relative brightness as cone vision recedes. No additive night floor.
      float rods=max(0.0,dot(c.rgb,vec3(.035,.680,.285)));
      vec3 rodWhite=vec3(.90,1.015,1.10);
      rodWhite/=dot(rodWhite,vec3(.2126,.7152,.0722));
      c.rgb=mix(rods*rodWhite,c.rgb,cones);
      gl_FragColor=c;
    }`,
};
