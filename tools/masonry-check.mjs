import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {masonryFields} from '../src/masonry.js';
import {setWorldSeed,DEFAULT_SEED} from '../src/seed.js';

const digest=a=>createHash('sha256').update(a).digest('hex');
const options=[{}, {roughCut:1,stoneM:.52,salt:0x51a51},
  {coverM:5,courseM:.46,stoneM:1.4,tone:1,salt:0x51a54},
  {coverM:4.2,courseM:.4,stoneM:.90,fort:true,salt:0x51a55}];
setWorldSeed(DEFAULT_SEED);
for(const o of options) {
  const f=masonryFields(o),n=f.size;let seamStone=0,minHeight=Infinity,maxHeight=-Infinity,minRoughness=255;
  for(let y=0;y<n;y++)if(f.ids[y*n]===f.ids[y*n+n-1])seamStone++;
  assert(seamStone/n>.97,'A stone crossing the horizontal wrap must retain its identity');
  for(let i=0;i<f.ids.length;i++) {
    assert(f.ids[i]>0,'No uncovered pixels between generated courses');
    assert(f.color[i*4+3]===255 && f.normal[i*4+3]===255 && f.roughness[i*4+3]===255);
    const q=f.height[i];assert(Number.isFinite(q) && q>-.004 && q<.024,'Relief stays within masonry scale');
    minHeight=Math.min(minHeight,q);maxHeight=Math.max(maxHeight,q);minRoughness=Math.min(minRoughness,f.roughness[i*4+1]);
    const length=Math.hypot(...Array.from(f.normal.subarray(i*4,i*4+3),v=>v/255*2-1));
    assert(Math.abs(length-1)<.014,'Encoded physical normal has unit length within 8-bit precision');
  }
  assert(minRoughness>=.72*255-1,'Unglazed stone has no polished or plastic patches');
  // Generate another finish in between; no dependence on factory call order.
  masonryFields({size:64,salt:25});
  assert.equal(digest(f.color),digest(masonryFields(o).color));
  console.log(JSON.stringify({options:o,stones:f.stones.length,seamStone:seamStone/n,minHeight,maxHeight,minRoughness:minRoughness/255}));
}
