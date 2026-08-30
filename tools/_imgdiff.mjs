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
// _imgdiff.mjs — 2 枚の PNG の差を「どこが・どれだけ」で出す。
//   node tools/_imgdiff.mjs 前.png 後.png
// 変化が一点に集まっていれば直接の変更、画面全体に薄く広がっていれば
// ブルームや露出のような **画面全体を通る経路** が犯人。目では区別できない。
const [pa, pb] = process.argv.slice(2);
const A = readPNG(pa), B = readPNG(pb);
if (A.w !== B.w || A.h !== B.h) { console.error('寸法が違う'); process.exit(1); }
const GX = 8, GY = 6;
const g = Array.from({ length: GY }, () => new Array(GX).fill(0));
const gn = Array.from({ length: GY }, () => new Array(GX).fill(0));
let n = 0, chg = 0, sum = 0, mx = 0, mxAt = '';
for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
  const o = (y * A.w + x) * A.ch;
  const ya = 0.2126*s2l(A.px[o]/255)+0.7152*s2l(A.px[o+1]/255)+0.0722*s2l(A.px[o+2]/255);
  const yb = 0.2126*s2l(B.px[o]/255)+0.7152*s2l(B.px[o+1]/255)+0.0722*s2l(B.px[o+2]/255);
  const d = yb - ya, ad = Math.abs(d);
  n++; sum += d;
  if (Math.max(Math.abs(A.px[o]-B.px[o]), Math.abs(A.px[o+1]-B.px[o+1]), Math.abs(A.px[o+2]-B.px[o+2])) > 1) chg++;
  if (ad > mx) { mx = ad; mxAt = x + ',' + y; }
  const gy = Math.min(GY-1, (y * GY / A.h) | 0), gx = Math.min(GX-1, (x * GX / A.w) | 0);
  g[gy][gx] += d; gn[gy][gx]++;
}
console.log(`変化した画素 ${(100*chg/n).toFixed(2)}%   平均ΔY ${(sum/n).toFixed(5)}   最大|ΔY| ${mx.toFixed(4)} @${mxAt}`);
console.log('# 画面を 8×6 に割った平均ΔY(×1000)');
for (let j = 0; j < GY; j++) console.log('  ' + g[j].map((s,i)=>String(Math.round(1000*s/gn[j][i])).padStart(6)).join(''));
