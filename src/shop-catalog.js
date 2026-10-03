import {hash2} from './util.js';

// Indices follow the icons drawn in tex.js (canvas rows, top to bottom).
export const SHOP_TRADES=['bakery','locksmith','tailor','fishmonger','wine','apothecary','cobbler','barber'];
export const SHOP_ICONS=['bread','key','scissors','fish','bottle','mortar','shoe','comb'];
export function shopTrade(shop) {
  // Preserve every existing sign: CanvasTexture flips the two atlas rows.
  return ((hash2((shop.x*53)|0,(shop.z*47)|0)*8)|0)^4;
}
export function shopSignUV(trade) {return [(trade%4)*.25,(1-Math.floor(trade/4))*.5];}
export function hasShopSign(shop) {return hash2((shop.x*31)|0,(shop.z*29)|0)<.62;}
