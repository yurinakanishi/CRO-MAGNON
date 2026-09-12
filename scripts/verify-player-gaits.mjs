import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { loadMotion } from './motion-glb.mjs';
const revision = process.argv[2] || 'revision-02',
  base = `output/player-gaits/${revision}`,
  results = [];
const hash = (b) => createHash('sha256').update(b).digest('hex');
for (const { key } of CHARACTER_MODELS) {
  const source = await loadMotion(`output/player-gaits/baseline/${key}/model.glb`),
    g = await loadMotion(`${base}/${key}/model.glb`),
    asset = JSON.parse(await readFile(`${base}/${key}/asset.json`));
  assert.equal(hash(g.bytes), asset.sha256);
  assert.equal(hash(source.bytes), asset.playerGaits.sourceSha256);
  assert.ok(
    g.binary.subarray(0, source.binary.length).equals(source.binary),
    'original buffers preserved',
  );
  for (const field of ['nodes', 'meshes', 'skins', 'materials', 'textures', 'images'])
    assert.deepEqual(g.doc[field], source.doc[field]);
  for (let i = 0; i < g.doc.animations.length; i++)
    if (!['Walk_Loop', 'Run_Loop'].includes(g.doc.animations[i].name))
      assert.deepEqual(g.doc.animations[i], source.doc.animations[i]);
  const sole = { L: [], R: [] },
    points = [];
  g.scene.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const a = mesh.geometry.attributes;
    for (let i = 0; i < a.position.count; i++)
      for (const side of ['L', 'R']) {
        let weight = 0;
        for (let c = 0; c < 4; c++)
          if (
            ['Foot' + side, 'Toe' + side].includes(
              mesh.skeleton.bones[a.skinIndex.array[i * 4 + c]].name,
            )
          )
            weight += a.skinWeight.array[i * 4 + c];
        if (weight > 0.7) {
          const p = mesh.getVertexPosition(i, new T.Vector3()).applyMatrix4(mesh.matrixWorld);
          sole[side].push({ mesh, i, p });
        }
      }
    for (let i = 0; i < a.position.count; i += Math.max(1, Math.floor(a.position.count / 500)))
      points.push({ mesh, i });
  });
  for (const side of ['L', 'R']) {
    const lowest = Math.min(...sole[side].map((s) => s.p.y));
    sole[side] = sole[side]
      .filter((s) => s.p.y < lowest + asset.heightMetres * 0.016)
      .filter((s, i) => i % 3 === 0);
    assert.ok(sole[side].length > 8);
  }
  const pos = (name) => g.scene.getObjectByName(name).getWorldPosition(new T.Vector3());
  const metrics = [];
  for (const name of ['Walk_Loop', 'Run_Loop']) {
    const clip = g.animations.find((c) => c.name === name),
      mixer = new T.AnimationMixer(g.scene),
      action = mixer.clipAction(clip).setLoop(T.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const count = Math.ceil(clip.duration * 120);
    let minimum = Infinity,
      peak = 0,
      flight = 0,
      elbow = 0,
      knee = 0,
      first,
      last;
    for (let f = 0; f <= count; f++) {
      action.time = (clip.duration * f) / count;
      mixer.update(0);
      g.scene.updateMatrixWorld(true);
      g.scene.traverse((n) => {
        if (n.isSkinnedMesh) n.skeleton.update();
      });
      const heights = ['L', 'R'].map((side) =>
        Math.min(
          ...sole[side].map(
            (s) =>
              s.mesh.getVertexPosition(s.i, new T.Vector3()).applyMatrix4(s.mesh.matrixWorld).y,
          ),
        ),
      );
      minimum = Math.min(minimum, ...heights);
      peak = Math.max(peak, ...heights);
      if (Math.min(...heights) > 0.003 + asset.heightMetres * 0.004) flight++;
      const upper = pos('UpperArmL'),
        lower = pos('LowerArmL'),
        hand = pos('HandL');
      elbow += Math.PI - upper.sub(lower).angleTo(hand.sub(lower));
      knee = Math.max(
        knee,
        Math.PI -
          pos('UpperLegL')
            .sub(pos('LowerLegL'))
            .angleTo(pos('FootL').sub(pos('LowerLegL'))),
      );
      const snapshot = points.map((s) =>
        s.mesh.getVertexPosition(s.i, new T.Vector3()).applyMatrix4(s.mesh.matrixWorld),
      );
      assert.ok(snapshot.every((p) => p.toArray().every(Number.isFinite)));
      if (f === 0) first = snapshot;
      if (f === count) last = snapshot;
      assert.deepEqual(g.scene.getObjectByName('Root').position.toArray(), [0, 0, 0]);
    }
    const loopError = Math.max(...first.map((p, i) => p.distanceTo(last[i])));
    metrics.push({
      name,
      duration: clip.duration,
      minimumSoleY: minimum,
      maximumSoleY: peak,
      flightFraction: flight / (count + 1),
      meanElbowBend: elbow / (count + 1),
      maximumKneeBend: knee,
      loopError,
    });
    mixer.stopAllAction();
    mixer.uncacheRoot(g.scene);
  }
  const walk = metrics[0],
    run = metrics[1];
  console.log(key, JSON.stringify(metrics));
  for (const m of metrics) {
    assert.ok(m.minimumSoleY > -0.012, `${key} ${m.name} sinking`);
    assert.ok(m.loopError < 1e-5, `${key} loop`);
  }
  assert.ok(walk.flightFraction < 0.02, `${key} walk keeps support`);
  assert.ok(run.flightFraction > 0.08, `${key} run has flight`);
  assert.ok(run.maximumSoleY > walk.maximumSoleY * 2.5, `${key} running heel recovery`);
  assert.ok(run.meanElbowBend > walk.meanElbowBend + 0.4, `${key} distinct elbow drive`);
  results.push({ key, sha256: asset.sha256, metrics });
}
await writeFile(
  `${base}/validation.json`,
  JSON.stringify(
    {
      revision,
      method:
        'Exact GLB at 120 Hz; sole skin, loop closure, elbow/knee angles, buffers and unrelated clips',
      results,
    },
    null,
    2,
  ),
);
