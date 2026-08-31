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
// _pattern.mjs — 2 枚の画の **模様だけ** を比べる。
//   node tools/_pattern.mjs 前.png 後.png [半径=24]
// 低周波(箱平均)を引いた残差どうしの相関を出す。色や明るさが変わっても
// 相関が 1 に近ければ **模様は同じ位置に貼りついている**。
const [pa, pb, R = 24] = process.argv.slice(2);
const A = readPNG(pa), B = readPNG(pb);
const W = A.w, H = A.h, r = Number(R);
const lum = (im) => { const o = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) { const k = i * im.ch;
    o[i] = 0.2126*s2l(im.px[k]/255)+0.7152*s2l(im.px[k+1]/255)+0.0722*s2l(im.px[k+2]/255); }
  return o; };
const box = (Y) => { const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let rs = 0;
    for (let x = 0; x < W; x++) { rs += Y[y*W+x]; I[(y+1)*(W+1)+x+1] = I[y*(W+1)+x+1] + rs; } }
  const out = new Float64Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const x0 = Math.max(0, x-r), y0 = Math.max(0, y-r), x1 = Math.min(W-1, x+r), y1 = Math.min(H-1, y+r);
    const s = I[(y1+1)*(W+1)+x1+1] - I[y0*(W+1)+x1+1] - I[(y1+1)*(W+1)+x0] + I[y0*(W+1)+x0];
    out[y*W+x] = s / ((x1-x0+1)*(y1-y0+1));
  }
  return out; };
const ya = lum(A), yb = lum(B);
const ra = box(ya), rb = box(yb);
// 空だけを見る(上半分かつ十分明るい所)
let n = 0, sa = 0, sb = 0;
const da = [], db = [];
for (let y = 0; y < H * 0.6; y++) for (let x = 0; x < W; x++) {
  const i = y*W+x; if (ya[i] < 0.02 || yb[i] < 0.02) continue;
  const u = ya[i] - ra[i], v = yb[i] - rb[i];
  da.push(u); db.push(v); sa += u; sb += v; n++;
}
if (!n) { console.log('比べる画素が無い'); process.exit(0); }
const ma = sa/n, mb = sb/n;
let cov = 0, va = 0, vb = 0;
for (let i = 0; i < n; i++) { const u = da[i]-ma, v = db[i]-mb; cov += u*v; va += u*u; vb += v*v; }
const cor = cov / Math.sqrt(va * vb || 1e-12);
console.log(`模様の相関 ${cor.toFixed(3)}   残差の強さ ${Math.sqrt(va/n).toFixed(5)} / ${Math.sqrt(vb/n).toFixed(5)}   標本 ${n}`);
