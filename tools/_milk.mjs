// 「無彩の白」の割合 — Y>0.75 かつ彩度<0.06。批評家が問題にしたのは
// 明るいことではなく、**色の無い乳白のベール**だった。明部率とは別に測る。
import zlib from 'node:zlib'; import { readFileSync } from 'node:fs';
function readPNG(path){const d=readFileSync(path);let i=8,w=0,h=0,bd=0,ct=0,idat=[];
 while(i<d.length){const ln=d.readUInt32BE(i),typ=d.toString('ascii',i+4,i+8);
  const data=d.subarray(i+8,i+8+ln);i+=12+ln;
  if(typ==='IHDR'){w=data.readUInt32BE(0);h=data.readUInt32BE(4);bd=data[8];ct=data[9];}
  else if(typ==='IDAT')idat.push(data); else if(typ==='IEND')break;}
 const raw=zlib.inflateSync(Buffer.concat(idat));const ch={0:1,2:3,4:2,6:4}[ct];
 const bpp=ch*(bd/8),stride=w*bpp;const out=Buffer.alloc(h*stride);let prev=Buffer.alloc(stride),p=0;
 for(let y=0;y<h;y++){const f=raw[p];p++;const line=Buffer.from(raw.subarray(p,p+stride));p+=stride;
  if(f===1)for(let x=bpp;x<stride;x++)line[x]=(line[x]+line[x-bpp])&255;
  else if(f===2)for(let x=0;x<stride;x++)line[x]=(line[x]+prev[x])&255;
  else if(f===3)for(let x=0;x<stride;x++)line[x]=(line[x]+(((x>=bpp?line[x-bpp]:0)+prev[x])>>1))&255;
  else if(f===4)for(let x=0;x<stride;x++){const a=x>=bpp?line[x-bpp]:0,b=prev[x],c=x>=bpp?prev[x-bpp]:0;
   const pp=a+b-c,pa=Math.abs(pp-a),pb=Math.abs(pp-b),pc=Math.abs(pp-c);
   line[x]=(line[x]+(pa<=pb&&pa<=pc?a:pb<=pc?b:c))&255;}
  line.copy(out,y*stride);prev=line;}
 return {w,h,ch,px:out};}
const s2l=v=>(v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
for(const path of process.argv.slice(2)){
 const {w,h,ch,px}=readPNG(path);let n=0,milk=0,brightCol=0;
 for(let y=0;y<h;y+=2)for(let x=0;x<w;x+=2){const o=(y*w+x)*ch;
  const r=px[o]/255,g=px[o+1]/255,b=px[o+2]/255;
  const Y=0.2126*s2l(r)+0.7152*s2l(g)+0.0722*s2l(b);
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b),S=mx>0?(mx-mn)/mx:0;
  n++; if(Y>0.75&&S<0.06)milk++; if(Y>0.75&&S>=0.06)brightCol++;}
 console.log(`${path.split('/').pop().replace('.png','').padEnd(24)} 無彩の白 ${(100*milk/n).toFixed(2)}%   色のある明部 ${(100*brightCol/n).toFixed(2)}%`);}
