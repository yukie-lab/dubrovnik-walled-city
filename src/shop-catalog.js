import {hash2} from './util.js';

// Indices follow the icons drawn in tex.js (canvas rows, top to bottom).
export const SHOP_TRADES=['bakery','locksmith','tailor','fishmonger','wine','apothecary','cobbler','barber','boutique','fruit','bookshop','souvenirs','cheese'];
export const SHOP_ICONS=['bread','key','scissors','fish','bottle','mortar','shoe','comb','handbag','fruit','book','doll','cheese'];
export const SHOP_SIGN_ATLAS={columns:4,rows:4};
export function shopTrade(shop) {
  // Allocate the two additions independently, keeping the original trade for
  // the remaining storefronts rather than reshuffling the entire street.
  const addition=hash2((shop.x*71)|0,(shop.z*67)|0);
  if(addition<.10)return 8;
  if(addition<.20)return 9;
  // Retain the recently added boutique/fruit shops. Allocate the next three
  // trades among the older shops using an independent, stable coordinate hash.
  const culture=hash2((shop.x*89)|0,(shop.z*83)|0);
  if(culture<.08)return 10;
  if(culture<.16)return 11;
  if(culture<.24)return 12;
  // The original eight signs used a CanvasTexture with two flipped rows.
  return ((hash2((shop.x*53)|0,(shop.z*47)|0)*8)|0)^4;
}
export function shopSignUV(trade) {
  const {columns,rows}=SHOP_SIGN_ATLAS;
  return [(trade%columns)/columns,(rows-1-Math.floor(trade/columns))/rows];
}
export function hasShopSign(shop) {return hash2((shop.x*31)|0,(shop.z*29)|0)<.62;}
