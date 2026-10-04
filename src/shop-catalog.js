import {hash2} from './util.js';

// Indices follow the icons drawn in tex.js (canvas rows, top to bottom).
export const SHOP_TRADES=['bakery','locksmith','tailor','fishmonger','wine','apothecary','cobbler','barber','boutique','fruit'];
export const SHOP_ICONS=['bread','key','scissors','fish','bottle','mortar','shoe','comb','handbag','fruit'];
export const SHOP_SIGN_ATLAS={columns:4,rows:3};
export function shopTrade(shop) {
  // Allocate the two additions independently, keeping the original trade for
  // the remaining storefronts rather than reshuffling the entire street.
  const addition=hash2((shop.x*71)|0,(shop.z*67)|0);
  if(addition<.10)return 8;
  if(addition<.20)return 9;
  // The original eight signs used a CanvasTexture with two flipped rows.
  return ((hash2((shop.x*53)|0,(shop.z*47)|0)*8)|0)^4;
}
export function shopSignUV(trade) {
  const {columns,rows}=SHOP_SIGN_ATLAS;
  return [(trade%columns)/columns,(rows-1-Math.floor(trade/columns))/rows];
}
export function hasShopSign(shop) {return hash2((shop.x*31)|0,(shop.z*29)|0)<.62;}
