// Exact-GLB skinning checks: face vertices must keep their bind shape in Head space
// throughout every clip, not merely at the first walking/running frame.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import * as T from 'three';
import { loadMotion } from '../motion-glb.mjs';
import { CharacterAnimation } from '../../dist/src/character-animation.js';
import { CHIBI_FACE_KEYS } from './stabilize-chibi-heads.mjs';

export async function measureChibiHead(file, asset) {
  const g = await loadMotion(file),
    head = g.scene.getObjectByName('Head');
  const headY = head.getWorldPosition(new T.Vector3()).y;
  const inverse = new T.Matrix4().copy(head.matrixWorld).invert();
  const point = new T.Vector3(),
    samples = [],
    meshes = [],
    seams = new Map();
  g.scene.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    meshes.push(mesh);
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      // Include the hood/hair below the Head joint as well as the upper face.
      if (mesh.material.name === 'HeadSurface' || point.y >= headY + 1e-5)
        samples.push({ mesh, i, rest: point.clone().applyMatrix4(inverse) });
      // Exact material seams share the same bind vertex position.
      const key = [p.getX(i), p.getY(i), p.getZ(i)].map((v) => v.toFixed(6)).join(',');
      const group = seams.get(key) ?? [];
      group.push({ mesh, i });
      seams.set(key, group);
    }
  });
  const boundaries = [...seams.values()].filter((g) => new Set(g.map((s) => s.mesh)).size > 1);
  let maxSeamGap = 0;
  const first = new T.Vector3();
  const update = () => {
    g.scene.updateMatrixWorld(true);
    meshes.forEach((m) => m.skeleton.update());
    inverse.copy(head.matrixWorld).invert();
    let maximum = 0;
    for (const s of samples) {
      s.mesh.getVertexPosition(s.i, point).applyMatrix4(s.mesh.matrixWorld).applyMatrix4(inverse);
      maximum = Math.max(maximum, point.distanceTo(s.rest));
    }
    for (const group of boundaries) {
      const a = group[0];
      a.mesh.getVertexPosition(a.i, first).applyMatrix4(a.mesh.matrixWorld);
      for (const s of group.slice(1)) {
        s.mesh.getVertexPosition(s.i, point).applyMatrix4(s.mesh.matrixWorld);
        maxSeamGap = Math.max(maxSeamGap, first.distanceTo(point));
      }
    }
    return maximum;
  };
  const clips = [];
  for (const clip of g.animations) {
    const mixer = new T.AnimationMixer(g.scene),
      action = mixer.clipAction(clip);
    action.setLoop(T.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    let maximum = 0;
    for (let n = 0; n <= 30; n++) {
      mixer.setTime((clip.duration * n) / 30);
      maximum = Math.max(maximum, update());
    }
    clips.push({ name: clip.name, maxDeviationM: maximum, samples: 31 });
    mixer.stopAllAction();
    mixer.uncacheRoot(g.scene);
  }
  const animation = new CharacterAnimation(g.scene, g.animations, {
    walkSpeed: asset.locomotion.Walk_Loop.metresPerSecond,
    runSpeed: asset.locomotion.Run_Loop.metresPerSecond,
    groundLocomotion: true,
  });
  let maxCrossfadeDeviationM = 0;
  for (const [speed, running] of [
    [2, false],
    [4, true],
    [2, false],
    [0, false],
  ])
    for (let n = 0; n < 18; n++) {
      animation.update(1 / 60, speed, running);
      maxCrossfadeDeviationM = Math.max(maxCrossfadeDeviationM, update());
    }
  animation.dispose();
  return {
    vertices: samples.length,
    seamGroups: boundaries.length,
    maxSeamGapM: maxSeamGap,
    clips,
    maxDeviationM: Math.max(...clips.map((c) => c.maxDeviationM)),
    maxCrossfadeDeviationM,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [stage, out] = process.argv.slice(2),
    rows = [];
  for (const key of CHIBI_FACE_KEYS) {
    const asset = JSON.parse(await readFile(`public/models/${key}/asset.json`));
    const result = await measureChibiHead(
      stage === 'current' ? `public${asset.url}` : `${stage}/${key}/model.glb`,
      asset,
    );
    rows.push({ key, ...result });
    console.log(
      key,
      JSON.stringify({
        maxDeviationM: result.maxDeviationM,
        maxCrossfadeDeviationM: result.maxCrossfadeDeviationM,
        maxSeamGapM: result.maxSeamGapM,
      }),
    );
  }
  await writeFile(out, JSON.stringify(rows, null, 2) + '\n');
}
