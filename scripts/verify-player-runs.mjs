import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { loadMotion } from './motion-glb.mjs';

const revision = process.argv[2] || 'revision-05';
const only = process.argv[3];
const results = [];
const hash = (b) => createHash('sha256').update(b).digest('hex');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
for (const { key } of CHARACTER_MODELS) {
  if (only && key !== only) continue;
  const asset = await json(`output/player-gaits/${revision}/${key}/asset.json`);
  const source = await loadMotion('public' + asset.playerRun.sourceDelivery);
  const g = await loadMotion(`output/player-gaits/${revision}/${key}/model.glb`);
  assert.equal(hash(g.bytes), asset.sha256);
  assert.equal(hash(source.bytes), asset.playerRun.sourceSha256);
  assert.ok(g.binary.subarray(0, source.binary.length).equals(source.binary));
  for (const field of ['nodes', 'skins', 'meshes', 'materials', 'textures', 'images'])
    assert.deepEqual(g.doc[field], source.doc[field]);
  for (let i = 0; i < g.doc.animations.length; i++)
    if (g.doc.animations[i].name !== 'Run_Loop')
      assert.deepEqual(g.doc.animations[i], source.doc.animations[i]);
  const originalManifest = await json(`assets/player-gaits/run-source-manifests/${key}.json`);
  assert.deepEqual(asset.spearThrust, originalManifest.spearThrust);
  assert.deepEqual(asset.locomotion.Walk_Loop, originalManifest.locomotion.Walk_Loop);
  const sole = { L: [], R: [] },
    surface = [];
  g.scene.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const a = mesh.geometry.attributes;
    for (let i = 0; i < a.position.count; i++) {
      const p = mesh.getVertexPosition(i, new T.Vector3()).applyMatrix4(mesh.matrixWorld);
      if (i % Math.max(1, Math.floor(a.position.count / 900)) === 0) surface.push({ mesh, i });
      for (const side of ['L', 'R']) {
        let weight = 0;
        for (let c = 0; c < 4; c++)
          if (
            ['Foot' + side, 'Toe' + side].includes(
              mesh.skeleton.bones[a.skinIndex.array[i * 4 + c]].name,
            )
          )
            weight += a.skinWeight.array[i * 4 + c];
        if (weight > 0.7) sole[side].push({ mesh, i, p });
      }
    }
  });
  for (const side of ['L', 'R']) {
    const y = Math.min(...sole[side].map((s) => s.p.y));
    sole[side] = sole[side]
      .filter((s) => s.p.y < y + asset.heightMetres * 0.016)
      .filter((s, i) => i % 3 === 0);
  }
  const clip = g.animations.find((c) => c.name === 'Run_Loop'),
    mixer = new T.AnimationMixer(g.scene);
  const action = mixer.clipAction(clip).setLoop(T.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const pos = (n) => g.scene.getObjectByName(n).getWorldPosition(new T.Vector3());
  const samples = [],
    frames = Math.ceil(clip.duration * 240);
  let first, last;
  function sample(phase) {
    action.time = phase * clip.duration;
    mixer.update(0);
    g.scene.updateMatrixWorld(true);
    g.scene.traverse((n) => {
      if (n.isSkinnedMesh) n.skeleton.update();
    });
    const heights = [],
      knees = [],
      hipAngles = [];
    for (const side of ['L', 'R']) {
      heights.push(
        Math.min(
          ...sole[side].map(
            (s) =>
              s.mesh.getVertexPosition(s.i, new T.Vector3()).applyMatrix4(s.mesh.matrixWorld).y,
          ),
        ),
      );
      const top = pos('UpperLeg' + side),
        knee = pos('LowerLeg' + side),
        foot = pos('Foot' + side);
      knees.push(
        T.MathUtils.radToDeg(Math.PI - top.clone().sub(knee).angleTo(foot.clone().sub(knee))),
      );
      hipAngles.push(T.MathUtils.radToDeg(Math.atan2(knee.z - top.z, top.y - knee.y)));
      assert.ok(knee.x * (side === 'L' ? 1 : -1) > 0, key + ' knee crosses centre');
    }
    return { phase, heights, knees, hipAngles, pelvis: pos('Hips').y };
  }
  for (let i = 0; i <= frames; i++) {
    samples.push(sample(i / frames));
    if (i === 0 || i === frames) {
      const snapshot = surface.map((s) =>
        s.mesh.getVertexPosition(s.i, new T.Vector3()).applyMatrix4(s.mesh.matrixWorld),
      );
      if (i === 0) first = snapshot;
      else last = snapshot;
    }
  }
  const contact = sample(0),
    loaded = sample(0.13),
    flight = sample(0.4);
  const metrics = {
    minimumSoleY: Math.min(...samples.flatMap((s) => s.heights)),
    maximumSoleY: Math.max(...samples.flatMap((s) => s.heights)),
    flightFraction:
      samples.filter((s) => Math.min(...s.heights) > 0.003 + asset.heightMetres * 0.004).length /
      samples.length,
    maximumKneeDegrees: Math.max(...samples.flatMap((s) => s.knees)),
    minimumKneeDegrees: Math.min(...samples.flatMap((s) => s.knees)),
    maximumHipDegrees: Math.max(...samples.flatMap((s) => s.hipAngles)),
    minimumHipDegrees: Math.min(...samples.flatMap((s) => s.hipAngles)),
    pelvisExcursionMetres:
      Math.max(...samples.map((s) => s.pelvis)) - Math.min(...samples.map((s) => s.pelvis)),
    loadedKneeDegrees: loaded.knees[0],
    contactKneeDegrees: contact.knees[0],
    riseFromLoadingToFlight: flight.pelvis - loaded.pelvis,
    loopSurfaceError: Math.max(...first.map((p, i) => p.distanceTo(last[i]))),
    maximumKneeDegreesPerSecond: Math.max(
      ...samples
        .slice(1)
        .flatMap((s, i) =>
          s.knees.map((a, j) => (Math.abs(a - samples[i].knees[j]) * frames) / clip.duration),
        ),
    ),
  };
  console.log(key, JSON.stringify(metrics));
  assert.ok(metrics.minimumSoleY > -0.002, key + ' sole sinking');
  assert.ok(metrics.flightFraction > 0.08 && metrics.flightFraction < 0.4, key + ' flight');
  assert.ok(metrics.maximumKneeDegrees < 116, key + ' crumpled recovery knee');
  assert.ok(metrics.minimumKneeDegrees > 8, key + ' knee locking');
  assert.ok(metrics.maximumHipDegrees < 60, key + ' exaggerated high knee');
  // The short-legged, broad-bodied ape retains a heavier bounce than the humans.
  assert.ok(
    metrics.pelvisExcursionMetres < asset.heightMetres * (key === 'giant-ape' ? 0.075 : 0.065),
    key + ' excessive bob',
  );
  assert.ok(metrics.riseFromLoadingToFlight > asset.heightMetres * 0.02, key + ' missing spring');
  assert.ok(
    metrics.loadedKneeDegrees > metrics.contactKneeDegrees + 10,
    key + ' landing absorption',
  );
  assert.ok(metrics.loopSurfaceError < 0.00001, key + ' loop closure');
  assert.ok(metrics.maximumKneeDegreesPerSecond < 1250, key + ' knee snap');
  results.push({ key, sha256: asset.sha256, metrics, samples });
}
await writeFile(
  `output/player-gaits/${revision}/run-validation${only ? '-' + only : ''}.json`,
  JSON.stringify(
    {
      revision,
      method:
        'Exact exported GLB sampled at 240 Hz; run-only byte preservation, textured-skin soles, joint flexion, loading/flight pelvis and loop surface',
      results,
    },
    null,
    2,
  ) + '\n',
);
