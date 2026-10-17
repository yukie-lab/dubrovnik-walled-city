import {hash2,mulberry32} from './util.js';

// Indices follow the icons drawn in tex.js (canvas rows, top to bottom).
export const SHOP_TRADES=['bakery','locksmith','tailor','fishmonger','wine','apothecary','cobbler','barber','boutique','fruit','bookshop','souvenirs','cheese',
  'hatter','miller','tableware','vases','gallery','ties','jeweller','candlemaker','gelato','music','nautical'];
export const SHOP_ICONS=['bread','key','scissors','fish','bottle','mortar','shoe','comb','handbag','fruit','book','doll','cheese',
  'hat','wheat','plate','vase','frame','tie','ring','candle','cone','lijerica','anchor'];
// cellAspect = cell height / width, so that a cell drawn square lands square
// on the 0.52 × 0.30 m board face (buildings.js maps u to 88 %, v to 92 %).
export const SHOP_SIGN_ATLAS={columns:4,rows:6,cellAspect:.88*.30/(.92*.52)};
// When the shop count is not a multiple of the trade count, the remainder
// goes to these trades in turn (souvenir shops are the commonest on Stradun).
const EXTRA_TRADES=['souvenirs','gelato','bookshop'];
// Windows that read alike from the street should not stand side by side.
const ALIKE=[['tableware','vases'],['cobbler','boutique'],['bakery','miller'],['bakery','cheese'],['miller','cheese'],
  ['wine','apothecary'],['apothecary','barber'],['tailor','ties'],['bookshop','gallery']];

export function hasShopSign(shop) {return hash2((shop.x*31)|0,(shop.z*29)|0)<.62;}

