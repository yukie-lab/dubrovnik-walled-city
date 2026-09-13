import * as THREE from 'three';

// Indexed, closed tree components. A chunk is still one mesh; these builders
// never create a Mesh per branch, leaf or plant. Trees retain individual
// ranges and a shared wind field for later view/shadow selection.
export class WoodlandBuffer {
  constructor() {
    this.P=[];this.N=[];this.C=[];this.U=[];this.W=[];this.L=[];this.G=[];this.I=[];
    this.tris=0;this.trees=[];this.closedParts=[];this.current=null;
    this.FM=[];this.FC=[];this.FT=[];
  }
  begin(base,height,phase,strength=1) {
    if(this.current)throw new Error('Finish the previous tree');
    this.current={base:[...base],height,phase,strength,from:this.tris,leafFrom:this.FM.length/16,mainRanges:[],fineRanges:[],fineDiameter:0};
  }
  leaf(matrix,color) {
    const t=this.current;if(!t)throw new Error('Begin a tree before adding foliage');
    for(const v of matrix.elements)this.FM.push(v);
    this.FC.push(...color);this.FT.push(t.base[1],1/t.height,t.phase,t.strength);
  }
  append(g,color,leaf=0,fineDiameter=0) {
    if(!this.current)throw new Error('Begin a tree before adding its wood');
    const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv,co=g.attributes.color;
    const offset=this.P.length/3,t=this.current,start=this.tris;
    for(let i=0;i<p.count;i++) {
      this.P.push(p.getX(i),p.getY(i),p.getZ(i));this.N.push(n.getX(i),n.getY(i),n.getZ(i));
      this.U.push(uv ? uv.getX(i) : 0,uv ? uv.getY(i) : 0);
      const angle=(uv ? uv.getX(i) : 0)*Math.PI*2;
      this.G.push(Math.cos(angle),Math.sin(angle),uv ? uv.getY(i) : 0);
      this.C.push(color[0]*(co ? co.getX(i) : 1),color[1]*(co ? co.getY(i) : 1),color[2]*(co ? co.getZ(i) : 1));
      this.W.push(t.base[1],1/t.height,t.phase,t.strength);this.L.push(leaf);
    }
    const count=g.index?.count||p.count;
    for(let i=0;i<count;i++)this.I.push(offset+(g.index ? g.index.getX(i) : i));
    this.tris+=count/3;this.closedParts.push({from:start,to:this.tris});
    const ranges=fineDiameter ? t.fineRanges : t.mainRanges,last=ranges.at(-1);
    if(last?.to===start)last.to=this.tris;else ranges.push({from:start,to:this.tris});
    t.fineDiameter=Math.max(t.fineDiameter,fineDiameter);g.dispose();
  }
  end() {
    const t=this.current;if(!t)throw new Error('No current tree');
    this.trees.push({...t,to:this.tris,leafTo:this.FM.length/16});this.current=null;
  }
  absorb(B) {
    if(this.current || B.current)throw new Error('Only completed tree chunks can merge');
    const offset=this.P.length/3,tri=this.tris,leaf=this.FM.length/16;
    for(const key of ['P','N','C','U','W','L','G','FM','FC','FT'])for(const v of B[key])this[key].push(v);
    for(const i of B.I)this.I.push(i+offset);
    for(const t of B.trees)this.trees.push({...t,from:t.from+tri,to:t.to+tri,leafFrom:t.leafFrom+leaf,leafTo:t.leafTo+leaf,
      mainRanges:t.mainRanges.map(r=>({from:r.from+tri,to:r.to+tri})),fineRanges:t.fineRanges.map(r=>({from:r.from+tri,to:r.to+tri}))});
    for(const p of B.closedParts)this.closedParts.push({from:p.from+tri,to:p.to+tri});this.tris+=B.tris;
  }
  geometry() {
    if(this.current)throw new Error('An unfinished tree cannot be batched');
    const g=new THREE.BufferGeometry();
    for(const [name,data,size] of [['position',this.P,3],['normal',this.N,3],['color',this.C,3],
      ['uv',this.U,2],['aTree',this.W,4],['aLeaf',this.L,1],['aGrain',this.G,3]])g.setAttribute(name,new THREE.Float32BufferAttribute(data,size));
    g.setIndex(this.I);g.userData.trees=this.trees;g.userData.closedParts=this.closedParts;
    g.computeBoundingBox();g.computeBoundingSphere();return g;
  }
}

