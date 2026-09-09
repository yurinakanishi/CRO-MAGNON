import { writeFile, readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { MOTION_KEYS, loadMotion } from './motion-glb.mjs';
const revision = process.argv[2] || 'revision-04',
  results = [];
for (const key of MOTION_KEYS) {
  const records = [];
  for (const version of ['baseline', revision]) {
    const gltf = await loadMotion(`output/creature-motion/${version}/${key}/model.glb`),
      manifest = JSON.parse(
        await readFile(`output/creature-motion/${version}/${key}/asset.json`, 'utf8'),
      ),
      feet = [],
      surface = [];
    gltf.scene.traverse((mesh) => {
      if (!mesh.isSkinnedMesh) return;
      const p = mesh.geometry.attributes.position,
        j = mesh.geometry.attributes.skinIndex,
        w = mesh.geometry.attributes.skinWeight;
      for (let i = 0; i < p.count; i++) {
        let footWeight = 0;
        for (let c = 0; c < 4; c++)
          if (/Foot|Toe/.test(mesh.skeleton.bones[j.array[i * 4 + c]]?.name))
            footWeight += w.array[i * 4 + c];
        if (footWeight > (key === 'woolly-mammoth' ? 0.3 : 0.7))
          feet.push({
            mesh,
            i,
            p: mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld),
          });
      }
      for (let i = 0; i < p.count; i += Math.max(1, Math.floor(p.count / 500)))
        surface.push({ mesh, i });
    });
    feet.sort((a, b) => a.p.y - b.p.y);
    const sole = feet.filter((f) => f.p.y < (feet[0]?.p.y || 0) + manifest.heightMetres * 0.016);
    const samples = sole.filter((_, i) => i % Math.max(1, Math.floor(sole.length / 96)) === 0);
    if (samples.length < 8) throw Error('Insufficient sole samples ' + key);
    for (const clip of gltf.animations) {
      const mixer = new THREE.AnimationMixer(gltf.scene),
        action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      let minY = Infinity,
        maxGroundGap = 0,
        maximumStep = 0,
        previous = null;
      const count = Math.ceil(clip.duration * 60);
      for (let f = 0; f <= count; f++) {
        action.time = (f / count) * clip.duration;
        mixer.update(0);
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((n) => {
          if (n.isSkinnedMesh) n.skeleton.update();
        });
        let ground = Infinity;
        for (const s of samples) {
          const p = s.mesh
            .getVertexPosition(s.i, new THREE.Vector3())
            .applyMatrix4(s.mesh.matrixWorld);
          ground = Math.min(ground, p.y);
        }
        minY = Math.min(minY, ground);
        maxGroundGap = Math.max(maxGroundGap, ground);
        if (f % 4 === 0) {
          const positions = surface.map((s) =>
            s.mesh.getVertexPosition(s.i, new THREE.Vector3()).applyMatrix4(s.mesh.matrixWorld),
          );
          for (let i = 0; i < positions.length; i++) {
            if (!positions[i].toArray().every(Number.isFinite)) throw Error('Nonfinite skin');
            if (previous) maximumStep = Math.max(maximumStep, positions[i].distanceTo(previous[i]));
          }
          previous = positions;
        }
      }
      records.push({
        version,
        clip: clip.name,
        frames: count + 1,
        soleSamples: samples.length,
        surfaceSamples: surface.length,
        minimumSoleY: minY,
        maximumLowestSoleY: maxGroundGap,
        maximumSampleDisplacementOver4Frames: maximumStep,
      });
      mixer.stopAllAction();
      mixer.uncacheRoot(gltf.scene);
    }
  }
  results.push({ key, records });
  console.log(
    key,
    JSON.stringify(
      records
        .filter((r) => r.version === revision)
        .map((r) => ({
          clip: r.clip,
          min: +r.minimumSoleY.toFixed(3),
          gap: +r.maximumLowestSoleY.toFixed(3),
        })),
    ),
  );
}
await writeFile(
  `output/creature-motion/${revision}/skin-validation.json`,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      method:
        '60 Hz exact-GLB skinning; distributed sole vertices and approximately 500 surface points per mesh. This is sampled surface QA, not exhaustive self-intersection testing.',
      results,
    },
    null,
    2,
  ) + '\n',
);
