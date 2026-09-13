import * as THREE from 'three';
import {woodStem} from './woodland-shape.js';
import {needleTexture} from './needle-surface.js';

const matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),spin=new THREE.Quaternion();
const up=new THREE.Vector3(0,1,0),axis=new THREE.Vector3(),pos=new THREE.Vector3(),scale=new THREE.Vector3();

// A closed, folded leaf. Its thickness remains nonzero at every orientation;
// hundreds of thousands of copies share these four vertices and four faces.
export function woodlandLeafGeometry() {
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute([0,-.5,0,.5,0,0,-.5,0,0,0,.5,.055],3));
  g.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(12).fill(1),3));
  const ix=[0,2,1,0,1,3,0,3,2,1,2,3];
  g.setIndex(ix);g.computeVertexNormals();g.computeBoundingSphere();
  g.userData.closedParts=[{from:0,to:4}];return g;
}

export function growLeafCluster(B,at,radii,rnd,color,yaw=0) {
  const kind=B.current.kind||'pine',pine=kind==='pine',cypress=kind==='cypress';
  const [rx,ry,rz]=radii,spread=Math.max(rx,rz),large=ry>spread*2;
  const groups=large ? 24 : pine ? 9 : 10;
  const perGroup=large ? 20 : pine ? 10 : kind==='olive' ? 18 : 9;
  const length=pine ? .40 : cypress ? .32 : kind==='olive' ? .087 : .073;
  const width=pine ? .30 : cypress ? .23 : kind==='olive' ? .031 : .038;
  for(let k=0;k<groups;k++) {
    const a=k*2.3999632297+yaw+(rnd()-.5)*.7,y=large ? -.85+k/(groups-1)*1.7 : (rnd()-.5)*1.25;
    const r=Math.sqrt(1-y*y)*(.55+rnd()*.4);
    const end=[at[0]+Math.sin(a)*rx*r,at[1]+y*ry,at[2]+Math.cos(a)*rz*r];
    const start=[...at];
    // Real twig supports follow the cluster's radial branch system. Tiny
    // diameters are retained; distant twigs may be omitted by visibility LOD.
    const twigRadius=Math.min(.008,spread*.012);
    B.append(woodStem([start,end],[twigRadius,.0015],{sides:3,phase:rnd()}),[.071,.06,.038],0,twigRadius*2.16);
    for(let j=0;j<perGroup;j++) {
      const t=.20+.80*(j+rnd())/perGroup,b=a+j*2.39996;
      axis.set(Math.cos(b)*.8,(pine ? .1 : .4)+rnd()*.8,Math.sin(b)*.8).normalize();
      q.setFromUnitVectors(up,axis);spin.setFromAxisAngle(up,rnd()*Math.PI*2);q.multiply(spin);
      const size=.68+rnd()*.65;
      pos.set(...start).lerp(new THREE.Vector3(...end),t).addScaledVector(axis,length*size*.5);
      scale.set(width*size,length*size,(pine ? .18 : .024)*size);
      matrix.compose(pos,q,scale);
      const shade=.63+rnd()*.57;
      B.leaf(matrix,color.map(v=>v*shade));
    }
  }
}

export function woodlandLeafMesh(B,material,depth) {
  const geometry=woodlandLeafGeometry(),count=B.FM.length/16;
  geometry.setAttribute('aTree',new THREE.InstancedBufferAttribute(new Float32Array(B.FT),4));
  geometry.setAttribute('aNeedle',new THREE.InstancedBufferAttribute(new Float32Array(B.FK||count),1));
  geometry.userData.needleCoverage=needleTexture().userData.coverage;
  const mesh=new THREE.InstancedMesh(geometry,material,count);
  mesh.instanceMatrix.array.set(B.FM);
  mesh.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(B.FC),3);
  mesh.userData.woodlandLeaves=B.trees;
  mesh.castShadow=true;mesh.receiveShadow=true;mesh.customDepthMaterial=depth;
  mesh.computeBoundingSphere();return mesh;
}
