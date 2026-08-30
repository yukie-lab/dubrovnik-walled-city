// 第6パスの保護値「厚 0.9m 未満の板」と、家並みの高さの分布を plan だけで数える。
// three を通さないので速い(GPU 不要)。変種を当てた前後で比べる。
import { buildPlan } from '../src/plan.js';
const plan = buildPlan();
const hs = plan.houses;
const slabs = hs.filter(h => Math.min(h.w, h.d) < 0.9);
const len = slabs.reduce((a, h) => a + Math.max(h.w, h.d), 0);
const gardens = hs.filter(h => h.garden);
const north2 = hs.filter(h => h.z <= -37.8 && h.z >= -72.4);
const q = (arr, f) => { const v = arr.slice().sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor(f * v.length))]; };
const hgt = h => h.eaves - h.yBase;
console.log(`家 ${hs.length} 軒  うち庭 ${gardens.length}`);
console.log(`厚 0.9m 未満の板 ${slabs.length} 枚 / 総延長 ${len.toFixed(0)}m`);
console.log(`全体の軒高(地盤から) 中央値 ${q(hs.map(hgt), 0.5).toFixed(2)}m  p90 ${q(hs.map(hgt), 0.9).toFixed(2)}m  最大 ${Math.max(...hs.map(hgt)).toFixed(2)}m`);
console.log(`北の第2帯 ${north2.length} 軒  軒高 中央値 ${q(north2.map(hgt), 0.5).toFixed(2)}m  最大 ${Math.max(...north2.map(hgt)).toFixed(2)}m  庭 ${north2.filter(h => h.garden).length}`);
console.log(`絶対高 eaves 中央値 ${q(hs.map(h => h.eaves), 0.5).toFixed(2)}m  最大 ${Math.max(...hs.map(h => h.eaves)).toFixed(2)}m`);
