import * as THREE from 'three';
import {chainMaterialShader} from './material-patch.js';
import {smoothstep} from './util.js';

// The city shadow covers hundreds of metres at parapet height. An enclosure
// also needs centimetre-scale occlusion through its real narrow openings.
// This depth pass uses the SAME directional light, never a second light.
export function makeStairShadows(layouts) {
  const entries=[...layouts.values()].filter(layout=>layout.enclosed).map((layout,i)=>{
    layout.shadowRoom=i+1;layout.masonry.computeBoundingBox();
    return {layout,room:i+1,box:layout.masonry.boundingBox.clone()};
  });
  const size=2048,target=new THREE.WebGLRenderTarget(size,size,{depthBuffer:true,stencilBuffer:false});
  target.depthTexture=new THREE.DepthTexture(size,size,THREE.UnsignedIntType);
  target.depthTexture.compareFunction=THREE.LessEqualCompare;
  target.depthTexture.minFilter=target.depthTexture.magFilter=THREE.LinearFilter;
  const uniforms={uStairDepth:{value:target.depthTexture},uStairMatrix:{value:new THREE.Matrix4()},
    uStairRoom:{value:0},uStairDepthBias:{value:0},uStairShadowStrength:{value:0}};
  const depthMaterial=new THREE.MeshDepthMaterial({colorWrite:false,side:THREE.FrontSide});
  const scene=new THREE.Scene(),caster=new THREE.Mesh(new THREE.BufferGeometry(),depthMaterial);scene.add(caster);
  const camera=new THREE.OrthographicCamera(),direction=new THREE.Vector3(),lastDirection=new THREE.Vector3(99,99,99);
  const centre=new THREE.Vector3(),extent=new THREE.Vector3(),point=new THREE.Vector3(),viewBox=new THREE.Box3();
  const biasMatrix=new THREE.Matrix4().set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1);
  let current=null;
  const update=(renderer,light,viewer)=>{
    let nearest=null,distance=Infinity;
    for(const entry of entries){const d=entry.box.distanceToPoint(viewer.position);if(d<distance){distance=d;nearest=entry;}}
    const strength=1-smoothstep(28,42,distance);
    uniforms.uStairRoom.value=strength>0&&nearest?nearest.room:0;
    uniforms.uStairShadowStrength.value=strength;
    if(!nearest||strength<=0)return;
    direction.copy(light.position).sub(light.target.position).normalize();
    if(current===nearest&&direction.distanceToSquared(lastDirection)<1e-9)return;
    current=nearest;lastDirection.copy(direction);caster.geometry=nearest.layout.masonry;
    nearest.box.getCenter(centre);nearest.box.getSize(extent);
    camera.position.copy(centre).addScaledVector(direction,extent.length()*2+2);camera.lookAt(centre);camera.updateMatrixWorld(true);
    viewBox.makeEmpty();
    for(const x of [nearest.box.min.x,nearest.box.max.x])for(const y of [nearest.box.min.y,nearest.box.max.y])for(const z of [nearest.box.min.z,nearest.box.max.z]) {
      point.set(x,y,z).applyMatrix4(camera.matrixWorldInverse);viewBox.expandByPoint(point);
    }
    camera.left=viewBox.min.x-.18;camera.right=viewBox.max.x+.18;camera.bottom=viewBox.min.y-.18;camera.top=viewBox.max.y+.18;
    camera.near=Math.max(.05,-viewBox.max.z-1);camera.far=-viewBox.min.z+1;camera.updateProjectionMatrix();
    uniforms.uStairMatrix.value.copy(biasMatrix).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
    uniforms.uStairDepthBias.value=.006/(camera.far-camera.near);
    const previous=renderer.getRenderTarget();renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,camera);renderer.setRenderTarget(previous);
  };
  const patch=material=>chainMaterialShader(material,'enclosureDepth-v1',sh=>{
    Object.assign(sh.uniforms,uniforms);
    sh.vertexShader=sh.vertexShader.replace('#include <common>',`#include <common>
      attribute float aStairRoom; varying float vStairRoom; varying vec4 vStairCoord; uniform mat4 uStairMatrix;`)
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        vStairRoom=aStairRoom;vStairCoord=uStairMatrix*vec4(position+normal*.004,1.0);`);
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>',`#include <common>
      varying float vStairRoom; varying vec4 vStairCoord; uniform float uStairRoom,uStairDepthBias,uStairShadowStrength;
      uniform highp sampler2DShadow uStairDepth;
      float stairLocalVisibility(){
        if(uStairRoom<.5||abs(vStairRoom-uStairRoom)>.25)return 1.0;
        vec3 p=vStairCoord.xyz/vStairCoord.w;
        if(any(lessThan(p,vec3(0.0)))||any(greaterThan(p,vec3(1.0))))return 1.0;
        return mix(1.0,texture(uStairDepth,vec3(p.xy,p.z-uStairDepthBias)),uStairShadowStrength);
      }`);
    const shadow='getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )';
    sh.fragmentShader=sh.fragmentShader.replace('#include <lights_fragment_begin>',
      THREE.ShaderChunk.lights_fragment_begin.replace(shadow,'min('+shadow+',stairLocalVisibility())'));
  });
  return {update,patch,uniforms,target,camera,entries};
}
