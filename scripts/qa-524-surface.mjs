// Preserved exact delivered-GLB surface assertions, sampled in an isolated Chrome scene.
import assert from 'node:assert/strict';
export async function verify524Surface(page) {
  const surface = await page.evaluate(async () => {
    const T = qaThree,
      r = window.qa;
    const { companion524Pose } = await import('/src/companion-524-renderer.js');
    const { COMPANION_524 } = await import('/shared/companion-524.mjs');
    const actor = r.worldAssets.createAnimal('yellow-524-mascot', 'Floating_Ripple');
    const stage = new T.Group(),
      tilt = new T.Group();
    actor.root.scale.setScalar(COMPANION_524.scale);
    tilt.add(actor.root);
    stage.add(tilt);
    actor.update(0.3);
    let minimum = Infinity,
      samples = 0,
      vertices = 0,
      loopError = 0;
    let bodyHeightMin = Infinity,
      bodyHeightMax = 0;
    const first = [];
    for (const reaction of ['idle', 'happy', 'hit'])
      for (let i = 0; i <= 16; i++) {
        const now = 10000 + i * (reaction === 'idle' ? 250 : reaction === 'happy' ? 112.5 : 40.625);
        const state = {
          ...r.state.companions.find((c) => c.key === '524'),
          facing: 0,
          petAt: 10000,
          petPlayerId: reaction === 'happy' ? r.selfId : null,
          petContactAt: reaction === 'happy' ? 10000 - COMPANION_524.petStrokeMs : 0,
          hitAt: 10000,
          petSequence: reaction === 'happy' ? 1 : 0,
          hitSequence: reaction === 'hit' ? 1 : 0,
          hitDirectionX: 0.707,
          hitDirectionZ: -0.707,
        };
        const pose = companion524Pose(state, now);
        stage.position.y = pose.height;
        tilt.rotation.set(pose.pitch, pose.spin, pose.roll);
        actor.mixer.setTime(i / 4);
        stage.updateMatrixWorld(true);
        const v = new T.Vector3();
        let offset = 0;
        let poseMin = Infinity,
          poseMax = -Infinity;
        actor.root.traverse((mesh) => {
          if (!mesh.isSkinnedMesh) return;
          mesh.skeleton.update();
          for (let j = 0; j < mesh.geometry.attributes.position.count; j++) {
            mesh.getVertexPosition(j, v).applyMatrix4(mesh.matrixWorld);
            if (![v.x, v.y, v.z].every(Number.isFinite)) throw Error('Nonfinite surface');
            minimum = Math.min(minimum, v.y);
            poseMin = Math.min(poseMin, v.y);
            poseMax = Math.max(poseMax, v.y);
            vertices++;
            if (reaction === 'idle' && i === 0) first.push(v.x, v.y, v.z);
            if (reaction === 'idle' && i === 16)
              loopError = Math.max(
                loopError,
                Math.hypot(v.x - first[offset], v.y - first[offset + 1], v.z - first[offset + 2]),
              );
            offset += 3;
          }
        });
        if (reaction === 'idle') {
          bodyHeightMin = Math.min(bodyHeightMin, poseMax - poseMin);
          bodyHeightMax = Math.max(bodyHeightMax, poseMax - poseMin);
        }
        samples++;
      }
    actor.dispose();
    const gl = r.renderer.getContext(),
      ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      minimum,
      samples,
      vertices,
      loopError,
      bodyHeightMin,
      bodyHeightMax,
      humanHeight: r.players.get(r.selfId).actor.asset.heightMetres,
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      triangles: r.renderer.info.render.triangles,
      memory: r.renderer.info.memory,
      loadMs: r.worldAssets.loadMilliseconds,
      fps: r.canvas.dataset.fps,
    };
  });
  assert.ok(surface.minimum > 0.6, JSON.stringify(surface));
  assert.ok(
    surface.bodyHeightMin > 0.285 && surface.bodyHeightMax < 0.315,
    JSON.stringify(surface),
  );
  assert.ok(surface.loopError < 1e-5);
  assert.ok(Math.abs(surface.humanHeight - 1.67) < 1e-12);

  return surface;
}
