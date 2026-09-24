// Treads, foundations and side walls share the surveyed mitred boundaries.
// Sampling this footprint never pulls an individual step towards a different
// city wall or changes the route's walking width.
export function wallStairPoint(t,u,v) {
  const c=t.corners;
  const left=[c[0][0]*(1-v)+c[3][0]*v,c[0][1]*(1-v)+c[3][1]*v];
  const right=[c[1][0]*(1-v)+c[2][0]*v,c[1][1]*(1-v)+c[2][1]*v];
  return [left[0]*(1-u)+right[0]*u,left[1]*(1-u)+right[1]*u];
}
