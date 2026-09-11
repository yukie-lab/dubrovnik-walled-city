import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, tagMesh } from './util.js';
import { patchSkyVisInstanced } from './skyvis.js';
import { patchDetailShadows } from './detail-shadows.js';

// One continuous cross-section: outside, rolled rim, inside and bottom. The
// material has thickness even though the vessel is open. Axis vertices are
// single vertices, so the two bottom caps contain no zero-area triangles.
export function potShellGeometry(segments = 32) {
  const profile = [[0,0], [.229,0], [.238,.014], [.242,.030], [.300,.343],
    [.322,.365], [.335,.376], [.335,.421], [.331,.432], [.300,.432],
    [.293,.419], [.299,.378], [.286,.323], [.209,.061], [0,.061]];
  const p = [], uv = [], index = [], rings = [];
  for (const [r,y] of profile) {
    const ring = [];
    const n = r === 0 ? 1 : segments;
    for (let i = 0; i < n; i++) {
      const a = i * Math.PI * 2 / segments;
      ring.push(p.length / 3);
      p.push(r * Math.cos(a), y, r * Math.sin(a));
      uv.push(i / segments, y / .432);
    }
    rings.push(ring);
  }
  for (let k = 1; k < rings.length; k++) {
    const a = rings[k-1], b = rings[k];
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      if (a.length === 1) index.push(a[0], b[i], b[j]);
      else if (b.length === 1) index.push(a[i], b[0], a[j]);
      else index.push(a[i], b[i], a[j], a[j], b[i], b[j]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

// A cupped, pointed lamina with its petiole at the origin. It is a real leaf
// surface in space, with no transparent rectangle and no camera-facing turn.
export function leafGeometry() {
  const geo = new THREE.BufferGeometry(), p = [0,0,0], c = [.78,.84,.70], index = [];
  const rows = 6;
  for (let j = 1; j <= rows; j++) {
    const y = j / (rows + 1), arch = Math.sin(Math.PI*y);
    const w = .5 * arch**.72 * (1-.15*y);
    for (const side of [-1,0,1]) {
      const z = (side === 0 ? .035 : -.013) * arch + .025*y*y;
      p.push(side*w,y,z);
      c.push(...(side === 0 ? [1.05,1.07,.92] : [.88,.94,.82]));
    }
  }
  const tip = p.length/3;
  p.push(0,1,.055); c.push(.94,.98,.87);
  index.push(0,2,1,0,3,2);
  for (let j=0; j<rows-1; j++) for (let x=0; x<2; x++) {
    const a=1+j*3+x,b=a+1,d=a+3,e=d+1;
    index.push(a,b,d,b,e,d);
  }
  const last=1+(rows-1)*3;
  index.push(last,last+1,tip,last+1,last+2,tip);
  geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(c,3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

const UP = new THREE.Vector3(0,1,0);
const V = (x,y,z) => new THREE.Vector3(x,y,z);

// Independent, deterministic growth: each leaf's base lies on a generated
// branch. Adding a leaf must never consume the city's shared layout RNG.
export function growPot(pot) {
  const rng = mulberry32((pot.seed * 0xffffffff) >>> 0);
  const kind = pot.boug ? 'bougainvillea' : pot.seed < .38 ? 'herb' : 'bay';
  const height = kind === 'herb' ? .54 + rng() * .16 : .73 + rng() * .24;
  const stems = [], leaves = [];
  const root = V(0,0,0), tip = V(0,height*.82,0);
  stems.push({ a: root, b: tip, radius: kind === 'herb' ? .006 : .009 });
  const branchCount = kind === 'herb' ? 9 : 8;
  for (let b = 0; b < branchCount; b++) {
    const t = (b + .6) / (branchCount + 1);
    const start = V(0,height * t * .82,0);
    const a = b * 2.399963 + rng() * .70;
    const spread = (.31 - t * .14) * (.75 + rng() * .40);
    const end = V(Math.cos(a) * spread, start.y + height * (.20 + rng() * .22), Math.sin(a) * spread);
    stems.push({ a: start, b: end, radius: .003 + (1-t) * .0025 });
    const axis = end.clone().sub(start).normalize();
    const side = new THREE.Vector3().crossVectors(axis, UP).normalize();
    const nodes = kind === 'herb' ? 6 : 7;
    for (let n = 0; n < nodes; n++) for (const sign of (kind === 'herb' ? [-1,1] : [n%2 ? -1 : 1])) {
      const u = .15 + n / nodes * .78 + (rng()-.5)*.035;
      const base = start.clone().lerp(end,u);
      const direction = side.clone().multiplyScalar(sign * (.85 + rng() * .30))
        .addScaledVector(axis,.30 + rng() * .50).add(V(0,.16 + rng() * .44,0)).normalize();
      const length = kind === 'herb' ? .038 + rng() * .022 : .063 + rng() * .048;
      leaves.push({ base, direction, length, width: length * (kind === 'herb' ? .19 : .60),
        roll: (rng() - .5) * 1.5, age: rng(), bract: false, branch: b + 1, u });
    }
    leaves.push({ base:end.clone(), direction:axis.clone().add(V(0,.2,0)).normalize(),
      length:kind === 'herb' ? .04 : .08, width:kind === 'herb' ? .008 : .048,
      roll:(rng()-.5)*1.5,age:rng(),bract:false,branch:b+1,u:1 });
    // Coloured bracts cluster at shoot tips; the whole shrub never turns pink.
    if (pot.boug && b % 2 === 0) for (let f = 0; f < 3; f++) {
      const a2 = a + f * Math.PI * 2 / 3;
      leaves.push({ base: end.clone(), direction: V(Math.cos(a2), .15 + rng(), Math.sin(a2)).normalize(),
        length: .036 + rng() * .018, width: .044, roll: rng() * 1.2,
        age: rng(), bract: true, branch: b + 1, u: 1 });
    }
  }
  return { stems, leaves, kind, height };
}

// The same world-space bend is used for twigs, leaves and their depth pass.
// Stem roots stay in the soil. Neighbouring plants share gusts, with a small
// phase difference, and leaves keep their branch attachment while moving.
function windMaterial(mat, time) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uPlantTime = time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec4 aWindRoot;
      uniform float uPlantTime;
      float plantGust() {
        return sin(uPlantTime * 1.13 + aWindRoot.x * .13 + aWindRoot.z * .09) * .66
          + sin(uPlantTime * 2.37 + aWindRoot.w * 6.28) * .22;
      }`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        mat3 pi = mat3(instanceMatrix);
        vec3 pn = pi * (objectNormal / vec3(dot(pi[0],pi[0]), dot(pi[1],pi[1]), dot(pi[2],pi[2])));
        float ph = max(0.0, (instanceMatrix * vec4(position,1.0)).y - aWindRoot.y);
        pn.y -= 2.0 * ph * plantGust() * dot(pn, vec3(.027,0.0,.018));
        objectNormal = transpose(pi) * pn;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float plantH = max(0.0, (instanceMatrix * vec4(position,1.0)).y - aWindRoot.y);
        vec3 plantBend = vec3(.027,0.0,.018) * plantH * plantH * plantGust();
        transformed += vec3(dot(instanceMatrix[0].xyz,plantBend) / dot(instanceMatrix[0].xyz,instanceMatrix[0].xyz),
          dot(instanceMatrix[1].xyz,plantBend) / dot(instanceMatrix[1].xyz,instanceMatrix[1].xyz),
          dot(instanceMatrix[2].xyz,plantBend) / dot(instanceMatrix[2].xyz,instanceMatrix[2].xyz));`);
  };
  mat.customProgramCacheKey = () => 'attachedPlantWind-v1';
  return mat;
}

function clayMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: .91, vertexColors: true });
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute float aPotSeed; varying float vPotSeed; varying vec3 vClay;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vPotSeed = aPotSeed; vClay = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying float vPotSeed; varying vec3 vClay;
      float clayHash(vec3 p) { return fract(sin(dot(p,vec3(41.7,127.1,93.8))) * 43758.5453); }
      float clayNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(clayHash(i),clayHash(i+vec3(1,0,0)),f.x),
          mix(clayHash(i+vec3(0,1,0)),clayHash(i+vec3(1,1,0)),f.x),f.y),
          mix(mix(clayHash(i+vec3(0,0,1)),clayHash(i+vec3(1,0,1)),f.x),
          mix(clayHash(i+vec3(0,1,1)),clayHash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float kiln = clayNoise(vClay * vec3(15.,8.,15.) + vPotSeed * 39.);
        float pores = clayNoise(vClay * 310. + vPotSeed * 71.);
        float salts = smoothstep(.49,.75,kiln) * (1. - smoothstep(.08,.24,vClay.y)) * (.12 + vPotSeed * .18);
        diffuseColor.rgb *= .87 + .20 * kiln + .09 * pores;
        diffuseColor.rgb = mix(diffuseColor.rgb,vec3(.43,.40,.34),salts);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float wheelResolve = 1. - smoothstep(.0004,.002,fwidth(vClay.y));
        float clayHeight = .00014 * sin(vClay.y * 1900. + kiln*2.) * wheelResolve + .00012 * pores;
        vec3 cx = dFdx(-vViewPosition), cy = dFdy(-vViewPosition);
        vec3 rx = cross(cy,normal), ry = cross(normal,cx);
        float determinant = dot(cx,rx);
        normal = normalize(abs(determinant)*normal - sign(determinant)
          * (dFdx(clayHeight)*rx + dFdy(clayHeight)*ry));`);
  };
  mat.customProgramCacheKey = () => 'firedClay-v1';
  return mat;
}

function colorGeometry(geo, c) {
  const a = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) a.set(c,i);
  geo.setAttribute('color', new THREE.BufferAttribute(a,3));
  return geo;
}

export function makePottedPlants(pots, skyAt, time) {
  const group = new THREE.Group(), growth = pots.map(growPot);
  const soil = new THREE.CylinderGeometry(.283,.281,.016,32);
  soil.translate(0,.33,0);
  const shell = potShellGeometry();
  const potGeo = mergeGeometries([colorGeometry(shell,[1,1,1]), colorGeometry(soil,[.18,.16,.125])]);
  const stemGeo = new THREE.CylinderGeometry(.70,1,1,5); stemGeo.translate(0,.5,0);
  const leafGeo = leafGeometry();
  const potMat = clayMaterial();
  const stemMat = windMaterial(new THREE.MeshStandardMaterial({ roughness: .94 }),time);
  const leafMat = windMaterial(new THREE.MeshStandardMaterial({ roughness: .81, side: THREE.DoubleSide,
    vertexColors: true, envMapIntensity: .5 }),time);
  const leafWind = leafMat.onBeforeCompile;
  leafMat.onBeforeCompile = (sh,renderer) => {
    leafWind(sh,renderer);
    // directLight.color already contains the light's shadow attenuation.
    // The thin lamina transmits a small part of backlighting; shaded leaves
    // receive no invented emissive fill and no unshadowed sunlight.
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
      void RE_Direct_Leaf(const in IncidentLight directLight, const in vec3 geometryPosition,
        const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal,
        const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
        RE_Direct_Physical(directLight,geometryPosition,geometryNormal,geometryViewDir,geometryClearcoatNormal,material,reflectedLight);
        float backNL = saturate(-dot(geometryNormal,directLight.direction));
        reflectedLight.directDiffuse += .18 * backNL * directLight.color * BRDF_Lambert(material.diffuseColor);
      }
      #undef RE_Direct
      #define RE_Direct RE_Direct_Leaf`);
  };
  leafMat.customProgramCacheKey = () => 'attachedPlantWind-v1|thinLeaf-v1';
  patchDetailShadows(leafMat,{twoSided:true});
  const batches = [
    new THREE.InstancedMesh(potGeo,potMat,pots.length),
    new THREE.InstancedMesh(stemGeo,stemMat,growth.reduce((n,g)=>n+g.stems.length,0)),
    new THREE.InstancedMesh(leafGeo,leafMat,growth.reduce((n,g)=>n+g.leaves.length,0)),
  ];
  const skies = batches.map(m=>new Float32Array(m.count));
  const roots = batches.map(m=>new Float32Array(m.count*4));
  const seeds = new Float32Array(pots.length);
  const m = new THREE.Matrix4(), parent = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  const scale = new THREE.Vector3(), p = new THREE.Vector3();
  let si = 0, li = 0;
  for (let i = 0; i < pots.length; i++) {
    const pot = pots[i], g = growth[i];
    q.setFromUnitVectors(UP,V(...(pot.up||[0,1,0])));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(UP,pot.seed*7));
    parent.compose(V(pot.x,pot.y,pot.z),q,V(pot.s,pot.s,pot.s));
    batches[0].setMatrixAt(i,parent);
    col.setHSL(.043 + (pot.seed-.5)*.017, .29 + pot.seed*.13, .37 + pot.seed*.105,THREE.SRGBColorSpace);
    batches[0].setColorAt(i,col);
    seeds[i] = pot.seed;
    skies[0][i] = skyAt(pot.x,pot.z,pot.y+.4,0,1,0);
    p.set(0,.34,0).applyMatrix4(parent);
    parent.setPosition(p);
    const windRoot = [p.x,p.y,p.z,pot.seed];
    for (const stem of g.stems) {
      const d = stem.b.clone().sub(stem.a);
      q.setFromUnitVectors(UP,d.clone().normalize());
      scale.set(stem.radius,d.length(),stem.radius);
      m.compose(stem.a,q,scale).premultiply(parent);
      batches[1].setMatrixAt(si,m);
      col.setHSL(.105,.23,.26 + pot.seed*.08,THREE.SRGBColorSpace);
      batches[1].setColorAt(si,col);
      skies[1][si] = skies[0][i]; roots[1].set(windRoot,si*4); si++;
    }
    for (const leaf of g.leaves) {
      q.setFromUnitVectors(UP,leaf.direction);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(UP,leaf.roll));
      scale.set(leaf.width,leaf.length,leaf.length);
      m.compose(leaf.base,q,scale).premultiply(parent);
      batches[2].setMatrixAt(li,m);
      if (leaf.bract) col.setHSL(.916 + leaf.age*.025,.47 + leaf.age*.15,.37 + leaf.age*.08,THREE.SRGBColorSpace);
      else col.setHSL(g.kind === 'herb' ? .255 : .282 + leaf.age*.035,.26 + leaf.age*.11,
        .22 + leaf.age*.11 + (g.kind === 'herb' ? .035 : 0),THREE.SRGBColorSpace);
      batches[2].setColorAt(li,col);
      p.copy(leaf.base).applyMatrix4(parent);
      skies[2][li] = skyAt(p.x,p.z,p.y,0,1,0);
      roots[2].set(windRoot,li*4); li++;
    }
  }
  potGeo.setAttribute('aPotSeed',new THREE.InstancedBufferAttribute(seeds,1));
  batches.forEach((mesh,i)=>{
    mesh.geometry.setAttribute('aSkyI',new THREE.InstancedBufferAttribute(skies[i],1));
    mesh.castShadow = mesh.receiveShadow = true;
    if (i > 0) {
      mesh.geometry.setAttribute('aWindRoot',new THREE.InstancedBufferAttribute(roots[i],4));
      mesh.customDepthMaterial = windMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),time);
    }
    patchSkyVisInstanced(mesh.material);
  });
  group.add(tagMesh(batches[0],'life.flowerPot',{ solid:true, groundContact:true, staticDetail:true }),
    tagMesh(batches[1],'life.plantStem',{ solid:true, small:true, noCollide:true, staticDetail:true }),
    // Even a subpixel leaf can cover one raster sample. Keep visible leaves
    // instead of dropping that sample at a hard distance threshold.
    tagMesh(batches[2],'life.foliage',{ thin:true, reason:'individual cupped leaf laminae', noCollide:true, staticDetail:true, lodMinPixels:0 }));
  return { group, growth };
}
