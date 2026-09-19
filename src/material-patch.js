// Snapshot the upstream identity before replacing onBeforeCompile. Three's
// default cache key reads the CURRENT callback, so asking for it after wrapping
// erases the distinction between every shader behind that wrapper.
export function chainMaterialShader(material,id,patch) {
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.onBeforeCompile=function(shader,renderer) {
    previous.call(material,shader,renderer);
    patch.call(material,shader,renderer);
  };
  material.customProgramCacheKey=()=>key+'|'+id;
  return material;
}
