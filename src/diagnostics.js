// Count what WebGLRenderer actually submits in the main scene pass. A building
// count is not an instance count: one window may occupy several separate batches.
export function makeRenderDiagnostics(root, mainCamera) {
  const batches = [], seen = new Set();
  let captures = [];
  const stats = { instances: 0, instanceCapacity: 0, instanceBatches: 0,
    residentInstances: 0, culledInstances: 0, drawCalls: 0, triangles: 0, dpr: 1 };
  root.traverse(mesh => {
    if (!mesh.isInstancedMesh) return;
    batches.push(mesh);
    const before = mesh.onBeforeRender;
    mesh.onBeforeRender = function (renderer, scene, camera, ...rest) {
      before?.call(this, renderer, scene, camera, ...rest);
      // The underwater/reflection pass shares this camera but changes its
      // layers. Shadow draws use onBeforeShadow and are counted in drawCalls.
      if (camera !== mainCamera || camera.layers.mask !== 1 || seen.has(this)) return;
      seen.add(this);
      stats.instances += this.count;
      stats.instanceBatches++;
    };
  });
  return {
    stats,
    captureNextFrame() {
      return new Promise(resolve => captures.push(resolve));
    },
    beginFrame() {
      seen.clear();
      stats.instances = stats.instanceBatches = 0;
    },
    finishFrame(renderer) {
      stats.drawCalls = renderer.info.render.calls;
      stats.triangles = renderer.info.render.triangles;
      stats.dpr = renderer.getPixelRatio();
      stats.instanceCapacity = stats.residentInstances = 0;
      for (const mesh of batches) {
        stats.instanceCapacity += mesh.instanceMatrix.count;
        stats.residentInstances += mesh.count;
      }
      stats.culledInstances = stats.instanceCapacity - stats.residentInstances;
      if (captures.length) {
        // Read inside the application's render callback, before the browser
        // compositor may recycle a non-preserved drawing buffer. Only the
        // screenshot harness requests this synchronous GPU readback.
        renderer.getContext().finish();
        const png = renderer.domElement.toDataURL('image/png');
        const pending = captures;
        captures = [];
        for (const resolve of pending) resolve(png);
      }
    },
  };
}