// Deal every trade across the whole street instead of carving each new batch
// out of the older trades. Shops sorted along the street form consecutive
// blocks that each hold every trade once, so a trade recurs once per stretch
// of street. A seeded swap search inside each block then evens out street
// sides and hanging signs, keeps equal or look-alike windows apart, and lets
// any two trades meet as neighbours only once — otherwise the best spacing is
// one sequence stamped block after block. The result depends only on the
// shop positions, so signs and shelves always agree.
export function assignShopTrades(shops) {
  const T=SHOP_TRADES.length,n=shops.length;
  const order=shops.map((_,i)=>i).sort((a,b)=>shops[a].x-shops[b].x||shops[a].z-shops[b].z);
  const blocks=Math.max(1,Math.floor(n/T)),bounds=[];
  const trade=new Int32Array(n);
  for(let b=0;b<blocks;b++) {
    const from=Math.floor(b*n/blocks),to=Math.floor((b+1)*n/blocks);
    bounds.push([from,to]);
    for(let j=from;j<to;j++) {
      const slot=j-from;
      trade[order[j]]=slot<T?slot:SHOP_TRADES.indexOf(EXTRA_TRADES[(slot-T)%EXTRA_TRADES.length]);
    }
  }
  // Street side = facing direction; a sign either hangs or it does not.
  const side=shops.map(s=>Math.cos(s.rotY)<0?1:0),signed=shops.map(hasShopSign);
  const count=new Int32Array(T),signs=new Int32Array(T),far=new Int32Array(T);
  const members=Array.from({length:T},()=>[]);
  for(let i=0;i<n;i++){count[trade[i]]++;signs[trade[i]]+=signed[i];far[trade[i]]+=side[i];members[trade[i]].push(i);}
  const signTotal=signed.reduce((a,b)=>a+b,0),farTotal=side.reduce((a,b)=>a+b,0);
  const fewestSigns=Math.floor(signTotal/T),mostSigns=Math.ceil(signTotal/T);
  const countTerm=t=>1000*(Math.max(0,fewestSigns-signs[t])+Math.max(0,signs[t]-mostSigns))
    +40*(far[t]-farTotal*count[t]/n)**2;
  // Same-trade windows closer than ~60 % of a block's length repel; beyond
  // that, spacing earns nothing (rewarding it would favour a fixed period).
  const reach=.6*((shops[order[n-1]].x-shops[order[0]].x)/blocks||1);
  const near=new Float64Array(n*n);
  for(let i=0;i<n;i++)for(let j=0;j<n;j++)if(i!==j) {
    const d2=(shops[i].x-shops[j].x)**2+(shops[i].z-shops[j].z)**2;
    near[i*n+j]=5*Math.max(0,reach*reach/Math.max(d2,1)-1);
  }
  const nearBy=(i)=>{let e=0;for(const j of members[trade[i]])if(j!==i)e+=near[i*n+j];return e;};
  // Neighbours: next door on the same side, or straight across the street.
  const rel=[];
  for(const s of [0,1]) {
    const row=order.filter(i=>side[i]===s);
    for(let k=1;k<row.length;k++)rel.push([row[k-1],row[k]]);
  }
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)
    if(side[i]!==side[j]&&Math.abs(shops[i].x-shops[j].x)<3.5)rel.push([i,j]);
  const relOf=Array.from({length:n},()=>[]);
  rel.forEach(([i,j],r)=>{relOf[i].push(r);relOf[j].push(r);});
  const alike=new Float64Array(T*T);
  for(const [a,b] of ALIKE) {
    const i=SHOP_TRADES.indexOf(a),j=SHOP_TRADES.indexOf(b);
    alike[i*T+j]=alike[j*T+i]=10;
  }
  for(let t=0;t<T;t++)alike[t*T+t]=50;
  // Adds (+1) or removes (-1) one neighbour relation; returns the energy change.
  const met=new Int32Array(T*T);
  const meet=(r,d)=>{
    const A=trade[rel[r][0]],B=trade[rel[r][1]],k=A<B?A*T+B:B*T+A;
    const repeat=Math.max(0,met[k]-1);met[k]+=d;
    return 10*(Math.max(0,met[k]-1)-repeat)+d*alike[A*T+B];
  };
  for(let r=0;r<rel.length;r++)meet(r,1);
  const swap=(a,b)=>{
    const A=trade[a],B=trade[b];
    members[A][members[A].indexOf(a)]=b;members[B][members[B].indexOf(b)]=a;
    signs[A]+=signed[b]-signed[a];signs[B]+=signed[a]-signed[b];
    far[A]+=side[b]-side[a];far[B]+=side[a]-side[b];
    trade[a]=B;trade[b]=A;
  };
  const random=mulberry32(0x5172ad),touched=[];
  const steps=60000,cold=.002,cooling=Math.pow(cold/4,1/steps);
  for(let step=0,temperature=4;step<steps;step++,temperature*=cooling) {
    const [from,to]=bounds[Math.floor(random()*blocks)];
    const a=order[from+Math.floor(random()*(to-from))],b=order[from+Math.floor(random()*(to-from))];
    if(trade[a]===trade[b])continue;
    const A=trade[a],B=trade[b];
    touched.length=0;
    for(const r of relOf[a])touched.push(r);
    for(const r of relOf[b])if(!relOf[a].includes(r))touched.push(r);
    let change=-(nearBy(a)+nearBy(b)+countTerm(A)+countTerm(B));
    for(const r of touched)change+=meet(r,-1);
    swap(a,b);
    for(const r of touched)change+=meet(r,1);
    change+=nearBy(a)+nearBy(b)+countTerm(A)+countTerm(B);
    if(change>0&&random()>=Math.exp(-change/temperature)) {
      for(const r of touched)meet(r,-1);
      swap(a,b);
      for(const r of touched)meet(r,1);
    }
  }
  shops.forEach((shop,i)=>{shop.trade=trade[i];});
  return shops;
}
export function shopTrade(shop) {
  if(shop.trade===undefined)throw new Error('assignShopTrades() must run before shopTrade()');
  return shop.trade;
}
export function shopSignUV(trade) {
  const {columns,rows}=SHOP_SIGN_ATLAS;
  return [(trade%columns)/columns,(rows-1-Math.floor(trade/columns))/rows];
}