function geometry(p,uv,indices,shade) {
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  const c=[];for(const s of shade)c.push(s,s,s);g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));
  g.setIndex(indices);g.computeVertexNormals();return g;
}

// Parallel-transported rings avoid rotating or flattening a branch at each
// bend. Caps share the actual perimeter positions and close every cut end.
export function woodStem(path,radii,{sides=6,phase=0}={}) {
  const p=[],uv=[],ix=[],shade=[],points=path.map(v=>new THREE.Vector3(...v));
  let tangent=new THREE.Vector3(),axis=new THREE.Vector3(0,0,1),total=0;
  for(let j=0;j<points.length;j++) {
    tangent.copy(points[Math.min(j+1,points.length-1)]).sub(points[Math.max(0,j-1)]).normalize();
    axis.addScaledVector(tangent,-axis.dot(tangent));
    if(axis.lengthSq()<1e-8)axis.set(1,0,0).addScaledVector(tangent,-tangent.x);
    axis.normalize();const b=new THREE.Vector3().crossVectors(tangent,axis).normalize();
    if(j)total+=points[j].distanceTo(points[j-1]);
    for(let i=0;i<sides;i++) {
      const a=i/sides*Math.PI*2,r=radii[j]*(1+.075*Math.sin(i*2.8+phase*9));
      const v=points[j].clone().addScaledVector(axis,Math.cos(a)*r).addScaledVector(b,Math.sin(a)*r);
      p.push(...v.toArray());uv.push(i/sides,total);
      shade.push(.80+.18*Math.sin(i*2.7+phase*9)**2);
    }
  }
  for(let j=0;j<points.length-1;j++)for(let i=0;i<sides;i++) {
    const a=j*sides+i,b=j*sides+(i+1)%sides,c=a+sides,d=b+sides;
    ix.push(a,b,c,b,d,c);
  }
  for(const j of [0,points.length-1]) {
    const c=p.length/3;p.push(...points[j].toArray());uv.push(.5,j ? total : 0);shade.push(.8);
    for(let i=0;i<sides;i++) {
      const a=j*sides+i,b=j*sides+(i+1)%sides;
      if(j)ix.push(c,a,b);else ix.push(c,b,a);
    }
  }
  return geometry(p,uv,ix,shade);
}

// A small irregular foliage volume with a coarse interior and a lobed edge.
// Its surface occupies three dimensions at every camera angle. The rings are
// shared, so a crown carries fewer vertices than the old overlapping cards.
export function foliageLobe(at,radii,rnd,{sides=8,rings=4}={}) {
  const p=[],uv=[],ix=[],shade=[],phase=rnd()*Math.PI*2,twist=(rnd()-.5)*.4;
  const [rx,ry,rz]=radii;
  for(let j=0;j<rings;j++) {
    const y=-.80+j/(rings-1)*1.63,r=Math.sqrt(1-y*y);
    for(let i=0;i<sides;i++) {
      const a=i/sides*Math.PI*2,angle=a+twist*y;
      const lobe=1+.13*Math.sin(a*3+phase)+.065*Math.cos(a*5-phase+j*.7);
      p.push(at[0]+Math.sin(angle)*rx*r*lobe,
        at[1]+(y+.035*Math.sin(a*3-phase))*ry,
        at[2]+Math.cos(angle)*rz*r*lobe);
      uv.push(i/sides,j/(rings-1));shade.push(.82+.16*(y+1)*.5+.06*Math.sin(a*3+phase+j));
    }
  }
  for(let j=0;j<rings-1;j++)for(let i=0;i<sides;i++) {
    const a=j*sides+i,b=j*sides+(i+1)%sides,c=a+sides,d=b+sides;
    ix.push(a,b,c,b,d,c);
  }
  for(const end of [0,1]) {
    const c=p.length/3;p.push(at[0],at[1]+(end ? 1 : -1)*ry,at[2]);uv.push(.5,end);shade.push(end ? 1 : .8);
    for(let i=0;i<sides;i++) {
      const a=(end ? rings-1 : 0)*sides+i,b=(end ? rings-1 : 0)*sides+(i+1)%sides;
      if(end)ix.push(c,a,b);else ix.push(c,b,a);
    }
  }
  return geometry(p,uv,ix,shade);
}
