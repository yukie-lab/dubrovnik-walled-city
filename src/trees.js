// Each planted tree grows independent wood and foliage volumes into a shared
// indexed chunk. Species, root sites and height draws are kept in surround.js.
export {WoodlandBuffer as TreeBuf} from './woodland-shape.js';
export {patchWoodlandWind as patchTreeWind,woodlandDepthMaterial} from './woodland-wind.js';
export {patchWoodlandSurface} from './woodland-surface.js';
export {woodlandLeafMesh} from './woodland-leaves.js';
import {growPine,growCypress,growOlive,growMaquis} from './woodland-growth.js';

export function aleppoPine(B,base,rnd,o={}) {return growPine(B,base,rnd,o);}
export function cypress(B,base,rnd,o={}) {return growCypress(B,base,rnd,o);}
export function olive(B,base,rnd,o={}) {return growOlive(B,base,rnd,o);}
export function maquis(B,base,rnd,o={}) {return growMaquis(B,base,rnd,o);}
