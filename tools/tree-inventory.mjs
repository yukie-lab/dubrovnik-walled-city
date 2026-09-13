// Instrument module loading in this Node process only. Do not change the
// live tree generator while a camera sweep is rendering another process.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {installDomShim} from './structure/domshim.mjs';
installDomShim();globalThis.__treeRows=[];globalThis.__treeActive=null;
const names=['aleppoPine','cypress','olive','maquis'];
const hook=registerHooks({load(url,context,next) {
  const result=next(url,context);
  if(url.endsWith('/src/woodland-leaves.js') && process.argv.includes('--anchors')) {
    globalThis.__leafAnchors={total:0,bad:0,maxGap:0};
    const source=String(result.source).replace('B.leaf(matrix,color.map(v=>v*shade));',`
      {const actual=new THREE.Vector3(0,-.5,0).applyMatrix4(matrix);
       const anchor=new THREE.Vector3(...start).lerp(new THREE.Vector3(...end),t);
       const error=actual.distanceTo(anchor),r=globalThis.__leafAnchors;r.total++;if(error>.001)r.bad++;r.maxGap=Math.max(r.maxGap,error);}
      B.leaf(matrix,color.map(v=>v*shade));`);
    return {...result,source};
  }
  if(!url.endsWith('/src/trees.js'))return result;
  let source=String(result.source);
  for(const name of names) {
    assert(source.includes(`export function ${name}(`),'Tree entry point must remain observable');
    source=source.replace(`export function ${name}(`,`function original_${name}(`);
    source+=`\nexport function ${name}(B,base,rnd,o={}) {
      const row={species:${JSON.stringify(name)},base:[...base],options:{...o},cards:0,tubes:0,root:null,phases:[]};
      globalThis.__treeActive=row;const start=B.tris;
      row.height=original_${name}(B,base,rnd,o);row.triangles=B.tris-start;
      row.root??=B.trees?.at(-1)?.roots?.[0]??null;
      globalThis.__treeRows.push(row);globalThis.__treeActive=null;return row.height;
    }\n`;
  }
  if(source.includes('function tuft(')) {
    source=source.replace('function tuft(','function original_tuft(');
    source+=`\nfunction tuft(...args) {const n=args[0].P.length,r=original_tuft(...args);
      if(globalThis.__treeActive)globalThis.__treeActive.cards+=(args[0].P.length-n)/18;return r;}\n`;
  }
  if(source.includes('function tube(')) {
    source=source.replace('function tube(','function original_tube(');
    source+=`\nfunction tube(B,path,rad,sway,sides,col,phase) {
      const row=globalThis.__treeActive;if(row){row.tubes++;row.root??=[...path[0]];row.phases.push(phase);}
      return original_tube(B,path,rad,sway,sides,col,phase);}\n`;
  }
  return {...result,source};
}});
const {buildWorld}=await import('../src/world.js');
const w=buildWorld({life:false,sky:false,sea:false});hook.deregister();
const leafAnchors=globalThis.__leafAnchors ? {...globalThis.__leafAnchors} : null;
const rows=globalThis.__treeRows,records=rows.map(({species,base,options,height})=>({species,base,options,height}));
const hash=value=>createHash('sha256').update(value).digest('hex');
const land=w.root.getObjectByName('surround.lokrum').geometry;
const landHash=hash(Buffer.from(land.attributes.position.array.buffer));
const actual={count:records.length,sha256:hash(JSON.stringify(records)),islandVertices:landHash};
const file=new URL('../docs/september-trees.json',import.meta.url);
if(process.argv.includes('--record')) {
  assert(!existsSync(file),'Never overwrite original vegetation or island records');
  writeFileSync(file,JSON.stringify(actual,null,2)+'\n');
}
assert.deepEqual(actual,JSON.parse(readFileSync(file,'utf8')),'Species, sites, heights, options and island landform must be preserved');
const batches=[];w.root.traverse(m=>{if(m.name==='surround.pine')batches.push({triangles:(m.geometry.index?.count||m.geometry.attributes.position.count)/3,
  vertices:m.geometry.attributes.position.count,closedParts:m.geometry.userData.closedParts?.length||0,
  customDepth:!!m.customDepthMaterial,castShadow:m.castShadow});});
const foliage=[];w.root.traverse(m=>{if(m.name==='surround.foliage')foliage.push({instances:m.count,
  trianglesPerInstance:m.geometry.index.count/3,verticesPerInstance:m.geometry.attributes.position.count,customDepth:!!m.customDepthMaterial});});
if(process.argv.includes('--strict')) {
  const {closedGeometry}=await import('./woodland-check.mjs');let checked=0;
  w.root.traverse(m=>{if(m.name==='surround.pine') {
    assert(m.geometry.index && m.geometry.userData.trees.length,'Indexed tree ranges');
    assert(m.customDepthMaterial,'Wind must be applied to tree shadows');
    closedGeometry(m.geometry);checked+=m.geometry.userData.closedParts.length;
    for(const t of m.geometry.userData.trees)assert.deepEqual(t.roots[0],t.base,'Every first wood ring is rooted at its designated site');
  }});
  console.log('Actual vegetation topology, wind material and roots passed:',checked,'closed parts');
}
const report={...actual,census:rows.reduce((r,t)=>(r[t.species]=(r[t.species]||0)+1,r),{}),batches,foliage,leafAnchors,
  cards:rows.reduce((s,r)=>s+r.cards,0),tubes:rows.reduce((s,r)=>s+r.tubes,0),
  displacedRoots:rows.filter(r=>r.root && Math.hypot(r.root[0]-r.base[0],r.root[2]-r.base[2])>.001).length,
  records};
writeFileSync(process.argv.find(a=>a.endsWith('.json'))||'shots/sept14-tree-inventory.json',JSON.stringify(report,null,2)+'\n');
const {records:omit,...summary}=report;console.log(JSON.stringify(summary));
if(leafAnchors)console.log('Leaf attachments',JSON.stringify(leafAnchors));
