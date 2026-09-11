// Conservative occlusion by the closed, rectangular part of each house body.
// Gables, ornaments and towers are excluded. No inferred skyline or geography
// enters this index. Eroding a solid by the detail's bounding radius guarantees
// coverage of the entire detail rather than just a ray to its centre.
export function makeHouseOcclusion(houses) {
  const cellSize=8,boxes=new Float64Array(houses.length*6);
  const minX=Math.floor(Math.min(...houses.map(h=>h.x-h.w/2))/cellSize);
  const minZ=Math.floor(Math.min(...houses.map(h=>h.z-h.d/2))/cellSize);
  const width=Math.floor(Math.max(...houses.map(h=>h.x+h.w/2))/cellSize)-minX+1;
  const depth=Math.floor(Math.max(...houses.map(h=>h.z+h.d/2))/cellSize)-minZ+1;
  const cells=Array.from({length:width*depth},()=>[]),empty=[];
  const seen=new Int32Array(houses.length);
  let stamp=0;
  houses.forEach((h,i)=>{
    const x0=h.x-h.w/2,x1=h.x+h.w/2,z0=h.z-h.d/2,z1=h.z+h.d/2;
    boxes.set([x0,x1,h.yBase,h.eaves,z0,z1],i*6);
    for(let z=Math.floor(z0/cellSize);z<=Math.floor(z1/cellSize);z++)
      for(let x=Math.floor(x0/cellSize);x<=Math.floor(x1/cellSize);x++) {
        cells[(z-minZ)*width+x-minX].push(i);
      }
  });
  function blocked(ox,oy,oz,x,y,z,radius) {
    const dx=x-ox,dy=y-oy,dz=z-oz,length=Math.hypot(dx,dy,dz);
    if(length<=radius*2)return false;
    const maxT=1-radius/length;
    // Clip long shadow rays to the city index before traversing it. Empty
    // kilometres above/outside the city have no possible occluders.
    let firstT=0,lastT=maxT;
    for(let axis=0;axis<2;axis++) {
      const origin=axis===0 ? ox : oz,delta=axis===0 ? dx : dz;
      const lo=(axis===0 ? minX : minZ)*cellSize,hi=lo+(axis===0 ? width : depth)*cellSize;
      if(Math.abs(delta)<1e-12) {if(origin<lo || origin>hi)return false;}
      else {const a=(lo-origin)/delta,b=(hi-origin)/delta;firstT=Math.max(firstT,Math.min(a,b));lastT=Math.min(lastT,Math.max(a,b));}
    }
    if(firstT>lastT)return false;
    if(++stamp===2147483647){seen.fill(0);stamp=1;}
    let ix=Math.max(minX,Math.min(minX+width-1,Math.floor((ox+dx*firstT)/cellSize)));
    let iz=Math.max(minZ,Math.min(minZ+depth-1,Math.floor((oz+dz*firstT)/cellSize)));
    const ex=Math.floor((ox+dx*lastT)/cellSize),ez=Math.floor((oz+dz*lastT)/cellSize);
    const sx=Math.sign(dx),sz=Math.sign(dz);
    let tx=dx===0 ? Infinity : ((ix+(sx>0 ? 1 : 0))*cellSize-ox)/dx;
    let tz=dz===0 ? Infinity : ((iz+(sz>0 ? 1 : 0))*cellSize-oz)/dz;
    const dtX=dx===0 ? Infinity : cellSize/Math.abs(dx),dtZ=dz===0 ? Infinity : cellSize/Math.abs(dz);
    const count=Math.abs(ex-ix)+Math.abs(ez-iz)+2;
    for(let cell=0;cell<count;cell++) {
      const bucket=ix>=minX && ix<minX+width && iz>=minZ && iz<minZ+depth ? cells[(iz-minZ)*width+ix-minX] : empty;
      for(const id of bucket) {
        if(seen[id]===stamp)continue;
        seen[id]=stamp;
        const o=id*6;
        if(boxes[o+1]-boxes[o]<=2*radius || boxes[o+3]-boxes[o+2]<=2*radius || boxes[o+5]-boxes[o+4]<=2*radius)continue;
        // Inside/near a solid, front-face culling is not a reliable occluder.
        if(ox>=boxes[o]-radius && ox<=boxes[o+1]+radius && oy>=boxes[o+2]-radius
          && oy<=boxes[o+3]+radius && oz>=boxes[o+4]-radius && oz<=boxes[o+5]+radius)continue;
        let enter=0,leave=maxT;
        for(let axis=0;axis<3;axis++) {
          const origin=axis===0 ? ox : axis===1 ? oy : oz;
          const delta=axis===0 ? dx : axis===1 ? dy : dz;
          const lo=boxes[o+axis*2]+radius,hi=boxes[o+axis*2+1]-radius;
          if(Math.abs(delta)<1e-12) {
            if(origin<lo || origin>hi){leave=-1;break;}
          }else {
            const a=(lo-origin)/delta,b=(hi-origin)/delta;
            enter=Math.max(enter,Math.min(a,b));leave=Math.min(leave,Math.max(a,b));
            if(leave<enter)break;
          }
        }
        if(leave>=enter && enter>0 && enter<maxT)return true;
      }
      if(ix===ex && iz===ez)break;
      if(tx<tz){if(tx>lastT)break;ix+=sx;tx+=dtX;}
      else {if(tz>lastT)break;iz+=sz;tz+=dtZ;}
    }
    return false;
  }
  return {blocked};
}
