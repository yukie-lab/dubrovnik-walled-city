import {inflateSync} from 'node:zlib';

export function pngPixels(d) {
  let i=8,w=0,h=0,depth=0,type=0,idat=[];
  while(i<d.length) {
    const n=d.readUInt32BE(i),tag=d.toString('ascii',i+4,i+8),data=d.subarray(i+8,i+8+n);i+=12+n;
    if(tag==='IHDR'){w=data.readUInt32BE(0);h=data.readUInt32BE(4);depth=data[8];type=data[9];}
    else if(tag==='IDAT')idat.push(data);else if(tag==='IEND')break;
  }
  if(depth!==8||![2,6].includes(type))throw new Error('Expected 8-bit RGB/RGBA PNG');
  const channels=type===2?3:4,stride=w*channels,raw=inflateSync(Buffer.concat(idat)),pixels=Buffer.alloc(h*stride);
  let previous=Buffer.alloc(stride),p=0;
  for(let y=0;y<h;y++) {
    const filter=raw[p++],line=Buffer.from(raw.subarray(p,p+stride));p+=stride;
    for(let x=0;x<stride;x++) {
      const a=x>=channels?line[x-channels]:0,b=previous[x],c=x>=channels?previous[x-channels]:0;
      let prediction=0;
      if(filter===1)prediction=a;else if(filter===2)prediction=b;else if(filter===3)prediction=(a+b)>>1;
      else if(filter===4) {const q=a+b-c,pa=Math.abs(q-a),pb=Math.abs(q-b),pc=Math.abs(q-c);prediction=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
      line[x]=(line[x]+prediction)&255;
    }
    line.copy(pixels,y*stride);previous=line;
  }
  return {width:w,height:h,channels,pixels};
}

const linear=Float64Array.from({length:256},(_,v)=>v<=10?v/255/12.92:((v/255+.055)/1.055)**2.4);
const encode=v=>v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055;
function inside(x,y,polygon) {
  let hit=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[i],b=polygon[j];
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }
  return hit;
}
export function regionColours(png,polygons) {
  const {width,channels,pixels}=pngPixels(png),result={};
  for(const [name,polygon]of Object.entries(polygons)) {
    const lo=[0,1].map(k=>Math.floor(Math.min(...polygon.map(p=>p[k]))));
    const hi=[0,1].map(k=>Math.ceil(Math.max(...polygon.map(p=>p[k]))));
    const sum=[0,0,0];let count=0;
    for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++)if(inside(x+.5,y+.5,polygon)) {
      const offset=(y*width+x)*channels;count++;
      for(let k=0;k<3;k++)sum[k]+=linear[pixels[offset+k]];
    }
    const rgb=sum.map(v=>encode(v/count)),max=Math.max(...rgb),min=Math.min(...rgb),d=max-min,l=(min+max)*.5;
    let h=0;if(d)h=(max===rgb[0]?(rgb[1]-rgb[2])/d+(rgb[1]<rgb[2]?6:0):max===rgb[1]?(rgb[2]-rgb[0])/d+2:(rgb[0]-rgb[1])/d+4)*60;
    result[name]={rgb:rgb.map(v=>v*255),hue:h,saturation:d?d/(1-Math.abs(2*l-1))*100:0,lightness:l*100};
  }
  return result;
}
