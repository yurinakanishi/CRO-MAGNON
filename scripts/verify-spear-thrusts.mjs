import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { handGripPlacement } from '../dist/src/character-assets.js';
import { orientSpear } from '../dist/src/spear-pose.js';
import { loadMotion } from './motion-glb.mjs';
const revision = process.argv[2] || 'revision-02',
  base = `output/spear-thrusts/${revision}`,
  results = [];
const hash = (b) => createHash('sha256').update(b).digest('hex'),
  v = () => new T.Vector3();
for (const { key } of CHARACTER_MODELS.filter((m) => ['cro', 'nea'].includes(m.species))) {
  const source = await loadMotion(`output/spear-thrusts/baseline/${key}/model.glb`),
    g = await loadMotion(`${base}/${key}/model.glb`),
    asset = JSON.parse(await readFile(`${base}/${key}/asset.json`, 'utf8'));
  assert.equal(hash(g.bytes), asset.sha256);
  assert.equal(hash(source.bytes), asset.spearThrust.sourceSha256);
  assert.ok(g.binary.subarray(0, source.binary.length).equals(source.binary));
  for (const field of ['nodes', 'meshes', 'skins', 'materials', 'textures', 'images'])
    assert.deepEqual(g.doc[field], source.doc[field]);
  for (let i = 0; i < g.doc.animations.length; i++)
    if (g.doc.animations[i].name !== 'Attack')
      assert.deepEqual(g.doc.animations[i], source.doc.animations[i]);
  const placement = handGripPlacement(g.scene),
    weapon = new T.Group();
  placement.grip.add(weapon);
  const soles = { L: [], R: [] },
    points = [];
  g.scene.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const a = mesh.geometry.attributes;
    for (let i = 0; i < a.position.count; i++)
      for (const side of ['L', 'R']) {
        let w = 0;
        for (let c = 0; c < 4; c++)
          if (
            ['Foot' + side, 'Toe' + side].includes(
              mesh.skeleton.bones[a.skinIndex.array[i * 4 + c]].name,
            )
          )
            w += a.skinWeight.array[i * 4 + c];
        if (w > 0.7)
          soles[side].push({
            mesh,
            i,
            p: mesh.getVertexPosition(i, v()).applyMatrix4(mesh.matrixWorld),
          });
      }
    for (let i = 0; i < a.position.count; i += Math.max(1, Math.floor(a.position.count / 1000)))
      points.push({ mesh, i });
  });
  for (const side of ['L', 'R']) {
    const low = Math.min(...soles[side].map((p) => p.p.y));
    soles[side] = soles[side]
      .filter((p) => p.p.y < low + asset.heightMetres * 0.016)
      .filter((_, i) => i % 3 === 0);
    assert.ok(soles[side].length > 10);
  }
  const clip = g.animations.find((c) => c.name === 'Attack'),
    mixer = new T.AnimationMixer(g.scene),
    action = mixer.clipAction(clip).setLoop(T.LoopOnce, 1).play();
  action.clampWhenFinished = true;
  assert.ok(Math.abs(clip.duration - 0.7) < 1e-6);
  const pos = (name) => g.scene.getObjectByName(name).getWorldPosition(v());
  const frames = [];
  let low = Infinity,
    maxGripError = 0,
    first,
    last;
  for (let i = 0; i <= 168; i++) {
    const time = i / 240;
    action.time = time;
    mixer.update(0);
    orientSpear(weapon, g.scene, true, placement.rotation, true, time);
    g.scene.updateMatrixWorld(true);
    g.scene.traverse((n) => {
      if (n.isSkinnedMesh) n.skeleton.update();
    });
    const foot = {};
    for (const side of ['L', 'R']) {
      const p = soles[side].map((s) =>
        s.mesh.getVertexPosition(s.i, v()).applyMatrix4(s.mesh.matrixWorld),
      );
      foot[side] = {
        y: Math.min(...p.map((p) => p.y)),
        centre: p
          .reduce((a, p) => a.add(p), v())
          .multiplyScalar(1 / p.length)
          .toArray(),
      };
    }
    low = Math.min(low, foot.L.y, foot.R.y);
    const shaft = new T.Vector3(0, 1, 0).applyQuaternion(
        weapon.getWorldQuaternion(new T.Quaternion()),
      ),
      grips = pos('GripL').sub(pos('GripR'));
    const along = grips.dot(shaft),
      error = grips.clone().addScaledVector(shaft, -along).length();
    if (time >= 0.15 && time <= 0.51) {
      maxGripError = Math.max(maxGripError, error);
      assert.ok(along > 0.24 && along < 0.4, `${key} left hand ahead`);
    }
    const surface = points.map((s) =>
      s.mesh.getVertexPosition(s.i, v()).applyMatrix4(s.mesh.matrixWorld),
    );
    assert.ok(surface.every((p) => p.toArray().every(Number.isFinite)));
    if (i === 0) first = surface;
    if (i === 168) last = surface;
    assert.deepEqual(g.scene.getObjectByName('Root').position.toArray(), [0, 0, 0]);
    frames.push({
      time,
      foot,
      gripError: error,
      along,
      shaft: shaft.toArray(),
      rear: pos('GripR').toArray(),
      hips: pos('Hips').toArray(),
    });
  }
  const at = (t) =>
      frames.reduce((best, f) => (Math.abs(f.time - t) < Math.abs(best.time - t) ? f : best)),
    start = at(0),
    impact = at(0.333),
    ready = at(0.16);
  const metrics = {
    minimumSoleY: low,
    maxGripError,
    returnSurfaceError: Math.max(...first.map((p, i) => p.distanceTo(last[i]))),
    leftStep: impact.foot.L.centre[2] - start.foot.L.centre[2],
    rightStep: impact.foot.R.centre[2] - start.foot.R.centre[2],
    thrustTravel: impact.rear[2] - ready.rear[2],
    impactVerticalAim: Math.abs(impact.shaft[1]),
    supportMaximumY: Math.max(...frames.map((f) => Math.min(f.foot.L.y, f.foot.R.y))),
  };
  assert.ok(metrics.minimumSoleY > -0.006, `${key} sole sinks ${low}`);
  assert.ok(metrics.supportMaximumY < 0.012, `${key} support foot floats`);
  assert.ok(metrics.maxGripError < 0.001, `${key} shaft leaves left palm`);
  assert.ok(metrics.leftStep > 0.4 && Math.abs(metrics.rightStep) < 0.05, `${key} left foot leads`);
  assert.ok(metrics.thrustTravel > 0.2, `${key} thrust forward`);
  assert.ok(metrics.impactVerticalAim < 0.001, `${key} horizontal impact`);
  assert.ok(metrics.returnSurfaceError < 1e-5, `${key} recovery returns to start`);
  results.push({ key, sha256: asset.sha256, metrics });
  await writeFile(`${base}/${key}/measurements.json`, JSON.stringify({ metrics, frames }, null, 2));
  console.log(key, JSON.stringify(metrics));
}
await writeFile(
  `${base}/validation.json`,
  JSON.stringify(
    {
      revision,
      method:
        'Exact exported GLB at 240 Hz, source buffer identity, other clips, actual sole skin, shaft alignment, foot lead and root recovery',
      results,
    },
    null,
    2,
  ),
);
