// The visible foot of a facade, independent of the observer's current floor.
// A wall alongside steps follows the local tread, not the midpoint of the street.
export function facadeGroundY(plan, x, z) {
  const terrain = plan.surfaceAt(x, z);
  const paving = plan.pavedY(x, z);
  const walk = plan.groundAt(x, z, terrain + 0.6);
  let y = terrain;
  // A wall walk above the street is a different layer. It cannot set the damp
  // band at the base of the house beneath it.
  if (paving !== null && Math.abs(paving - terrain) < 0.6) y = Math.max(y, paving);
  if (walk?.zone === 'alley' && Math.abs(walk.y - terrain) < 0.6) y = Math.max(y, walk.y);
  return y;
}

export function facadeHeightAttribute(geometry, plan) {
  const p = geometry.attributes.position, n = geometry.attributes.normal;
  const heights = new Float32Array(p.count), groundCache = new Map();
  for (let i = 0; i < p.count; i++) {
    // Sample just outside the wall. Repeated vertices at different heights
    // must resolve the very same ground position.
    const x = p.getX(i) + n.getX(i) * 0.08;
    const z = p.getZ(i) + n.getZ(i) * 0.08;
    const key = `${x.toFixed(3)},${z.toFixed(3)}`;
    if (!groundCache.has(key)) groundCache.set(key, facadeGroundY(plan, x, z));
    heights[i] = p.getY(i) - groundCache.get(key);
  }
  return heights;
}
